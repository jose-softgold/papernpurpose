import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { supplierService } from '../../services/suppliers'
import { storage } from '../../firebase/config'
import { Supplier } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import ConfirmModal from '../../components/ConfirmModal'
import { formatDate } from '../../utils/format'
import { useAuth } from '../../hooks/useAuth'
import { canWriteMaster, isAdminOrOwner, isWorker } from '../../utils/roles'
import SupplierPurchases from '../../components/SupplierPurchases'

function resolveMapUrl(link: string): string {
  if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(link.trim())) {
    return `https://maps.google.com/?q=${link.trim()}`
  }
  return link
}

function displayName(s: Supplier): string {
  return s.type === 'company' ? (s.companyName ?? s.name) : s.name
}

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    type: 'individual' as 'individual' | 'company',
    name: '', companyName: '', contactPerson: '',
    phone: '', email: '', address: '', city: '', notes: '', mapLink: '', gstin: '',
  })
  const { toasts, showToast } = useToast()
  const { role } = useAuth()
  const canDelete = canWriteMaster(role)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = async () => {
    if (!id || !supplier) return
    try {
      await supplierService.delete(id, displayName(supplier))
      navigate('/suppliers')
    } catch {
      setConfirmDelete(false)
      showToast('Failed to delete supplier', 'danger')
    }
  }

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        const s = await supplierService.getById(id)
        if (s) {
          setSupplier(s)
          setForm({
            type: s.type ?? 'individual',
            name: s.name,
            companyName: s.companyName ?? '',
            contactPerson: s.contactPerson ?? '',
            phone: s.phone,
            email: s.email,
            address: s.address,
            city: s.city ?? '',
            notes: s.notes,
            mapLink: s.mapLink ?? '',
            gstin: s.gstin ?? '',
          })
        }
      } catch {
        showToast('Failed to load supplier', 'danger')
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
        companyName: form.companyName, contactPerson: form.contactPerson,
        phone: form.phone, email: form.email,
        address: form.address, city: form.city,
        notes: form.notes, mapLink: form.mapLink, gstin: form.gstin,
      }
    }
    return {
      type: 'individual' as const,
      name: form.name,
      companyName: '', contactPerson: '',
      phone: form.phone, email: form.email,
      address: form.address, city: form.city,
      notes: form.notes, mapLink: form.mapLink, gstin: form.gstin,
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    try {
      const payload = buildPayload()
      await supplierService.update(id, payload)
      setSupplier(prev => prev ? { ...prev, ...payload } : prev)
      setEditing(false)
      showToast('Supplier updated')
    } catch {
      showToast('Failed to update supplier', 'danger')
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
        const storageRef = ref(storage, `suppliers/${id}/${Date.now()}-${file.name}`)
        await uploadBytes(storageRef, file)
        urls.push(await getDownloadURL(storageRef))
      }
      const merged = [...(supplier?.photoUrls ?? []), ...urls]
      await supplierService.update(id, { photoUrls: merged })
      setSupplier(prev => prev ? { ...prev, photoUrls: merged } : prev)
      showToast(`${urls.length} photo${urls.length > 1 ? 's' : ''} uploaded`)
    } catch {
      showToast('Failed to upload photos', 'danger')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handlePhotoDelete = async (url: string) => {
    if (!id || !supplier) return
    try { await deleteObject(ref(storage, url)) } catch { /* already gone */ }
    const remaining = (supplier.photoUrls ?? []).filter(u => u !== url)
    await supplierService.update(id, { photoUrls: remaining })
    setSupplier(prev => prev ? { ...prev, photoUrls: remaining } : prev)
    showToast('Photo removed')
  }

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  if (loading) return <LoadingSpinner />
  if (!supplier) return (
    <div>
      <p className="text-danger">Supplier not found.</p>
      <button className="btn btn-secondary" onClick={() => navigate('/suppliers')}>Back</button>
    </div>
  )

  const isCompany = supplier.type === 'company'

  return (
    <div>
      <ToastContainer toasts={toasts} />
      <ConfirmModal
        show={confirmDelete}
        title="Delete Supplier"
        message={`Delete ${displayName(supplier)}? Past purchases keep pointing at this supplier but will show its id.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <div className="d-flex align-items-center gap-3 mb-4 flex-wrap">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/suppliers')}>&larr; Back</button>
        <div>
          <h4 className="pc-page-title">{displayName(supplier)}</h4>
          {isCompany && supplier.contactPerson && (
            <small className="text-muted">Contact: {supplier.contactPerson}</small>
          )}
        </div>
        <span className={`badge bg-${isCompany ? 'info' : 'secondary'}`}>
          {isCompany ? 'Company' : 'Individual'}
        </span>
        <span className={`badge bg-${supplier.status === 'active' ? 'success' : 'secondary'}`}>
          {supplier.status}
        </span>
      </div>

      {/* Supplier Information */}
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Supplier Information</h5>
          {!editing && (
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-outline-primary" onClick={() => setEditing(true)}>Edit</button>
              {canDelete && (
                <button className="btn btn-sm btn-outline-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
              )}
            </div>
          )}
        </div>
        <div className="card-body">
          {editing ? (
            <form onSubmit={handleSave}>
              <div className="row g-3 mb-1">
                <div className="col-12">
                  <label className="form-label">Supplier Type</label>
                  <div className="d-flex gap-3">
                    <div className="form-check">
                      <input className="form-check-input" type="radio" id="sedit-individual"
                        checked={form.type === 'individual'}
                        onChange={() => setForm(f => ({ ...f, type: 'individual' }))} />
                      <label className="form-check-label" htmlFor="sedit-individual">Individual</label>
                    </div>
                    <div className="form-check">
                      <input className="form-check-input" type="radio" id="sedit-company"
                        checked={form.type === 'company'}
                        onChange={() => setForm(f => ({ ...f, type: 'company' }))} />
                      <label className="form-check-label" htmlFor="sedit-company">Company</label>
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
                  <label className="form-label">GSTIN</label>
                  <input className="form-control" value={form.gstin} onChange={set('gstin')} />
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
                  <span>{supplier.companyName || '—'}</span>
                </div>
              )}
              {isCompany && (
                <div className="col-md-6">
                  <small className="text-muted d-block">Contact Person</small>
                  <span>{supplier.contactPerson || '—'}</span>
                </div>
              )}
              <div className="col-md-6">
                <small className="text-muted d-block">Phone</small>
                <span>{supplier.phone || '—'}</span>
              </div>
              <div className="col-md-6">
                <small className="text-muted d-block">Email</small>
                <span>{supplier.email || '—'}</span>
              </div>
              <div className="col-md-6">
                <small className="text-muted d-block">City</small>
                <span>{supplier.city || '—'}</span>
              </div>
              <div className="col-md-6">
                <small className="text-muted d-block">GSTIN</small>
                <span>{supplier.gstin || '—'}</span>
              </div>
              <div className="col-md-6">
                <small className="text-muted d-block">Added On</small>
                <span>{supplier.createdAt ? formatDate(supplier.createdAt) : '—'}</span>
              </div>
              <div className="col-12">
                <small className="text-muted d-block">Address</small>
                <span>{supplier.address || '—'}</span>
              </div>
              {supplier.mapLink && (
                <div className="col-12">
                  <small className="text-muted d-block">Location</small>
                  <a href={resolveMapUrl(supplier.mapLink)} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-secondary mt-1">
                    📍 View on Map
                  </a>
                </div>
              )}
              {supplier.notes && (
                <div className="col-12">
                  <small className="text-muted d-block">Notes</small>
                  <span>{supplier.notes}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {id && !isWorker(role) && <SupplierPurchases supplierId={id} supplierName={displayName(supplier)} showPayments={isAdminOrOwner(role)} />}

      {/* Photos */}
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Photos</h5>
          <div className="d-flex align-items-center gap-2">
            {uploading && <span className="text-muted small">Uploading…</span>}
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="d-none" onChange={handlePhotoUpload} />
            <button className="btn btn-sm btn-outline-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              + Upload Photos
            </button>
          </div>
        </div>
        <div className="card-body">
          {(supplier.photoUrls ?? []).length === 0 ? (
            <p className="text-muted mb-0">No photos yet. Click "Upload Photos" to add some.</p>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              {(supplier.photoUrls ?? []).map(url => (
                <div key={url} className="position-relative" style={{ width: 120, height: 120 }}>
                  <img src={url} alt="supplier" className="rounded border"
                    style={{ width: 120, height: 120, objectFit: 'cover', cursor: 'pointer' }}
                    onClick={() => window.open(url, '_blank')} />
                  <button
                    className="btn btn-danger btn-sm position-absolute top-0 end-0"
                    style={{ padding: '0 4px', lineHeight: 1.2, fontSize: 12 }}
                    onClick={() => handlePhotoDelete(url)}
                    title="Remove photo"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
