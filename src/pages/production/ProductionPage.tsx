import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Timestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { productService } from '../../services/products'
import { bomService } from '../../services/bom'
import { materialService } from '../../services/materials'
import { inventoryService } from '../../services/inventory'
import { productionService } from '../../services/production'
import { orderService } from '../../services/orders'
import { usersService } from '../../services/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import ToastContainer from '../../components/ToastContainer'
import WorkerPicker from '../../components/WorkerPicker'
import type { Product, ProductVersion, BomItem, Material, Production, Order, OrderItem, WorkerOption, OccasionSeason } from '../../types'
import { occasionService } from '../../services/occasions'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner, isWorker as roleIsWorker } from '../../utils/roles'
import { millisOf } from '../../utils/sort'

interface MaterialRow {
  bomItem: BomItem
  material: Material
  requiredTotal: number
  available: number
  sufficient: boolean
  actualQty: string
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function shortOrderId(id: string) {
  return id.slice(0, 6).toUpperCase()
}

function linkedOrderLabel(order: Order, items: OrderItem[], products: Record<string, Product>): string {
  const productPart = items
    .map(i => `${products[i.productId]?.name ?? 'Product'} ×${i.quantity}`)
    .join(', ')
  return [shortOrderId(order.id), order.eventType?.trim(), productPart].filter(Boolean).join(' · ')
}

export default function ProductionPage() {
  const { toasts, showToast } = useToast()
  const { role, user, userDoc } = useAuth()
  const isWorker = roleIsWorker(role)
  const canAssign = isAdminOrOwner(role)

  const [products, setProducts] = useState<Product[]>([])
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItemsById, setOrderItemsById] = useState<Record<string, OrderItem[]>>({})
  const [workers, setWorkers] = useState<WorkerOption[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [orderId, setOrderId] = useState('')
  const pendingFromOrderRef = useRef<{ productId: string; versionId: string } | null>(null)
  const [expectedQty, setExpectedQty] = useState(1)
  const [actualQty, setActualQty] = useState('')
  const [productionDate, setProductionDate] = useState(todayStr())
  const [notes, setNotes] = useState('')
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [completeNow, setCompleteNow] = useState(true)

  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([])
  const [materialLoading, setMaterialLoading] = useState(false)

  const [history, setHistory] = useState<Production[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [productMap, setProductMap] = useState<Record<string, Product>>({})
  const [versionMap, setVersionMap] = useState<Record<string, ProductVersion>>({})
  const [myWorkOnly, setMyWorkOnly] = useState(false)
  const [seasons, setSeasons] = useState<OccasionSeason[]>([])
  const [selectedSeasonId, setSelectedSeasonId] = useState('')
  const [batchCodePreview, setBatchCodePreview] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [completingId, setCompletingId] = useState<string | null>(null)

  useEffect(() => {
    productService.getAll().then(all => {
      const active = all.filter(p => p.status === 'active')
      setProducts(active)
      const map: Record<string, Product> = {}
      all.forEach(p => { map[p.id] = p })
      setProductMap(map)
    })
    productService.getAllVersions().then(all => {
      const map: Record<string, ProductVersion> = {}
      all.forEach(v => { map[v.id] = v })
      setVersionMap(map)
    })
    if (isWorker && !user?.uid) return
    orderService.listForProductionLink(isWorker ? user?.uid : undefined)
      .then(({ orders: list, itemsByOrderId }) => {
        setOrders(list)
        setOrderItemsById(itemsByOrderId)
      })
      .catch(() => {
        setOrders([])
        setOrderItemsById({})
      })
    if (canAssign) usersService.listWorkers().then(setWorkers).catch(() => {})
    occasionService.getAllSeasons().then(setSeasons).catch(() => {})
  }, [canAssign, isWorker, user?.uid])

  useEffect(() => {
    if (!selectedProductId) {
      setVersions([])
      setSelectedVersionId('')
      return
    }
    let cancelled = false
    productService.getVersions(selectedProductId).then(all => {
      if (cancelled) return
      const active = all.filter(v => v.status === 'active')
      const pending = pendingFromOrderRef.current
      const pendingVer = pending?.productId === selectedProductId
        ? all.find(v => v.id === pending.versionId)
        : undefined
      const base = active.length ? active : all
      setVersions(pendingVer && !base.some(v => v.id === pendingVer.id) ? [...base, pendingVer] : base)
      if (pendingVer) {
        pendingFromOrderRef.current = null
        setSelectedVersionId(pendingVer.id)
        return
      }
      const preferred = active.at(0) ?? all.at(0)
      setSelectedVersionId(preferred?.id ?? '')
    })
    return () => { cancelled = true }
  }, [selectedProductId])

  const selectedProduct = products.find(p => p.id === selectedProductId)
  const eligibleSeasons = useMemo(() => {
    const ids = selectedProduct?.occasionIds ?? []
    if (!ids.length) return seasons.filter(s => s.status === 'active')
    return seasons.filter(s => s.status === 'active' && ids.includes(s.occasionId))
  }, [seasons, selectedProduct])

  useEffect(() => {
    if (!selectedSeasonId) {
      setBatchCodePreview('')
      return
    }
    occasionService.nextSeasonBatchCode(selectedSeasonId)
      .then(setBatchCodePreview)
      .catch(() => setBatchCodePreview(''))
  }, [selectedSeasonId])

  useEffect(() => {
    if (selectedSeasonId && !eligibleSeasons.some(s => s.id === selectedSeasonId)) {
      setSelectedSeasonId('')
    }
  }, [eligibleSeasons, selectedSeasonId])

  useEffect(() => {
    if (!selectedVersionId || expectedQty < 1) {
      setMaterialRows([])
      return
    }
    setMaterialLoading(true)
    Promise.all([
      bomService.getByVersionId(selectedVersionId),
      materialService.getAll(),
      inventoryService.getMaterialStocks(),
    ]).then(([boms, materials, stocks]) => {
      const matMap: Record<string, Material> = {}
      materials.forEach(m => { matMap[m.id] = m })
      setMaterialRows(boms.map(b => {
        const material = matMap[b.materialId]
        const requiredTotal = b.quantity * expectedQty
        const available = stocks[b.materialId] ?? 0
        return {
          bomItem: b,
          material,
          requiredTotal,
          available,
          sufficient: available >= requiredTotal,
          actualQty: String(requiredTotal),
        }
      }))
    }).finally(() => setMaterialLoading(false))
  }, [selectedVersionId, expectedQty])

  const loadHistory = useCallback(() => {
    if (isWorker && !user?.uid) return
    setHistoryLoading(true)
    productionService.getAll(isWorker ? user?.uid : undefined)
      .then(setHistory)
      .finally(() => setHistoryLoading(false))
  }, [isWorker, user?.uid])

  useEffect(() => { loadHistory() }, [loadHistory])

  const allSufficient = materialRows.length > 0 && materialRows.every(r => r.sufficient)
  const formComplete = selectedProductId && selectedVersionId && expectedQty >= 1 && productionDate
  const parsedActual = actualQty === '' ? expectedQty : (parseFloat(actualQty) || 0)

  const linkableOrders = useMemo(() => {
    const byDate = (a: Order, b: Order) => millisOf(b.orderDate) - millisOf(a.orderDate)
    if (!selectedProductId) return [...orders].sort(byDate)
    const hasProduct = (o: Order) => (orderItemsById[o.id] ?? []).some(i => i.productId === selectedProductId)
    return [...orders].sort((a, b) => {
      const match = Number(hasProduct(b)) - Number(hasProduct(a))
      if (match !== 0) return match
      return byDate(a, b)
    })
  }, [orders, orderItemsById, selectedProductId])

  const applyLineFromOrder = (id: string) => {
    setOrderId(id)
    if (!id) return
    const items = orderItemsById[id] ?? []
    if (!items.length) return
    const line = (selectedProductId && items.find(i => i.productId === selectedProductId)) || items[0]
    const qty = Math.max(1, Math.round(Number(line.quantity)) || 1)
    setExpectedQty(qty)
    pendingFromOrderRef.current = line.productVersionId
      ? { productId: line.productId, versionId: line.productVersionId }
      : null
    if (line.productId === selectedProductId) {
      if (line.productVersionId && versions.some(v => v.id === line.productVersionId)) {
        setSelectedVersionId(line.productVersionId)
        pendingFromOrderRef.current = null
      } else if (line.productVersionId) {
        setSelectedVersionId(line.productVersionId)
      }
    } else {
      setSelectedProductId(line.productId)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formComplete || submitting) return
    if (completeNow && !allSufficient) return

    setSubmitting(true)
    try {
      const ts = Timestamp.fromDate(new Date(productionDate))
      const ids = isWorker && user ? [user.uid] : assignedIds
      const names = isWorker
        ? [userDoc?.name || user?.email || '']
        : workers.filter(w => assignedIds.includes(w.id)).map(w => w.name)
      const bomMaterials = materialRows.map(r => ({
        materialId: r.bomItem.materialId,
        plannedQty: r.bomItem.quantity,
        actualQty: parseFloat(r.actualQty) || r.requiredTotal,
        unitCost: r.material?.costPerUnit ?? 0,
        unit: r.material?.unit ?? r.bomItem.unit,
      }))
      const seasonId = selectedSeasonId || null
      const batchCode = seasonId ? batchCodePreview || undefined : undefined

      if (completeNow) {
        await productionService.complete({
          productId: selectedProductId,
          productVersionId: selectedVersionId,
          expectedQuantity: expectedQty,
          actualQuantity: parsedActual,
          productionDate: ts,
          notes,
          orderId: orderId || null,
          occasionSeasonId: seasonId,
          batchCode,
          assignedWorkerIds: ids,
          assignedWorkerNames: names,
          assignedBy: user?.uid,
          bomMaterials,
        })
        showToast('Production completed', 'success')
      } else {
        await productionService.start({
          productId: selectedProductId,
          productVersionId: selectedVersionId,
          expectedQuantity: expectedQty,
          productionDate: ts,
          notes,
          orderId: orderId || null,
          occasionSeasonId: seasonId,
          batchCode,
          assignedWorkerIds: ids,
          assignedWorkerNames: names,
          assignedBy: user?.uid,
          bomMaterials: bomMaterials.map(m => ({
            materialId: m.materialId,
            plannedQty: m.plannedQty,
            unitCost: m.unitCost,
            unit: m.unit,
          })),
        })
        showToast('Production batch started', 'success')
      }
      setSelectedProductId('')
      setSelectedVersionId('')
      setOrderId('')
      setExpectedQty(1)
      setActualQty('')
      setProductionDate(todayStr())
      setNotes('')
      setAssignedIds([])
      setSelectedSeasonId('')
      setBatchCodePreview('')
      setMaterialRows([])
      loadHistory()
    } catch (err) {
      showToast('Failed to save production', 'danger')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const finishExisting = async (p: Production) => {
    setCompletingId(p.id)
    try {
      const [mats, boms, allMats] = await Promise.all([
        productionService.getMaterials(p.id),
        bomService.getByVersionId(p.productVersionId),
        materialService.getAll(),
      ])
      const matMap = Object.fromEntries(allMats.map(m => [m.id, m]))
      const expected = p.expectedQuantity ?? p.quantity
      const actual = window.prompt(`Actual finished qty for ${p.batchCode || p.id.slice(0, 6)}? (expected ${expected})`, String(expected))
      if (actual == null) return
      const actualN = parseFloat(actual) || 0
      const bomMaterials = (mats.length ? mats : boms.map(b => ({
        materialId: b.materialId,
        plannedQuantity: b.quantity * expected,
        unitCost: matMap[b.materialId]?.costPerUnit ?? 0,
      }))).map(m => {
        const materialId = 'materialId' in m ? m.materialId : ''
        const planned = 'plannedQuantity' in m ? m.plannedQuantity : 0
        const perUnit = expected ? planned / expected : planned
        return {
          materialId,
          plannedQty: perUnit,
          actualQty: perUnit * actualN,
          unitCost: 'unitCost' in m ? m.unitCost : 0,
          unit: matMap[materialId]?.unit ?? '',
        }
      })
      await productionService.complete({
        productionId: p.id,
        productId: p.productId,
        productVersionId: p.productVersionId,
        expectedQuantity: expected,
        actualQuantity: actualN,
        productionDate: p.productionDate,
        notes: p.notes,
        orderId: p.orderId,
        batchCode: p.batchCode,
        occasionSeasonId: p.occasionSeasonId ?? null,
        assignedWorkerIds: p.assignedWorkerIds,
        assignedWorkerNames: p.assignedWorkerNames,
        bomMaterials,
      })
      showToast('Batch completed')
      loadHistory()
    } catch {
      showToast('Could not complete batch', 'danger')
    } finally {
      setCompletingId(null)
    }
  }

  const visibleHistory = history.filter(p => {
    if (isWorker) return !!user && (p.assignedWorkerIds ?? []).includes(user.uid)
    if (!myWorkOnly || !user) return true
    return (p.assignedWorkerIds ?? []).includes(user.uid)
  })

  return (
    <div className="pc-tap">
      <ToastContainer toasts={toasts} />

      <PageHeader
        title={isWorker ? 'Assigned to me' : 'Production'}
        subtitle={isWorker ? 'Batches assigned to you' : 'Log a batch with expected vs actual qty'}
        icon="🏭"
        actions={
          canAssign ? (
            <Link to="/import?type=production" className="btn btn-outline-secondary btn-sm">Import</Link>
          ) : undefined
        }
      />

      <div className="card mb-4">
        <div className="card-header">
          <h5 className="mb-0">New production batch</h5>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Product</label>
                <select className="form-select" value={selectedProductId} onChange={e => {
                  pendingFromOrderRef.current = null
                  setSelectedProductId(e.target.value)
                }}>
                  <option value="">Select product…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Version</label>
                <select className="form-select" value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)} disabled={!selectedProductId}>
                  <option value="">Select version…</option>
                  {versions.map(v => <option key={v.id} value={v.id}>{v.version}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Linked order (optional)</label>
                <select className="form-select" value={orderId} onChange={e => applyLineFromOrder(e.target.value)}>
                  <option value="">Without order</option>
                  {linkableOrders.map(o => (
                    <option key={o.id} value={o.id}>
                      {linkedOrderLabel(o, orderItemsById[o.id] ?? [], productMap)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Occasion season (optional)</label>
                <select
                  className="form-select"
                  value={selectedSeasonId}
                  onChange={e => setSelectedSeasonId(e.target.value)}
                  disabled={!selectedProductId}
                >
                  <option value="">Unassigned stock</option>
                  {eligibleSeasons.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
                  ))}
                </select>
                {batchCodePreview && (
                  <div className="form-text font-monospace">Batch: {batchCodePreview}</div>
                )}
              </div>
              <div className="col-6 col-md-2">
                <label className="form-label">Expected qty</label>
                <input type="number" className="form-control" min={1} value={expectedQty} onChange={e => setExpectedQty(Math.max(1, parseInt(e.target.value) || 1))} />
              </div>
              <div className="col-6 col-md-2">
                <label className="form-label">Actual qty</label>
                <input type="number" className="form-control" min={0} value={actualQty} placeholder={String(expectedQty)} onChange={e => setActualQty(e.target.value)} disabled={!completeNow} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Production date</label>
                <input type="datetime-local" className="form-control" value={productionDate} onChange={e => setProductionDate(e.target.value)} />
              </div>
              <div className="col-12">
                <label className="form-label">Notes</label>
                <textarea className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Waste, stitching issues, storage…" />
              </div>
              {canAssign && (
                <div className="col-md-6">
                  <WorkerPicker workers={workers} selectedIds={assignedIds} onChange={setAssignedIds} />
                </div>
              )}
              <div className="col-12">
                <label className="form-check">
                  <input className="form-check-input" type="checkbox" checked={completeNow} onChange={e => setCompleteNow(e.target.checked)} />
                  <span className="form-check-label">Complete now (consume materials and add finished stock)</span>
                </label>
              </div>
            </div>

            {selectedProductId && selectedVersionId && expectedQty >= 1 && (
              <div className="mt-4">
                <h6>Materials</h6>
                {materialLoading ? <LoadingSpinner /> : materialRows.length === 0 ? (
                  <p className="text-muted">No BOM items found for this version.</p>
                ) : (
                  <>
                    <div className="d-none d-lg-block table-responsive">
                      <table className="table table-sm table-bordered align-middle">
                        <thead className="table-light">
                          <tr>
                            <th>Material</th>
                            <th>Per unit</th>
                            <th>Expected</th>
                            {completeNow && <th>Actual used</th>}
                            <th>Available</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {materialRows.map((r, idx) => (
                            <tr key={r.bomItem.id}>
                              <td>{r.material?.name ?? r.bomItem.materialId}</td>
                              <td>{r.bomItem.quantity} {r.material?.unit ?? ''}</td>
                              <td>{r.requiredTotal} {r.material?.unit ?? ''}</td>
                              {completeNow && (
                                <td>
                                  <input
                                    type="number"
                                    className="form-control form-control-sm"
                                    min={0}
                                    step="0.001"
                                    value={r.actualQty}
                                    onChange={e => setMaterialRows(prev => prev.map((row, i) => i === idx ? { ...row, actualQty: e.target.value } : row))}
                                  />
                                </td>
                              )}
                              <td>{r.available} {r.material?.unit ?? ''}</td>
                              <td>
                                {r.sufficient
                                  ? <span className="badge bg-success">OK</span>
                                  : <span className="badge bg-danger">INSUFFICIENT</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="d-lg-none pc-line-cards">
                      {materialRows.map((r, idx) => (
                        <div key={r.bomItem.id} className="pc-line-card mb-2">
                          <div className="fw-semibold">{r.material?.name}</div>
                          <div className="small text-muted">Need {r.requiredTotal} · have {r.available} {r.material?.unit}</div>
                          {completeNow && (
                            <div className="mt-2">
                              <label className="form-label">Actual used</label>
                              <input
                                type="number"
                                className="form-control"
                                min={0}
                                value={r.actualQty}
                                onChange={e => setMaterialRows(prev => prev.map((row, i) => i === idx ? { ...row, actualQty: e.target.value } : row))}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="pc-sticky-submit">
              <button
                type="submit"
                className="btn btn-primary w-100"
                disabled={!formComplete || (completeNow && !allSufficient) || submitting || materialLoading}
              >
                {submitting ? 'Processing…' : completeNow ? 'Complete production' : 'Start batch'}
              </button>
              {completeNow && materialRows.length > 0 && !allSufficient && (
                <div className="text-danger small mt-2">Cannot complete: some materials are insufficient.</div>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h5 className="mb-0">{isWorker ? 'Assigned batches' : 'Production history'}</h5>
          {!isWorker && (
            <label className="form-check mb-0">
              <input className="form-check-input" type="checkbox" checked={myWorkOnly} onChange={e => setMyWorkOnly(e.target.checked)} />
              <span className="form-check-label">My work</span>
            </label>
          )}
        </div>
        <div className="card-body p-0">
          {historyLoading ? (
            <div className="p-3"><LoadingSpinner /></div>
          ) : (
            <DataGrid
              items={visibleHistory}
              resetKey={myWorkOnly}
              empty={
                <div className="p-3">
                  <EmptyState
                    icon="🏭"
                    message={isWorker ? 'Nothing assigned yet' : 'No production records yet'}
                    description={
                      isWorker
                        ? 'When an admin assigns you to a batch, it will show up here.'
                        : 'Pick a product version above and log your first run.'
                    }
                  />
                </div>
              }
            >
              {pageItems => (
                <>
                  <thead className="table-light">
                    <tr>
                      <th>Batch</th>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Expected</th>
                      <th>Actual</th>
                      <th>Assigned</th>
                      {!isWorker && <th>Cost/Unit</th>}
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(p => (
                      <tr key={p.id}>
                        <td className="font-monospace">{p.batchCode || p.id.slice(0, 6)}</td>
                        <td>{formatDate(p.productionDate)}</td>
                        <td>{productMap[p.productId]?.name ?? p.productId}<div className="small text-muted">{versionMap[p.productVersionId]?.version}</div></td>
                        <td>{p.expectedQuantity ?? p.quantity}</td>
                        <td>{p.status === 'COMPLETED' ? (p.actualQuantity ?? p.quantity) : '—'}</td>
                        <td className="small">{(p.assignedWorkerNames ?? []).join(', ') || '—'}</td>
                        {!isWorker && <td>{formatCurrency(p.costPerUnit)}</td>}
                        <td>
                          <span className={`badge ${
                            p.status === 'COMPLETED' ? 'bg-success' :
                            p.status === 'IN_PROGRESS' ? 'bg-warning text-dark' :
                            p.status === 'PLANNED' ? 'bg-info text-dark' : 'bg-secondary'
                          }`}>{p.status}</span>
                        </td>
                        <td>
                          {p.status !== 'COMPLETED' && p.status !== 'CANCELLED' && (
                            <button className="btn btn-sm btn-outline-primary" disabled={completingId === p.id} onClick={() => finishExisting(p)}>
                              Record actuals
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </DataGrid>
          )}
        </div>
      </div>
    </div>
  )
}
