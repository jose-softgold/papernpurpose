import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { customerService } from '../../services/customers'
import { orderService } from '../../services/orders'
import { productService } from '../../services/products'
import { storage } from '../../firebase/config'
import { Customer, Order, OrderItem, Product } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatDate, formatCurrency } from '../../utils/format'

function resolveMapUrl(link: string): string {
  if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(link.trim())) {
    return `https://maps.google.com/?q=${link.trim()}`
  }
  return link
}

function displayName(c: Customer): string {
  return c.type === 'company' ? (c.companyName ?? c.name) : c.name
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [purchaseHistory, setPurchaseHistory] = useState<Array<{ productName: string; totalQty: number; totalRevenue: number }>>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    type: 'individual' as 'individual' | 'company',
    name: '', companyName: '', contactPerson: '',
    phone: '', email: '', address: '', city: '', notes: '', mapLink: '',
  })
  const { toasts, showToast } = useToast()

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        const [c, customerOrders, products] = await Promise.all([
          customerService.getById(id),
          orderService.getByCustomerId(id),
          productService.getAll(),
        ])
        if (c) {
          setCustomer(c)
          setForm({
            type: c.type ?? 'individual',
            name: c.name,
            companyName: c.companyName ?? '',
            contactPerson: c.contactPerson ?? '',
            phone: c.phone,
            email: c.email,
            address: c.address,
            city: c.city,
            notes: c.notes,
            mapLink: c.mapLink ?? '',
          })
        }
        setOrders(customerOrders)

        const prodMap = Object.fromEntries(products.map((p: Product) => [p.id, p.name]))
        const itemsPerOrder = await Promise.all(customerOrders.map((o: Order) => orderService.getItems(o.id)))
        const allItems: OrderItem[] = itemsPerOrder.flat()
        const agg: Record<string, { productName: string; totalQty: number; totalRevenue: number }> = {}
        for (const item of allItems) {
          if (!agg[item.productId]) {
            agg[item.productId] = { productName: prodMap[item.productId] ?? 'Unknown', totalQty: 0, totalRevenue: 0 }
          }
          agg[item.productId].totalQty += item.quantity
          agg[item.productId].totalRevenue += item.totalPrice
        }
        setPurchaseHistory(Object.values(agg).sort((a, b) => b.totalRevenue - a.totalRevenue))
      } catch {
        showToast('Failed to load customer', 'danger')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const buildPayload = () => {
    if (form.type === 'company') {
      return {
        type: 'company' as const,
        name: form.contactPerson,
        companyName: form.companyName,
        contactPerson: form.contactPerson,
        phone: form.phone, email: form.email,
        address: form.address, city: form.city,
        notes: form.notes, mapLink: form.mapLink,
      }
    }
    return {
      type: 'individual' as const,
      name: form.name,
      companyName: '', contactPerson: '',
      phone: form.phone, email: form.email,
      address: form.address, city: form.city,
      notes: form.notes, mapLink: form.mapLink,
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    try {
      const payload = buildPayload()
      await customerService.update(id, payload)
      setCustomer(prev => prev ? { ...prev, ...payload } : prev)
      setEditing(false)
      showToast('Customer updated')
    } catch {
      showToast('Failed to update customer', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!id || !e.target.files?.length) return
    setUploading(true)
    try {
      const urls: string[] = []
      for (const file of Array.from(e.target.files)) {
        const storageRef = ref(storage, `customers/${id}/${Date.now()}-${file.name}`)
        await uploadBytes(storageRef, file)
        urls.push(await getDownloadURL(storageRef))
      }
      const existing = customer?.photoUrls ?? []
      const merged = [...existing, ...urls]
      await customerService.update(id, { photoUrls: merged })
      setCustomer(prev => prev ? { ...prev, photoUrls: merged } : prev)
      showToast(`${urls.length} photo${urls.length > 1 ? 's' : ''} uploaded`)
    } catch {
      showToast('Failed to upload photos', 'danger')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handlePhotoDelete = async (url: string) => {
    if (!id || !customer) return
    try {
      const storageRef = ref(storage, url)
      await deleteObject(storageRef)
    } catch {
      // If file not found in storage, still remove from Firestore list
    }
    const remaining = (customer.photoUrls ?? []).filter(u => u !== url)
    await customerService.update(id, { photoUrls: remaining })
    setCustomer(prev => prev ? { ...prev, photoUrls: remaining } : prev)
    showToast('Photo removed')
  }

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  if (loading) return <LoadingSpinner />
  if (!customer) return (
    <div className="container-fluid py-3">
      <p className="text-danger">Customer not found.</p>
      <button className="btn btn-secondary" onClick={() => navigate('/customers')}>Back</button>
    </div>
  )

  const isCompany = customer.type === 'company'

  return (
    <div className="container-fluid py-3">
      <ToastContainer toasts={toasts} />

      <div className="d-flex align-items-center gap-3 mb-4">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/customers')}>
          &larr; Back
        </button>
        <div>
          <h4 className="mb-0">{displayName(customer)}</h4>
          {isCompany && customer.contactPerson && (
            <small className="text-muted">Contact: {customer.contactPerson}</small>
          )}
        </div>
        <span className={`badge bg-${isCompany ? 'info text-dark' : 'secondary'}`}>
          {isCompany ? 'Company' : 'Individual'}
        </span>
        <span className={`badge bg-${customer.status === 'active' ? 'success' : 'secondary'}`}>
          {customer.status}
        </span>
      </div>

      {/* Customer Information */}
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Customer Information</h5>
          {!editing && (
            <button className="btn btn-sm btn-outline-primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        <div className="card-body">
          {editing ? (
            <form onSubmit={handleSave}>
              {/* Type toggle */}
              <div className="row g-3 mb-1">
                <div className="col-12">
                  <label className="form-label">Customer Type</label>
                  <div className="d-flex gap-3">
                    <div className="form-check">
                      <input className="form-check-input" type="radio" id="edit-individual"
                        checked={form.type === 'individual'}
                        onChange={() => setForm(f => ({ ...f, type: 'individual' }))} />
                      <label className="form-check-label" htmlFor="edit-individual">Individual</label>
                    </div>
                    <div className="form-check">
                      <input className="form-check-input" type="radio" id="edit-company"
                        checked={form.type === 'company'}
                        onChange={() => setForm(f => ({ ...f, type: 'company' }))} />
                      <label className="form-check-label" htmlFor="edit-company">Company</label>
                    </div>
                  </div>
                </div>
              </div>
              <div className="row g-3">
                {form.type === 'company' ? (
                  <>
                    <div className="col-md-6">
                      <label className="form-label">Company Name <span className="text-danger">*</span></label>
                      <input className="form-control" value={form.companyName} onChange={set('companyName')} required />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Contact Person <span className="text-danger">*</span></label>
                      <input className="form-control" value={form.contactPerson} onChange={set('contactPerson')} required />
                    </div>
                  </>
                ) : (
                  <div className="col-md-6">
                    <label className="form-label">Name <span className="text-danger">*</span></label>
                    <input className="form-control" value={form.name} onChange={set('name')} required />
                  </div>
                )}
                <div className="col-md-6">
                  <label className="form-label">Phone</label>
                  <input className="form-control" value={form.phone} onChange={set('phone')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Email</label>
                  <input className="form-control" type="email" value={form.email} onChange={set('email')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">City</label>
                  <input className="form-control" value={form.city} onChange={set('city')} />
                </div>
                <div className="col-12">
                  <label className="form-label">Address</label>
                  <input className="form-control" value={form.address} onChange={set('address')} />
                </div>
                <div className="col-12">
                  <label className="form-label">Google Maps Link</label>
                  <input className="form-control" placeholder="Paste a Google Maps URL or lat,lng" value={form.mapLink} onChange={set('mapLink')} />
                </div>
                <div className="col-12">
                  <label className="form-label">Notes</label>
                  <textarea className="form-control" rows={3} value={form.notes} onChange={set('notes')} />
                </div>
              </div>
              <div className="mt-3 d-flex gap-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="row g-2">
              {isCompany && (
                <div className="col-md-6">
                  <small className="text-muted d-block">Company Name</small>
                  <span>{customer.companyName || '—'}</span>
                </div>
              )}
              {isCompany && (
                <div className="col-md-6">
                  <small className="text-muted d-block">Contact Person</small>
                  <span>{customer.contactPerson || '—'}</span>
                </div>
              )}
              <div className="col-md-6">
                <small className="text-muted d-block">Phone</small>
                <span>{customer.phone || '—'}</span>
              </div>
              <div className="col-md-6">
                <small className="text-muted d-block">Email</small>
                <span>{customer.email || '—'}</span>
              </div>
              <div className="col-md-6">
                <small className="text-muted d-block">City</small>
                <span>{customer.city || '—'}</span>
              </div>
              <div className="col-md-6">
                <small className="text-muted d-block">Member Since</small>
                <span>{customer.createdAt ? formatDate(customer.createdAt) : '—'}</span>
              </div>
              <div className="col-12">
                <small className="text-muted d-block">Address</small>
                <span>{customer.address || '—'}</span>
              </div>
              {customer.mapLink && (
                <div className="col-12">
                  <small className="text-muted d-block">Location</small>
                  <a href={resolveMapUrl(customer.mapLink)} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-secondary mt-1">
                    📍 View on Map
                  </a>
                </div>
              )}
              {customer.notes && (
                <div className="col-12">
                  <small className="text-muted d-block">Notes</small>
                  <span>{customer.notes}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Photos */}
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Photos</h5>
          <div className="d-flex align-items-center gap-2">
            {uploading && <span className="text-muted small">Uploading…</span>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="d-none"
              onChange={handlePhotoUpload}
            />
            <button
              className="btn btn-sm btn-outline-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              + Upload Photos
            </button>
          </div>
        </div>
        <div className="card-body">
          {(customer.photoUrls ?? []).length === 0 ? (
            <p className="text-muted mb-0">No photos yet. Click "Upload Photos" to add some.</p>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              {(customer.photoUrls ?? []).map(url => (
                <div key={url} className="position-relative" style={{ width: 120, height: 120 }}>
                  <img
                    src={url}
                    alt="customer"
                    className="rounded border"
                    style={{ width: 120, height: 120, objectFit: 'cover', cursor: 'pointer' }}
                    onClick={() => window.open(url, '_blank')}
                  />
                  <button
                    className="btn btn-danger btn-sm position-absolute top-0 end-0"
                    style={{ padding: '0 4px', lineHeight: 1.2, fontSize: 12 }}
                    onClick={() => handlePhotoDelete(url)}
                    title="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Order History */}
      <div className="card mb-4">
        <div className="card-header">
          <h5 className="mb-0">Order History</h5>
        </div>
        {orders.length === 0 ? (
          <div className="card-body text-muted">No orders yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th>Order ID</th>
                  <th>Order Date</th>
                  <th>Event Type</th>
                  <th className="text-end">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
                    <td className="font-monospace">{o.id.slice(0, 6).toUpperCase()}</td>
                    <td>{formatDate(o.orderDate)}</td>
                    <td>{o.eventType || '—'}</td>
                    <td className="text-end">{formatCurrency(o.total)}</td>
                    <td><span className="badge bg-secondary">{o.status.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product Purchase History */}
      <div className="card mb-4">
        <div className="card-header">
          <h5 className="mb-0">Product Purchase History</h5>
        </div>
        {purchaseHistory.length === 0 ? (
          <div className="card-body text-muted">No product purchases yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th>Product</th>
                  <th className="text-end">Total Qty</th>
                  <th className="text-end">Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {purchaseHistory.map(ph => (
                  <tr key={ph.productName}>
                    <td>{ph.productName}</td>
                    <td className="text-end">{ph.totalQty}</td>
                    <td className="text-end">{formatCurrency(ph.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">Summary</h5>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-3">
              <small className="text-muted d-block">Total Orders</small>
              <span className="fw-semibold">{orders.length}</span>
            </div>
            <div className="col-md-3">
              <small className="text-muted d-block">Total Revenue</small>
              <span className="fw-semibold">{formatCurrency(orders.reduce((s, o) => s + o.total, 0))}</span>
            </div>
            <div className="col-md-3">
              <small className="text-muted d-block">Active Orders</small>
              <span className="fw-semibold">{orders.filter(o => o.status !== 'CANCELLED' && o.status !== 'COMPLETED').length}</span>
            </div>
            <div className="col-md-3">
              <small className="text-muted d-block">Completed Orders</small>
              <span className="fw-semibold">{orders.filter(o => o.status === 'COMPLETED').length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
