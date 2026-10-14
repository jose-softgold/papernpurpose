import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Occasion, OccasionKind, OccasionSeason } from '../../types'
import { occasionService } from '../../services/occasions'
import { useToast } from '../../hooks/useToast'
import { canWriteMaster } from '../../utils/roles'
import { useAuth } from '../../hooks/useAuth'
import LoadingSpinner from '../../components/LoadingSpinner'
import StatusBadge from '../../components/StatusBadge'
import ConfirmModal from '../../components/ConfirmModal'

const KIND_OPTIONS: { value: OccasionKind; label: string }[] = [
  { value: 'festival', label: 'Festival' },
  { value: 'national', label: 'National' },
  { value: 'personal', label: 'Personal' },
  { value: 'other', label: 'Other' },
]

export default function OccasionsManager() {
  const { role } = useAuth()
  const canEdit = canWriteMaster(role)
  const { showToast } = useToast()

  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [seasons, setSeasons] = useState<OccasionSeason[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<OccasionKind>('festival')

  const [openSeasonFor, setOpenSeasonFor] = useState<string | null>(null)
  const [openYear, setOpenYear] = useState(new Date().getFullYear())

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', kind: 'festival' as OccasionKind, month: '', day: '' })
  const [deleteOccasion, setDeleteOccasion] = useState<Occasion | null>(null)
  const [deleteSeason, setDeleteSeason] = useState<OccasionSeason | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, s] = await Promise.all([
        occasionService.getAllOccasions(),
        occasionService.getAllSeasons(),
      ])
      setOccasions(o)
      setSeasons(s)
    } catch {
      showToast('Failed to load occasions', 'danger')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void load() }, [load])

  const seasonsFor = (occasionId: string) =>
    seasons.filter(s => s.occasionId === occasionId).sort((a, b) => b.year - a.year)

  async function handleAddOccasion(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    try {
      await occasionService.createOccasion({ name: newName.trim(), kind: newKind })
      showToast('Occasion created', 'success')
      setNewName('')
      setShowAdd(false)
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function handleOpenSeason(occasionId: string) {
    setBusy(true)
    try {
      await occasionService.openSeason(occasionId, openYear)
      showToast(`Season opened for ${openYear}`, 'success')
      setOpenSeasonFor(null)
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Open season failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function toggleOccasionStatus(o: Occasion) {
    if (!canEdit) return
    setBusy(true)
    try {
      await occasionService.updateOccasion(o.id, {
        status: o.status === 'active' ? 'inactive' : 'active',
      })
      await load()
    } catch {
      showToast('Update failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(o: Occasion) {
    setEditingId(o.id)
    setEditForm({
      name: o.name,
      kind: o.kind,
      month: o.typicalMonth ? String(o.typicalMonth) : '',
      day: o.typicalDay ? String(o.typicalDay) : '',
    })
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId || !editForm.name.trim()) return
    setBusy(true)
    try {
      await occasionService.updateOccasion(editingId, {
        name: editForm.name,
        kind: editForm.kind,
        typicalMonth: editForm.month ? Number(editForm.month) : null,
        typicalDay: editForm.day ? Number(editForm.day) : null,
      })
      showToast('Occasion updated', 'success')
      setEditingId(null)
      await load()
    } catch {
      showToast('Update failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDeleteOccasion() {
    if (!deleteOccasion) return
    setBusy(true)
    try {
      await occasionService.deleteOccasion(deleteOccasion.id)
      showToast('Occasion deleted', 'success')
      setDeleteOccasion(null)
      await load()
    } catch {
      showToast('Delete failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDeleteSeason() {
    if (!deleteSeason) return
    setBusy(true)
    try {
      await occasionService.deleteSeason(deleteSeason.id)
      showToast('Season deleted', 'success')
      setDeleteSeason(null)
      await load()
    } catch {
      showToast('Delete failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function updateSeasonStatus(s: OccasionSeason, status: OccasionSeason['status']) {
    if (!canEdit) return
    setBusy(true)
    try {
      await occasionService.updateSeason(s.id, { status })
      await load()
    } catch {
      showToast('Update failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mt-3" style={{ maxWidth: 720 }}>
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h2 className="h6 mb-1">Occasions</h2>
            <p className="small text-muted mb-0">
              Catalog of events (Diwali, New Year, etc.). Open a season each year for seasonal stock.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setShowAdd(v => !v)}
            >
              {showAdd ? 'Cancel' : 'Add occasion'}
            </button>
          )}
        </div>

        {showAdd && canEdit && (
          <form onSubmit={handleAddOccasion} className="border rounded p-3 mb-3 bg-light">
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label small">Name</label>
                <input
                  className="form-control form-control-sm"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Diwali"
                  required
                />
              </div>
              <div className="col-md-4">
                <label className="form-label small">Kind</label>
                <select
                  className="form-select form-select-sm"
                  value={newKind}
                  onChange={e => setNewKind(e.target.value as OccasionKind)}
                >
                  {KIND_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2 d-flex align-items-end">
                <button type="submit" className="btn btn-sm btn-success w-100" disabled={busy}>
                  Save
                </button>
              </div>
            </div>
          </form>
        )}

        {loading ? (
          <LoadingSpinner />
        ) : occasions.length === 0 ? (
          <p className="text-muted small mb-0">No occasions yet. Add Diwali, Independence Day, New Year, etc.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Seasons</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {occasions.map(o => editingId === o.id ? (
                  <tr key={o.id}>
                    <td colSpan={canEdit ? 5 : 4}>
                      <form onSubmit={saveEdit} className="row g-2 align-items-end">
                        <div className="col-md-4">
                          <label className="form-label small mb-0">Name</label>
                          <input
                            className="form-control form-control-sm"
                            value={editForm.name}
                            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="col-md-3">
                          <label className="form-label small mb-0">Kind</label>
                          <select
                            className="form-select form-select-sm"
                            value={editForm.kind}
                            onChange={e => setEditForm(f => ({ ...f, kind: e.target.value as OccasionKind }))}
                          >
                            {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                          </select>
                        </div>
                        <div className="col-3 col-md-1">
                          <label className="form-label small mb-0">Month</label>
                          <input
                            type="number" min={1} max={12}
                            className="form-control form-control-sm"
                            value={editForm.month}
                            onChange={e => setEditForm(f => ({ ...f, month: e.target.value }))}
                          />
                        </div>
                        <div className="col-3 col-md-1">
                          <label className="form-label small mb-0">Day</label>
                          <input
                            type="number" min={1} max={31}
                            className="form-control form-control-sm"
                            value={editForm.day}
                            onChange={e => setEditForm(f => ({ ...f, day: e.target.value }))}
                          />
                        </div>
                        <div className="col-6 col-md-3 d-flex gap-1">
                          <button type="submit" className="btn btn-sm btn-success" disabled={busy}>Save</button>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={o.id}>
                    <td className="fw-semibold">{o.name}</td>
                    <td className="text-capitalize small">{o.kind}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>
                      <div className="d-flex flex-wrap gap-1">
                        {seasonsFor(o.id).map(s => (
                          <span key={s.id} className="badge bg-light text-dark border">
                            <Link to={`/occasions/${s.id}`} className="text-dark" title="Open occasion dashboard">{s.name}</Link>
                            <span className="ms-1 text-muted">({s.status})</span>
                            {canEdit && s.status !== 'closed' && (
                              <button
                                type="button"
                                className="btn btn-link btn-sm p-0 ms-1"
                                style={{ fontSize: '.7rem' }}
                                onClick={() => void updateSeasonStatus(s, 'closed')}
                              >
                                close
                              </button>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                className="btn btn-link btn-sm p-0 ms-1 text-danger"
                                style={{ fontSize: '.7rem' }}
                                onClick={() => setDeleteSeason(s)}
                              >
                                delete
                              </button>
                            )}
                          </span>
                        ))}
                        {seasonsFor(o.id).length === 0 && (
                          <span className="text-muted small">None</span>
                        )}
                      </div>
                    </td>
                    {canEdit && (
                      <td className="text-end text-nowrap">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary me-1"
                          disabled={busy}
                          onClick={() => startEdit(o)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger me-1"
                          disabled={busy}
                          onClick={() => setDeleteOccasion(o)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary me-1"
                          disabled={busy}
                          onClick={() => toggleOccasionStatus(o)}
                        >
                          {o.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          disabled={busy}
                          onClick={() => {
                            setOpenSeasonFor(openSeasonFor === o.id ? null : o.id)
                            setOpenYear(new Date().getFullYear())
                          }}
                        >
                          Open season
                        </button>
                        {openSeasonFor === o.id && (
                          <div className="d-inline-flex align-items-center gap-1 ms-2">
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              style={{ width: 80 }}
                              value={openYear}
                              onChange={e => setOpenYear(Number(e.target.value))}
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-success"
                              disabled={busy}
                              onClick={() => void handleOpenSeason(o.id)}
                            >
                              Go
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        show={deleteOccasion !== null}
        title="Delete Occasion"
        message={deleteOccasion ? `Delete ${deleteOccasion.name} and all its seasons? Stock already tagged to a season stays in the ledger.` : ''}
        confirmLabel="Delete"
        onConfirm={() => void confirmDeleteOccasion()}
        onCancel={() => setDeleteOccasion(null)}
      />
      <ConfirmModal
        show={deleteSeason !== null}
        title="Delete Season"
        message={deleteSeason ? `Delete ${deleteSeason.name}? Stock already tagged to it stays in the ledger.` : ''}
        confirmLabel="Delete"
        onConfirm={() => void confirmDeleteSeason()}
        onCancel={() => setDeleteSeason(null)}
      />
    </div>
  )
}
