import { useState, FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { defaultHomePath } from '../utils/roles'

const HIGHLIGHTS = [
  { icon: '🤖', text: 'Tell the assistant what happened and it logs the paperwork for you' },
  { icon: '📦', text: 'Materials, production and orders stay in sync automatically' },
  { icon: '🧾', text: 'Snap a bill photo and let the assistant read the details' },
]

export default function Login() {
  const { signIn, user, role, loading, authError } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user && role) return <Navigate to={defaultHomePath(role)} replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : ''
      if (code === 'auth/operation-not-allowed') {
        setError('Email/Password sign-in is not enabled in Firebase Authentication.')
      } else if (code === 'auth/unauthorized-domain') {
        setError('This site is not an authorized domain in Firebase Authentication.')
      } else if (code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Wait a minute, then try again.')
      } else if (code === 'auth/user-disabled') {
        setError('This account is disabled.')
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        setError('Invalid email or password')
      } else {
        setError(code ? `Sign-in failed (${code})` : 'Invalid email or password')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const displayError = error || authError

  return (
    <div className="pc-login">
      <div className="pc-login-card">
        <div className="row g-0">
          <div className="col-lg-6 d-none d-lg-block">
            <div className="pc-login-aside h-100">
              <div className="pc-display fw-bold fs-4">Paper&Purpose</div>
              <p className="mt-4 mb-0 fs-5 fw-semibold">
                Run your craft studio by simply describing what happened.
              </p>
              <ul>
                {HIGHLIGHTS.map(h => (
                  <li key={h.text}>
                    <span aria-hidden="true">{h.icon}</span>
                    <span>{h.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="col-lg-6">
            <div className="p-4 p-lg-5">
              <div className="d-lg-none pc-display fw-bold fs-5 mb-3">Paper&Purpose</div>

              <h4 className="mb-1">Welcome back</h4>
              <p className="text-muted small mb-4">Sign in to open your studio assistant.</p>

              {displayError && <div className="alert alert-danger py-2">{displayError}</div>}

              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-control"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="mb-4">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Sign In'}
                </button>
              </form>

              <p className="text-muted mt-4 mb-0" style={{ fontSize: '.78rem' }}>
                Need access? Ask an owner or admin to add you under Settings → Users.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
