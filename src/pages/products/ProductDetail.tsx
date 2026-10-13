import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../../firebase/config'
import { productService } from '../../services/products'
import { inventoryService } from '../../services/inventory'
import { occasionService } from '../../services/occasions'
import { bomService, bomCostBreakdown } from '../../services/bom'
import { materialService } from '../../services/materials'
import { settingsService } from '../../services/settings'
import { Product, ProductVersion, Production, OrderItem, Order, BomItem, Material, Occasion } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ConfirmModal from '../../components/ConfirmModal'
import StatusBadge from '../../components/StatusBadge'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatCurrency, formatDate, formatPercent } from '../../utils/format'
import { sortByNewest } from '../../utils/sort'
import { gstLabel, lineTax, marginPctFromPrices, effectiveTargetMargin, DEFAULT_TARGET_MARGIN_PCT } from '../../utils/tax'
import EntityQuickCreate from '../../components/EntityQuickCreate'
import { GstRateSelect } from '../../components/GstFields'

type Tab = 'overview' | 'packaging' | 'performance' | 'production' | 'sales' | 'customers' | 'bom'

interface CustomerRecord { id: string; name: string }

function profitTone(profit: number): string {
  if (profit > 0) return 'text-success'
  if (profit < 0) return 'text-danger'
  return 'text-muted'
}

function MarginWithProfit({
  cost,
  sell,
  marginPct,
  size = 'sm',
}: {
  cost: number
  sell: number
  marginPct: number | null
  size?: 'sm' | 'lg'
}) {
  if (marginPct == null || sell <= 0) {
    return <span className="text-muted">—</span>
  }
  const profit = sell - cost
  const tone = profitTone(profit)
  if (size === 'lg') {
    return (
      <>
        <div className={`fw-semibold fs-5 ${tone}`}>
          {formatPercent(marginPct)}
          <span className="ms-2">{formatCurrency(profit)} profit</span>
        </div>
        <div className="small text-muted">
          Sell {formatCurrency(sell)} − BOM {formatCurrency(cost)}
        </div>
      </>
    )
  }
  return (
    <span className={tone}>
      {formatPercent(marginPct)} · {formatCurrency(profit)} profit
    </span>
  )
}

