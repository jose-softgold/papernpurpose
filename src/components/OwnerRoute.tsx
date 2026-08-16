import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from './LoadingSpinner'

export default function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (role === 'worker') return <Navigate to="/orders" replace />
  return <>{children}</>
}
