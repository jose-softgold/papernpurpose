import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { randomBytes } from 'crypto'
import { resolveActor, syncCustomClaims } from './actor'
import { AuthzError, UserRole, isAdminOrOwner } from './authz'
import { runTool, ToolName, catalogForTool, getCatalogNames } from './domain/tools'
import { ChatMessage, InlineAttachment, PendingToolCall, runLlmFollowUp, runLlmTurn } from './llm/gemini'
import { buildAuthUrl, exchangeCode, getAuthedGmail, toPublicStatus } from './gmail/client'
import {
  DEFAULT_SENDER_ALLOWLIST,
  gmailDocRef,
  GmailIntegrationDoc,
  requireOAuthConfig,
} from './gmail/config'
import { backfillMessages, syncFromHistory } from './gmail/ingest'

interface ChatAttachment {
  url: string
  contentType: string
  name: string
}

const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

async function downloadAttachments(attachments: ChatAttachment[]): Promise<InlineAttachment[]> {
  const out: InlineAttachment[] = []
  for (const att of attachments.slice(0, MAX_ATTACHMENTS)) {
    try {
      const res = await fetch(att.url)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_ATTACHMENT_BYTES) continue
      out.push({ base64: buf.toString('base64'), contentType: att.contentType })
    } catch (err) {
      console.warn('Attachment fetch failed', err)
    }
  }
  return out
}

initializeApp()
setGlobalOptions({ region: 'asia-south1' })

function requireAuth(uid: string | undefined): string {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required')
  return uid
}

function mapError(err: unknown): never {
  if (err instanceof AuthzError) {
    throw new HttpsError('permission-denied', err.message)
  }
  if (err instanceof HttpsError) throw err
  console.error(err)
  throw new HttpsError('internal', err instanceof Error ? err.message : 'Internal error')
}

function formatInr(amount: unknown): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '₹0'
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pcTableReply(lead: string, columns: string[], rows: Array<Array<string | undefined>>): string {
  const keepIdx = columns.map((_, i) => i).filter(i => rows.some(r => String(r[i] ?? '').trim()))
  const cols = keepIdx.map(i => columns[i])
  const body = rows.map(r => keepIdx.map(i => String(r[i] ?? '')))
  return `${lead}\n\n\`\`\`pc-table\n${JSON.stringify({ columns: cols, rows: body })}\n\`\`\``
}

const PRESENT_TOOLS = new Set<ToolName>([
  'list_orders',
  'list_inventory',
  'find_customer',
  'find_material',
  'find_supplier',
  'find_product',
  'find_worker',
])

function looksLikeDataDump(text: string): boolean {
  if (/```pc-table/.test(text)) return true
  const numbered = text.match(/^\s*\d+\.\s/gm)?.length ?? 0
  if (numbered >= 2) return true
  if (/\bID:\s*['`]/i.test(text)) return true
  if ((text.match(/\|/g)?.length ?? 0) >= 4) return true
  return false
}

