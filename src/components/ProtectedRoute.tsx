import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from './LoadingSpinner'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!user || !role) return <Navigate to="/login" replace />
  return <>{children}</>
}
