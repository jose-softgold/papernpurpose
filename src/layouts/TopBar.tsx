import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS, workspaceHomePath } from '../utils/roles'

interface Props {
  isAiMode: boolean
  onOpenMenu: () => void
}

export default function TopBar({ isAiMode, onOpenMenu }: Props) {
  const { role, userDoc, user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const goWorkspace = () => {
    if (isAiMode) navigate(workspaceHomePath(role))
  }

  const goAi = () => {
    if (!isAiMode) navigate('/', { state: { from: location.pathname } })
  }

  const displayName = userDoc?.name || user?.email || ''
  const initial = (userDoc?.name || user?.email || '?').charAt(0).toUpperCase()

  return (
    <header className="pc-topbar d-flex align-items-center">
      {!isAiMode && (
        <button
          type="button"
          className="pc-icon-btn d-lg-none"
          onClick={onOpenMenu}
          aria-label="Open menu"
        >
          ☰
        </button>
      )}

      <button
        type="button"
        className="pc-brand btn btn-link p-0 text-decoration-none d-none d-sm-inline"
        onClick={goAi}
      >
        Paper&Purpose
      </button>

      <div
        className={`pc-mode-toggle mx-auto${isAiMode ? ' pc-mode-toggle-ai' : ''}`}
        role="group"
        aria-label="Switch between AI and workspace"
      >
        <button type="button" aria-pressed={isAiMode} onClick={goAi}>
          <span aria-hidden="true">🤖</span> AI
        </button>
        <button type="button" aria-pressed={!isAiMode} onClick={goWorkspace}>
          <span aria-hidden="true">🗂️</span> Workspace
        </button>
      </div>

      <div className="d-flex align-items-center gap-2 ms-auto">
        <div className="text-end d-none d-md-block" style={{ lineHeight: 1.15 }}>
          <div className="small fw-semibold text-truncate" style={{ maxWidth: 170 }}>
            {displayName}
          </div>
          {role && <span className="pc-role-pill">{ROLE_LABELS[role]}</span>}
        </div>
        <span className="pc-avatar is-user d-md-none" aria-hidden="true">
          {initial}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={signOut}
          title="Sign out"
        >
          <span className="d-none d-sm-inline">Sign out</span>
          <span className="d-sm-none" aria-hidden="true">
            ⏻
          </span>
        </button>
      </div>
    </header>
  )
}