function formatReadToolReply(
  toolName: ToolName,
  args: Record<string, unknown>,
  result: unknown,
): string {
  const isEmpty = Array.isArray(result) && result.length === 0
  const emptyWithCatalog =
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    Array.isArray((result as { matches?: unknown[] }).matches) &&
    (result as { matches: unknown[] }).matches.length === 0

  if (isEmpty || emptyWithCatalog) {
    const query = args.query ?? args.status
    const hint = query ? ` for “${query}”` : ''
    const catalog = emptyWithCatalog
      ? (result as { availableInCatalog?: string[] }).availableInCatalog
      : undefined
    if (catalog?.length) {
      return (
        `I couldn’t find anything${hint}. ` +
        `Available in the catalog:\n${catalog.map(n => `• ${n}`).join('\n')}\n\n` +
        'Try one of these names, or add the item in the CRM first.'
      )
    }
    return (
      `I didn’t find anything${hint}. ` +
      'Try a shorter or different name. If the database is empty, run `npm run seed` with emulators running.'
    )
  }

  if (emptyWithCatalog === false && result && typeof result === 'object' && !Array.isArray(result) && 'matches' in result) {
    result = (result as { matches: unknown[] }).matches
  }

  if (!Array.isArray(result)) {
    return `Done.\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
  }

  switch (toolName) {
    case 'list_orders': {
      const rows = result as Array<{
        id: string
        customerName?: string
        status?: string
        total?: number
        eventType?: string
        notes?: string
      }>
      return pcTableReply(
        `Found ${rows.length} recent order${rows.length === 1 ? '' : 's'}.`,
        ['Customer', 'Event', 'Status', 'Total'],
        rows.map(r => [
          r.customerName || '—',
          r.eventType || '',
          r.status ?? '',
          r.total != null ? formatInr(r.total) : '',
        ]),
      )
    }

    case 'find_customer': {
      const rows = result as Array<{ name?: string; phone?: string; city?: string; status?: string }>
      return pcTableReply(
        `Found ${rows.length} customer${rows.length === 1 ? '' : 's'}.`,
        ['Name', 'Phone', 'City', 'Status'],
        rows.map(r => [r.name ?? 'Unnamed', r.phone ?? '', r.city ?? '', r.status ?? '']),
      )
    }

    case 'find_material': {
      const rows = result as Array<{ name?: string; unit?: string; costPerUnit?: number }>
      return pcTableReply(
        `Found ${rows.length} material${rows.length === 1 ? '' : 's'}.`,
        ['Name', 'Unit', 'Cost'],
        rows.map(r => [
          r.name ?? 'Unnamed',
          r.unit ?? '',
          r.costPerUnit != null ? `${formatInr(r.costPerUnit)} / ${r.unit ?? 'unit'}` : '',
        ]),
      )
    }

    case 'find_supplier': {
      const rows = result as Array<{ name?: string; phone?: string; gstin?: string }>
      return pcTableReply(
        `Found ${rows.length} supplier${rows.length === 1 ? '' : 's'}.`,
        ['Name', 'Phone', 'GSTIN'],
        rows.map(r => [r.name ?? 'Unnamed', r.phone ?? '', r.gstin ?? '']),
      )
    }

    case 'find_worker': {
      const rows = result as Array<{ name?: string; email?: string }>
      return pcTableReply(
        `Found ${rows.length} worker${rows.length === 1 ? '' : 's'}.`,
        ['Name', 'Email'],
        rows.map(r => [r.name ?? 'Unnamed', r.email ?? '']),
      )
    }

    case 'find_product': {
      const rows = result as Array<{
        name?: string
        defaultSellingPrice?: number
        versions?: Array<{ id: string; version: string }>
      }>
      return pcTableReply(
        `Found ${rows.length} product${rows.length === 1 ? '' : 's'}.`,
        ['Name', 'Price', 'Versions'],
        rows.map(r => [
          r.name ?? 'Unnamed',
          r.defaultSellingPrice != null ? formatInr(r.defaultSellingPrice) : '',
          (r.versions ?? []).map(v => v.version).join(', '),
        ]),
      )
    }

    case 'list_inventory': {
      const rows = result as Array<{ name?: string; itemType?: string; quantity?: number }>
      return pcTableReply(
        'Current stock.',
        ['Name', 'Type', 'Qty'],
        rows.map(r => [r.name ?? 'Unknown', r.itemType ?? '', String(r.quantity ?? 0)]),
      )
    }

    default:
      return `Here’s what I found:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
  }
}

/** Sync Firebase Auth custom claims from Firestore user doc */
export const syncUserClaims = onCall(async request => {
  try {
    const callerUid = requireAuth(request.auth?.uid)
    const caller = await resolveActor(callerUid)
    if (caller.role !== 'owner' && caller.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admins can sync claims')
    }
    const targetUid = String(request.data?.uid ?? '')
    if (!targetUid) throw new HttpsError('invalid-argument', 'uid required')
    const snap = await getFirestore().collection('users').doc(targetUid).get()
    if (!snap.exists) throw new HttpsError('not-found', 'User not found')
    const data = snap.data()!
    await syncCustomClaims(targetUid, data.role as UserRole, data.active !== false)
    return { ok: true, role: data.role }
  } catch (err) {
    mapError(err)
  }
})

/** Execute a domain tool (after user confirmation for writes) */
export const runDomainTool = onCall(async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    const name = String(request.data?.name ?? '') as ToolName
    const args = (request.data?.args ?? {}) as Record<string, unknown>
    if (!name) throw new HttpsError('invalid-argument', 'name required')
    const result = await runTool(actor, name, args)
    return { ok: true, result }
  } catch (err) {
    mapError(err)
  }
})

interface ChatRequest {
  message: string
  sessionId?: string
  confirm?: boolean
  cancel?: boolean
  attachments?: ChatAttachment[]
}

/**
 * Web CRM chatbot turn.
 * - Sends message to Gemini with tools
 * - Write tools return a pending confirmation (no commit until confirm=true)
 * - Read tools execute immediately
 */
