import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS, isWorker, isViewer } from '../utils/roles'

const ownerItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/suppliers', label: 'Suppliers', icon: '🏪' },
  { to: '/products', label: 'Products', icon: '🎀' },
  { to: '/materials', label: 'Materials', icon: '📦' },
  { to: '/purchases', label: 'Purchases', icon: '🛒' },
  { to: '/production', label: 'Production', icon: '🏭' },
  { to: '/inventory', label: 'Inventory', icon: '🗄️' },
  { to: '/orders', label: 'Orders', icon: '📋' },
  { to: '/import', label: 'Import', icon: '📥' },
  { to: '/history', label: 'History', icon: '📜' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

const workerItems = [
  { to: '/orders', label: 'My orders', icon: '📋' },
  { to: '/production', label: 'My production', icon: '🏭' },
  { to: '/purchases', label: 'Purchases', icon: '🛒' },
  { to: '/materials', label: 'Materials', icon: '📦' },
  { to: '/suppliers', label: 'Suppliers', icon: '🏪' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

const viewerItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/suppliers', label: 'Suppliers', icon: '🏪' },
  { to: '/products', label: 'Products', icon: '🎀' },
  { to: '/materials', label: 'Materials', icon: '📦' },
  { to: '/inventory', label: 'Inventory', icon: '🗄️' },
  { to: '/orders', label: 'Orders', icon: '📋' },
  { to: '/history', label: 'History', icon: '📜' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut, role, userDoc } = useAuth()
  const items = isWorker(role) ? workerItems : isViewer(role) ? viewerItems : ownerItems

  return (
    <div className="pc-sidebar d-flex flex-column h-100">
      <div className="pc-sidebar-head">
        <div>
          <div className="fw-bold pc-display">Paper&Purpose</div>
          <div className="small" style={{ color: 'rgba(236,234,246,.55)', fontSize: '.72rem' }}>
            Workspace
          </div>
        </div>
      </div>

      <nav className="flex-grow-1 py-2 overflow-auto pc-scroll-slim">
        <NavLink to="/" end onClick={onNavigate} className="pc-nav-link">
          <span className="pc-nav-icon" aria-hidden="true">
            🤖
          </span>
          Ask the AI
        </NavLink>
        <div
          className="text-uppercase fw-bold px-3 pt-3 pb-1"
          style={{ fontSize: '.66rem', letterSpacing: '.08em', color: 'rgba(236,234,246,.4)' }}
        >
          Manage
        </div>
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) => `pc-nav-link${isActive ? ' active' : ''}`}
          >
            <span className="pc-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="pc-sidebar-foot">
        {userDoc?.name && (
          <div className="small fw-semibold text-truncate" style={{ color: '#fff' }}>
            {userDoc.name}
          </div>
        )}
        {role && (
          <div className="small mb-2" style={{ color: 'rgba(236,234,246,.55)', fontSize: '.74rem' }}>
            {ROLE_LABELS[role]}
          </div>
        )}
        <button className="btn btn-sm btn-outline-light w-100" onClick={signOut}>
          Sign Out
        </button>
      </div>
    </div>
  )
}
