import { useState, useEffect } from 'react'
import { initializeApp, getApps, deleteApp } from 'firebase/app'
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  connectAuthEmulator,
  type Auth,
} from 'firebase/auth'
import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db, firebaseConfig } from '../../firebase/config'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { UserDoc, UserRole } from '../../types'
import { ROLE_LABELS, isOwner } from '../../utils/roles'
import { sortByNewest } from '../../utils/sort'
import { callSyncUserClaims } from '../../firebase/functions'
import { emulatorHost } from '../../firebase/emulator'

interface UserRow extends UserDoc {
  id: string
}

const SECONDARY = 'user-creator'

const CREATABLE_ROLES: UserRole[] = ['owner', 'admin', 'worker', 'viewer']

function getSecondaryAuth() {
  const existing = getApps().find(a => a.name === SECONDARY)
  const app = existing ?? initializeApp(firebaseConfig, SECONDARY)
  const secondaryAuth = getAuth(app)
  if (import.meta.env.VITE_USE_EMULATOR === 'true') {
    try {
      connectAuthEmulator(secondaryAuth, `http://${emulatorHost()}:9099`, {
        disableWarnings: true,
      })
    } catch {
      /* already connected */
    }
  }
  return secondaryAuth
}

async function releaseSecondaryAuth(secondaryAuth: Auth) {
  try {
    await fbSignOut(secondaryAuth)
  } catch {
    /* ignore */
  }
  try {
    await deleteApp(secondaryAuth.app)
  } catch {
    /* ignore */
  }
}

/**
 * Returns the uid for the login, creating it when new. An account can already
 * exist in Auth without a Firestore profile (e.g. an earlier attempt failed
 * midway), so fall back to signing in to recover and attach the profile.
 */
async function resolveAuthUid(
  secondaryAuth: Auth,
  email: string,
  password: string,
): Promise<{ uid: string; recovered: boolean }> {
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    return { uid: cred.user.uid, recovered: false }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code !== 'auth/email-already-in-use') throw err
    try {
      const cred = await signInWithEmailAndPassword(secondaryAuth, email, password)
      return { uid: cred.user.uid, recovered: true }
    } catch {
      throw new Error(
        `${email} already has a login with a different password. Use that password to link it, or pick another email.`,
      )
    }
  }
}

function normalizePhone(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const digits = trimmed.replace(/[^\d+]/g, '')
  return digits || undefined
}

