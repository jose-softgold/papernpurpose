import { createHash } from 'crypto'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { gmail_v1 } from 'googleapis'
import { getAuthedGmail } from './client'
import { DEFAULT_SENDER_ALLOWLIST, GmailIntegrationDoc, gmailDocRef } from './config'
import { parseBankEmail } from './parseBankEmail'

function decodeBody(data?: string | null): string {
  if (!data) return ''
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function headerMap(headers: gmail_v1.Schema$MessagePartHeader[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of headers ?? []) {
    if (h.name && h.value) out[h.name.toLowerCase()] = h.value
  }
  return out
}

function collectParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: { text: string; html: string; pdfs: Array<{ base64: string; filename?: string }> },
) {
  if (!part) return
  const mime = (part.mimeType || '').toLowerCase()
  const filename = part.filename || undefined
  if (part.body?.data) {
    if (mime === 'text/plain') acc.text += decodeBody(part.body.data) + '\n'
    else if (mime === 'text/html') acc.html += decodeBody(part.body.data) + '\n'
    else if (mime === 'application/pdf' || filename?.toLowerCase().endsWith('.pdf')) {
      acc.pdfs.push({ base64: part.body.data.replace(/-/g, '+').replace(/_/g, '/'), filename })
    }
  }
  for (const child of part.parts ?? []) collectParts(child, acc)
}

function senderMatchesAllowlist(from: string, allowlist: string[]): boolean {
  const lower = from.toLowerCase()
  return allowlist.some(entry => {
    const e = entry.trim().toLowerCase()
    if (!e) return false
    if (e.includes('@')) return lower.includes(e)
    return lower.includes(`@${e}`) || lower.endsWith(e)
  })
}

function fingerprint(
  gmailMessageId: string,
  row: {
    amount: number
    direction: string
    occurredAt: string | null
    accountLast4: string | null
    description: string
  },
  index: number,
): string {
  const base = [
    gmailMessageId,
    row.direction,
    row.amount.toFixed(2),
    row.occurredAt || '',
    row.accountLast4 || '',
    row.description.slice(0, 80),
    String(index),
  ].join('|')
  return createHash('sha256').update(base).digest('hex').slice(0, 40)
}

function parseOccurredAt(value: string | null): Timestamp | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return Timestamp.fromDate(d)
}

async function alreadyStored(gmailMessageId: string, fp: string): Promise<boolean> {
  const db = getFirestore()
  const snap = await db
    .collection('bankTransactions')
    .where('gmailMessageId', '==', gmailMessageId)
    .where('fingerprint', '==', fp)
    .limit(1)
    .get()
  return !snap.empty
}

async function fetchPdfAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
): Promise<string> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  })
  return (res.data.data || '').replace(/-/g, '+').replace(/_/g, '/')
}

