import { useAuth } from '../../hooks/useAuth'
import WorkerManager from './WorkerManager'

export default function SettingsPage() {
  const { user, signOut, role } = useAuth()

  return (
    <div className="container-fluid py-4">
      <h4 className="mb-4">Settings</h4>
      <div className="card" style={{ maxWidth: 400 }}>
        <div className="card-body">
          <h5 className="card-title">Account</h5>
          <p className="mb-1 text-muted">Signed in as:</p>
          <p className="fw-semibold mb-4">{user?.email}</p>
          <button className="btn btn-danger" onClick={signOut}>Sign Out</button>
        </div>
      </div>
      {role === 'owner' && <WorkerManager />}
    </div>
  )
}
