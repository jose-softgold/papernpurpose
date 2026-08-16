import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const ownerItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/suppliers', label: 'Suppliers', icon: '🏪' },
  { to: '/products', label: 'Products', icon: '🎀' },
  { to: '/materials', label: 'Materials', icon: '📦' },
  { to: '/purchases', label: 'Purchases', icon: '🛒' },
  { to: '/production', label: 'Production', icon: '🏭' },
  { to: '/inventory', label: 'Inventory', icon: '🗄️' },
  { to: '/orders', label: 'Orders', icon: '📋' },
  { to: '/history', label: 'History', icon: '📜' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

const workerItems = [
  { to: '/orders',     label: 'Orders',     icon: '📋' },
  { to: '/production', label: 'Production', icon: '🏭' },
  { to: '/purchases',  label: 'Purchases',  icon: '🛒' },
  { to: '/materials',  label: 'Materials',  icon: '📦' },
  { to: '/suppliers',  label: 'Suppliers',  icon: '🏪' },
]

export default function Sidebar() {
  const { signOut, role, userDoc } = useAuth()
  const items = role === 'worker' ? workerItems : ownerItems

  return (
    <div className="d-flex flex-column bg-dark text-white" style={{ width: '220px', minHeight: '100vh' }}>
      <div className="p-3 border-bottom border-secondary">
        <h6 className="mb-0 fw-bold">🎉 Party Craft</h6>
        {role === 'worker' && (
          <small className="text-warning">Worker</small>
        )}
      </div>
      <nav className="flex-grow-1 py-2">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `d-block px-3 py-2 text-decoration-none small ${isActive ? 'bg-primary text-white' : 'text-light'}`
            }
          >
            <span className="me-2">{item.icon}</span>{item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-top border-secondary">
        {userDoc?.name && <div className="text-muted small mb-2">{userDoc.name}</div>}
        <button className="btn btn-sm btn-outline-light w-100" onClick={signOut}>Sign Out</button>
      </div>
    </div>
  )
}
