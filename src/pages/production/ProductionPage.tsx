import { useState, useEffect, useCallback } from 'react'
import { Timestamp } from 'firebase/firestore'
import { productService } from '../../services/products'
import { bomService } from '../../services/bom'
import { materialService } from '../../services/materials'
import { inventoryService } from '../../services/inventory'
import { productionService } from '../../services/production'
import { formatCurrency, formatDate } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import ToastContainer from '../../components/ToastContainer'
import type { Product, ProductVersion, BomItem, Material, Production } from '../../types'
import { useAuth } from '../../hooks/useAuth'

interface MaterialRow {
  bomItem: BomItem
  material: Material
  requiredTotal: number
  available: number
  sufficient: boolean
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function ProductionPage() {
  const { toasts, showToast } = useToast()
  const { role } = useAuth()
  const isWorker = role === 'worker'

  // Form state
  const [products, setProducts] = useState<Product[]>([])
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [quantity, setQuantity] = useState<number>(1)
  const [productionDate, setProductionDate] = useState(todayStr())
  const [notes, setNotes] = useState('')

  // Material check state
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([])
  const [materialLoading, setMaterialLoading] = useState(false)

  // History state
  const [history, setHistory] = useState<Production[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  // For display: product/version maps
  const [productMap, setProductMap] = useState<Record<string, Product>>({})
  const [versionMap, setVersionMap] = useState<Record<string, ProductVersion>>({})

  const [submitting, setSubmitting] = useState(false)

  // Load products on mount
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
  }, [])

  // Load versions when product changes
  useEffect(() => {
    if (!selectedProductId) {
      setVersions([])
      setSelectedVersionId('')
      return
    }
    productService.getVersions(selectedProductId).then(all => {
      const active = all.filter(v => v.status === 'active')
      setVersions(active.length ? active : all)
      const preferred = active.at(-1) ?? all.at(-1)
      setSelectedVersionId(preferred?.id ?? '')
    })
  }, [selectedProductId])

  // Load material check when version + quantity change
  useEffect(() => {
    if (!selectedVersionId || quantity < 1) {
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
      const rows: MaterialRow[] = boms.map(b => {
        const material = matMap[b.materialId]
        const requiredTotal = b.quantity * quantity
        const available = stocks[b.materialId] ?? 0
        return {
          bomItem: b,
          material,
          requiredTotal,
          available,
          sufficient: available >= requiredTotal,
        }
      })
      setMaterialRows(rows)
    }).finally(() => setMaterialLoading(false))
  }, [selectedVersionId, quantity])

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    productionService.getAll()
      .then(setHistory)
      .finally(() => setHistoryLoading(false))
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const allSufficient = materialRows.length > 0 && materialRows.every(r => r.sufficient)
  const formComplete = selectedProductId && selectedVersionId && quantity >= 1 && productionDate

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formComplete || !allSufficient || submitting) return

    setSubmitting(true)
    try {
      const ts = Timestamp.fromDate(new Date(productionDate))

      const bomMaterials = materialRows.map(r => ({
        materialId: r.bomItem.materialId,
        plannedQty: r.bomItem.quantity,
        unitCost: r.material.costPerUnit,
        unit: r.material.unit,
      }))

      await productionService.complete({
        productId: selectedProductId,
        productVersionId: selectedVersionId,
        quantity,
        productionDate: ts,
        notes,
        bomMaterials,
      })

      showToast('Production completed successfully', 'success')
      // Reset form
      setSelectedProductId('')
      setSelectedVersionId('')
      setQuantity(1)
      setProductionDate(todayStr())
      setNotes('')
      setMaterialRows([])
      loadHistory()
    } catch (err) {
      showToast('Failed to complete production', 'danger')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container-fluid py-3">
      <ToastContainer toasts={toasts} />

      {/* Section 1 — New Production */}
      <div className="card mb-4">
        <div className="card-header">
          <h5 className="mb-0">New Production</h5>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Product</label>
                <select
                  className="form-select"
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(e.target.value)}
                >
                  <option value="">Select product…</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="col-md-4">
                <label className="form-label">Version</label>
                <select
                  className="form-select"
                  value={selectedVersionId}
                  onChange={e => setSelectedVersionId(e.target.value)}
                  disabled={!selectedProductId}
                >
                  <option value="">Select version…</option>
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>{v.version}</option>
                  ))}
                </select>
              </div>

              <div className="col-md-2">
                <label className="form-label">Quantity</label>
                <input
                  type="number"
                  className="form-control"
                  min={1}
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>

              <div className="col-md-2">
                <label className="form-label">Production Date</label>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={productionDate}
                  onChange={e => setProductionDate(e.target.value)}
                />
              </div>

              <div className="col-12">
                <label className="form-label">Notes</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes…"
                />
              </div>
            </div>

            {/* Required Materials Table */}
            {selectedProductId && selectedVersionId && quantity >= 1 && (
              <div className="mt-4">
                <h6>Required Materials</h6>
                {materialLoading ? (
                  <LoadingSpinner />
                ) : materialRows.length === 0 ? (
                  <p className="text-muted">No BOM items found for this version.</p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered align-middle">
                      <thead className="table-light">
                        <tr>
                          <th>Material</th>
                          <th>Per Unit</th>
                          <th>Required Total</th>
                          <th>Available</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialRows.map(r => (
                          <tr key={r.bomItem.id}>
                            <td>{r.material?.name ?? r.bomItem.materialId}</td>
                            <td>{r.bomItem.quantity} {r.material?.unit ?? ''}</td>
                            <td>{r.requiredTotal} {r.material?.unit ?? ''}</td>
                            <td>{r.available} {r.material?.unit ?? ''}</td>
                            <td>
                              {r.sufficient
                                ? <span className="badge bg-success">OK</span>
                                : <span className="badge bg-danger">INSUFFICIENT</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!formComplete || !allSufficient || submitting || materialLoading}
              >
                {submitting ? 'Processing…' : 'Complete Production'}
              </button>
              {materialRows.length > 0 && !allSufficient && (
                <span className="ms-3 text-danger small">
                  Cannot complete: some materials are insufficient.
                </span>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Section 2 — Production History */}
      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">Production History</h5>
        </div>
        <div className="card-body p-0">
          {historyLoading ? (
            <div className="p-3"><LoadingSpinner /></div>
          ) : history.length === 0 ? (
            <div className="p-3">
              <EmptyState message="No production records yet." />
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Version</th>
                    <th>Qty</th>
                    {!isWorker && <th>Cost/Unit</th>}
                    {!isWorker && <th>Total Cost</th>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(p => (
                    <tr key={p.id}>
                      <td>{formatDate(p.productionDate)}</td>
                      <td>{productMap[p.productId]?.name ?? p.productId}</td>
                      <td>{versionMap[p.productVersionId]?.version ?? p.productVersionId}</td>
                      <td>{p.quantity}</td>
                      {!isWorker && <td>{formatCurrency(p.costPerUnit)}</td>}
                      {!isWorker && <td>{formatCurrency(p.totalMaterialCost)}</td>}
                      <td>
                        <span className={`badge ${
                          p.status === 'COMPLETED' ? 'bg-success' :
                          p.status === 'IN_PROGRESS' ? 'bg-warning text-dark' :
                          p.status === 'PLANNED' ? 'bg-info text-dark' : 'bg-secondary'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
