import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const isAiMode = location.pathname === '/'

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <div className="pc-shell d-flex">
      {!isAiMode && (
        <div className="d-none d-lg-block h-100">
          <Sidebar />
        </div>
      )}

      {drawerOpen && !isAiMode && (
        <>
          <div
            className="d-lg-none"
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,44,.55)', zIndex: 1040 }}
          />
          <div
            className="d-lg-none shadow"
            style={{ position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 1045 }}
          >
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </>
      )}

      <div className="flex-grow-1 d-flex flex-column" style={{ minWidth: 0 }}>
        <TopBar isAiMode={isAiMode} onOpenMenu={() => setDrawerOpen(true)} />

        <main
          className={`flex-grow-1 d-flex flex-column pc-main pc-scroll-slim ${
            isAiMode ? 'p-0' : 'p-3 p-lg-4'
          }`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
