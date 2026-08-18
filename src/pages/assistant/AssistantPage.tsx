import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { callChatAssistant } from '../../firebase/functions'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_LABELS, workspaceHomePath } from '../../utils/roles'
import { ChatMarkdown } from '../../components/ChatMarkdown'

interface Attachment {
  url: string
  contentType: string
  name: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  isError?: boolean
}

const SUGGESTIONS = [
  { kicker: 'Log a purchase', text: 'Bought 10 kg crepe from Ravi for 2500' },
  { kicker: 'Check stock', text: 'Stock of pink paper' },
  { kicker: 'Browse orders', text: 'List recent orders' },
  { kicker: 'Log production', text: 'Made 20 units of party hats today' },
]

const GREETING: Msg = {
  role: 'assistant',
  content:
    'Hi! Tell me what happened in plain language and I will log it — purchases, production runs, orders and status updates all work. You can attach a bill photo and I will read the details off it. I always show you what I am about to save and wait for your confirmation.',
}

const MAX_FILES = 3
const MAX_BYTES = 5 * 1024 * 1024

export default function AssistantPage() {
  const { role, user, userDoc } = useAuth()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const resizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  useEffect(resizeInput, [input])

  const addFiles = (picked: FileList | null) => {
    if (!picked?.length) return
    setError('')
    const next: File[] = []
    for (const f of Array.from(picked)) {
      if (f.size > MAX_BYTES) {
        setError(`${f.name} is larger than 5 MB`)
        continue
      }
      next.push(f)
    }
    setFiles(prev => [...prev, ...next].slice(0, MAX_FILES))
    if (fileRef.current) fileRef.current.value = ''
  }

  const uploadFiles = async (): Promise<Attachment[]> => {
    if (!files.length || !user) return []
    setUploading(true)
    try {
      const out: Attachment[] = []
      for (const f of files) {
        const path = `chatUploads/${user.uid}/${Date.now()}-${f.name}`
        const storageRef = ref(storage, path)
        await uploadBytes(storageRef, f)
        out.push({
          url: await getDownloadURL(storageRef),
          contentType: f.type || 'application/octet-stream',
          name: f.name,
        })
      }
      return out
    } finally {
      setUploading(false)
    }
  }

  const send = async (text: string, opts?: { confirm?: boolean; cancel?: boolean }) => {
    const trimmed = text.trim()
    const hasFiles = files.length > 0
    if ((!trimmed && !hasFiles && !opts?.confirm && !opts?.cancel) || busy) return

    setBusy(true)
    setError('')
    let attachments: Attachment[] = []

    try {
      if (hasFiles && !opts?.confirm && !opts?.cancel) {
        attachments = await uploadFiles()
      }

      if (trimmed || attachments.length) {
        setMessages(m => [
          ...m,
          { role: 'user', content: trimmed || '(attachment)', attachments },
        ])
        setInput('')
        setFiles([])
      }

      const res = await callChatAssistant({
        message: trimmed || (opts?.confirm ? 'yes' : opts?.cancel ? 'no' : ''),
        sessionId,
        confirm: opts?.confirm,
        cancel: opts?.cancel,
        attachments,
      })
      setSessionId(res.sessionId)
      setPending(Boolean(res.needsConfirmation && res.pendingTool))
      setMessages(m => [...m, { role: 'assistant', content: res.reply }])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Chat failed'
      setMessages(m => [...m, { role: 'assistant', content: msg, isError: true }])
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const startNewChat = () => {
    setSessionId(undefined)
    setPending(false)
    setMessages([GREETING])
    setInput('')
    setFiles([])
    setError('')
  }

  const isFresh = messages.length === 1
  const userInitial = (userDoc?.name || user?.email || '?').charAt(0).toUpperCase()

  return (
    <div className="d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
      <div className="d-flex align-items-center justify-content-between gap-2 px-3 px-lg-4 py-2 border-bottom bg-white">
        <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
          <span className="pc-avatar" aria-hidden="true">
            🤖
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="fw-bold pc-display">Studio Assistant</div>
            <div className="small text-muted text-truncate">
              {role ? ROLE_LABELS[role] : 'User'} — actions follow your permissions
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary d-none d-md-inline-flex"
            onClick={() => navigate(workspaceHomePath(role))}
          >
            Open workspace
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={startNewChat}>
            New chat
          </button>
        </div>
      </div>

      <div className="pc-chat-scroll pc-scroll-slim">
        <div className="pc-chat-col">
          {messages.map((m, i) => (
            <div key={i} className={`pc-turn${m.role === 'user' ? ' is-user' : ''}`}>
              <span
                className={`pc-avatar${m.role === 'user' ? ' is-user' : ''}`}
                aria-hidden="true"
              >
                {m.role === 'user' ? userInitial : '🤖'}
              </span>
              <div
                className={`pc-bubble ${m.role === 'user' ? 'is-user' : 'is-assistant'}${
                  m.isError ? ' is-error' : ''
                }`}
              >
                {m.role === 'assistant' && !m.isError ? (
                  <ChatMarkdown text={m.content} hideMoney={role === 'worker'} />
                ) : (
                  m.content
                )}
                {m.attachments?.length ? (
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    {m.attachments.map(a =>
                      a.contentType.startsWith('image/') ? (
                        <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                          <img src={a.url} alt={a.name} className="pc-chat-thumb" />
                        </a>
                      ) : (
                        <a
                          key={a.url}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="badge text-bg-light text-decoration-none"
                        >
                          📎 {a.name}
                        </a>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {busy && (
            <div className="pc-turn">
              <span className="pc-avatar" aria-hidden="true">
                🤖
              </span>
              <div className="pc-bubble is-assistant">
                <span className="pc-typing" role="status" aria-label="Assistant is thinking">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          )}

          {isFresh && !busy && (
            <div className="row g-2 mt-1">
              {SUGGESTIONS.map(s => (
                <div className="col-12 col-sm-6" key={s.text}>
                  <button
                    type="button"
                    className="pc-suggest"
                    disabled={busy}
                    onClick={() => void send(s.text)}
                  >
                    <span className="pc-suggest-kicker">{s.kicker}</span>
                    {s.text}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="pc-composer-wrap">
        <div className="pc-chat-col">
          {pending && (
            <div className="pc-confirm-bar mb-2">
              <span className="small fw-semibold">
                <span aria-hidden="true">⚠️</span> Review the details above, then save.
              </span>
              <div className="d-flex gap-2 ms-auto">
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={busy}
                  onClick={() => void send('', { confirm: true })}
                >
                  Confirm and save
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={busy}
                  onClick={() => void send('', { cancel: true })}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && <div className="text-danger small mb-2">{error}</div>}

          {files.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-2">
              {files.map((f, idx) => (
                <span key={`${f.name}-${idx}`} className="badge text-bg-light border">
                  📎 {f.name}
                  <button
                    type="button"
                    className="btn btn-sm btn-link p-0 ms-2 text-decoration-none"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <form
            onSubmit={e => {
              e.preventDefault()
              void send(input)
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="d-none"
              onChange={e => addFiles(e.target.files)}
            />
            <div className="pc-composer">
              <button
                type="button"
                className="pc-attach-btn"
                onClick={() => fileRef.current?.click()}
                disabled={busy || files.length >= MAX_FILES}
                title="Attach a bill photo"
                aria-label="Attach a bill photo"
              >
                📎
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                placeholder="e.g. Bought 20 sheets pink paper at 4 each"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(input)
                  }
                }}
                disabled={busy}
              />
              <button
                className="pc-send-btn"
                type="submit"
                disabled={busy || (!input.trim() && files.length === 0)}
                aria-label="Send"
                title="Send"
              >
                {uploading || busy ? '…' : '➤'}
              </button>
            </div>
          </form>
          <div className="text-muted mt-2" style={{ fontSize: '.74rem' }}>
            Enter sends · Shift+Enter for a new line · nothing is saved until you confirm
          </div>
        </div>
      </div>
    </div>
  )
}
