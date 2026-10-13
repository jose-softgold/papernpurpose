import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { productService } from '../../services/products'
import { inventoryService } from '../../services/inventory'
import { occasionService } from '../../services/occasions'
import { Product, ProductVersion, Occasion } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import StatusBadge from '../../components/StatusBadge'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatCurrency } from '../../utils/format'
import { exportToCSV } from '../../utils/export'
import { GstRateSelect } from '../../components/GstFields'
import { useAuth } from '../../hooks/useAuth'
import { canWriteMaster } from '../../utils/roles'

interface ProductRow extends Product {
  activeVersion: ProductVersion | null
  stock: number
}

interface AddProductForm {
  name: string
  category: string
  description: string
  gstRate: string
  hsnSac: string
}

interface AddVersionForm {
  version: string
  description: string
}

const emptyProductForm: AddProductForm = { name: '', category: '', description: '', gstRate: '0', hsnSac: '' }
const emptyVersionForm: AddVersionForm = { version: 'V1', description: '' }

export default function ProductList() {
  const { role } = useAuth()
  const canEdit = canWriteMaster(role)
  const [rows, setRows] = useState<ProductRow[]>([])
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [occasionFilter, setOccasionFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showAddVersion, setShowAddVersion] = useState(false)
  const [newProductId, setNewProductId] = useState<string | null>(null)
  const [productForm, setProductForm] = useState<AddProductForm>(emptyProductForm)
  const [versionForm, setVersionForm] = useState<AddVersionForm>(emptyVersionForm)
  const [saving, setSaving] = useState(false)
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const { toasts, showToast } = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const [products, stocks, allOccasions] = await Promise.all([
        productService.getAll(),
        inventoryService.getProductStocks(),
        occasionService.getActiveOccasions(),
      ])
      setOccasions(allOccasions)
      // fetch active versions in parallel
      const activeVersions = await Promise.all(products.map(p => productService.getActiveVersion(p.id)))
      setRows(products.map((p, i) => ({
        ...p,
        activeVersion: activeVersions[i],
        stock: stocks[p.id] ?? 0,
      })))
    } catch {
      showToast('Failed to load products', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const setProductField = (field: keyof AddProductForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setProductForm(f => ({ ...f, [field]: e.target.value }))

  const setVersionField = (field: keyof AddVersionForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setVersionForm(f => ({ ...f, [field]: e.target.value }))

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const id = await productService.create({
        name: productForm.name.trim(),
        category: productForm.category.trim(),
        description: productForm.description.trim(),
        defaultSellingPrice: 0,
        gstRate: parseFloat(productForm.gstRate) || 0,
        hsnSac: productForm.hsnSac.trim(),
        status: 'active',
        imageUrl: '',
      })
      if (selectedPhotos.length) {
        const urls = await Promise.all(selectedPhotos.map(async file => {
          const storageRef = ref(storage, `products/${id}/${Date.now()}-${file.name}`)
          await uploadBytes(storageRef, file)
          return getDownloadURL(storageRef)
        }))
        await productService.update(id, { photoUrls: urls })
      }
      setNewProductId(id)
      setShowAddProduct(false)
      setShowAddVersion(true)
    } catch {
      showToast('Failed to create product', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateVersion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProductId) return
    setSaving(true)
    try {
      await productService.createVersion({
        productId: newProductId,
        version: versionForm.version.trim(),
        description: versionForm.description.trim(),
        status: 'active',
      })
      showToast('Product and version created')
      setShowAddVersion(false)
      setProductForm(emptyProductForm)
      setVersionForm(emptyVersionForm)
      setNewProductId(null)
      await load()
    } catch {
      showToast('Failed to create version', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleSkipVersion = async () => {
    showToast('Product created (no version yet)')
    setShowAddVersion(false)
    setProductForm(emptyProductForm)
    setVersionForm(emptyVersionForm)
    setNewProductId(null)
    await load()
  }

  const handleExport = () => {
    const data = rows.map(r => ({
      Name: r.name,
      Category: r.category,
      'Current Version': r.activeVersion?.version ?? '—',
      Stock: r.stock,
      'Default Price (₹)': r.defaultSellingPrice,
      Status: r.status,
    }))
    exportToCSV(data as unknown as Record<string, unknown>[], 'products')
  }

  const occasionMap = Object.fromEntries(occasions.map(o => [o.id, o.name]))

  const filteredRows = occasionFilter === 'all'
    ? rows
    : rows.filter(r => (r.occasionIds ?? []).includes(occasionFilter))

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <ToastContainer toasts={toasts} />

      <PageHeader
        title="Products"
        subtitle={`${filteredRows.length} product${filteredRows.length === 1 ? '' : 's'} with versioned recipes`}
        icon="🎀"
        actions={
          <>
            <button className="btn btn-outline-secondary btn-sm" onClick={handleExport}>Export CSV</button>
            {canEdit && <Link to="/import?type=products" className="btn btn-outline-secondary btn-sm">Import</Link>}
            {canEdit && <Link to="/import?type=bom" className="btn btn-outline-secondary btn-sm">Import BOM</Link>}
            {canEdit && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddProduct(true)}>+ Add Product</button>
            )}
          </>
        }
      />

      {occasions.length > 0 && (
        <div className="d-flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            className={`btn btn-sm ${occasionFilter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setOccasionFilter('all')}
          >
            All
          </button>
          {occasions.map(o => (
            <button
              key={o.id}
              type="button"
              className={`btn btn-sm ${occasionFilter === o.id ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setOccasionFilter(o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <DataGrid
          items={filteredRows}
          empty={
            <EmptyState
              icon="🎀"
              message="No products yet"
              description="Add a product, then give it a version with its material recipe."
            />
          }
        >
            {pageItems => (
              <>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Occasions</th>
                    <th>Current Version</th>
                    <th>Stock</th>
                    <th>Unit Price</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(r => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/products/${r.id}`} className="text-decoration-none fw-semibold">{r.name}</Link>
                      </td>
                      <td>{r.category || '—'}</td>
                      <td>
                        {(r.occasionIds ?? []).length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <div className="d-flex flex-wrap gap-1">
                            {(r.occasionIds ?? []).map(oid => (
                              <span key={oid} className="badge bg-light text-dark border">
                                {occasionMap[oid] ?? oid.slice(0, 6)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{r.activeVersion?.version ?? <span className="text-muted">None</span>}</td>
                      <td>{r.stock}</td>
                      <td>{formatCurrency(r.defaultSellingPrice)}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>
                        <Link to={`/products/${r.id}`} className="btn btn-outline-primary btn-sm">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </DataGrid>
        </div>

      {/* Add Product Modal */}
      {showAddProduct && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={handleCreateProduct}>
                  <div className="modal-header">
                    <h5 className="modal-title">Add Product</h5>
                    <button type="button" className="btn-close" onClick={() => setShowAddProduct(false)} />
                  </div>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label">Name <span className="text-danger">*</span></label>
                      <input className="form-control" value={productForm.name} onChange={setProductField('name')} required />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Category</label>
                      <input className="form-control" value={productForm.category} onChange={setProductField('category')} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Description</label>
                      <textarea className="form-control" rows={2} value={productForm.description} onChange={setProductField('description')} />
                    </div>
                    <div className="mb-3">
                      <GstRateSelect value={productForm.gstRate} onChange={rate => setProductForm(f => ({ ...f, gstRate: String(rate) }))} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">HSN / SAC</label>
                      <input className="form-control" value={productForm.hsnSac} onChange={setProductField('hsnSac')} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Photos</label>
                      <input ref={fileRef} type="file" accept="image/*" multiple className="form-control"
                        onChange={e => setSelectedPhotos(e.target.files ? Array.from(e.target.files) : [])} />
                      {selectedPhotos.length > 0 && (
                        <div className="d-flex flex-wrap gap-1 mt-2">
                          {selectedPhotos.map(f => <span key={f.name} className="badge bg-secondary">{f.name}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddProduct(false)} disabled={saving}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Next: Add Version'}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add First Version Modal */}
      {showAddVersion && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={handleCreateVersion}>
                  <div className="modal-header">
                    <h5 className="modal-title">Add First Version</h5>
                  </div>
                  <div className="modal-body">
                    <p className="text-muted small">Add an initial version for this product (e.g. V1). You can add more versions later.</p>
                    <div className="mb-3">
                      <label className="form-label">Version Label <span className="text-danger">*</span></label>
                      <input className="form-control" value={versionForm.version} onChange={setVersionField('version')} required />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Description</label>
                      <textarea className="form-control" rows={2} value={versionForm.description} onChange={setVersionField('description')} />
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={handleSkipVersion} disabled={saving}>Skip for Now</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create Version'}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
