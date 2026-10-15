import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BankTransaction, Material, Purchase, PurchaseItem } from '../types'
import { purchaseService, groupPaymentsByPurchase, summarizePayments, PAY_STATUS_LABEL } from '../services/purchases'
import { materialService } from '../services/materials'
import { bankService } from '../services/bank'
import { formatCurrency, formatDate } from '../utils/format'
import { PAY_STATUS_BADGE } from './PurchasePaymentsModal'

interface MaterialRow {
  key: string
  name: string
  unit: string
  qty: number
  spent: number
  bills: Set<string>
  lastMs: number
  lastDate: Purchase['purchaseDate'] | null
  lastRate: number
}

const ms = (p?: Purchase) => p?.purchaseDate?.toMillis?.() ?? 0

export default function SupplierPurchases({ supplierId, showPayments }: { supplierId: string; showPayments: boolean }) {
  const [loading, setLoading] = useState(true)
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [items, setItems] = useState<PurchaseItem[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [payments, setPayments] = useState<Map<string, BankTransaction[]>>(new Map())
  const [view, setView] = useState<'items' | 'bills'>('items')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const bills = await purchaseService.getBySupplier(supplierId)
        const [lines, mats, txs] = await Promise.all([
          bills.length ? purchaseService.getItemsForPurchases(bills.map(b => b.id)) : Promise.resolve([] as PurchaseItem[]),
          materialService.getAll(),
          showPayments ? bankService.listPurchasePayments().catch(() => [] as BankTransaction[]) : Promise.resolve([] as BankTransaction[]),
        ])
        if (cancelled) return
        setPurchases(bills)
        setItems(lines)
        setMaterials(mats)
        setPayments(groupPaymentsByPurchase(txs))
      } catch (err) {
        console.error(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [supplierId, showPayments])

  const { materialRows, itemsByBill, summaries, totals } = useMemo(() => {
    const matById = Object.fromEntries(materials.map(m => [m.id, m]))
    const billById = Object.fromEntries(purchases.map(p => [p.id, p]))
    const rows = new Map<string, MaterialRow>()
    const byBill = new Map<string, PurchaseItem[]>()
    for (const item of items) {
      byBill.set(item.purchaseId, [...(byBill.get(item.purchaseId) ?? []), item])
      const isCharge = item.kind === 'charge' || !item.materialId
      const key = isCharge ? `charge:${(item.description || 'Charge').toLowerCase()}` : item.materialId
      const mat = matById[item.materialId]
      const row = rows.get(key) ?? {
        key,
        name: isCharge ? `${item.description || 'Charge'} (charge)` : mat?.name || 'Deleted material',
        unit: isCharge ? '' : mat?.unit || '',
        qty: 0, spent: 0, bills: new Set<string>(), lastMs: 0, lastDate: null, lastRate: 0,
      }
      row.qty += Number(item.quantity || 0)
      row.spent += Number(item.total || 0)
      row.bills.add(item.purchaseId)
      const bill = billById[item.purchaseId]
      const when = ms(bill)
      if (when >= row.lastMs) {
        row.lastMs = when
        row.lastDate = bill?.purchaseDate ?? null
        row.lastRate = Number(item.unitCost || 0)
      }
      rows.set(key, row)
    }
    const sums = new Map(purchases.map(p => [p.id, summarizePayments(p, payments.get(p.id))]))
    return {
      materialRows: [...rows.values()].sort((a, b) => b.spent - a.spent),
      itemsByBill: byBill,
      summaries: sums,
      totals: {
        spent: purchases.reduce((s, p) => s + Number(p.grandTotal ?? p.total ?? 0), 0),
        due: [...sums.values()].reduce((s, x) => s + x.balance, 0),
      },
    }
  }, [purchases, items, materials, payments])

  const matName = (item: PurchaseItem) =>
    item.kind === 'charge' || !item.materialId
      ? item.description || 'Charge'
      : materials.find(m => m.id === item.materialId)?.name || 'Material'

  return (
    <div className="card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">Purchases from this supplier</h5>
        <div className="d-flex gap-2">
          <div className="btn-group btn-group-sm">
            <button className={`btn btn-outline-secondary${view === 'items' ? ' active' : ''}`} onClick={() => setView('items')}>Items bought</button>
            <button className={`btn btn-outline-secondary${view === 'bills' ? ' active' : ''}`} onClick={() => setView('bills')}>Bills</button>
          </div>
          <Link to="/purchases" className="btn btn-sm btn-outline-primary">+ New purchase</Link>
        </div>
      </div>

      {loading ? (
        <div className="card-body text-muted">Loading purchases…</div>
      ) : purchases.length === 0 ? (
        <div className="card-body text-muted">No purchases from this supplier yet.</div>
      ) : (
        <>
          <div className="card-body pb-0">
            <div className="row g-2">
              <div className="col-6 col-md-3">
                <div className="border rounded p-2 h-100">
                  <div className="small text-muted">Bills</div>
                  <div className="fw-semibold">{purchases.length}</div>
                </div>
              </div>
              <div className="col-6 col-md-3">
                <div className="border rounded p-2 h-100">
                  <div className="small text-muted">Total spent</div>
                  <div className="fw-semibold">{formatCurrency(totals.spent)}</div>
                </div>
              </div>
              {showPayments && (
                <div className="col-6 col-md-3">
                  <div className="border rounded p-2 h-100">
                    <div className="small text-muted">Balance due</div>
                    <div className={`fw-semibold${totals.due > 0 ? ' text-danger' : ''}`}>{formatCurrency(totals.due)}</div>
                  </div>
                </div>
              )}
              <div className="col-6 col-md-3">
                <div className="border rounded p-2 h-100">
                  <div className="small text-muted">Last purchase</div>
                  <div className="fw-semibold">{formatDate(purchases[0].purchaseDate)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="table-responsive mt-3">
            {view === 'items' ? (
              <table className="table table-hover mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-end">Total qty</th>
                    <th className="text-end">Bills</th>
                    <th className="text-end">Last rate</th>
                    <th className="text-end">Total spent</th>
                    <th>Last bought</th>
                  </tr>
                </thead>
                <tbody>
                  {materialRows.map(r => (
                    <tr key={r.key}>
                      <td className="fw-semibold">
                        {r.key.startsWith('charge:') ? r.name : <Link to={`/materials/${r.key}`}>{r.name}</Link>}
                      </td>
                      <td className="text-end">{r.qty.toLocaleString('en-IN')} {r.unit}</td>
                      <td className="text-end">{r.bills.size}</td>
                      <td className="text-end">{formatCurrency(r.lastRate)}</td>
                      <td className="text-end fw-semibold">{formatCurrency(r.spent)}</td>
                      <td className="small text-muted">{formatDate(r.lastDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="table table-hover mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Paid by</th>
                    <th className="text-end">Total</th>
                    {showPayments && <th>Payment</th>}
                  </tr>
                </thead>
                <tbody>
                  {purchases.map(p => {
                    const s = summaries.get(p.id)
                    return (
                      <tr key={p.id}>
                        <td className="small text-muted text-nowrap">{formatDate(p.purchaseDate)}</td>
                        <td className="small">
                          {(itemsByBill.get(p.id) ?? [])
                            .map(i => (i.kind === 'charge' ? matName(i) : `${matName(i)} × ${i.quantity}`))
                            .join(', ') || '—'}
                        </td>
                        <td>{p.purchasedByName || '—'}</td>
                        <td className="text-end fw-semibold">{formatCurrency(Number(p.grandTotal ?? p.total ?? 0))}</td>
                        {showPayments && (
                          <td>
                            {s?.assumed ? (
                              <span className="badge text-bg-light border">Assumed paid</span>
                            ) : s ? (
                              <>
                                <span className={`badge ${PAY_STATUS_BADGE[s.status]}`}>{PAY_STATUS_LABEL[s.status]}</span>
                                {s.balance > 0 && <div className="small text-danger">{formatCurrency(s.balance)} due</div>}
                              </>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