export default function UserManager() {
  const { user, role: myRole } = useAuth()
  const { toasts, showToast } = useToast()
  const [users, setUsers] = useState<UserRow[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('worker')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadUsers = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'))
      setUsers(sortByNewest(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as UserDoc) })),
        u => u.createdAt,
      ))
      setLoadError(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load users'
      setLoadError(msg)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setFormError(null)
    const cleanEmail = email.trim().toLowerCase()
    const cleanName = name.trim()
    if (newRole === 'owner' && !isOwner(myRole)) {
      setFormError('Only an owner can create another owner')
      return
    }
    if (cleanEmail === user.email?.toLowerCase()) {
      setFormError('That is your own login. Clear the form if your browser autofilled it.')
      return
    }
    if (users.some(u => u.email?.toLowerCase() === cleanEmail)) {
      setFormError(`${cleanEmail} is already listed below`)
      return
    }
    setSaving(true)
    let secondaryAuth: Auth | null = null
    try {
      secondaryAuth = getSecondaryAuth()
      const { uid, recovered } = await resolveAuthUid(secondaryAuth, cleanEmail, password)
      const phone = normalizePhone(whatsappPhone)
      await setDoc(doc(db, 'users', uid), {
        email: cleanEmail,
        name: cleanName,
        role: newRole,
        active: true,
        ...(phone ? { whatsappPhone: phone } : {}),
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      })
      try {
        await callSyncUserClaims(uid)
      } catch {
        /* claims sync optional until functions are deployed */
      }
      showToast(
        recovered
          ? `Linked existing login and restored profile for "${cleanName}"`
          : `${ROLE_LABELS[newRole]} "${cleanName}" created`,
      )
      setName('')
      setEmail('')
      setPassword('')
      setWhatsappPhone('')
      setNewRole('worker')
      await loadUsers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create user'
      setFormError(msg)
      showToast(msg, 'danger')
    } finally {
      if (secondaryAuth) await releaseSecondaryAuth(secondaryAuth)
      setSaving(false)
    }
  }

  const setActive = async (id: string, active: boolean) => {
    if (id === user?.uid) {
      showToast('You cannot deactivate yourself', 'danger')
      return
    }
    try {
      await updateDoc(doc(db, 'users', id), { active })
      try {
        await callSyncUserClaims(id)
      } catch {
        /* optional */
      }
      showToast(active ? 'User reactivated' : 'User deactivated')
      await loadUsers()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'danger')
    }
  }

  const changeRole = async (id: string, role: UserRole) => {
    if (id === user?.uid) {
      showToast('You cannot change your own role', 'danger')
      return
    }
    if (role === 'owner' && !isOwner(myRole)) {
      showToast('Only an owner can promote to owner', 'danger')
      return
    }
    try {
      await updateDoc(doc(db, 'users', id), { role })
      try {
        await callSyncUserClaims(id)
      } catch {
        /* optional */
      }
      showToast('Role updated')
      await loadUsers()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'danger')
    }
  }

  const savePhone = async (id: string, phoneRaw: string) => {
    try {
      const phone = normalizePhone(phoneRaw)
      await updateDoc(doc(db, 'users', id), {
        whatsappPhone: phone ?? null,
      })
      showToast('Phone updated')
      await loadUsers()
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'danger')
    }
  }

  return (
    <div className="mt-4">
      <ToastContainer toasts={toasts} />
      <div className="card mb-3">
        <div className="card-header">
          <h5 className="mb-0">Users</h5>
        </div>
        <div className="card-body">
          <form onSubmit={handleCreate} autoComplete="off">
            <div className="row g-2 mb-2">
              <div className="col-12 col-sm-6 col-xl-3">
                <label className="form-label small mb-1">Name</label>
                <input
                  className="form-control"
                  placeholder="Full name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="col-12 col-sm-6 col-xl-3">
                <label className="form-label small mb-1">Email</label>
                <input
                  className="form-control"
                  type="email"
                  name="new-user-email"
                  placeholder="staff@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="col-12 col-sm-6 col-xl-2">
                <label className="form-label small mb-1">Temp password</label>
                <input
                  className="form-control"
                  type="password"
                  name="new-user-password"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <div className="col-12 col-sm-6 col-xl-2">
                <label className="form-label small mb-1">Role</label>
                <select
                  className="form-select"
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as UserRole)}
                >
                  {CREATABLE_ROLES.filter(r => r !== 'owner' || isOwner(myRole)).map(r => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 col-sm-6 col-xl-2">
                <label className="form-label small mb-1">WhatsApp (optional)</label>
                <input
                  className="form-control"
                  placeholder="+91…"
                  value={whatsappPhone}
                  onChange={e => setWhatsappPhone(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="col-12">
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Creating…' : '+ Add user'}
                </button>
              </div>
              {formError && (
                <div className="col-12">
                  <div className="alert alert-danger py-2 mb-0 small">{formError}</div>
                </div>
              )}
            </div>
            <small className="text-muted">
              Workers can log ops (purchases, production, order status). Viewers are read-only. Admins
              manage most of the CRM. WhatsApp phone is optional (for a future channel).
            </small>
          </form>
        </div>
      </div>

      {loadError && (
        <div className="alert alert-warning">
          Could not load the user list: {loadError}
        </div>
      )}

      {users.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h6 className="mb-0">All users</h6>
          </div>
          <div className="table-responsive">
            <table className="table table-sm mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>WhatsApp</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className={u.active === false ? 'table-secondary' : undefined}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td style={{ minWidth: 120 }}>
                      <select
                        className="form-select form-select-sm"
                        value={u.role}
                        disabled={u.id === user?.uid}
                        onChange={e => changeRole(u.id, e.target.value as UserRole)}
                      >
                        {CREATABLE_ROLES.filter(r => r !== 'owner' || isOwner(myRole) || u.role === 'owner').map(
                          r => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <PhoneCell
                        initial={u.whatsappPhone ?? ''}
                        onSave={phone => savePhone(u.id, phone)}
                      />
                    </td>
                    <td>{u.active === false ? 'Inactive' : 'Active'}</td>
                    <td className="text-end">
                      {u.id !== user?.uid && (
                        <button
                          type="button"
                          className={`btn btn-sm ${u.active === false ? 'btn-outline-success' : 'btn-outline-danger'}`}
                          onClick={() => setActive(u.id, u.active === false)}
                        >
                          {u.active === false ? 'Reactivate' : 'Deactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PhoneCell({
  initial,
  onSave,
}: {
  initial: string
  onSave: (phone: string) => void
}) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    setValue(initial)
  }, [initial])
  return (
    <div className="input-group input-group-sm">
      <input
        className="form-control"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="+91…"
      />
      <button type="button" className="btn btn-outline-secondary" onClick={() => onSave(value)}>
        Save
      </button>
    </div>
  )
}
