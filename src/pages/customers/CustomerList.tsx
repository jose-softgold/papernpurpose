import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { customerService } from '../../services/customers'
import { Customer } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import ConfirmModal from '../../components/ConfirmModal'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import StatusBadge from '../../components/StatusBadge'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { exportToCSV } from '../../utils/export'
import { useAuth } from '../../hooks/useAuth'
import { canWriteMaster } from '../../utils/roles'

interface FormData {
  type: 'individual' | 'company'
  name: string
  companyName: string
  contactPerson: string
  phone: string
  email: string
  address: string
  city: string
  notes: string
  mapLink: string
  gstin: string
}

function CustomerForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Customer>
  onSave: (data: FormData, photos: File[]) => Promise<void>
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState<FormData>({
    type: initial?.type ?? 'individual',
    name: initial?.name ?? '',
    companyName: initial?.companyName ?? '',
    contactPerson: initial?.contactPerson ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    notes: initial?.notes ?? '',
    mapLink: initial?.mapLink ?? '',
    gstin: initial?.gstin ?? '',
  })
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setSelectedPhotos(Array.from(e.target.files))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave(form, selectedPhotos)
  }

  const isCompany = form.type === 'company'

  return (
    <form onSubmit={handleSubmit}>
      <div className="modal-body">
        {/* Type toggle */}
        <div className="mb-3">
          <label className="form-label">Customer Type <span className="text-danger">*</span></label>
          <div className="d-flex gap-3">
            <div className="form-check">
              <input
                className="form-check-input" type="radio" id="type-individual"
                checked={form.type === 'individual'}
                onChange={() => setForm(f => ({ ...f, type: 'individual' }))}
              />
              <label className="form-check-label" htmlFor="type-individual">Individual</label>
            </div>
            <div className="form-check">
              <input
                className="form-check-input" type="radio" id="type-company"
                checked={form.type === 'company'}
                onChange={() => setForm(f => ({ ...f, type: 'company' }))}
              />
              <label className="form-check-label" htmlFor="type-company">Company</label>
            </div>
          </div>
        </div>

        {isCompany ? (
          <>
            <div className="mb-3">
              <label className="form-label">Company Name <span className="text-danger">*</span></label>
              <input className="form-control" value={form.companyName} onChange={set('companyName')} required={isCompany} />
            </div>
            <div className="mb-3">
              <label className="form-label">Contact Person <span className="text-danger">*</span></label>
              <input className="form-control" value={form.contactPerson} onChange={set('contactPerson')} required={isCompany} />
            </div>
          </>
        ) : (
          <div className="mb-3">
            <label className="form-label">Name <span className="text-danger">*</span></label>
            <input className="form-control" value={form.name} onChange={set('name')} required={!isCompany} />
          </div>
        )}

        <div className="mb-3">
          <label className="form-label">Phone</label>
          <input className="form-control" value={form.phone} onChange={set('phone')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Email</label>
          <input className="form-control" type="email" value={form.email} onChange={set('email')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Address</label>
          <input className="form-control" value={form.address} onChange={set('address')} />
        </div>
        <div className="mb-3">
          <label className="form-label">City</label>
          <input className="form-control" value={form.city} onChange={set('city')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Google Maps Link</label>
          <input className="form-control" placeholder="Paste a Google Maps URL or lat,lng" value={form.mapLink} onChange={set('mapLink')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Photos</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="form-control"
            onChange={handleFileChange}
          />
          {selectedPhotos.length > 0 && (
            <div className="d-flex flex-wrap gap-1 mt-2">
              {selectedPhotos.map(f => (
                <span key={f.name} className="badge bg-secondary">{f.name}</span>
              ))}
            </div>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label">GSTIN</label>
          <input className="form-control" value={form.gstin} onChange={set('gstin')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Notes</label>
          <textarea className="form-control" rows={3} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function displayName(c: Customer): string {
  return c.type === 'company' ? (c.companyName ?? c.name) : c.name
}

export default function CustomerList() {
  const { role } = useAuth()
  const canEdit = canWriteMaster(role)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)
  const { toasts, showToast } = useToast()

  const load = async () => {
    try {
      setLoading(true)
      setCustomers(await customerService.getAll())
    } catch {
      showToast('Failed to load customers', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = customers.filter(c => {
    const q = search.toLowerCase()
    return (
      displayName(c).toLowerCase().includes(q) ||
      (c.contactPerson ?? '').toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q)
    )
  })

  const buildPayload = (data: FormData) => {
    if (data.type === 'company') {
      return {
        type: 'company' as const,
        name: data.contactPerson,
        companyName: data.companyName,
        contactPerson: data.contactPerson,
        phone: data.phone,
        email: data.email,
        address: data.address,
        city: data.city,
        notes: data.notes,
        mapLink: data.mapLink,
        gstin: data.gstin,
      }
    }
    return {
      type: 'individual' as const,
      name: data.name,
      companyName: '',
      contactPerson: '',
      phone: data.phone,
      email: data.email,
      address: data.address,
      city: data.city,
      notes: data.notes,
      mapLink: data.mapLink,
      gstin: data.gstin,
    }
  }

  const uploadPhotos = async (customerId: string, files: File[], existing: string[] = []): Promise<string[]> => {
    if (!files.length) return existing
    const urls = await Promise.all(files.map(async file => {
      const storageRef = ref(storage, `customers/${customerId}/${Date.now()}-${file.name}`)
      await uploadBytes(storageRef, file)
      return getDownloadURL(storageRef)
    }))
    return [...existing, ...urls]
  }

  const handleAdd = async (data: FormData, photos: File[]) => {
    setSaving(true)
    try {
      const id = await customerService.create({ ...buildPayload(data), status: 'active' })
      if (photos.length) {
        const photoUrls = await uploadPhotos(id, photos)
        await customerService.update(id, { photoUrls })
      }
      showToast('Customer added')
      setShowForm(false)
      await load()
    } catch {
      showToast('Failed to add customer', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (data: FormData, photos: File[]) => {
    if (!editCustomer) return
    setSaving(true)
    try {
      const payload = buildPayload(data)
      let photoUrls = editCustomer.photoUrls ?? []
      if (photos.length) {
        photoUrls = await uploadPhotos(editCustomer.id, photos, photoUrls)
      }
      await customerService.update(editCustomer.id, { ...payload, photoUrls })
      showToast('Customer updated')
      setEditCustomer(null)
      await load()
    } catch {
      showToast('Failed to update customer', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    if (!confirmToggle) return
    try {
      await customerService.toggleStatus(confirmToggle.id, confirmToggle.status)
      showToast(`Customer ${confirmToggle.status === 'active' ? 'deactivated' : 'activated'}`)
      setConfirmToggle(null)
      await load()
    } catch {
      showToast('Failed to update status', 'danger')
    }
  }

  const handleExport = () => {
    const rows = filtered.map(c => ({
      type: c.type,
      name: displayName(c),
      contactPerson: c.contactPerson ?? '',
      phone: c.phone,
      email: c.email,
      address: c.address,
      city: c.city,
      status: c.status,
    }))
    exportToCSV(rows, 'customers')
  }

  const openAdd = () => { setShowForm(true); setEditCustomer(null) }
  const openEdit = (c: Customer) => { setEditCustomer(c); setShowForm(false) }
  const closeModal = () => { setShowForm(false); setEditCustomer(null) }

  const showModal = showForm || editCustomer !== null

  return (
    <div>
      <ToastContainer toasts={toasts} />

      <PageHeader
        title="Customers"
        subtitle={`${customers.length} on file`}
        icon="👥"
        actions={
          <>
            <button className="btn btn-outline-secondary btn-sm" onClick={handleExport}>
              Export CSV
            </button>
            {canEdit && (
              <Link to="/import?type=customers" className="btn btn-outline-secondary btn-sm">Import</Link>
            )}
            {canEdit && (
              <button className="btn btn-primary btn-sm" onClick={openAdd}>
                + Add Customer
              </button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="card-body pb-3">
          <input
            className="form-control"
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
        <LoadingSpinner />
      ) : (
        <DataGrid
          items={filtered}
          resetKey={search}
          empty={
            <EmptyState
              icon="👥"
              message={search ? 'No customers match your search' : 'No customers yet'}
              description={
                search
                  ? 'Try a different name, phone number or email.'
                  : 'Add your first customer, or just tell the assistant about them.'
              }
            />
          }
        >
          {pageItems => (
            <>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>City</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/customers/${c.id}`} className="fw-semibold text-decoration-none">
                        {displayName(c)}
                      </Link>
                      {c.type === 'company' && c.contactPerson && (
                        <div className="text-muted small">{c.contactPerson}</div>
                      )}
                    </td>
                    <td>
                      <span className={`badge bg-${c.type === 'company' ? 'info' : 'secondary'}`}>
                        {c.type === 'company' ? 'Company' : 'Individual'}
                      </span>
                    </td>
                    <td>{c.phone}</td>
                    <td className="text-muted">{c.email}</td>
                    <td>{c.city}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      <div className="d-flex gap-2">
                        <button
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </button>
                        <button
                          className={`btn btn-sm btn-outline-${c.status === 'active' ? 'warning' : 'success'}`}
                          onClick={() => setConfirmToggle(c)}
                        >
                          {c.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </DataGrid>
      )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{editCustomer ? 'Edit Customer' : 'Add Customer'}</h5>
                  <button className="btn-close" onClick={closeModal} />
                </div>
                <CustomerForm
                  initial={editCustomer ?? undefined}
                  onSave={editCustomer ? handleEdit : handleAdd}
                  onCancel={closeModal}
                  saving={saving}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Toggle Confirmation */}
      <ConfirmModal
        show={confirmToggle !== null}
        title={confirmToggle?.status === 'active' ? 'Deactivate Customer' : 'Activate Customer'}
        message={
          confirmToggle
            ? confirmToggle.status === 'active'
              ? `Are you sure you want to deactivate ${displayName(confirmToggle)}?`
              : `Are you sure you want to activate ${displayName(confirmToggle)}?`
            : ''
        }
        confirmLabel={confirmToggle?.status === 'active' ? 'Deactivate' : 'Activate'}
        onConfirm={handleToggle}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  )
}