async function processMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
  integration: GmailIntegrationDoc,
): Promise<{ written: number; skipped: number }> {
  const full = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  })
  const headers = headerMap(full.data.payload?.headers)
  const from = headers.from || ''
  const allowlist = integration.senderAllowlist?.length
    ? integration.senderAllowlist
    : DEFAULT_SENDER_ALLOWLIST

  if (!senderMatchesAllowlist(from, allowlist)) return { written: 0, skipped: 0 }

  const collected = { text: '', html: '', pdfs: [] as Array<{ base64: string; filename?: string }> }
  collectParts(full.data.payload, collected)

  async function walkForAttachmentIds(part: gmail_v1.Schema$MessagePart | undefined) {
    if (!part) return
    const mime = (part.mimeType || '').toLowerCase()
    const filename = part.filename || ''
    if (
      part.body?.attachmentId &&
      (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'))
    ) {
      const base64 = await fetchPdfAttachment(gmail, messageId, part.body.attachmentId)
      collected.pdfs.push({ base64, filename })
    }
    for (const child of part.parts ?? []) await walkForAttachmentIds(child)
  }
  await walkForAttachmentIds(full.data.payload)

  const subject = headers.subject || ''
  const snippet = full.data.snippet || ''
  const parsed = await parseBankEmail({
    subject,
    snippet,
    textBody: collected.text,
    htmlBody: collected.html,
    pdfAttachments: collected.pdfs.slice(0, 2),
  })

  let written = 0
  let skipped = 0

  if (!parsed.rows.length) {
    const fp = fingerprint(
      messageId,
      { amount: 0, direction: 'debit', occurredAt: null, accountLast4: null, description: subject },
      0,
    )
    if (await alreadyStored(messageId, fp)) {
      return { written: 0, skipped: 1 }
    }
    await getFirestore().collection('bankTransactions').add({
      gmailMessageId: messageId,
      gmailThreadId: full.data.threadId || '',
      fingerprint: fp,
      source: parsed.source,
      occurredAt: null,
      amount: 0,
      direction: 'debit',
      currency: 'INR',
      bankName: null,
      accountLast4: null,
      counterparty: null,
      description: subject || 'Unparsed bank email',
      rawSubject: subject.slice(0, 300),
      snippet: snippet.slice(0, 400),
      parseConfidence: 0.1,
      parseNotes: parsed.parseNotes || 'Could not extract amount — edit manually',
      status: 'pending',
      books: 'unassigned',
      personalCategory: null,
      category: null,
      workerId: null,
      orderId: null,
      purchaseId: null,
      materialId: null,
      productId: null,
      tags: [],
      matchType: null,
      matchId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { written: 1, skipped: 0 }
  }

  const db = getFirestore()
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    const fp = fingerprint(
      messageId,
      {
        amount: row.amount,
        direction: row.direction,
        occurredAt: row.occurredAt,
        accountLast4: row.accountLast4,
        description: row.description,
      },
      i,
    )
    if (await alreadyStored(messageId, fp)) {
      skipped++
      continue
    }

    await db.collection('bankTransactions').add({
      gmailMessageId: messageId,
      gmailThreadId: full.data.threadId || '',
      fingerprint: fp,
      source: parsed.source,
      occurredAt: parseOccurredAt(row.occurredAt) || FieldValue.serverTimestamp(),
      amount: row.amount,
      direction: row.direction,
      currency: 'INR',
      bankName: row.bankName,
      accountLast4: row.accountLast4,
      counterparty: row.counterparty,
      description: row.description || subject,
      rawSubject: subject.slice(0, 300),
      snippet: snippet.slice(0, 400),
      parseConfidence: row.confidence,
      parseNotes: row.notes || parsed.parseNotes || null,
      status: 'pending',
      books: 'unassigned',
      personalCategory: null,
      category: null,
      workerId: null,
      orderId: null,
      purchaseId: null,
      materialId: null,
      productId: null,
      tags: [],
      matchType: null,
      matchId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    written++
  }
  return { written, skipped }
}

function buildSearchQuery(integration: GmailIntegrationDoc, days: number): string {
  const allowlist = integration.senderAllowlist?.length
    ? integration.senderAllowlist
    : DEFAULT_SENDER_ALLOWLIST
  // Gmail search: use from:user@domain or from:domain (no leading @ on domains).
  // from:@domain often matches nothing.
  const fromClauses = allowlist
    .slice(0, 20)
    .map(s => {
      const e = s.trim()
      if (!e) return ''
      return `from:${e.replace(/^@/, '')}`
    })
    .filter(Boolean)
  const fromPart = fromClauses.length ? `(${fromClauses.join(' OR ')})` : ''
  const labelPart = integration.labelId ? `label:${integration.labelId}` : ''
  const newer = `newer_than:${Math.max(1, days)}d`
  return [fromPart, labelPart, newer].filter(Boolean).join(' ')
}

export async function syncFromHistory(): Promise<{
  processed: number
  written: number
  skippedDuplicates: number
}> {
  const { gmail, integration, ref } = await getAuthedGmail()
  let processed = 0
  let written = 0
  let skippedDuplicates = 0

  try {
    const startHistoryId = integration.historyId
    if (!startHistoryId) {
      const profile = await gmail.users.getProfile({ userId: 'me' })
      await ref.set(
        {
          historyId: String(profile.data.historyId || ''),
          lastSyncAt: FieldValue.serverTimestamp(),
          lastError: null,
        },
        { merge: true },
      )
      return { processed: 0, written: 0, skippedDuplicates: 0 }
    }

    const messageIds = new Set<string>()
    let pageToken: string | undefined
    let newestHistoryId = startHistoryId

    do {
      const hist = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        pageToken,
      })
      if (hist.data.historyId) newestHistoryId = String(hist.data.historyId)
      for (const h of hist.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.id) messageIds.add(added.message.id)
        }
      }
      pageToken = hist.data.nextPageToken || undefined
    } while (pageToken)

    for (const id of messageIds) {
      processed++
      const r = await processMessage(gmail, id, integration)
      written += r.written
      skippedDuplicates += r.skipped
    }

    await ref.set(
      {
        historyId: newestHistoryId,
        lastSyncAt: FieldValue.serverTimestamp(),
        lastError: null,
      },
      { merge: true },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/historyId/i.test(message) || /404/.test(message)) {
      const profile = await gmail.users.getProfile({ userId: 'me' })
      await ref.set(
        {
          historyId: String(profile.data.historyId || ''),
          lastError: 'historyId expired; reset. Run backfill to catch missed mail.',
          lastSyncAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return { processed, written, skippedDuplicates }
    }
    await ref.set({ lastError: message, lastSyncAt: FieldValue.serverTimestamp() }, { merge: true })
    throw err
  }

  return { processed, written, skippedDuplicates }
}

export async function backfillMessages(
  days = 7,
  maxMessages = 500,
): Promise<{ processed: number; written: number; skippedDuplicates: number }> {
  const clampedDays = Math.min(90, Math.max(1, days))
  const cappedMax = Math.min(500, Math.max(1, maxMessages))
  const { gmail, integration, ref } = await getAuthedGmail()
  const q = buildSearchQuery(integration, clampedDays)
  let processed = 0
  let written = 0
  let skippedDuplicates = 0
  let pageToken: string | undefined

  do {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: Math.min(50, cappedMax - processed),
      pageToken,
    })
    for (const m of list.data.messages ?? []) {
      if (!m.id) continue
      processed++
      const r = await processMessage(gmail, m.id, integration)
      written += r.written
      skippedDuplicates += r.skipped
      if (processed >= cappedMax) break
    }
    pageToken = list.data.nextPageToken || undefined
  } while (pageToken && processed < cappedMax)

  const profile = await gmail.users.getProfile({ userId: 'me' })
  await ref.set(
    {
      historyId: String(profile.data.historyId || integration.historyId || ''),
      lastSyncAt: FieldValue.serverTimestamp(),
      lastError: null,
    },
    { merge: true },
  )

  return { processed, written, skippedDuplicates }
}

export async function loadIntegration(): Promise<GmailIntegrationDoc | null> {
  const snap = await gmailDocRef().get()
  if (!snap.exists) return null
  return snap.data() as GmailIntegrationDoc
}
