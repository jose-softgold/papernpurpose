import { useState } from 'react'
import { customerService } from '../services/customers'
import { supplierService } from '../services/suppliers'
import { materialService } from '../services/materials'
import { GstRateSelect } from './GstFields'
import type { Customer, Material, Supplier } from '../types'

export type QuickCreateKind = 'supplier' | 'customer' | 'material'

type Created =
  | { kind: 'supplier'; entity: Supplier }
  | { kind: 'customer'; entity: Customer }
  | { kind: 'material'; entity: Material }

type PartyType = 'individual' | 'company'

const emptyParty = {
  type: 'individual' as PartyType,
  name: '',
  companyName: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  mapLink: '',
  gstin: '',
  notes: '',
}

function partyPayload(p: typeof emptyParty) {
  const shared = {
    phone: p.phone.trim(),
    email: p.email.trim(),
    address: p.address.trim(),
    city: p.city.trim(),
    notes: p.notes.trim(),
    mapLink: p.mapLink.trim(),
    gstin: p.gstin.trim(),
    status: 'active' as const,
  }
  if (p.type === 'company') {
    return {
      ...shared,
      type: 'company' as const,
      name: p.contactPerson.trim(),
      companyName: p.companyName.trim(),
      contactPerson: p.contactPerson.trim(),
    }
  }
  return {
    ...shared,
    type: 'individual' as const,
    name: p.name.trim(),
    companyName: '',
    contactPerson: '',
  }
}

const stubTimestamps = { createdAt: undefined as never, updatedAt: undefined as never }

