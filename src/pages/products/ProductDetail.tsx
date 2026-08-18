import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../../firebase/config'
import { productService } from '../../services/products'
import { inventoryService } from '../../services/inventory'
import { bomService } from '../../services/bom'
import { materialService } from '../../services/materials'
import { Product, ProductVersion, Production, OrderItem, Order, BomItem, Material } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ConfirmModal from '../../components/ConfirmModal'
import StatusBadge from '../../components/StatusBadge'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatCurrency, formatDate, formatPercent } from '../../utils/format'
import { sortByNewest } from '../../utils/sort'
import { gstLabel, suggestedSell } from '../../utils/tax'
import { callRunDomainTool } from '../../firebase/functions'
import EntityQuickCreate from '../../components/EntityQuickCreate'
import { GstRateSelect } from '../../components/GstFields'

type Tab = 'overview' | 'packaging' | 'performance' | 'production' | 'sales' | 'customers' | 'bom'

interface CustomerRecord { id: string; name: string }

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toasts, showToast } = useToast()

  // Core data
  const [product, setProduct] = useState<Product | null>(null)
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<string>('')
  const [stock, setStock] = useState(0)
  const [productions, setProductions] = useState<Production[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [bomItems, setBomItems] = useState<BomItem[]>([])
  const [loading, setLoading] = useState(true)

  // Photos
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoFileRef = useRef<HTMLInputElement>(null)

  // Packaging
  const [packagingNotes, setPackagingNotes] = useState('')
  const [savingPackaging, setSavingPackaging] = useState(false)
  const [uploadingPackagingPhoto, setUploadingPackagingPhoto] = useState(false)
  const packagingPhotoRef = useRef<HTMLInputElement>(null)

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Edit product inline
  const [editingProduct, setEditingProduct] = useState(false)
  const [productForm, setProductForm] = useState({ name: '', category: '', description: '', defaultSellingPrice: '', gstRate: '0', hsnSac: '' })
  const [savingProduct, setSavingProduct] = useState(false)

  // Add version
  const [showAddVersion, setShowAddVersion] = useState(false)
  const [versionForm, setVersionForm] = useState({ version: '', description: '' })
  const [savingVersion, setSavingVersion] = useState(false)

  // BOM
  const [loadingBom, setLoadingBom] = useState(false)
  const [showAddBom, setShowAddBom] = useState(false)
  const [showMaterialCreate, setShowMaterialCreate] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null)
  const [bomForm, setBomForm] = useState({ materialId: '', quantity: '', unit: '' })
  const [savingBom, setSavingBom] = useState(false)
  const [editBomItem, setEditBomItem] = useState<BomItem | null>(null)
  const [editBomForm, setEditBomForm] = useState({ quantity: '', unit: '' })
  const [deleteBomId, setDeleteBomId] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    const fetchAll = async () => {
      try {
        const [
          prod,
          vers,
          stockVal,
          allProductions,
          allOrderItems,
          allOrders,
          allCustomers,
          allMaterials,
        ] = await Promise.all([
          productService.getById(id),
          productService.getVersions(id),
          inventoryService.getStock('product', id),
          getDocs(collection(db, 'productions')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as Production))),
          getDocs(collection(db, 'orderItems')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem))),
          getDocs(collection(db, 'orders')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as Order))),
          getDocs(collection(db, 'customers')).then(s => s.docs.map(d => ({ id: d.id, name: (d.data().name as string) || '' }))),
          materialService.getAll(),
        ])

        if (!prod) { setLoading(false); return }

        setProduct(prod)
        setPackagingNotes(prod.packagingNotes ?? '')
        setProductForm({
          name: prod.name,
          category: prod.category,
          description: prod.description,
          defaultSellingPrice: String(prod.defaultSellingPrice),
          gstRate: String(prod.gstRate ?? 0),
          hsnSac: prod.hsnSac ?? '',
        })
        setVersions(vers)
        // default selected version = newest active
        const active = vers.filter(v => v.status === 'active').at(0)
        setSelectedVersionId(active?.id ?? vers.at(0)?.id ?? '')
        setStock(stockVal)
        setProductions(sortByNewest(
          allProductions.filter(p => p.productId === id),
          p => p.productionDate,
        ))
        const myOrderItems = allOrderItems.filter(oi => oi.productId === id)
        setOrderItems(myOrderItems)
        setOrders(allOrders)
        setCustomers(allCustomers)
        setMaterials(allMaterials)
      } catch {
        showToast('Failed to load product data', 'danger')
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [id])

  // Load BOM when selected version changes
  useEffect(() => {
    if (!selectedVersionId) return
    setLoadingBom(true)
    bomService.getByVersionId(selectedVersionId).then(items => {
      setBomItems(items)
    }).catch(() => showToast('Failed to load BOM', 'danger'))
      .finally(() => setLoadingBom(false))
  }, [selectedVersionId])

  // ---- Derived data ----
  const cancelledOrderIds = new Set(orders.filter(o => o.status === 'CANCELLED').map(o => o.id))
  const activeOrderItems = orderItems.filter(oi => !cancelledOrderIds.has(oi.orderId))

  // Performance stats
  const totalProduced = productions.reduce((s, p) => s + p.quantity, 0)
  const totalSold = activeOrderItems.reduce((s, oi) => s + oi.quantity, 0)
  const totalRevenue = activeOrderItems.reduce((s, oi) => s + oi.totalPrice, 0)
  const totalCost = activeOrderItems.reduce((s, oi) => s + oi.totalCost, 0)
  const totalProfit = totalRevenue - totalCost
  const avgSellingPrice = totalSold > 0 ? totalRevenue / totalSold : 0
  const avgCostPerUnit = totalSold > 0 ? totalCost / totalSold : 0
  const profitPerUnit = avgSellingPrice - avgCostPerUnit
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  // Helpers
  const versionMap = Object.fromEntries(versions.map(v => [v.id, v.version]))
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]))
  const orderDateMap = Object.fromEntries(orders.map(o => [o.id, o.orderDate]))
  const orderCustomerMap = Object.fromEntries(orders.map(o => [o.id, o.customerId]))

  // Sales rows
  const salesRows = sortByNewest(
    activeOrderItems.map(oi => ({
      oi,
      date: orderDateMap[oi.orderId] ?? null,
      customerName: customerMap[orderCustomerMap[oi.orderId]] ?? '—',
    })),
    row => row.date,
  )

  // Customers aggregated
  interface CustomerAgg { name: string; qty: number; totalSpent: number }
  const customerAgg: Record<string, CustomerAgg> = {}
  salesRows.forEach(({ oi, customerName }) => {
    const cid = orderCustomerMap[oi.orderId] ?? 'unknown'
    if (!customerAgg[cid]) customerAgg[cid] = { name: customerName, qty: 0, totalSpent: 0 }
    customerAgg[cid].qty += oi.quantity
    customerAgg[cid].totalSpent += oi.totalPrice
  })
  const customerAggRows = Object.values(customerAgg)

  // ---- Handlers ----
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setSavingProduct(true)
    try {
      const updates = {
        name: productForm.name.trim(),
        category: productForm.category.trim(),
        description: productForm.description.trim(),
        defaultSellingPrice: parseFloat(productForm.defaultSellingPrice) || 0,
        gstRate: parseFloat(productForm.gstRate) || 0,
        hsnSac: productForm.hsnSac.trim(),
      }
      await productService.update(id, updates)
      setProduct(prev => prev ? { ...prev, ...updates } : prev)
      setEditingProduct(false)
      showToast('Product updated')
    } catch {
      showToast('Failed to update product', 'danger')
    } finally {
      setSavingProduct(false)
    }
  }

  const handleAddVersion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setSavingVersion(true)
    try {
      const newId = await productService.createVersion({
        productId: id,
        version: versionForm.version.trim(),
        description: versionForm.description.trim(),
        status: 'active',
      })
      const newVers = await productService.getVersions(id)
      setVersions(newVers)
      setSelectedVersionId(newId)
      setShowAddVersion(false)
      setVersionForm({ version: '', description: '' })
      showToast('Version added')
    } catch {
      showToast('Failed to add version', 'danger')
    } finally {
      setSavingVersion(false)
    }
  }

  const handleMarkActive = async (versionId: string) => {
    try {
      await productService.updateVersion(versionId, { status: 'active' })
      setVersions(prev => prev.map(v => v.id === versionId ? { ...v, status: 'active' } : v))
      showToast('Version marked active')
    } catch {
      showToast('Failed to update version', 'danger')
    }
  }

  const handleAddBom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedVersionId) return
    setSavingBom(true)
    try {
      await bomService.create({
        productVersionId: selectedVersionId,
        materialId: bomForm.materialId,
        quantity: parseFloat(bomForm.quantity) || 0,
        unit: bomForm.unit,
      })
      const updated = await bomService.getByVersionId(selectedVersionId)
      setBomItems(updated)
      setShowAddBom(false)
      setBomForm({ materialId: '', quantity: '', unit: '' })
      showToast('BOM item added')
    } catch {
      showToast('Failed to add BOM item', 'danger')
    } finally {
      setSavingBom(false)
    }
  }

  const handleEditBomSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editBomItem) return
    setSavingBom(true)
    try {
      await bomService.update(editBomItem.id, {
        quantity: parseFloat(editBomForm.quantity) || 0,
        unit: editBomForm.unit,
      })
      const updated = await bomService.getByVersionId(selectedVersionId)
      setBomItems(updated)
      setEditBomItem(null)
      showToast('BOM item updated')
    } catch {
      showToast('Failed to update BOM item', 'danger')
    } finally {
      setSavingBom(false)
    }
  }

  const handleDeleteBom = async () => {
    if (!deleteBomId) return
    try {
      await bomService.delete(deleteBomId)
      setBomItems(prev => prev.filter(b => b.id !== deleteBomId))
      setDeleteBomId(null)
      showToast('BOM item deleted')
    } catch {
      showToast('Failed to delete BOM item', 'danger')
    }
  }

  const materialMap = Object.fromEntries(materials.map(m => [m.id, m]))

  const handleSavePackagingNotes = async () => {
    if (!id) return
    setSavingPackaging(true)
    try {
      await productService.update(id, { packagingNotes })
      setProduct(prev => prev ? { ...prev, packagingNotes } : prev)
      showToast('Packaging notes saved')
    } catch {
      showToast('Failed to save packaging notes', 'danger')
    } finally {
      setSavingPackaging(false)
    }
  }

  const handlePackagingPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!id || !e.target.files?.length) return
    setUploadingPackagingPhoto(true)
    try {
      const urls: string[] = []
      for (const file of Array.from(e.target.files)) {
        const sRef = storageRef(storage, `products/${id}/packaging/${Date.now()}-${file.name}`)
        await uploadBytes(sRef, file)
        urls.push(await getDownloadURL(sRef))
      }
      const merged = [...(product?.packagingPhotoUrls ?? []), ...urls]
      await productService.update(id, { packagingPhotoUrls: merged })
      setProduct(prev => prev ? { ...prev, packagingPhotoUrls: merged } : prev)
      showToast(`${urls.length} photo${urls.length > 1 ? 's' : ''} uploaded`)
    } catch {
      showToast('Failed to upload photos', 'danger')
    } finally {
      setUploadingPackagingPhoto(false)
      if (packagingPhotoRef.current) packagingPhotoRef.current.value = ''
    }
  }

  const handlePackagingPhotoDelete = async (url: string) => {
    if (!id || !product) return
    try { await deleteObject(storageRef(storage, url)) } catch { /* already gone */ }
    const remaining = (product.packagingPhotoUrls ?? []).filter(u => u !== url)
    await productService.update(id, { packagingPhotoUrls: remaining })
    setProduct(prev => prev ? { ...prev, packagingPhotoUrls: remaining } : prev)
    showToast('Photo removed')
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!id || !e.target.files?.length) return
    setUploadingPhoto(true)
    try {
      const urls: string[] = []
      for (const file of Array.from(e.target.files)) {
        const sRef = storageRef(storage, `products/${id}/${Date.now()}-${file.name}`)
        await uploadBytes(sRef, file)
        urls.push(await getDownloadURL(sRef))
      }
      const merged = [...(product?.photoUrls ?? []), ...urls]
      await productService.update(id, { photoUrls: merged })
      setProduct(prev => prev ? { ...prev, photoUrls: merged } : prev)
      showToast(`${urls.length} photo${urls.length > 1 ? 's' : ''} uploaded`)
    } catch {
      showToast('Failed to upload photos', 'danger')
    } finally {
      setUploadingPhoto(false)
      if (photoFileRef.current) photoFileRef.current.value = ''
    }
  }

  const handlePhotoDelete = async (url: string) => {
    if (!id || !product) return
    try { await deleteObject(storageRef(storage, url)) } catch { /* already gone */ }
    const remaining = (product.photoUrls ?? []).filter(u => u !== url)
    await productService.update(id, { photoUrls: remaining })
    setProduct(prev => prev ? { ...prev, photoUrls: remaining } : prev)
    showToast('Photo removed')
  }

  if (loading) return <LoadingSpinner />
  if (!product) return (
    <div>
      <p className="text-danger">Product not found.</p>
      <button className="btn btn-secondary" onClick={() => navigate('/products')}>Back</button>
    </div>
  )

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'performance', label: 'Performance' },
    { key: 'production', label: 'Production History' },
    { key: 'sales', label: 'Sales History' },
    { key: 'customers', label: 'Customers' },
    { key: 'bom', label: 'BOM' },
    { key: 'packaging', label: 'Packaging' },
  ]

  return (
    <div>
      <ToastContainer toasts={toasts} />

      {/* Header */}
      <div className="d-flex align-items-center gap-3 mb-4 flex-wrap">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/products')}>&larr; Back</button>
        <h4 className="pc-page-title">{product.name}</h4>
        <StatusBadge status={product.status} />
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        {tabs.map(t => (
          <li key={t.key} className="nav-item">
            <button
              className={`nav-link${activeTab === t.key ? ' active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      {/* ===== OVERVIEW ===== */}
      {activeTab === 'overview' && (
        <div>
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">AI product calculation</h5>
              <button
                className="btn btn-sm btn-primary"
                disabled={aiLoading}
                onClick={async () => {
                  if (!id) return
                  setAiLoading(true)
                  try {
                    const data = await callRunDomainTool('analyze_product', { productId: id })
                    setAiResult((data as { result?: Record<string, unknown> }).result ?? data as Record<string, unknown>)
                  } catch {
                    showToast('AI calculation failed', 'danger')
                  } finally {
                    setAiLoading(false)
                  }
                }}
              >
                {aiLoading ? 'Calculating…' : 'AI calculate'}
              </button>
            </div>
            {aiResult && (
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-md-4"><small className="text-muted d-block">Max buildable</small><strong>{String(aiResult.maxBuildable ?? '—')}</strong></div>
                  <div className="col-md-4"><small className="text-muted d-block">Cost / unit</small><strong>{formatCurrency(Number(aiResult.costPerUnit ?? 0))}</strong></div>
                  <div className="col-md-4"><small className="text-muted d-block">Suggested sell (taxable)</small><strong>{formatCurrency(Number(aiResult.suggestedTaxableSell ?? 0))}</strong></div>
                  <div className="col-md-4"><small className="text-muted d-block">Invoice with GST</small><strong>{formatCurrency(Number(aiResult.suggestedInvoiceTotal ?? 0))}</strong></div>
                  <div className="col-md-4"><small className="text-muted d-block">Avg yield vs expected</small><strong>{String(aiResult.yieldPct ?? '—')}</strong></div>
                  <div className="col-12"><small className="text-muted d-block">Notes</small>{String(aiResult.guidance ?? '—')}</div>
                </div>
              </div>
            )}
          </div>
          {/* Product info card */}
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Product Information</h5>
              {!editingProduct && (
                <button className="btn btn-sm btn-outline-primary" onClick={() => setEditingProduct(true)}>Edit</button>
              )}
            </div>
            <div className="card-body">
              {editingProduct ? (
                <form onSubmit={handleSaveProduct}>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">Name <span className="text-danger">*</span></label>
                      <input className="form-control" value={productForm.name}
                        onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))} required />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Category</label>
                      <input className="form-control" value={productForm.category}
                        onChange={e => setProductForm(f => ({ ...f, category: e.target.value }))} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Default Selling Price (₹, taxable)</label>
                      <input className="form-control" type="number" min="0" step="0.01" value={productForm.defaultSellingPrice}
                        onChange={e => setProductForm(f => ({ ...f, defaultSellingPrice: e.target.value }))} />
                    </div>
                    <div className="col-md-3">
                      <GstRateSelect value={productForm.gstRate} onChange={rate => setProductForm(f => ({ ...f, gstRate: String(rate) }))} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">HSN / SAC</label>
                      <input className="form-control" value={productForm.hsnSac}
                        onChange={e => setProductForm(f => ({ ...f, hsnSac: e.target.value }))} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Description</label>
                      <textarea className="form-control" rows={2} value={productForm.description}
                        onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>
                  <div className="mt-3 d-flex gap-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={savingProduct}>
                      {savingProduct ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingProduct(false)} disabled={savingProduct}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="row g-2">
                  <div className="col-md-4">
                    <small className="text-muted d-block">Category</small>
                    <span>{product.category || '—'}</span>
                  </div>
                  <div className="col-md-4">
                    <small className="text-muted d-block">Default Selling Price</small>
                    <span>{formatCurrency(product.defaultSellingPrice)}</span>
                  </div>
                  <div className="col-md-4">
                    <small className="text-muted d-block">GST / HSN</small>
                    <span>{gstLabel(product.gstRate)} {product.hsnSac ? `· ${product.hsnSac}` : ''}</span>
                  </div>
                  <div className="col-md-4">
                    <small className="text-muted d-block">Current Stock</small>
                    <span>{stock} units</span>
                  </div>
                  {product.description && (
                    <div className="col-12">
                      <small className="text-muted d-block">Description</small>
                      <span>{product.description}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Photos */}
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Photos</h5>
              <div className="d-flex align-items-center gap-2">
                {uploadingPhoto && <span className="text-muted small">Uploading…</span>}
                <input ref={photoFileRef} type="file" accept="image/*" multiple className="d-none" onChange={handlePhotoUpload} />
                <button className="btn btn-sm btn-outline-primary" onClick={() => photoFileRef.current?.click()} disabled={uploadingPhoto}>
                  + Upload Photos
                </button>
              </div>
            </div>
            <div className="card-body">
              {(product.photoUrls ?? []).length === 0 ? (
                <p className="text-muted mb-0">No photos yet.</p>
              ) : (
                <div className="d-flex flex-wrap gap-2">
                  {(product.photoUrls ?? []).map(url => (
                    <div key={url} className="position-relative" style={{ width: 120, height: 120 }}>
                      <img src={url} alt="product" className="rounded border"
                        style={{ width: 120, height: 120, objectFit: 'cover', cursor: 'pointer' }}
                        onClick={() => window.open(url, '_blank')} />
                      <button className="btn btn-danger btn-sm position-absolute top-0 end-0"
                        style={{ padding: '0 4px', lineHeight: 1.2, fontSize: 12 }}
                        onClick={() => handlePhotoDelete(url)} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Version selector + list */}
          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <div className="d-flex align-items-center gap-3">
                <h5 className="mb-0">Versions</h5>
                {versions.length > 0 && (
                  <select className="form-select form-select-sm" style={{ width: 'auto' }}
                    value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)}>
                    {versions.map(v => (
                      <option key={v.id} value={v.id}>{v.version}</option>
                    ))}
                  </select>
                )}
              </div>
              <button className="btn btn-sm btn-outline-primary" onClick={() => setShowAddVersion(true)}>+ Add Version</button>
            </div>
            <div className="card-body p-0">
              {versions.length === 0 ? (
                <p className="text-muted p-3">No versions yet.</p>
              ) : (
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Version</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map(v => (
                      <tr key={v.id}>
                        <td className="fw-semibold">{v.version}</td>
                        <td>{v.description || '—'}</td>
                        <td>
                          <span className={`badge bg-${v.status === 'active' ? 'success' : 'secondary'}`}>{v.status}</span>
                        </td>
                        <td>
                          {v.status !== 'active' && (
                            <button className="btn btn-outline-success btn-sm" onClick={() => handleMarkActive(v.id)}>
                              Mark Active
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== PERFORMANCE ===== */}
      {activeTab === 'performance' && (
        <div>
          <div className="card mb-3">
            <div className="card-header"><h5 className="mb-0">Performance Summary</h5></div>
            <div className="card-body">
              <div className="row g-3">
                {[
                  { label: 'Total Produced', value: `${totalProduced} units` },
                  { label: 'Total Sold', value: `${totalSold} units` },
                  { label: 'Current Stock', value: `${stock} units` },
                  { label: 'Total Revenue', value: formatCurrency(totalRevenue) },
                  { label: 'Total Cost', value: formatCurrency(totalCost) },
                  { label: 'Total Profit', value: formatCurrency(totalProfit) },
                  { label: 'Avg Selling Price', value: formatCurrency(avgSellingPrice) },
                  { label: 'Avg Cost Per Unit', value: formatCurrency(avgCostPerUnit) },
                  { label: 'Profit Per Unit', value: formatCurrency(profitPerUnit) },
                  { label: 'Margin', value: formatPercent(margin) },
                ].map(({ label, value }) => (
                  <div key={label} className="col-md-4 col-6">
                    <div className="border rounded p-3 h-100">
                      <small className="text-muted d-block">{label}</small>
                      <div className="fw-semibold fs-5">{value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {avgCostPerUnit > 0 && (
            <div className="card">
              <div className="card-header"><h5 className="mb-0">Pricing Calculator</h5></div>
              <div className="card-body">
                <p className="text-muted small mb-3">
                  Based on avg cost/unit of <strong>{formatCurrency(avgCostPerUnit)}</strong> — suggested selling prices at target margins:
                </p>
                <div className="table-responsive">
                  <table className="table table-bordered table-sm mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Target Margin</th>
                        <th>Taxable sell</th>
                        <th>GST</th>
                        <th>Invoice total</th>
                        <th>vs. Default Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[10, 20, 30, 40, 50].map(pct => {
                        const quote = suggestedSell(avgCostPerUnit, pct, product.gstRate ?? 0)
                        const diff = quote.taxableSell - product.defaultSellingPrice
                        return (
                          <tr key={pct} className={Math.abs(margin - pct) < 5 ? 'table-success' : ''}>
                            <td className="fw-semibold">{pct}%</td>
                            <td>{formatCurrency(quote.taxableSell)}</td>
                            <td>{formatCurrency(quote.gstAmount)}</td>
                            <td>{formatCurrency(quote.invoiceTotal)}</td>
                            <td className={diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : ''}>
                              {diff > 0 ? `+${formatCurrency(diff)}` : diff < 0 ? formatCurrency(diff) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="table-light">
                      <tr>
                        <td className="fw-semibold">Current (actual)</td>
                        <td>{formatCurrency(avgSellingPrice)}</td>
                        <td colSpan={2} className="text-muted">actual avg taxable</td>
                        <td className="text-muted">GST {gstLabel(product.gstRate)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="text-muted small mt-2 mb-0">
                  Highlighted row = closest to your actual margin ({formatPercent(margin)}).
                  Default selling price: <strong>{formatCurrency(product.defaultSellingPrice)}</strong>.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== PRODUCTION HISTORY ===== */}
      {activeTab === 'production' && (
        <div className="card">
          <div className="card-header"><h5 className="mb-0">Production History</h5></div>
          {productions.length === 0 ? (
            <div className="card-body text-muted">No production records.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Batch</th>
                    <th>Version</th>
                    <th>Expected</th>
                    <th>Actual</th>
                    <th>Cost/Unit (₹)</th>
                    <th>Total Cost (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {productions.map(p => (
                    <tr key={p.id}>
                      <td>{formatDate(p.productionDate)}</td>
                      <td className="font-monospace">{p.batchCode || '—'}</td>
                      <td>{versionMap[p.productVersionId] ?? '—'}</td>
                      <td>{p.expectedQuantity ?? p.quantity}</td>
                      <td>{p.actualQuantity ?? p.quantity}</td>
                      <td>{formatCurrency(p.costPerUnit)}</td>
                      <td>{formatCurrency(p.totalMaterialCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== SALES HISTORY ===== */}
      {activeTab === 'sales' && (
        <div className="card">
          <div className="card-header"><h5 className="mb-0">Sales History</h5></div>
          {salesRows.length === 0 ? (
            <div className="card-body text-muted">No sales records.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Revenue</th>
                    <th>Cost</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {salesRows.map(({ oi, date, customerName }) => (
                    <tr key={oi.id}>
                      <td>{formatDate(date)}</td>
                      <td>{customerName}</td>
                      <td>{oi.quantity}</td>
                      <td>{formatCurrency(oi.unitPrice)}</td>
                      <td>{formatCurrency(oi.totalPrice)}</td>
                      <td>{formatCurrency(oi.totalCost)}</td>
                      <td>{formatCurrency(oi.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== CUSTOMERS ===== */}
      {activeTab === 'customers' && (
        <div className="card">
          <div className="card-header"><h5 className="mb-0">Customers</h5></div>
          {customerAggRows.length === 0 ? (
            <div className="card-body text-muted">No customer data.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Customer</th>
                    <th>Qty Bought</th>
                    <th>Avg Price</th>
                    <th>Total Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {customerAggRows.map(r => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td>{r.qty}</td>
                      <td>{formatCurrency(r.qty > 0 ? r.totalSpent / r.qty : 0)}</td>
                      <td>{formatCurrency(r.totalSpent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== BOM ===== */}
      {activeTab === 'bom' && (
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <div className="d-flex align-items-center gap-3">
              <h5 className="mb-0">Bill of Materials</h5>
              {versions.length > 0 && (
                <select className="form-select form-select-sm" style={{ width: 'auto' }}
                  value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)}>
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>{v.version}</option>
                  ))}
                </select>
              )}
            </div>
            {selectedVersionId && (
              <button className="btn btn-sm btn-outline-primary" onClick={() => setShowAddBom(true)}>+ Add Item</button>
            )}
          </div>
          {loadingBom ? (
            <div className="card-body"><LoadingSpinner /></div>
          ) : bomItems.length === 0 ? (
            <div className="card-body text-muted">No BOM items for this version.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Material</th>
                    <th>Quantity</th>
                    <th>Unit</th>
                    <th>GST</th>
                    <th className="text-end">Cost/Unit (₹)</th>
                    <th className="text-end">Line Cost (₹)</th>
                    <th className="text-end">Est. tax / unit</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bomItems.map(b => {
                    const mat = materialMap[b.materialId]
                    const lineCost = b.quantity * (mat?.costPerUnit ?? 0)
                    const taxPerUnit = lineCost * ((mat?.gstRate ?? 0) / 100)
                    return (
                      <tr key={b.id}>
                        <td>{mat?.name ?? b.materialId}</td>
                        <td>{b.quantity}</td>
                        <td>{b.unit}</td>
                        <td>{gstLabel(mat?.gstRate)}</td>
                        <td className="text-end">{mat ? formatCurrency(mat.costPerUnit) : '—'}</td>
                        <td className="text-end">{mat ? formatCurrency(lineCost) : '—'}</td>
                        <td className="text-end">{mat ? formatCurrency(taxPerUnit) : '—'}</td>
                        <td>
                          <button className="btn btn-outline-secondary btn-sm me-1"
                            onClick={() => { setEditBomItem(b); setEditBomForm({ quantity: String(b.quantity), unit: b.unit }) }}>
                            Edit
                          </button>
                          <button className="btn btn-outline-danger btn-sm" onClick={() => setDeleteBomId(b.id)}>Delete</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="table-light fw-semibold">
                  <tr>
                    <td colSpan={5} className="text-end">Estimated Material Cost / Unit Produced:</td>
                    <td className="text-end">
                      {formatCurrency(bomItems.reduce((s, b) => s + b.quantity * (materialMap[b.materialId]?.costPerUnit ?? 0), 0))}
                    </td>
                    <td className="text-end">
                      {formatCurrency(bomItems.reduce((s, b) => {
                        const mat = materialMap[b.materialId]
                        return s + b.quantity * (mat?.costPerUnit ?? 0) * ((mat?.gstRate ?? 0) / 100)
                      }, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add Version Modal */}
      {showAddVersion && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={handleAddVersion}>
                  <div className="modal-header">
                    <h5 className="modal-title">Add Version</h5>
                    <button type="button" className="btn-close" onClick={() => setShowAddVersion(false)} />
                  </div>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label">Version Label <span className="text-danger">*</span></label>
                      <input className="form-control" value={versionForm.version}
                        onChange={e => setVersionForm(f => ({ ...f, version: e.target.value }))} required />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Description</label>
                      <textarea className="form-control" rows={2} value={versionForm.description}
                        onChange={e => setVersionForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddVersion(false)} disabled={savingVersion}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={savingVersion}>{savingVersion ? 'Saving…' : 'Add Version'}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add BOM Item Modal */}
      {showAddBom && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={handleAddBom}>
                  <div className="modal-header">
                    <h5 className="modal-title">Add BOM Item</h5>
                    <button type="button" className="btn-close" onClick={() => setShowAddBom(false)} />
                  </div>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label">Material <span className="text-danger">*</span></label>
                      <select className="form-select" required value={bomForm.materialId}
                        onChange={e => {
                          const mat = materialMap[e.target.value]
                          setBomForm(f => ({ ...f, materialId: e.target.value, unit: mat?.unit ?? '' }))
                        }}>
                        <option value="">Select material…</option>
                        {materials.map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-outline-primary btn-sm mt-2" onClick={() => setShowMaterialCreate(true)}>+ New material</button>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Quantity <span className="text-danger">*</span></label>
                      <input className="form-control" type="number" min="0" step="0.001" required
                        value={bomForm.quantity} onChange={e => setBomForm(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Unit</label>
                      <input className="form-control" value={bomForm.unit}
                        onChange={e => setBomForm(f => ({ ...f, unit: e.target.value }))} />
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddBom(false)} disabled={savingBom}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={savingBom}>{savingBom ? 'Saving…' : 'Add'}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edit BOM Item Modal */}
      {editBomItem && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={handleEditBomSave}>
                  <div className="modal-header">
                    <h5 className="modal-title">Edit BOM Item</h5>
                    <button type="button" className="btn-close" onClick={() => setEditBomItem(null)} />
                  </div>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label">Material</label>
                      <input className="form-control" readOnly value={materialMap[editBomItem.materialId]?.name ?? editBomItem.materialId} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Quantity <span className="text-danger">*</span></label>
                      <input className="form-control" type="number" min="0" step="0.001" required
                        value={editBomForm.quantity} onChange={e => setEditBomForm(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Unit</label>
                      <input className="form-control" value={editBomForm.unit}
                        onChange={e => setEditBomForm(f => ({ ...f, unit: e.target.value }))} />
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setEditBomItem(null)} disabled={savingBom}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={savingBom}>{savingBom ? 'Saving…' : 'Save'}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== PACKAGING ===== */}
      {activeTab === 'packaging' && (
        <div>
          <div className="card mb-3">
            <div className="card-header">
              <h5 className="mb-0">Packaging Notes</h5>
            </div>
            <div className="card-body">
              <textarea
                className="form-control mb-2"
                rows={6}
                placeholder="Describe how to pack this product…"
                value={packagingNotes}
                onChange={e => setPackagingNotes(e.target.value)}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSavePackagingNotes}
                disabled={savingPackaging}
              >
                {savingPackaging ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Packaging Photos</h5>
              <button
                className="btn btn-sm btn-outline-primary"
                onClick={() => packagingPhotoRef.current?.click()}
                disabled={uploadingPackagingPhoto}
              >
                {uploadingPackagingPhoto ? 'Uploading…' : '+ Add Photo'}
              </button>
              <input
                ref={packagingPhotoRef}
                type="file"
                accept="image/*"
                multiple
                className="d-none"
                onChange={handlePackagingPhotoUpload}
              />
            </div>
            <div className="card-body">
              {(product.packagingPhotoUrls ?? []).length === 0 ? (
                <p className="text-muted mb-0">No packaging photos yet.</p>
              ) : (
                <div className="d-flex flex-wrap gap-2">
                  {(product.packagingPhotoUrls ?? []).map(url => (
                    <div key={url} className="position-relative">
                      <img src={url} alt="packaging" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 4 }} />
                      <button
                        className="btn btn-danger btn-sm position-absolute top-0 end-0"
                        style={{ padding: '0 4px', lineHeight: 1.2 }}
                        onClick={() => handlePackagingPhotoDelete(url)}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <EntityQuickCreate
        kind="material"
        show={showMaterialCreate}
        onCancel={() => setShowMaterialCreate(false)}
        onCreated={created => {
          if (created.kind !== 'material') return
          setMaterials(prev => [...prev, created.entity])
          setBomForm(f => ({ ...f, materialId: created.entity.id, unit: created.entity.unit }))
          setShowMaterialCreate(false)
        }}
      />
      {/* Delete BOM confirm */}
      <ConfirmModal
        show={!!deleteBomId}
        title="Delete BOM Item"
        message="Are you sure you want to delete this BOM item?"
        confirmLabel="Delete"
        onConfirm={handleDeleteBom}
        onCancel={() => setDeleteBomId(null)}
      />
    </div>
  )
}
