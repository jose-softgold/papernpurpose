import { useState, useEffect } from 'react'
import { initializeApp, getApps, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut, connectAuthEmulator } from 'firebase/auth'
import { collection, doc, setDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { db, firebaseConfig } from '../../firebase/config'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { UserDoc } from '../../types'

interface WorkerRow extends UserDoc { id: string }

const SECONDARY = 'worker-creator'

function getSecondaryAuth() {
  const existing = getApps().find(a => a.name === SECONDARY)
  const app = existing ?? initializeApp(firebaseConfig, SECONDARY)
  const secondaryAuth = getAuth(app)
  // Connect to emulator if primary is using it
  if (import.meta.env.VITE_USE_EMULATOR === 'true') {
    try { connectAuthEmulator(secondaryAuth, 'http://localhost:9099') } catch { /* already connected */ }
  }
  return secondaryAuth
}

export default function WorkerManager() {
  const { user } = useAuth()
  const { toasts, showToast } = useToast()
  const [workers, setWorkers] = useState<WorkerRow[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const loadWorkers = async () => {
    const q = query(collection(db, 'users'), where('role', '==', 'worker'))
    const snap = await getDocs(q)
    setWorkers(snap.docs.map(d => ({ id: d.id, ...(d.data() as UserDoc) })))
  }

  useEffect(() => { loadWorkers() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    try {
      const secondaryAuth = getSecondaryAuth()
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password)
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: email.trim(),
        name: name.trim(),
        role: 'worker',
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      })
      await fbSignOut(secondaryAuth)
      // Clean up secondary app to avoid emulator double-connect issues on re-creation
      try { await deleteApp(secondaryAuth.app) } catch { /* ignore */ }
      showToast(`Worker "${name.trim()}" created successfully`)
      setName('')
      setEmail('')
      setPassword('')
      await loadWorkers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create worker'
      showToast(msg, 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4">
      <ToastContainer toasts={toasts} />
      <div className="card mb-3">
        <div className="card-header">
          <h5 className="mb-0">Workers</h5>
        </div>
        <div className="card-body">
          <form onSubmit={handleCreate}>
            <div className="row g-2 mb-2">
              <div className="col-md-3">
                <input
                  className="form-control"
                  placeholder="Name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
              <div className="col-md-3">
                <input
                  className="form-control"
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="col-md-3">
                <input
                  className="form-control"
                  type="password"
                  placeholder="Temporary Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div className="col-md-3">
                <button className="btn btn-primary w-100" type="submit" disabled={saving}>
                  {saving ? 'Creating…' : '+ Add Worker'}
                </button>
              </div>
            </div>
            <small className="text-muted">Workers can only see and act on orders (IN_PRODUCTION / READY transitions). They cannot access financial data.</small>
          </form>
        </div>
      </div>

      {workers.length > 0 && (
        <div className="card">
          <div className="card-header"><h6 className="mb-0">Existing Workers</h6></div>
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {workers.map(w => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td>{w.email}</td>
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