export default function EntityQuickCreate({
  kind,
  show,
  onCreated,
  onCancel,
  hideCost,
}: {
  kind: QuickCreateKind
  show: boolean
  onCreated: (created: Created) => void
  onCancel: () => void
  hideCost?: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [party, setParty] = useState(emptyParty)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [costPerUnit, setCostPerUnit] = useState('0')
  const [gstRate, setGstRate] = useState(0)

  if (!show) return null

  const isParty = kind === 'supplier' || kind === 'customer'
  const isCompany = party.type === 'company'
  const title =
    kind === 'supplier' ? 'Add supplier' : kind === 'customer' ? 'Add customer' : 'Add material'
  const typeLabel = kind === 'supplier' ? 'Supplier Type' : 'Customer Type'

  const setPartyField = (field: keyof typeof emptyParty) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setParty(p => ({ ...p, [field]: e.target.value }))

  const reset = () => {
    setParty(emptyParty)
    setName('')
    setUnit('pcs')
    setCostPerUnit('0')
    setGstRate(0)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isParty) {
      if (isCompany && (!party.companyName.trim() || !party.contactPerson.trim())) {
        setError('Company name and contact person are required')
        return
      }
      if (!isCompany && !party.name.trim()) {
        setError('Name is required')
        return
      }
    } else if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (kind === 'supplier') {
        const payload = partyPayload(party)
        const id = await supplierService.create(payload)
        onCreated({ kind: 'supplier', entity: { id, ...payload, ...stubTimestamps } })
      } else if (kind === 'customer') {
        const payload = partyPayload(party)
        const id = await customerService.create(payload)
        onCreated({ kind: 'customer', entity: { id, ...payload, ...stubTimestamps } })
      } else {
        const id = await materialService.create({
          name: name.trim(),
          category: '',
          unit: unit.trim() || 'pcs',
          minimumStock: 0,
          costPerUnit: hideCost ? 0 : parseFloat(costPerUnit) || 0,
          supplierId: '',
          notes: '',
          status: 'active',
          gstRate,
        })
        onCreated({
          kind: 'material',
          entity: {
            id,
            name: name.trim(),
            category: '',
            unit: unit.trim() || 'pcs',
            minimumStock: 0,
            costPerUnit: hideCost ? 0 : parseFloat(costPerUnit) || 0,
            supplierId: '',
            notes: '',
            status: 'active',
            gstRate,
            ...stubTimestamps,
          },
        })
      }
      reset()
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1060 }} />
      <div
        className="modal d-flex align-items-center justify-content-center"
        tabIndex={-1}
        style={{ zIndex: 1070, overflow: 'hidden' }}
      >
        <div
          className={`modal-dialog modal-dialog-scrollable ${isParty ? '' : 'modal-sm'}`.trim()}
          style={{ height: 'auto', maxHeight: '90vh', minHeight: 0, width: '100%', margin: '0.5rem' }}
        >
          <form
            className="modal-content"
            onSubmit={handleSubmit}
            style={{ maxHeight: '90vh', overflow: 'hidden' }}
          >
              <div className="modal-header flex-shrink-0">
                <h5 className="modal-title">{title}</h5>
                <button type="button" className="btn-close" onClick={() => { reset(); onCancel() }} />
              </div>
              <div className="modal-body" style={{ overflowY: 'auto', minHeight: 0 }}>
                {error && <div className="alert alert-danger py-2">{error}</div>}
                {isParty && (
                  <>
                    <div className="mb-3">
                      <label className="form-label">{typeLabel} <span className="text-danger">*</span></label>
                      <div className="d-flex gap-3">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            id="eqc-type-individual"
                            name="eqc-entity-type"
                            checked={party.type === 'individual'}
                            onChange={() => setParty(p => ({ ...p, type: 'individual' }))}
                          />
                          <label className="form-check-label" htmlFor="eqc-type-individual">Individual</label>
                        </div>
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="radio"
                            id="eqc-type-company"
                            name="eqc-entity-type"
                            checked={party.type === 'company'}
                            onChange={() => setParty(p => ({ ...p, type: 'company' }))}
                          />
                          <label className="form-check-label" htmlFor="eqc-type-company">Company</label>
                        </div>
                      </div>
                    </div>

                    {isCompany ? (
                      <>
                        <div className="mb-3">
                          <label className="form-label">Company Name <span className="text-danger">*</span></label>
                          <input
                            className="form-control"
                            value={party.companyName}
                            onChange={setPartyField('companyName')}
                            autoFocus
                            required
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Contact Person <span className="text-danger">*</span></label>
                          <input
                            className="form-control"
                            value={party.contactPerson}
                            onChange={setPartyField('contactPerson')}
                            required
                          />
                        </div>
                      </>
                    ) : (
                      <div className="mb-3">
                        <label className="form-label">Name <span className="text-danger">*</span></label>
                        <input
                          className="form-control"
                          value={party.name}
                          onChange={setPartyField('name')}
                          autoFocus
                          required
                        />
                      </div>
                    )}

                    <div className="mb-3">
                      <label className="form-label">Phone</label>
                      <input
                        className="form-control"
                        value={party.phone}
                        onChange={setPartyField('phone')}
                        inputMode="tel"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Email</label>
                      <input
                        className="form-control"
                        type="email"
                        value={party.email}
                        onChange={setPartyField('email')}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Address</label>
                      <input
                        className="form-control"
                        value={party.address}
                        onChange={setPartyField('address')}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">City</label>
                      <input
                        className="form-control"
                        value={party.city}
                        onChange={setPartyField('city')}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Google Maps Link</label>
                      <input
                        className="form-control"
                        placeholder="Paste a Google Maps URL or lat,lng"
                        value={party.mapLink}
                        onChange={setPartyField('mapLink')}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">GSTIN</label>
                      <input
                        className="form-control"
                        value={party.gstin}
                        onChange={setPartyField('gstin')}
                        placeholder="Optional"
                      />
                      <div className="form-text">
                        Optional. Use GSTIN for companies so invoices can show it. Individuals can leave this blank.
                      </div>
                    </div>
                    <div className="mb-0">
                      <label className="form-label">Notes</label>
                      <textarea
                        className="form-control"
                        rows={3}
                        value={party.notes}
                        onChange={setPartyField('notes')}
                      />
                    </div>
                  </>
                )}
                {kind === 'material' && (
                  <>
                    <div className="mb-3">
                      <label className="form-label">Name <span className="text-danger">*</span></label>
                      <input className="form-control" value={name} onChange={e => setName(e.target.value)} autoFocus required />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Unit</label>
                      <input className="form-control" value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg, pcs, m" />
                    </div>
                    {!hideCost && (
                      <div className="mb-3">
                        <label className="form-label">Cost / unit (₹, taxable)</label>
                        <input className="form-control" type="number" min="0" step="0.01" value={costPerUnit} onChange={e => setCostPerUnit(e.target.value)} />
                      </div>
                    )}
                    {!hideCost && (
                      <div className="mb-0">
                        <GstRateSelect value={gstRate} onChange={setGstRate} />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="modal-footer flex-shrink-0">
                <button type="button" className="btn btn-secondary" onClick={() => { reset(); onCancel() }} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
              </div>
          </form>
        </div>
      </div>
    </>
  )
}
