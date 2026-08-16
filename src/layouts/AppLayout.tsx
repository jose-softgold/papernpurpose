import Sidebar from './Sidebar'
import { Outlet } from 'react-router-dom'

export default function AppLayout() {
  return (
    <div className="d-flex">
      <Sidebar />
      <main className="flex-grow-1 p-4 bg-light" style={{ minHeight: '100vh', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
