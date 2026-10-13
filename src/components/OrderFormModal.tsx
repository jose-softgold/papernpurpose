import React, { useEffect, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { productService } from '../services/products'
import { customerService } from '../services/customers'
import { productionService } from '../services/production'
import { inventoryService } from '../services/inventory'
import { occasionService } from '../services/occasions'
import { bomService, bomCostBreakdown } from '../services/bom'
import { materialService } from '../services/materials'
import {
  Customer, Product, ProductVersion, Production, Occasion, OccasionSeason, BomItem, Material, Order, OrderItem,
} from '../types'
import { formatCurrency, timestampToDatetimeLocal } from '../utils/format'
import { lineTax } from '../utils/tax'
import EntityQuickCreate from './EntityQuickCreate'
import QuickSelect from './QuickSelect'
import { GstRateSelect } from './GstFields'

export interface OrderFormLine {
  productId: string
  productVersionId: string
  quantity: string
  unitPrice: string
  costPerUnit: string
  gstRate: string
  occasionSeasonId: string
}

export interface OrderFormValues {
  customerId: string
  orderDate: string
  eventDate: string
  eventType: string
  occasionId: string
  discount: string
  notes: string
}

const nowStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const emptyOrderLine = (): OrderFormLine => ({
  productId: '',
  productVersionId: '',
  quantity: '1',
  unitPrice: '',
  costPerUnit: '',
  gstRate: '0',
  occasionSeasonId: '',
})

export const emptyOrderForm = (): OrderFormValues => ({
  customerId: '',
  orderDate: nowStr(),
  eventDate: '',
  eventType: '',
  occasionId: '',
  discount: '0',
  notes: '',
})

export function orderToForm(order: Order): OrderFormValues {
  return {
    customerId: order.customerId,
    orderDate: timestampToDatetimeLocal(order.orderDate) || emptyOrderForm().orderDate,
    eventDate: timestampToDatetimeLocal(order.eventDate),
    eventType: order.eventType || '',
    occasionId: order.occasionId ?? '',
    discount: String(order.discount ?? 0),
    notes: order.notes || '',
  }
}

export function itemsToLines(items: OrderItem[]): OrderFormLine[] {
  if (!items.length) return [emptyOrderLine()]
  return items.map(item => ({
    productId: item.productId,
    productVersionId: item.productVersionId,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    costPerUnit: String(item.costPerUnit),
    gstRate: String(item.gstRate ?? 0),
    occasionSeasonId: item.occasionSeasonId ?? '',
  }))
}

export function orderFormToPayload(form: OrderFormValues, lines: OrderFormLine[]) {
  const toTs = (s: string): Timestamp => Timestamp.fromDate(new Date(s))
  const validLines = lines.filter(l => l.productId && l.productVersionId && parseFloat(l.quantity) > 0)
  return {
    customerId: form.customerId,
    orderDate: toTs(form.orderDate),
    eventDate: form.eventDate ? toTs(form.eventDate) : null,
    eventType: form.eventType.trim(),
    occasionId: form.occasionId || null,
    discount: parseFloat(form.discount) || 0,
    notes: form.notes.trim(),
    items: validLines.map(l => ({
      productId: l.productId,
      productVersionId: l.productVersionId,
      quantity: parseFloat(l.quantity),
      unitPrice: parseFloat(l.unitPrice) || 0,
      costPerUnit: parseFloat(l.costPerUnit) || 0,
      gstRate: parseFloat(l.gstRate) || 0,
      occasionSeasonId: l.occasionSeasonId || null,
    })),
  }
}

interface Props {
  show: boolean
  mode: 'create' | 'edit'
  initialForm?: OrderFormValues
  initialLines?: OrderFormLine[]
  warning?: string
  saving: boolean
  onCancel: () => void
  onSubmit: (form: OrderFormValues, lines: OrderFormLine[]) => void
}

export default function OrderFormModal({
  show, mode, initialForm, initialLines, warning, saving, onCancel, onSubmit,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [allVersions, setAllVersions] = useState<ProductVersion[]>([])
  const [allProductions, setAllProductions] = useState<Production[]>([])
  const [productStocks, setProductStocks] = useState<Record<string, number>>({})
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [seasons, setSeasons] = useState<OccasionSeason[]>([])
  const [bomItems, setBomItems] = useState<BomItem[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [form, setForm] = useState<OrderFormValues>(emptyOrderForm())
  const [lines, setLines] = useState<OrderFormLine[]>([emptyOrderLine()])
  const [showCustomerCreate, setShowCustomerCreate] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!show) return
    setForm(initialForm ?? emptyOrderForm())
    setLines(initialLines?.length ? initialLines : [emptyOrderLine()])
    setStep(1)
    setLoadError('')
    let cancelled = false
    Promise.all([
      customerService.getAll(),
      productService.getAll(),
      productService.getAllVersions(),
      productionService.getAll(),
      inventoryService.getProductStocks(),
      occasionService.getActiveOccasions(),
      occasionService.getAllSeasons(),
      bomService.getAll(),
      materialService.getAll(),
    ]).then(([custs, prods, versions, productions, stocks, occs, seas, boms, mats]) => {
      if (cancelled) return
      setCustomers(custs)
      setProducts(prods)
      setAllVersions(versions)
      setAllProductions(productions)
      setProductStocks(stocks)
      setOccasions(occs)
      setSeasons(seas.filter(s => s.status === 'active'))
      setBomItems(boms)
      setMaterials(mats)
    }).catch(() => {
      if (!cancelled) setLoadError('Failed to load reference data')
    })
    return () => { cancelled = true }
  }, [show])

  if (!show) return null

  const setField = (field: keyof OrderFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const versionsFor = (productId: string) =>
    allVersions.filter(v => v.productId === productId && v.status === 'active')

  const latestCostFor = (productId: string): number => {
    const runs = allProductions.filter(p => p.productId === productId && p.status === 'COMPLETED')
    if (runs.length === 0) return 0
    runs.sort((a, b) => {
      const ta = a.productionDate?.toMillis?.() ?? 0
      const tb = b.productionDate?.toMillis?.() ?? 0
      return tb - ta
    })
    return runs[0].costPerUnit
  }

  const bomCostFor = (versionId: string) =>
    bomCostBreakdown(bomItems.filter(b => b.productVersionId === versionId), materials)

  const costFor = (productId: string, versionId: string): number =>
    latestCostFor(productId) || bomCostFor(versionId).total

  const seasonsForOccasion = (occasionId: string) =>
    seasons.filter(s => s.occasionId === occasionId)

  const defaultSeasonForOccasion = (occasionId: string): string => {
    const year = new Date().getFullYear()
    const match = seasonsForOccasion(occasionId).find(s => s.year === year)
    return match?.id ?? seasonsForOccasion(occasionId)[0]?.id ?? ''
  }

  const handleOccasionChange = (occasionId: string) => {
    const occ = occasions.find(o => o.id === occasionId)
    setForm(f => ({
      ...f,
      occasionId,
      eventType: occ?.name ?? '',
    }))
    const seasonId = occasionId ? defaultSeasonForOccasion(occasionId) : ''
    setLines(prev => prev.map(l => ({ ...l, occasionSeasonId: seasonId })))
  }

  const updateLine = (i: number, field: keyof OrderFormLine, value: string) => {
    setLines(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      if (field === 'productId') {
        const prod = products.find(p => p.id === value)
        const vers = versionsFor(value)
        const versionId = vers[0]?.id ?? ''
        const ver = vers[0]
        next[i].productVersionId = versionId
        next[i].unitPrice = prod
          ? String(ver?.sellingPrice ?? prod.defaultSellingPrice)
          : ''
        next[i].costPerUnit = String(costFor(value, versionId))
        next[i].gstRate = String(prod?.gstRate ?? 0)
      }
      if (field === 'productVersionId') {
        const prod = products.find(p => p.id === next[i].productId)
        const ver = allVersions.find(v => v.id === value)
        next[i].costPerUnit = String(costFor(next[i].productId, value))
        if (prod) {
          next[i].unitPrice = String(ver?.sellingPrice ?? prod.defaultSellingPrice)
        }
      }
      return next
    })
  }

  const addLine = () => setLines(prev => [...prev, emptyOrderLine()])
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i))

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)
  const gstTotal = lines.reduce((s, l) => s + lineTax(parseFloat(l.quantity) || 0, parseFloat(l.unitPrice) || 0, parseFloat(l.gstRate) || 0).gstAmount, 0)
  const discountAmt = parseFloat(form.discount) || 0
  const total = subtotal + gstTotal - discountAmt

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 1) {
      setStep(2)
      return
    }
    const validLines = lines.filter(l => l.productId && l.productVersionId && parseFloat(l.quantity) > 0)
    if (validLines.length === 0) {
      setLoadError('Add at least one line item')
      return
    }
    onSubmit(form, validLines)
  }

  return (
    <>
      <div className="modal-backdrop fade show" />
      <div className="modal d-block" tabIndex={-1}>
        <div className="modal-dialog modal-xl modal-dialog-scrollable">
          <div className="modal-content">
            <form onSubmit={handleSubmit}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {mode === 'edit' ? 'Edit Order' : 'New Order'} — Step {step} of 2
                </h5>
                <button type="button" className="btn-close" onClick={onCancel} />
              </div>
              <div className="modal-body">
                {loadError && <div className="alert alert-danger py-2">{loadError}</div>}
                {warning && <div className="alert alert-warning py-2">{warning}</div>}
                {step === 1 && (
                  <div className="row g-3">
                    <div className="col-md-6">
                      <QuickSelect
                        label="Customer"
                        required
                        value={form.customerId}
                        onChange={id => setForm(f => ({ ...f, customerId: id }))}
                        placeholder="— Select Customer —"
                        options={customers.map(c => ({ id: c.id, label: c.name }))}
                        onAdd={() => setShowCustomerCreate(true)}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Occasion</label>
                      <select
                        className="form-select"
                        value={form.occasionId}
                        onChange={e => handleOccasionChange(e.target.value)}
                      >
                        <option value="">— Select or type below —</option>
                        {occasions.map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                      <input
                        className="form-control mt-2"
                        value={form.eventType}
                        onChange={setField('eventType')}
                        placeholder="Event label (auto-filled from occasion)"
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Order Date <span className="text-danger">*</span></label>
                      <input type="datetime-local" className="form-control" value={form.orderDate} onChange={setField('orderDate')} required />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Event Date</label>
                      <input type="datetime-local" className="form-control" value={form.eventDate} onChange={setField('eventDate')} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Discount (₹)</label>
                      <input type="number" min="0" step="0.01" className="form-control" value={form.discount} onChange={setField('discount')} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Notes</label>
                      <textarea className="form-control" rows={2} value={form.notes} onChange={setField('notes')} />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <>
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead className="table-light">
                          <tr>
                            <th>Product</th>
                            <th>Version</th>
                            <th style={{ width: 80 }}>Qty</th>
                            <th>Season</th>
                            <th style={{ width: 110 }}>Unit Price</th>
                            <th style={{ width: 90 }}>GST</th>
                            <th style={{ width: 100 }}>Cost/Unit</th>
                            <th style={{ width: 100 }}>Line</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line, i) => {
                            const tax = lineTax(parseFloat(line.quantity) || 0, parseFloat(line.unitPrice) || 0, parseFloat(line.gstRate) || 0)
                            const vers = versionsFor(line.productId)
                            const prod = products.find(p => p.id === line.productId)
                            const stock = line.productId ? (productStocks[line.productId] ?? 0) : null
                            const qty = parseFloat(line.quantity) || 0
                            const needToProduce = stock !== null ? Math.max(0, qty - stock) : 0
                            const bomCost = line.productVersionId
                              ? bomCostFor(line.productVersionId)
                              : { taxable: 0, gst: 0, total: 0 }
                            const fromBom = latestCostFor(line.productId) === 0 && bomCost.total > 0
                            return (
                              <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <select
                                    className="form-select form-select-sm"
                                    value={line.productId}
                                    onChange={e => updateLine(i, 'productId', e.target.value)}
                                    required
                                  >
                                    <option value="">— Product —</option>
                                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <select
                                    className="form-select form-select-sm"
                                    value={line.productVersionId}
                                    onChange={e => updateLine(i, 'productVersionId', e.target.value)}
                                    required
                                    disabled={!line.productId}
                                  >
                                    <option value="">— Version —</option>
                                    {vers.map(v => <option key={v.id} value={v.id}>{v.version}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number" min="1" step="1"
                                    className="form-control form-control-sm"
                                    value={line.quantity}
                                    onChange={e => updateLine(i, 'quantity', e.target.value)}
                                    required
                                  />
                                </td>
                                <td>
                                  <select
                                    className="form-select form-select-sm"
                                    value={line.occasionSeasonId}
                                    onChange={e => updateLine(i, 'occasionSeasonId', e.target.value)}
                                  >
                                    <option value="">Unassigned</option>
                                    {(form.occasionId
                                      ? seasonsForOccasion(form.occasionId)
                                      : seasons
                                    ).map(s => (
                                      <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number" min="0" step="0.01"
                                    className="form-control form-control-sm"
                                    value={line.unitPrice}
                                    onChange={e => updateLine(i, 'unitPrice', e.target.value)}
                                    required
                                  />
                                </td>
                                <td>
                                  <GstRateSelect
                                    label={null}
                                    compact
                                    className="form-select form-select-sm"
                                    value={line.gstRate}
                                    onChange={rate => updateLine(i, 'gstRate', String(rate))}
                                  />
                                </td>
                                <td>
                                  <span className="form-control form-control-sm bg-light text-muted" style={{ display: 'block' }}>
                                    {line.costPerUnit ? formatCurrency(parseFloat(line.costPerUnit) || 0) : '—'}
                                  </span>
                                </td>
                                <td className="text-end">{formatCurrency(tax.lineTotal)}</td>
                                <td>
                                  {lines.length > 1 && (
                                    <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeLine(i)}>✕</button>
                                  )}
                                </td>
                              </tr>
                              {prod && (
                                <tr className="table-light">
                                  <td colSpan={9} className="py-1 px-3">
                                    <div className="d-flex flex-wrap gap-3 small text-muted align-items-center">
                                      <span>
                                        <span className="fw-semibold text-dark">Stock: </span>
                                        <span className={stock === 0 ? 'text-danger fw-semibold' : 'text-success fw-semibold'}>{stock}</span>
                                      </span>
                                      <span>
                                        <span className="fw-semibold text-dark">Selling unit price: </span>
                                        {formatCurrency(prod.defaultSellingPrice)}
                                      </span>
                                      <span>
                                        <span className="fw-semibold text-dark">Cost/Unit: </span>
                                        {formatCurrency(parseFloat(line.costPerUnit) || 0)}
                                        {fromBom ? ` (from BOM, incl. GST ${formatCurrency(bomCost.gst)})` : ''}
                                      </span>
                                      {qty > 0 && (
                                        <span>
                                          <span className="fw-semibold text-dark">Qty Ordered: </span>{qty}
                                        </span>
                                      )}
                                      {qty > 0 && (
                                        <span className={needToProduce > 0 ? 'text-warning fw-semibold' : 'text-success'}>
                                          {needToProduce > 0
                                            ? `⚠ Need to produce: ${needToProduce}`
                                            : '✓ Stock sufficient'}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                              </React.Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button type="button" className="btn btn-outline-secondary btn-sm mb-3" onClick={addLine}>+ Add Item</button>
                    <div className="border-top pt-3">
                      <div className="row g-2 mb-2">
                        {(() => {
                          const totalCostAmt = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.costPerUnit) || 0), 0)
                          const totalRevenueAmt = total
                          const totalProfit = totalRevenueAmt - totalCostAmt
                          const marginPct = totalRevenueAmt > 0 ? (totalProfit / totalRevenueAmt) * 100 : 0
                          return (
                            <>
                              {[
                                { label: 'Total Revenue', value: formatCurrency(totalRevenueAmt), color: '' },
                                { label: 'Total Cost', value: formatCurrency(totalCostAmt), color: 'text-danger' },
                                { label: 'Gross Profit', value: formatCurrency(totalProfit), color: totalProfit >= 0 ? 'text-success' : 'text-danger' },
                                { label: 'Margin', value: `${marginPct.toFixed(1)}%`, color: marginPct >= 20 ? 'text-success' : marginPct >= 10 ? 'text-warning' : 'text-danger' },
                              ].map(({ label, value, color }) => (
                                <div key={label} className="col-6 col-md-3">
                                  <div className="border rounded p-2 text-center">
                                    <div className="text-muted small">{label}</div>
                                    <div className={`fw-bold ${color}`}>{value}</div>
                                  </div>
                                </div>
                              ))}
                            </>
                          )
                        })()}
                      </div>
                      <div className="text-end">
                        <div className="small text-muted">Taxable {formatCurrency(subtotal)} · GST {formatCurrency(gstTotal)} · Discount {formatCurrency(discountAmt)}</div>
                        <div className="fw-bold">Grand total: {formatCurrency(total)}</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                {step === 2 && (
                  <button type="button" className="btn btn-secondary me-auto" onClick={() => setStep(1)}>← Back</button>
                )}
                <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {step === 1
                    ? 'Next: Add Items →'
                    : saving
                      ? (mode === 'edit' ? 'Saving…' : 'Creating…')
                      : (mode === 'edit' ? 'Save Changes' : 'Create Order')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <EntityQuickCreate
        kind="customer"
        show={showCustomerCreate}
        onCancel={() => setShowCustomerCreate(false)}
        onCreated={created => {
          if (created.kind !== 'customer') return
          setCustomers(prev => [...prev, created.entity])
          setForm(f => ({ ...f, customerId: created.entity.id }))
          setShowCustomerCreate(false)
        }}
      />
    </>
  )
}