type PendingFork =
  | { kind: 'sellingPrice'; price: number }
  | { kind: 'productSave'; updates: Record<string, unknown>; priceChanged: boolean }

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
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [selectedOccasionIds, setSelectedOccasionIds] = useState<string[]>([])
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
  const [globalMargin, setGlobalMargin] = useState(DEFAULT_TARGET_MARGIN_PCT)
  const [versionLocked, setVersionLocked] = useState(false)
  const [pendingFork, setPendingFork] = useState<PendingFork | null>(null)
  const [forking, setForking] = useState(false)

  // Add version
  const [showAddVersion, setShowAddVersion] = useState(false)
  const [versionForm, setVersionForm] = useState({ version: '', description: '' })
  const [savingVersion, setSavingVersion] = useState(false)

  // BOM
  const [loadingBom, setLoadingBom] = useState(false)
  const [showAddBom, setShowAddBom] = useState(false)
  const [showMaterialCreate, setShowMaterialCreate] = useState(false)
  const [bomForm, setBomForm] = useState({ materialId: '', quantity: '', unit: '' })
  const [savingBom, setSavingBom] = useState(false)
  const [editBomItem, setEditBomItem] = useState<BomItem | null>(null)
  const [editBomForm, setEditBomForm] = useState({ quantity: '', unit: '' })
  const [deleteBomId, setDeleteBomId] = useState<string | null>(null)
  const [savingUnitPrice, setSavingUnitPrice] = useState(false)
  const [unitPriceDraft, setUnitPriceDraft] = useState('')
  const bomQtyRef = useRef<HTMLInputElement>(null)

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
          allOccasions,
          pricing,
        ] = await Promise.all([
          productService.getById(id),
          productService.getVersions(id),
          inventoryService.getStock('product', id),
          getDocs(collection(db, 'productions')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as Production))),
          getDocs(collection(db, 'orderItems')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem))),
          getDocs(collection(db, 'orders')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as Order))),
          getDocs(collection(db, 'customers')).then(s => s.docs.map(d => ({ id: d.id, name: (d.data().name as string) || '' }))),
          materialService.getAll(),
          occasionService.getActiveOccasions(),
          settingsService.getPricing().catch(() => ({ targetMarginPct: DEFAULT_TARGET_MARGIN_PCT })),
        ])

        if (!prod) { setLoading(false); return }

        setGlobalMargin(pricing.targetMarginPct)
        setProduct(prod)
        setSelectedOccasionIds(prod.occasionIds ?? [])
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
        setOccasions(allOccasions)
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

  // Lock status for selected version (used = orders/production)
  useEffect(() => {
    if (!selectedVersionId) {
      setVersionLocked(false)
      return
    }
    let cancelled = false
    productService.isVersionLocked(selectedVersionId)
      .then(locked => { if (!cancelled) setVersionLocked(locked) })
      .catch(() => { if (!cancelled) setVersionLocked(false) })
    return () => { cancelled = true }
  }, [selectedVersionId])

  // ---- Derived data ----
  const cancelledOrderIds = new Set(orders.filter(o => o.status === 'CANCELLED').map(o => o.id))
  const activeOrderItems = orderItems.filter(oi => !cancelledOrderIds.has(oi.orderId))
  const selectedVersion = versions.find(v => v.id === selectedVersionId)
  const catalogPrice = selectedVersion?.sellingPrice ?? product?.defaultSellingPrice ?? 0
  /** Priced or used → price/margin/BOM changes auto-fork. */
  const versionImmutable = versionLocked || catalogPrice > 0

  // Performance stats (scoped to selected version)
  const versionProductions = productions.filter(p => p.productVersionId === selectedVersionId)
  const versionOrderItems = activeOrderItems.filter(oi => oi.productVersionId === selectedVersionId)
  const totalProduced = versionProductions.reduce((s, p) => s + p.quantity, 0)
  const totalSold = versionOrderItems.reduce((s, oi) => s + oi.quantity, 0)
  const totalRevenue = versionOrderItems.reduce((s, oi) => s + oi.totalPrice, 0)
  const totalCost = versionOrderItems.reduce((s, oi) => s + oi.totalCost, 0)
  const totalProfit = totalRevenue - totalCost
  const avgSellingPrice = totalSold > 0 ? totalRevenue / totalSold : 0
  const avgCostPerUnit = totalSold > 0 ? totalCost / totalSold : 0
  const productSoldAllVersions = activeOrderItems.reduce((s, oi) => s + oi.quantity, 0)

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

  const occasionMap = Object.fromEntries(occasions.map(o => [o.id, o.name]))

  const toggleOccasion = (occasionId: string) => {
    setSelectedOccasionIds(prev =>
      prev.includes(occasionId) ? prev.filter(id => id !== occasionId) : [...prev, occasionId],
    )
  }

  // ---- Handlers ----
  const refreshAfterFork = async (newVersionId: string) => {
    if (!id) return
    const [vers, prod] = await Promise.all([
      productService.getVersions(id),
      productService.getById(id),
    ])
    setVersions(vers)
    setSelectedVersionId(newVersionId)
    if (prod) {
      setProduct(prod)
      setProductForm(f => ({
        ...f,
        defaultSellingPrice: String(prod.defaultSellingPrice),
      }))
    }
    setVersionLocked(false)
  }

  const applyFork = async (pending: PendingFork) => {
    if (!id || !selectedVersionId || forking) return
    const sourceLabel = selectedVersion?.version ?? 'prior'
    setForking(true)
    try {
      const snapshotMargin = effectiveTargetMargin(null, globalMargin)
      let newId = ''

      if (pending.kind === 'sellingPrice') {
        newId = await productService.forkVersion({
          productId: id,
          sourceVersionId: selectedVersionId,
          sellingPrice: pending.price,
          targetMarginPct: snapshotMargin,
        })
      } else if (pending.kind === 'productSave') {
        const price = pending.priceChanged
          ? Number(pending.updates.defaultSellingPrice)
          : product?.defaultSellingPrice
        newId = await productService.forkVersion({
          productId: id,
          sourceVersionId: selectedVersionId,
          sellingPrice: price,
          targetMarginPct: snapshotMargin,
        })
        const productPatch: Record<string, unknown> = { ...pending.updates }
        delete productPatch.targetMarginPct
        await productService.update(id, productPatch as Partial<Product>)
      }

      const newVers = await productService.getVersions(id)
      const newLabel = newVers.find(v => v.id === newId)?.version ?? 'next'
      await refreshAfterFork(newId)
      setPendingFork(null)
      setEditingProduct(false)
      showToast(`Created ${newLabel} — ${sourceLabel} kept inactive`)
    } catch {
      showToast('Failed to create new version', 'danger')
    } finally {
      setForking(false)
    }
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !product) return
    const newPrice = parseFloat(productForm.defaultSellingPrice) || 0
    const priceChanged = newPrice !== product.defaultSellingPrice

    const updates: Record<string, unknown> = {
      name: productForm.name.trim(),
      category: productForm.category.trim(),
      description: productForm.description.trim(),
      defaultSellingPrice: newPrice,
      gstRate: parseFloat(productForm.gstRate) || 0,
      hsnSac: productForm.hsnSac.trim(),
      occasionIds: selectedOccasionIds,
    }

    if (versionImmutable && priceChanged) {
      setPendingFork({ kind: 'productSave', updates, priceChanged })
      return
    }

    setSavingProduct(true)
    try {
      await productService.update(id, updates as Partial<Product>)
      if (priceChanged && selectedVersionId && !versionImmutable) {
        await productService.updateVersion(selectedVersionId, {
          sellingPrice: newPrice,
          targetMarginPct: effectiveTargetMargin(null, globalMargin),
        })
        setVersions(prev => prev.map(v =>
          v.id === selectedVersionId
            ? { ...v, sellingPrice: newPrice, targetMarginPct: effectiveTargetMargin(null, globalMargin) }
            : v,
        ))
      }
      setProduct(prev => prev ? {
        ...prev,
        name: updates.name as string,
        category: updates.category as string,
        description: updates.description as string,
        defaultSellingPrice: newPrice,
        gstRate: updates.gstRate as number,
        hsnSac: updates.hsnSac as string,
        occasionIds: selectedOccasionIds,
      } : prev)
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
    if (!id || !product) return
    setSavingVersion(true)
    try {
      const newId = await productService.createVersion({
        productId: id,
        version: versionForm.version.trim(),
        description: versionForm.description.trim(),
        status: 'active',
        sellingPrice: product.defaultSellingPrice,
        targetMarginPct: effectiveTargetMargin(null, globalMargin),
      })
      // Mark older actives inactive
      await Promise.all(
        versions.filter(v => v.status === 'active').map(v =>
          productService.updateVersion(v.id, { status: 'inactive' }),
        ),
      )
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
      const vers = versions.find(v => v.id === versionId)
      await Promise.all([
        ...versions.filter(v => v.status === 'active' && v.id !== versionId).map(v =>
          productService.updateVersion(v.id, { status: 'inactive' }),
        ),
        productService.updateVersion(versionId, { status: 'active' }),
      ])
      if (vers?.sellingPrice != null && id) {
        await productService.update(id, { defaultSellingPrice: vers.sellingPrice })
        setProduct(prev => prev ? { ...prev, defaultSellingPrice: vers.sellingPrice! } : prev)
        setProductForm(f => ({ ...f, defaultSellingPrice: String(vers.sellingPrice) }))
      }
      setVersions(prev => prev.map(v => ({
        ...v,
        status: v.id === versionId ? 'active' : (v.status === 'active' ? 'inactive' : v.status),
      })))
      setSelectedVersionId(versionId)
      showToast('Version marked active')
    } catch {
      showToast('Failed to update version', 'danger')
    }
  }

  const handleAddBom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedVersionId) return
    if (!bomForm.materialId) {
      showToast('Select a material', 'danger')
      return
    }
    const quantity = parseFloat(bomForm.quantity)
    if (!bomForm.quantity.trim() || Number.isNaN(quantity) || quantity <= 0) {
      showToast('Enter a quantity greater than zero', 'danger')
      return
    }
    if (bomItems.some(b => b.materialId === bomForm.materialId)) {
      showToast('That material is already on this BOM', 'danger')
      return
    }
    setSavingBom(true)
    try {
      await bomService.create({
        productVersionId: selectedVersionId,
        materialId: bomForm.materialId,
        quantity,
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
    const quantity = parseFloat(editBomForm.quantity) || 0
    setSavingBom(true)
    try {
      await bomService.update(editBomItem.id, {
        quantity,
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
  const activeMaterials = materials.filter(m => m.status === 'active')
  const bomCost = bomCostBreakdown(bomItems, materials)
  const displaySellingPrice = catalogPrice
  const sellQuote = lineTax(1, displaySellingPrice, product?.gstRate ?? 0)
  const actualMarginPct = marginPctFromPrices(bomCost.total, displaySellingPrice)
  const editSellPrice = parseFloat(productForm.defaultSellingPrice) || 0
  const editMarginPct = marginPctFromPrices(bomCost.total, editSellPrice)
  const draftSellPrice = parseFloat(unitPriceDraft) || 0
  const draftMarginPct = marginPctFromPrices(bomCost.total, draftSellPrice)

  // Keep BOM unit-price draft in sync with catalog price
  useEffect(() => {
    setUnitPriceDraft(displaySellingPrice > 0 ? String(displaySellingPrice) : '')
  }, [displaySellingPrice, selectedVersionId])

  const handleSetSellingUnitPrice = async (price: number) => {
    if (!id || !product) return
    if (versionImmutable) {
      setPendingFork({ kind: 'sellingPrice', price })
      return
    }
    setSavingUnitPrice(true)
    try {
      await productService.update(id, { defaultSellingPrice: price })
      if (selectedVersionId) {
        const snap = effectiveTargetMargin(null, globalMargin)
        await productService.updateVersion(selectedVersionId, {
          sellingPrice: price,
          targetMarginPct: snap,
        })
        setVersions(prev => prev.map(v =>
          v.id === selectedVersionId ? { ...v, sellingPrice: price, targetMarginPct: snap } : v,
        ))
      }
      setProduct(prev => prev ? { ...prev, defaultSellingPrice: price } : prev)
      setProductForm(f => ({ ...f, defaultSellingPrice: String(price) }))
      setUnitPriceDraft(String(price))
      showToast('Selling unit price updated')
    } catch {
      showToast('Failed to update selling unit price', 'danger')
    } finally {
      setSavingUnitPrice(false)
    }
  }

  /** Product sell GST — in place, no version fork. */
  const handleSetProductGst = async (rate: number) => {
    if (!id || !product) return
    if (rate === (product.gstRate ?? 0)) return
    setSavingUnitPrice(true)
    try {
      await productService.update(id, { gstRate: rate })
      setProduct(prev => prev ? { ...prev, gstRate: rate } : prev)
      setProductForm(f => ({ ...f, gstRate: String(rate) }))
      showToast('GST rate updated')
    } catch {
      showToast('Failed to update GST rate', 'danger')
    } finally {
      setSavingUnitPrice(false)
    }
  }

  const materialOptionLabel = (m: Material) => {
    const color = m.colorSpec?.trim()
    return color ? `${m.name} — ${color} (${m.unit})` : `${m.name} (${m.unit})`
  }

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
        <div className="ms-auto small text-muted d-flex flex-wrap gap-3">
          <span>
            Selling unit price{' '}
            <strong className={product.defaultSellingPrice > 0 ? 'text-dark' : 'text-warning'}>
              {formatCurrency(product.defaultSellingPrice)}
            </strong>
          </span>
          {bomItems.length > 0 && (
            <span>
              BOM cost / item <strong className="text-dark">{formatCurrency(bomCost.total)}</strong>
              {' '}incl. GST
            </span>
          )}
        </div>
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
          {/* Product info card */}
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Product Information</h5>
              {!editingProduct && (
                <button className="btn btn-sm btn-outline-primary" onClick={() => {
                  setSelectedOccasionIds(product.occasionIds ?? [])
                  setProductForm({
                    name: product.name,
                    category: product.category,
                    description: product.description,
                    defaultSellingPrice: String(product.defaultSellingPrice),
                    gstRate: String(product.gstRate ?? 0),
                    hsnSac: product.hsnSac ?? '',
                  })
                  setEditingProduct(true)
                }}>Edit</button>
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
                      <label className="form-label">Selling unit price (₹, taxable)</label>
                      <input className="form-control" type="number" min="0" step="0.01" value={productForm.defaultSellingPrice}
                        onChange={e => setProductForm(f => ({ ...f, defaultSellingPrice: e.target.value }))} />
                      {bomCost.total > 0 && (
                        <div className="form-text">
                          {editMarginPct != null ? (
                            <>
                              Current margin{' '}
                              <MarginWithProfit
                                cost={bomCost.total}
                                sell={editSellPrice}
                                marginPct={editMarginPct}
                              />
                              <span className="text-muted"> on BOM {formatCurrency(bomCost.total)}</span>
                            </>
                          ) : (
                            `Enter a selling price to see margin vs BOM cost ${formatCurrency(bomCost.total)}`
                          )}
                        </div>
                      )}
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
                    {occasions.length > 0 && (
                      <div className="col-12">
                        <label className="form-label">Occasions</label>
                        <div className="d-flex flex-wrap gap-2">
                          {occasions.map(o => (
                            <label key={o.id} className="form-check form-check-inline mb-0">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={selectedOccasionIds.includes(o.id)}
                                onChange={() => toggleOccasion(o.id)}
                              />
                              <span className="form-check-label">{o.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
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
                    <small className="text-muted d-block">Selling unit price</small>
                    <span className={product.defaultSellingPrice > 0 ? '' : 'text-warning'}>
                      {formatCurrency(product.defaultSellingPrice)}
                    </span>
                    <div className="small text-muted">
                      Taxable · GST {gstLabel(product.gstRate)} · Invoice {formatCurrency(sellQuote.lineTotal)}
                    </div>
                  </div>
                  {bomItems.length > 0 && (
                    <div className="col-md-4">
                      <small className="text-muted d-block">BOM production cost / item</small>
                      <span>{formatCurrency(bomCost.total)}</span>
                      <div className="small text-muted">
                        {formatCurrency(bomCost.taxable)} + GST {formatCurrency(bomCost.gst)}
                      </div>
                    </div>
                  )}
                  <div className="col-md-4">
                    <small className="text-muted d-block">GST / HSN</small>
                    <span>{gstLabel(product.gstRate)} {product.hsnSac ? `· ${product.hsnSac}` : ''}</span>
                  </div>
                  <div className="col-md-4">
                    <small className="text-muted d-block">Current margin</small>
                    {actualMarginPct != null && displaySellingPrice > 0 ? (
                      <MarginWithProfit
                        cost={bomCost.total}
                        sell={displaySellingPrice}
                        marginPct={actualMarginPct}
                        size="lg"
                      />
                    ) : (
                      <>
                        <span>—</span>
                        <div className="small text-muted">
                          {bomCost.total > 0
                            ? 'Set a selling price to see margin'
                            : 'Add BOM to see margin'}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="col-md-4">
                    <small className="text-muted d-block">Current Stock</small>
                    <span>{stock} units</span>
                  </div>
                  {(product.occasionIds ?? []).length > 0 && (
                    <div className="col-12">
                      <small className="text-muted d-block">Occasions</small>
                      <div className="d-flex flex-wrap gap-1 mt-1">
                        {(product.occasionIds ?? []).map(oid => (
                          <span key={oid} className="badge bg-light text-dark border">
                            {occasionMap[oid] ?? oid.slice(0, 6)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
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
      {activeTab === 'performance' && (() => {
        const hasSales = totalSold > 0
        const unitCost = hasSales ? avgCostPerUnit : bomCost.total
        const unitSell = hasSales ? avgSellingPrice : displaySellingPrice
        const unitProfit = unitSell - unitCost
        const unitMargin = unitSell > 0 ? (unitProfit / unitSell) * 100 : 0
        const costNote = hasSales ? 'From sales (this version)' : bomCost.total > 0 ? 'From BOM, incl. GST' : 'No BOM yet'
        const sellNote = hasSales ? 'From sales (this version)' : 'Version / catalog selling price'
        const versionLabel = selectedVersion?.version ?? '—'
        return (
        <div>
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Performance · {versionLabel}</h5>
              {versions.length > 1 && (
                <select className="form-select form-select-sm" style={{ width: 'auto' }}
                  value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)}>
                  {versions.map(v => (
                    <option key={v.id} value={v.id}>{v.version}{v.status === 'active' ? ' · active' : ''}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="card-body">
              {productSoldAllVersions > totalSold && (
                <p className="small text-muted mb-3">
                  Showing this version only. Product total sold across all versions: {productSoldAllVersions} units.
                </p>
              )}
              <div className="row g-3">
                {[
                  { label: 'Total Produced', value: `${totalProduced} units` },
                  { label: 'Total Sold', value: `${totalSold} units` },
                  { label: 'Current Stock', value: `${stock} units` },
                  { label: 'Total Revenue', value: formatCurrency(totalRevenue) },
                  { label: 'Total Cost', value: formatCurrency(totalCost) },
                  { label: 'Total Profit', value: formatCurrency(totalProfit) },
                  { label: 'Avg Selling Price', value: formatCurrency(unitSell), note: sellNote },
                  { label: 'Avg Cost Per Unit', value: formatCurrency(unitCost), note: costNote },
                  { label: 'Profit Per Unit', value: formatCurrency(unitProfit), note: hasSales ? 'From sales' : 'Selling price − BOM cost' },
                  { label: 'Margin', value: formatPercent(unitMargin), note: hasSales ? 'Actual on sales' : 'On current selling price vs BOM' },
                ].map(({ label, value, note }) => (
                  <div key={label} className="col-md-4 col-6">
                    <div className="border rounded p-3 h-100">
                      <small className="text-muted d-block">{label}</small>
                      <div className="fw-semibold fs-5">{value}</div>
                      {note && <div className="small text-muted">{note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )
      })()}

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
                    <th>Linked order</th>
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
                      <td>
                        {p.orderId ? (
                          <Link to={`/orders/${p.orderId}`} className="font-monospace">
                            {p.orderId.slice(0, 6).toUpperCase()}
                          </Link>
                        ) : '—'}
                      </td>
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
              {versionImmutable && (
                <span className="badge bg-secondary" title="Priced or used — changing sell price will ask to create a new version">Priced</span>
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
                    <th className="text-end">
                      Material cost / unit (₹)
                      <div className="fw-normal small text-muted">From Materials master</div>
                    </th>
                    <th className="text-end">Cost / item (₹)</th>
                    <th className="text-end">Tax / item (₹)</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bomItems.map(b => {
                    const mat = materialMap[b.materialId]
                    const lineCost = b.quantity * (mat?.costPerUnit ?? 0)
                    const taxPerItem = lineCost * ((mat?.gstRate ?? 0) / 100)
                    return (
                      <tr key={b.id}>
                        <td>
                          {mat?.name ?? b.materialId}
                          {mat?.colorSpec?.trim() ? (
                            <div className="small text-muted">{mat.colorSpec.trim()}</div>
                          ) : null}
                        </td>
                        <td>{b.quantity}</td>
                        <td>{b.unit}</td>
                        <td>{gstLabel(mat?.gstRate)}</td>
                        <td className="text-end">{mat ? formatCurrency(mat.costPerUnit) : '—'}</td>
                        <td className="text-end">{mat ? formatCurrency(lineCost) : '—'}</td>
                        <td className="text-end">{mat ? formatCurrency(taxPerItem) : '—'}</td>
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
                    <td colSpan={5} className="text-end">
                      Production cost / item:
                      <div className="fw-normal small text-muted">
                        Taxable {formatCurrency(bomCost.taxable)} + GST {formatCurrency(bomCost.gst)} = {formatCurrency(bomCost.total)}
                      </div>
                    </td>
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
      {activeTab === 'bom' && bomItems.length > 0 && (
        <div className="card mt-3">
          <div className="card-header">
            <h5 className="mb-0">Unit price</h5>
          </div>
          <div className="card-body">
            {versionImmutable && (
              <p className="small text-muted mb-3">
                This version is already priced or used on orders/production. Changing the selling price will ask you to create a new version (BOM edits stay on this version). Material master cost edits still affect every BOM that uses that material.
              </p>
            )}
            <div className="row g-3 align-items-end">
              <div className="col-md-4">
                <small className="text-muted d-block">Production cost / item</small>
                <div className="fw-semibold fs-5">{formatCurrency(bomCost.total)}</div>
                <div className="small text-muted">
                  {formatCurrency(bomCost.taxable)} + material GST {formatCurrency(bomCost.gst)}
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted mb-1">Selling unit price (taxable)</label>
                <div className="input-group">
                  <span className="input-group-text">₹</span>
                  <input
                    className="form-control"
                    type="number"
                    min="0"
                    step="0.01"
                    value={unitPriceDraft}
                    disabled={savingUnitPrice || forking}
                    onChange={e => setUnitPriceDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    disabled={savingUnitPrice || forking || !(parseFloat(unitPriceDraft) > 0)}
                    onClick={() => void handleSetSellingUnitPrice(parseFloat(unitPriceDraft) || 0)}
                  >
                    {savingUnitPrice || forking ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <div className="mt-2">
                  <GstRateSelect
                    label="GST rate"
                    value={product.gstRate ?? 0}
                    onChange={rate => void handleSetProductGst(rate)}
                    className="form-select form-select-sm"
                    disabled={savingUnitPrice || forking}
                  />
                  <div className="small text-muted mt-1">
                    Invoice {formatCurrency(lineTax(1, draftSellPrice > 0 ? draftSellPrice : displaySellingPrice, product.gstRate ?? 0).lineTotal)}
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <small className="text-muted d-block">Current margin</small>
                {draftMarginPct != null && draftSellPrice > 0 ? (
                  <MarginWithProfit
                    cost={bomCost.total}
                    sell={draftSellPrice}
                    marginPct={draftMarginPct}
                    size="lg"
                  />
                ) : (
                  <>
                    <div className="fw-semibold fs-5 text-muted">—</div>
                    <div className="small text-muted">Enter a selling price to see gain %</div>
                  </>
                )}
              </div>
            </div>
            {displaySellingPrice <= 0 && !unitPriceDraft && (
              <p className="text-warning small mb-0 mt-3">
                No selling unit price yet. Set one here or on Overview so new orders start with a price.
              </p>
            )}
          </div>
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
                        {activeMaterials.map(m => (
                          <option key={m.id} value={m.id}>{materialOptionLabel(m)}</option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-outline-primary btn-sm mt-2" onClick={() => setShowMaterialCreate(true)}>+ New material</button>
                      <div className="form-text">Creating a material adds it to this list. Enter quantity below, then click Add to put it on the BOM.</div>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Quantity <span className="text-danger">*</span></label>
                      <input
                        ref={bomQtyRef}
                        className="form-control"
                        type="number"
                        min="0.001"
                        step="0.001"
                        required
                        value={bomForm.quantity}
                        onChange={e => setBomForm(f => ({ ...f, quantity: e.target.value }))}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Unit</label>
                      <input
                        className="form-control"
                        value={bomForm.unit}
                        onChange={e => setBomForm(f => ({ ...f, unit: e.target.value }))}
                        list="bom-unit-options"
                        placeholder="pcs, sheets, kg…"
                      />
                      <datalist id="bom-unit-options">
                        <option value="pcs" />
                        <option value="sheets" />
                        <option value="kg" />
                        <option value="m" />
                        <option value="ml" />
                        <option value="grams" />
                      </datalist>
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
                      <input
                        className="form-control"
                        value={editBomForm.unit}
                        onChange={e => setEditBomForm(f => ({ ...f, unit: e.target.value }))}
                        list="bom-edit-unit-options"
                      />
                      <datalist id="bom-edit-unit-options">
                        <option value="pcs" />
                        <option value="sheets" />
                        <option value="kg" />
                        <option value="m" />
                        <option value="ml" />
                        <option value="grams" />
                      </datalist>
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
          showToast('Material added — enter quantity and click Add')
          window.setTimeout(() => bomQtyRef.current?.focus(), 50)
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
      <ConfirmModal
        show={!!pendingFork}
        title="Create a new version?"
        message={`This version (${selectedVersion?.version ?? 'current'}) is already priced or used. Create the next version to apply the new selling price and keep the old one inactive?`}
        confirmLabel={forking ? 'Creating…' : 'Create new version'}
        onConfirm={() => { if (pendingFork && !forking) void applyFork(pendingFork) }}
        onCancel={() => { if (!forking) setPendingFork(null) }}
      />
    </div>
  )
}
