import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { materialService } from '../../services/materials'
import { bomService } from '../../services/bom'
import { productService } from '../../services/products'
import { inventoryService } from '../../services/inventory'
import { purchaseService } from '../../services/purchases'
import { supplierService } from '../../services/suppliers'
import type { BomItem, Material, Product, ProductVersion, Purchase, PurchaseItem } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import PageHeader from '../../components/PageHeader'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import ConfirmModal from '../../components/ConfirmModal'
import { formatCurrency, formatDate } from '../../utils/format'
import { gstLabel } from '../../utils/tax'
import { useAuth } from '../../hooks/useAuth'
import { canWriteMaster, isWorker as roleIsWorker } from '../../utils/roles'

export default function MaterialDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toasts, showToast } = useToast()
  const { role } = useAuth()
  const isWorker = roleIsWorker(role)
  const canBom = canWriteMaster(role)

  const [material, setMaterial] = useState<Material | null>(null)
  const [stock, setStock] = useState(0)
  const [links, setLinks] = useState<Array<{ bom: BomItem; product: Product; version: ProductVersion }>>([])
  const [products, setProducts] = useState<Product[]>([])
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [productId, setProductId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [qty, setQty] = useState('1')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [buys, setBuys] = useState<Array<{ item: PurchaseItem; purchase: Purchase; supplier: string }>>([])

  const handleDelete = async () => {
    if (!material) return
    try {
      await materialService.delete(material.id, material.name)
      navigate('/materials')
    } catch {
      setConfirmDelete(false)
      showToast('Failed to delete material', 'danger')
    }
  }

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [mat, boms, prods, vers, stocks] = await Promise.all([
        materialService.getById(id),
        bomService.getByMaterialId(id),
        productService.getAll(),
        productService.getAllVersions(),
        inventoryService.getMaterialStocks(),
      ])
      if (!mat) {
        showToast('Material not found', 'danger')
        setLoading(false)
        return
      }
      setMaterial(mat)
      setStock(stocks[id] ?? 0)
      setProducts(prods.filter(p => p.status === 'active'))
      setVersions(vers)
      const prodMap = Object.fromEntries(prods.map(p => [p.id, p]))
      const verMap = Object.fromEntries(vers.map(v => [v.id, v]))
      setLinks(boms.flatMap(b => {
        const version = verMap[b.productVersionId]
        const product = version ? prodMap[version.productId] : undefined
        return product && version ? [{ bom: b, product, version }] : []
      }))
      const [lines, purchases, suppliers] = await Promise.all([
        purchaseService.getItemsByMaterial(id),
        purchaseService.getAll(),
        supplierService.getAll(),
      ]).catch(() => [[], [], []] as [PurchaseItem[], Purchase[], Awaited<ReturnType<typeof supplierService.getAll>>])
      const purchaseMap = Object.fromEntries(purchases.map(p => [p.id, p]))
      const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
      setBuys(lines
        .flatMap(item => {
          const purchase = purchaseMap[item.purchaseId]
          return purchase ? [{ item, purchase, supplier: supplierMap[purchase.supplierId] ?? '—' }] : []
        })
        .sort((a, b) => (b.purchase.purchaseDate?.toMillis?.() ?? 0) - (a.purchase.purchaseDate?.toMillis?.() ?? 0)))
    } catch {
      showToast('Failed to load material', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  const versionsFor = versions.filter(v => v.productId === productId && v.status === 'active')

  const handleAddToProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !versionId || !material) return
    setSaving(true)
    try {
      await bomService.create({
        productVersionId: versionId,
        materialId: id,
        quantity: parseFloat(qty) || 0,
        unit: material.unit,
      })
      showToast('Added to product BOM')
      setProductId('')
      setVersionId('')
      setQty('1')
      await load()
    } catch {
      showToast('Could not add to BOM', 'danger')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (!material) return <p className="text-danger">Material not found.</p>

  return (
    <div>
      <ToastContainer toasts={toasts} />
      <PageHeader
        title={material.name}
        subtitle="Used in products via BOM"
        icon="📦"
        actions={
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/materials')}>
              Back
            </button>
            {canBom && (
              <>
                <button className="btn btn-outline-primary btn-sm" onClick={() => navigate(`/materials?edit=${material.id}`)}>
                  Edit
                </button>
                <button className="btn btn-outline-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              </>
            )}
          </div>
        }
      />

      <ConfirmModal
        show={confirmDelete}
        title="Delete Material"
        message={`Delete ${material.name}? It is also removed from every product recipe that uses it.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <div className="card mb-3">
        <div className="card-body row g-3">
          <div className="col-6 col-md-3">
            <small className="text-muted d-block">Category</small>
            {material.category || '—'}
          </div>
          <div className="col-6 col-md-3">
            <small className="text-muted d-block">Color / spec</small>
            {material.colorSpec?.trim() || '—'}
          </div>
          <div className="col-6 col-md-3">
            <small className="text-muted d-block">Stock</small>
            {stock} {material.unit}
          </div>
          {!isWorker && (
            <div className="col-6 col-md-3">
              <small className="text-muted d-block">Cost / unit</small>
              {formatCurrency(material.costPerUnit)}
            </div>
          )}
          {!isWorker && (
            <div className="col-6 col-md-3">
              <small className="text-muted d-block">GST / HSN</small>
              {gstLabel(material.gstRate)} {material.hsnSac ? `· ${material.hsnSac}` : ''}
            </div>
          )}
          {material.notes && (
            <div className="col-12">
              <small className="text-muted d-block">Description</small>
              {material.notes}
            </div>
          )}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-header"><h5 className="mb-0">Used in products</h5></div>
        {links.length === 0 ? (
          <div className="card-body text-muted">Not on any product BOM yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Version</th>
                  <th>Qty / unit</th>
                </tr>
              </thead>
              <tbody>
                {links.map(l => (
                  <tr key={l.bom.id}>
                    <td>
                      <Link to={`/products/${l.product.id}`}>{l.product.name}</Link>
                    </td>
                    <td>{l.version.version}</td>
                    <td>{l.bom.quantity} {l.bom.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Purchase history</h5>
          {buys.length > 0 && (
            <small className="text-muted">
              {buys.reduce((s, b) => s + Number(b.item.quantity || 0), 0)} {material.unit} bought in {buys.length} purchase{buys.length === 1 ? '' : 's'}
            </small>
          )}
        </div>
        {buys.length === 0 ? (
          <div className="card-body text-muted">No purchases recorded for this material yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Paid by</th>
                  <th className="text-end">Qty</th>
                  {!isWorker && <th className="text-end">Unit cost</th>}
                  {!isWorker && <th className="text-end">GST</th>}
                  {!isWorker && <th className="text-end">Line total</th>}
                </tr>
              </thead>
              <tbody>
                {buys.map(({ item, purchase, supplier }) => (
                  <tr key={item.id}>
                    <td>{formatDate(purchase.purchaseDate)}</td>
                    <td>{supplier}</td>
                    <td>{purchase.purchasedByName || '—'}</td>
                    <td className="text-end">{item.quantity} {material.unit}</td>
                    {!isWorker && <td className="text-end">{formatCurrency(item.unitCost)}</td>}
                    {!isWorker && <td className="text-end">{gstLabel(item.gstRate)}</td>}
                    {!isWorker && <td className="text-end">{formatCurrency(item.total)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canBom && (
        <div className="card">
          <div className="card-header"><h5 className="mb-0">Add to a product BOM</h5></div>
          <div className="card-body">
            <form onSubmit={handleAddToProduct} className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Product</label>
                <select
                  className="form-select"
                  value={productId}
                  onChange={e => { setProductId(e.target.value); setVersionId('') }}
                  required
                >
                  <option value="">Select…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Version</label>
                <select className="form-select" value={versionId} onChange={e => setVersionId(e.target.value)} required disabled={!productId}>
                  <option value="">Select…</option>
                  {versionsFor.map(v => <option key={v.id} value={v.id}>{v.version}</option>)}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Qty per unit</label>
                <input className="form-control" type="number" min="0" step="0.001" value={qty} onChange={e => setQty(e.target.value)} required />
              </div>
              <div className="col-md-2 d-flex align-items-end">
                <button className="btn btn-primary w-100" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
