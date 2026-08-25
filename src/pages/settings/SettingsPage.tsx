import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import UserManager from './UserManager'
import OccasionsManager from './OccasionsManager'
import PageHeader from '../../components/PageHeader'
import ToastContainer from '../../components/ToastContainer'
import { canManageUsers, isOwner, isAdminOrOwner, ROLE_LABELS } from '../../utils/roles'
import { GmailConnectionStatus } from '../../types'
import {
  callGmailBackfill,
  callGmailDisconnect,
  callGmailOAuthStart,
  callGmailStatus,
  callGmailUpdateSettings,
} from '../../firebase/functions'
import { useToast } from '../../hooks/useToast'

function GmailBankInboxCard({
  showToast,
}: {
  showToast: (message: string, type?: 'success' | 'danger' | 'warning') => void
}) {
  const { role } = useAuth()
  const [status, setStatus] = useState<GmailConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [allowlistText, setAllowlistText] = useState('')
  const [syncDays, setSyncDays] = useState(7)

  const refresh = useCallback(async () => {
    try {
      const s = await callGmailStatus()
      setStatus(s)
      setAllowlistText((s.senderAllowlist ?? []).join('\n'))
    } catch (err) {
      console.error(err)
      showToast('Could not load Gmail status', 'danger')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.data?.type === 'gmail-oauth') {
        void refresh()
        if (ev.data.ok) showToast('Bank inbox connected', 'success')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [refresh, showToast])

  if (!isAdminOrOwner(role) && role !== 'viewer') return null

  async function connect() {
    if (!isOwner(role)) {
      showToast('Only the owner can connect the bank inbox', 'warning')
      return
    }
    setBusy(true)
    try {
      const { url } = await callGmailOAuthStart()
      window.open(url, 'gmail-oauth', 'width=520,height=720')
      showToast('Pick the Gmail that receives bank emails (not your app login)', 'warning')
    } catch (err) {
      console.error(err)
      showToast('Connect failed — check OAuth secrets on Cloud Functions', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!isOwner(role)) return
    if (!confirm('Disconnect the bank Gmail inbox?')) return
    setBusy(true)
    try {
      await callGmailDisconnect()
      showToast('Bank inbox disconnected', 'success')
      await refresh()
    } catch (err) {
      console.error(err)
      showToast('Disconnect failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function saveAllowlist() {
    if (!isAdminOrOwner(role)) return
    setBusy(true)
    try {
      const list = allowlistText
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean)
      const s = await callGmailUpdateSettings({ senderAllowlist: list })
      setStatus(s)
      showToast('Sender allowlist saved', 'success')
    } catch (err) {
      console.error(err)
      showToast('Save failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function syncMail() {
    if (!isAdminOrOwner(role)) return
    setBusy(true)
    try {
      const days = Math.min(90, Math.max(1, Math.round(Number(syncDays) || 7)))
      const result = await callGmailBackfill(days)
      showToast(
        `Last ${days}d: ${result.written} new, ${result.skippedDuplicates} duplicates, ${result.processed} emails`,
        'success',
      )
      await refresh()
    } catch (err) {
      console.error(err)
      showToast('Sync failed', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mt-3" style={{ maxWidth: 560 }}>
      <div className="card-body">
        <h2 className="h6 mb-1">Bank inbox (Gmail)</h2>
        <p className="small text-muted mb-3">
          Connect the <strong>dedicated Gmail</strong> that receives bank alerts and statements — not
          your Paper&amp;Purpose login. Read-only access only. After sync, mark rows as Personal
          (          with a category) or Business (match to orders/purchases) on the{' '}
          <Link to="/bank">Bank</Link> page — not in Gmail.
        </p>

        {loading ? (
          <div className="text-muted small">Loading…</div>
        ) : status?.connected ? (
          <>
            <div className="mb-2">
              <span className="badge text-bg-success me-2">Connected</span>
              <span className="fw-semibold">Reading `{status.email}`</span>
            </div>
            {status.lastSyncAt && (
              <div className="small text-muted mb-2">
                Last sync: {new Date(status.lastSyncAt).toLocaleString()}
              </div>
            )}
            {status.lastError && (
              <div className="alert alert-warning py-2 small mb-2">{status.lastError}</div>
            )}

            {isAdminOrOwner(role) && (
              <>
                <label className="form-label small mb-1">Sender allowlist (domains or emails)</label>
                <textarea
                  className="form-control form-control-sm mb-2"
                  rows={5}
                  value={allowlistText}
                  onChange={e => setAllowlistText(e.target.value)}
                  disabled={busy}
                />
                <div className="d-flex flex-wrap align-items-end gap-2 mb-2">
                  <div>
                    <label className="form-label small mb-0">Sync days (1–90)</label>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      style={{ width: 100 }}
                      min={1}
                      max={90}
                      value={syncDays}
                      disabled={busy}
                      onChange={e => setSyncDays(Number(e.target.value))}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    disabled={busy}
                    onClick={() => void syncMail()}
                  >
                    Sync mail
                  </button>
                  {isOwner(role) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      disabled={busy}
                      onClick={() => void disconnect()}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={() => void saveAllowlist()}
                  >
                    Save allowlist
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="small mb-2">No bank inbox connected yet.</p>
            {isOwner(role) ? (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => void connect()}
              >
                Connect bank inbox
              </button>
            ) : (
              <p className="small text-muted mb-0">Ask the owner to connect Gmail in Settings.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { user, userDoc, signOut, role } = useAuth()
  const { toasts, showToast } = useToast()

  return (
    <div>
      <ToastContainer toasts={toasts} />
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

      <GmailBankInboxCard showToast={showToast} />

      {isAdminOrOwner(role) && <OccasionsManager />}

      {canManageUsers(role) && <UserManager />}
    </div>
  )
}