export const chatAssistant = onCall({ timeoutSeconds: 120 }, async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    const data = request.data as ChatRequest
    const message = String(data.message ?? '').trim()
    const db = getFirestore()

    let sessionId = data.sessionId ? String(data.sessionId) : ''
    const sessions = db.collection('chatSessions')

    if (!sessionId) {
      const ref = await sessions.add({
        userId: uid,
        messages: [],
        pendingTool: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      sessionId = ref.id
    }

    const sessionRef = sessions.doc(sessionId)
    const sessionSnap = await sessionRef.get()
    if (!sessionSnap.exists || sessionSnap.data()?.userId !== uid) {
      throw new HttpsError('not-found', 'Chat session not found')
    }

    const session = sessionSnap.data()!
    const messages = (session.messages ?? []) as ChatMessage[]
    let pendingTool = (session.pendingTool ?? null) as PendingToolCall | null

    // Confirmation flow
    if (pendingTool && (data.confirm || data.cancel || /^(yes|y|confirm|ok)$/i.test(message))) {
      if (data.cancel || /^(no|n|cancel)$/i.test(message)) {
        pendingTool = null
        const reply = 'Cancelled. Nothing was saved.'
        messages.push({ role: 'user', content: message || 'no' })
        messages.push({ role: 'assistant', content: reply })
        await sessionRef.update({
          messages,
          pendingTool: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { sessionId, reply, pendingTool: null }
      }

      if (data.confirm || /^(yes|y|confirm|ok)$/i.test(message)) {
        const result = await runTool(actor, pendingTool.name, pendingTool.args)
        const reply = `Done. ${pendingTool.name} → ${JSON.stringify(result)}`
        messages.push({ role: 'user', content: message || 'yes' })
        messages.push({ role: 'assistant', content: reply })
        pendingTool = null
        await sessionRef.update({
          messages,
          pendingTool: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { sessionId, reply, pendingTool: null, result }
      }
    }

    const requestAttachments = Array.isArray(data.attachments)
      ? (data.attachments as ChatAttachment[])
      : []

    if (!message && !requestAttachments.length) {
      throw new HttpsError('invalid-argument', 'message required')
    }

    const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || ''
    const model = process.env.LLM_MODEL || 'gemini-3.6-flash'

    if (!apiKey) {
      // Deterministic fallback without LLM (for local/dev without key)
      const reply =
        'AI is not configured yet. Set LLM_API_KEY (Gemini) on Cloud Functions. ' +
        'You can still use the CRM forms. Example intents once configured: ' +
        '"bought 10 sheets pink paper from Paper Mart at 4 each", ' +
        '"mark order … as IN_PRODUCTION".'
      messages.push({ role: 'user', content: message })
      messages.push({ role: 'assistant', content: reply })
      await sessionRef.update({
        messages,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { sessionId, reply, pendingTool: null, configured: false }
    }

    const attachmentUrls = requestAttachments.map(a => a.url)
    messages.push({
      role: 'user',
      content: message || 'See the attached file and log what it shows.',
    })
    const turn = await runLlmTurn({
      apiKey,
      model,
      messages,
      role: actor.role,
      attachments: await downloadAttachments(requestAttachments),
    })

    // Bill photos travel with the purchase they document
    if (turn.pendingTool?.name === 'log_purchase' && attachmentUrls.length) {
      turn.pendingTool.args.billPhotoUrls = attachmentUrls
    }

    if (turn.pendingTool && !turn.needsConfirmation) {
      // Auto-run read tools, then let the LLM continue (e.g. find product → log production)
      let currentTurn = turn
      let lastResult: unknown
      let lastReadName: ToolName | undefined
      let lastReadArgs: Record<string, unknown> = {}
      const maxReadSteps = 3

      for (let step = 0; step < maxReadSteps && currentTurn.pendingTool && !currentTurn.needsConfirmation; step++) {
        const { name, args } = currentTurn.pendingTool
        lastResult = await runTool(actor, name, args)
        lastReadName = name
        lastReadArgs = args

        if (Array.isArray(lastResult) && lastResult.length === 0) {
          const catalog = catalogForTool(name)
          if (catalog) {
            lastResult = { matches: [], availableInCatalog: await getCatalogNames(catalog) }
          }
        }

        currentTurn = await runLlmFollowUp({
          apiKey,
          model,
          messages,
          role: actor.role,
          toolName: name,
          toolArgs: args,
          toolResult: lastResult,
        })

        if (currentTurn.pendingTool?.name === 'log_purchase' && attachmentUrls.length) {
          currentTurn.pendingTool.args.billPhotoUrls = attachmentUrls
        }
      }

      if (currentTurn.pendingTool && currentTurn.needsConfirmation) {
        pendingTool = currentTurn.pendingTool
        messages.push({ role: 'assistant', content: currentTurn.reply })
        await sessionRef.update({
          messages,
          pendingTool,
          updatedAt: FieldValue.serverTimestamp(),
        })
        return {
          sessionId,
          reply: currentTurn.reply,
          pendingTool,
          needsConfirmation: true,
        }
      }

      if (currentTurn.pendingTool && !currentTurn.needsConfirmation) {
        const reply = formatReadToolReply(
          currentTurn.pendingTool.name,
          currentTurn.pendingTool.args,
          lastResult,
        )
        messages.push({ role: 'assistant', content: reply })
        await sessionRef.update({
          messages,
          pendingTool: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { sessionId, reply, pendingTool: null, result: lastResult }
      }

      let reply = currentTurn.reply
      if (lastReadName && PRESENT_TOOLS.has(lastReadName) && lastResult !== undefined) {
        reply = formatReadToolReply(lastReadName, lastReadArgs, lastResult)
        const coda = currentTurn.reply.trim()
        if (coda && !looksLikeDataDump(coda)) reply = `${reply}\n\n${coda}`
      }
      messages.push({ role: 'assistant', content: reply })
      await sessionRef.update({
        messages,
        pendingTool: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { sessionId, reply, pendingTool: null, result: lastResult }
    }

    if (turn.pendingTool && turn.needsConfirmation) {
      pendingTool = turn.pendingTool
      messages.push({ role: 'assistant', content: turn.reply })
      await sessionRef.update({
        messages,
        pendingTool,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { sessionId, reply: turn.reply, pendingTool, needsConfirmation: true }
    }

    messages.push({ role: 'assistant', content: turn.reply })
    await sessionRef.update({
      messages,
      pendingTool: null,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { sessionId, reply: turn.reply, pendingTool: null }
  } catch (err) {
    mapError(err)
  }
})

// ─── Gmail bank sync ─────────────────────────────────────────────────────────

function callbackRedirectUri(reqHost?: string, reqProtocol?: string): string {
  const configured = process.env.GMAIL_OAUTH_REDIRECT_URI || ''
  if (configured) return configured
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const project =
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      'demo-project'
    return `http://127.0.0.1:5001/${project}/asia-south1/gmailOAuthCallback`
  }
  if (reqHost) {
    const proto = reqProtocol === 'http' ? 'http' : 'https'
    return `${proto}://${reqHost}/gmailOAuthCallback`
  }
  const project =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
  return `https://asia-south1-${project}.cloudfunctions.net/gmailOAuthCallback`
}

export const gmailStatus = onCall(async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    if (!isAdminOrOwner(actor.role) && actor.role !== 'viewer') {
      throw new HttpsError('permission-denied', 'Not allowed')
    }
    const snap = await gmailDocRef().get()
    const data = snap.exists ? (snap.data() as GmailIntegrationDoc) : undefined
    const status = toPublicStatus(data)
    if (!status.connected) {
      status.senderAllowlist = DEFAULT_SENDER_ALLOWLIST
    }
    return status
  } catch (err) {
    mapError(err)
  }
})

export const gmailOAuthStart = onCall(async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    if (actor.role !== 'owner') {
      throw new HttpsError('permission-denied', 'Only the owner can connect the bank inbox')
    }
    requireOAuthConfig()
    const state = randomBytes(24).toString('hex')
    const redirectUri = callbackRedirectUri()
    await gmailDocRef().set(
      {
        oauthState: state,
        oauthStateExpiresAt: Date.now() + 15 * 60 * 1000,
        connectedBy: uid,
      },
      { merge: true },
    )
    const url = buildAuthUrl(redirectUri, state)
    return { url, redirectUri }
  } catch (err) {
    mapError(err)
  }
})

export const gmailOAuthCallback = onRequest({ cors: false }, async (req, res) => {
  const html = (title: string, body: string, ok: boolean) =>
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:3rem auto;padding:0 1rem;line-height:1.5}
    .ok{color:#0a7} .err{color:#c33}</style></head><body>${body}
    <p><a href="/settings">Back to Settings</a></p>
    <script>try{window.opener&&window.opener.postMessage({type:'gmail-oauth',ok:${ok}},'*')}catch(e){}
    setTimeout(function(){window.close()},2500)</script></body></html>`

  try {
    if (req.method !== 'GET') {
      res.status(405).send('Method not allowed')
      return
    }
    const code = String(req.query.code ?? '')
    const state = String(req.query.state ?? '')
    const errParam = String(req.query.error ?? '')
    if (errParam) {
      res.status(400).send(html('Error', `<p class="err">Google returned: ${errParam}</p>`, false))
      return
    }
    if (!code || !state) {
      res.status(400).send(html('Error', `<p class="err">Missing code or state.</p>`, false))
      return
    }

    const snap = await gmailDocRef().get()
    const existing = snap.exists ? (snap.data() as GmailIntegrationDoc) : null
    if (!existing?.oauthState || existing.oauthState !== state) {
      res
        .status(400)
        .send(html('Error', `<p class="err">Invalid OAuth state. Try Connect again.</p>`, false))
      return
    }
    if (existing.oauthStateExpiresAt && Date.now() > existing.oauthStateExpiresAt) {
      res
        .status(400)
        .send(html('Error', `<p class="err">OAuth session expired. Try Connect again.</p>`, false))
      return
    }

    const host = req.get('host') || undefined
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()
    const redirectUri = callbackRedirectUri(host, proto)
    const { refreshToken } = await exchangeCode(redirectUri, code)

    await gmailDocRef().set(
      {
        refreshToken,
        oauthState: null,
        oauthStateExpiresAt: null,
        connectedAt: FieldValue.serverTimestamp(),
        connectedBy: existing.connectedBy || 'oauth',
        senderAllowlist: existing.senderAllowlist?.length
          ? existing.senderAllowlist
          : DEFAULT_SENDER_ALLOWLIST,
        lastError: null,
      },
      { merge: true },
    )

    const { gmail } = await getAuthedGmail()
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const email = profile.data.emailAddress || ''

    await gmailDocRef().set(
      {
        email,
        historyId: String(profile.data.historyId || ''),
        connectedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    res.status(200).send(
      html(
        'Connected',
        `<p class="ok">Bank inbox connected: <strong>${email || 'Gmail'}</strong>.</p>
         <p>You can close this window and return to Settings.</p>`,
        true,
      ),
    )
  } catch (err) {
    console.error(err)
    const msg = err instanceof Error ? err.message : 'OAuth failed'
    res.status(500).send(html('Error', `<p class="err">${msg}</p>`, false))
  }
})

export const gmailDisconnect = onCall(async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    if (actor.role !== 'owner') {
      throw new HttpsError('permission-denied', 'Only the owner can disconnect the bank inbox')
    }
    await gmailDocRef().delete()
    return { ok: true }
  } catch (err) {
    mapError(err)
  }
})

export const gmailUpdateSettings = onCall(async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    if (!isAdminOrOwner(actor.role)) {
      throw new HttpsError('permission-denied', 'Only owners/admins can update Gmail settings')
    }
    const snap = await gmailDocRef().get()
    if (!snap.exists || !(snap.data() as GmailIntegrationDoc).refreshToken) {
      throw new HttpsError('failed-precondition', 'Connect a bank inbox first')
    }
    const allowlist = Array.isArray(request.data?.senderAllowlist)
      ? (request.data.senderAllowlist as unknown[])
          .map(s => String(s).trim())
          .filter(Boolean)
          .slice(0, 40)
      : undefined
    const labelId =
      request.data?.labelId === undefined
        ? undefined
        : request.data.labelId
          ? String(request.data.labelId).trim()
          : null

    const patch: Record<string, unknown> = {}
    if (allowlist) patch.senderAllowlist = allowlist
    if (labelId !== undefined) patch.labelId = labelId
    if (!Object.keys(patch).length) {
      throw new HttpsError('invalid-argument', 'No settings to update')
    }
    await gmailDocRef().set(patch, { merge: true })
    const updated = await gmailDocRef().get()
    return toPublicStatus(updated.data() as GmailIntegrationDoc)
  } catch (err) {
    mapError(err)
  }
})

export const gmailBackfill = onCall({ timeoutSeconds: 540 }, async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    if (!isAdminOrOwner(actor.role)) {
      throw new HttpsError('permission-denied', 'Only owners/admins can sync mail')
    }
    const days = Math.min(90, Math.max(1, Number(request.data?.days ?? 7) || 7))
    const maxMessages = Math.min(500, Math.max(1, Number(request.data?.maxMessages ?? 500) || 500))
    const result = await backfillMessages(days, maxMessages)
    return { ok: true, days, ...result }
  } catch (err) {
    mapError(err)
  }
})

export const gmailSyncNow = onCall({ timeoutSeconds: 120 }, async request => {
  try {
    const uid = requireAuth(request.auth?.uid)
    const actor = await resolveActor(uid)
    if (!isAdminOrOwner(actor.role)) {
      throw new HttpsError('permission-denied', 'Only owners/admins can sync mail')
    }
    const result = await syncFromHistory()
    return { ok: true, ...result }
  } catch (err) {
    mapError(err)
  }
})
