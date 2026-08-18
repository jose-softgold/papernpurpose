import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from './LoadingSpinner'
import { UserRole } from '../types'
import { canWriteMaster, defaultHomePath, isViewer, isWorker } from '../utils/roles'

/** Owner + admin pages (master data, finance, settings) */
export default function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!canWriteMaster(role)) {
    return <Navigate to={defaultHomePath(role)} replace />
  }
  return <>{children}</>
}

/** Pages workers can use for ops; viewers redirected away from write-focused home */
export function OpsRoute({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (isViewer(role)) return <Navigate to="/" replace />
  if (!role) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Read-only pages: owner, admin, viewer (and worker where allowed separately) */
export function ReadRoute({
  children,
  allowWorker = false,
}: {
  children: React.ReactNode
  allowWorker?: boolean
}) {
  const { role, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (canWriteMaster(role) || isViewer(role) || (allowWorker && isWorker(role))) {
    return <>{children}</>
  }
  return <Navigate to={defaultHomePath(role)} replace />
}

export function RequireRoles({
  roles,
  children,
}: {
  roles: UserRole[]
  children: React.ReactNode
}) {
  const { role, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!role || !roles.includes(role)) {
    return <Navigate to={defaultHomePath(role)} replace />
  }
  return <>{children}</>
}

/** Any signed-in role can view their account; UserManager is gated inside the page */
export function SettingsRoute({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!role) return <Navigate to="/login" replace />
  return <>{children}</>
}
