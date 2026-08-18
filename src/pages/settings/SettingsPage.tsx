import { useAuth } from '../../hooks/useAuth'
import UserManager from './UserManager'
import PageHeader from '../../components/PageHeader'
import { canManageUsers, ROLE_LABELS } from '../../utils/roles'

export default function SettingsPage() {
  const { user, userDoc, signOut, role } = useAuth()

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your account and team access" icon="⚙️" />

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-body">
          <div className="d-flex align-items-center gap-3">
            <span className="pc-avatar is-user" style={{ width: 44, height: 44, fontSize: '1rem' }}>
              {(userDoc?.name || user?.email || '?').charAt(0).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="fw-semibold">{userDoc?.name || 'Account'}</div>
              <div className="small text-muted text-truncate">{user?.email}</div>
              {role && <span className="pc-role-pill mt-1">{ROLE_LABELS[role]}</span>}
            </div>
          </div>
          <hr />
          <button className="btn btn-outline-secondary btn-sm" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </div>

      {canManageUsers(role) && <UserManager />}
    </div>
  )
}
