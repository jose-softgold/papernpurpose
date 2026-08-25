import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

export interface ParsedBankRow {
  amount: number
  direction: 'credit' | 'debit'
  occurredAt: string | null
  bankName: string | null
  accountLast4: string | null
  counterparty: string | null
  description: string
  confidence: number
  notes?: string
}

export interface ParsedBankEmail {
  source: 'alert' | 'statement'
  rows: ParsedBankRow[]
  parseNotes?: string
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse DD-MM-YY or DD-MM-YYYY (HDFC InstaAlerts style) to ISO date at local noon. */
function parseHdfcDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00.000Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return iso
}

function looksLikeHdfc(subject: string, text: string): boolean {
  const blob = `${subject}\n${text}`.toLowerCase()
  return (
    blob.includes('hdfc') ||
    blob.includes('instaalerts') ||
    blob.includes('hdfcbank.bank.in') ||
    /upi txn/i.test(subject) ||
    /account ending\s+(?:in\s+)?\d{4}/i.test(text)
  )
}

const RS_AMOUNT =
  'Rs\\.?\\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)'

/**
 * HDFC Bank InstaAlerts — examples:
 * "Rs.110.00 is debited from your account ending 8320 towards VPA … on 20-08-24."
 * "Rs.5000.00 has been successfully credited to your HDFC Bank account ending in 8320."
 */
function parseHdfcInstaAlert(subject: string, text: string): ParsedBankEmail | null {
  if (!looksLikeHdfc(subject, text)) return null

  // Classic UPI debit/credit sentence
  const primary =
    text.match(
      new RegExp(
        `${RS_AMOUNT}\\s+is\\s+(debited|credited)\\s+from\\s+your\\s+account\\s+ending\\s+(\\d{4})\\s+towards\\s+(.+?)\\s+on\\s+(\\d{1,2}-\\d{1,2}-\\d{2,4})`,
        'i',
      ),
    ) ||
    text.match(
      new RegExp(
        `${RS_AMOUNT}\\s+is\\s+(debited|credited)\\s+from\\s+your\\s+account\\s+ending\\s+(\\d{4})(?:\\s+towards\\s+(.+?))?\\s+on\\s+(\\d{1,2}-\\d{1,2}-\\d{2,4})`,
        'i',
      ),
    )

  if (primary) {
    const amount = Number(String(primary[1]).replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) return null

    const direction: 'credit' | 'debit' = /^credit/i.test(primary[2]) ? 'credit' : 'debit'
    const accountLast4 = primary[3]
    const towards = (primary[4] || '').trim()
    const occurredAt = parseHdfcDate(primary[5])

    let counterparty: string | null = null
    const vpaNamed = towards.match(/VPA\s+(\S+)\s*\(([^)]+)\)/i)
    const vpaOnly = towards.match(/VPA\s+(\S+)/i)
    if (vpaNamed) {
      counterparty = `${vpaNamed[2].trim()} (${vpaNamed[1]})`
    } else if (vpaOnly) {
      counterparty = vpaOnly[1]
    } else if (towards) {
      counterparty = towards.replace(/\s+/g, ' ').slice(0, 120)
    }

    const ref =
      text.match(/UPI\s+transaction\s+reference\s+no\.?\s*:?\s*(\d+)/i)?.[1] ||
      text.match(/reference\s+no\.?\s*:?\s*(\d{6,})/i)?.[1] ||
      null

    const descriptionParts = [
      direction === 'debit' ? 'UPI debit' : 'UPI credit',
      counterparty,
      ref ? `ref ${ref}` : null,
    ].filter(Boolean)

    return {
      source: 'alert',
      rows: [
        {
          amount,
          direction,
          occurredAt,
          bankName: 'HDFC',
          accountLast4,
          counterparty,
          description: descriptionParts.join(' · ') || subject.slice(0, 200),
          confidence: 0.92,
          notes: 'Parsed with HDFC InstaAlerts template',
        },
      ],
    }
  }

  // Newer credit template: "Rs.5000.00 has been successfully credited to your HDFC Bank account ending in 8320"
  const credit = text.match(
    new RegExp(
      `${RS_AMOUNT}\\s+has\\s+been\\s+successfully\\s+credited\\s+to\\s+your\\s+(?:HDFC\\s+Bank\\s+)?account\\s+ending\\s+(?:in\\s+)?(\\d{4})`,
      'i',
    ),
  )
  if (credit) {
    const amount = Number(String(credit[1]).replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) return null
    const accountLast4 = credit[2]
    const dateRaw =
      text.match(/\bDate:\s*(\d{1,2}-\d{1,2}-\d{2,4})/i)?.[1] ||
      text.match(/\bon\s+(\d{1,2}-\d{1,2}-\d{2,4})/i)?.[1] ||
      null
    const sender =
      text.match(/\bSender:\s*([^\n.]+?)(?:\s*\(VPA:|\s*c\.|\.|$)/i)?.[1]?.trim() || null
    const vpa = text.match(/\bVPA:\s*([^\s)]+)/i)?.[1] || null
    const ref =
      text.match(/UPI\s+Reference\s+No\.?\s*:?\s*(\d+)/i)?.[1] ||
      text.match(/reference\s+no\.?\s*:?\s*(\d{6,})/i)?.[1] ||
      null
    const counterparty = sender
      ? vpa
        ? `${sender} (${vpa})`
        : sender
      : vpa

    return {
      source: 'alert',
      rows: [
        {
          amount,
          direction: 'credit',
          occurredAt: dateRaw ? parseHdfcDate(dateRaw) : null,
          bankName: 'HDFC',
          accountLast4,
          counterparty,
          description: ['UPI credit', counterparty, ref ? `ref ${ref}` : null]
            .filter(Boolean)
            .join(' · '),
          confidence: 0.9,
          notes: 'Parsed with HDFC credited-to template',
        },
      ],
    }
  }

  return null
}

/**
 * Placeholder for credit-card statement/alert emails.
 * Returns null until a real template is provided (same pattern as HDFC InstaAlerts).
 */
function parseCreditCardAlert(subject: string, text: string): ParsedBankEmail | null {
  const blob = `${subject}\n${text}`.toLowerCase()
  const looksLikeCard =
    /\b(credit\s*card|cc\s*alert|card\s*ending|visa|mastercard|rupay)\b/i.test(blob) &&
    !looksLikeHdfc(subject, text)
  if (!looksLikeCard) return null
  // Intentionally empty — wire regex/LLM once the user shares a sample.
  return {
    source: 'alert',
    rows: [],
    parseNotes: 'Credit-card email detected but parser not configured yet (awaiting sample template)',
  }
}

function heuristicParse(text: string): ParsedBankEmail | null {
  const lower = text.toLowerCase()
  const amountMatch =
    text.match(/(?:INR|Rs\.?|₹)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i) ||
    text.match(/\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?)\b/)
  if (!amountMatch) return null
  const amount = Number(String(amountMatch[1]).replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null

  let direction: 'credit' | 'debit' = 'debit'
  if (/\b(credited|credit|received|deposit)\b/i.test(lower)) direction = 'credit'
  else if (/\b(debited|debit|spent|withdrawn|paid)\b/i.test(lower)) direction = 'debit'

  const last4 = text.match(/(?:a\/c|account|acct|xx+|X{2,}|ending)\D{0,12}(\d{4})\b/i)?.[1] ?? null
  const bankName =
    text.match(/\b(HDFC|ICICI|SBI|Axis|Kotak|Yes Bank|RBL|IndusInd|IDFC|Federal)\b/i)?.[1] ?? null

  return {
    source: 'alert',
    rows: [
      {
        amount,
        direction,
        occurredAt: null,
        bankName,
        accountLast4: last4,
        counterparty: null,
        description: text.slice(0, 240),
        confidence: 0.45,
        notes: 'Generic heuristic parse',
      },
    ],
  }
}

function normalizeRows(raw: ParsedBankEmail): ParsedBankEmail {
  const rows = (raw.rows ?? [])
    .map(r => ({
      amount: Number(r.amount),
      direction: r.direction === 'credit' ? ('credit' as const) : ('debit' as const),
      occurredAt: r.occurredAt || null,
      bankName: r.bankName || null,
      accountLast4: r.accountLast4 ? String(r.accountLast4).replace(/\D/g, '').slice(-4) : null,
      counterparty: r.counterparty || null,
      description: String(r.description || '').slice(0, 500),
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
      notes: r.notes,
    }))
    .filter(r => Number.isFinite(r.amount) && r.amount > 0)

  return {
    source: raw.source === 'statement' ? 'statement' : 'alert',
    rows,
    parseNotes: raw.parseNotes,
  }
}

async function parseWithGemini(input: {
  subject: string
  snippet: string
  text: string
  pdfAttachments?: Array<{ base64: string; filename?: string }>
}): Promise<ParsedBankEmail | null> {
  const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || ''
  if (!apiKey) return null
  const modelName = process.env.LLM_MODEL || 'gemini-2.0-flash'

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            source: { type: SchemaType.STRING, description: 'alert or statement' },
            parseNotes: { type: SchemaType.STRING },
            rows: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  amount: { type: SchemaType.NUMBER },
                  direction: { type: SchemaType.STRING, description: 'credit or debit' },
                  occurredAt: {
                    type: SchemaType.STRING,
                    description: 'ISO-8601 datetime if known, else empty',
                  },
                  bankName: { type: SchemaType.STRING },
                  accountLast4: { type: SchemaType.STRING },
                  counterparty: { type: SchemaType.STRING },
                  description: { type: SchemaType.STRING },
                  confidence: { type: SchemaType.NUMBER },
                  notes: { type: SchemaType.STRING },
                },
                required: ['amount', 'direction', 'description', 'confidence'],
              },
            },
          },
          required: ['source', 'rows'],
        },
      },
    })

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      {
        text:
          'Extract Indian bank transaction(s) from this email. ' +
          'Use source=alert for a single alert, source=statement for multiple statement rows. ' +
          'Amounts in INR. direction is credit (money in) or debit (money out). ' +
          'If unsure of a field, use empty string and lower confidence. Never invent amounts.\n\n' +
          `Subject: ${input.subject}\nSnippet: ${input.snippet}\nBody:\n${input.text}`,
      },
    ]

    for (const pdf of input.pdfAttachments ?? []) {
      parts.push({ inlineData: { data: pdf.base64, mimeType: 'application/pdf' } })
    }

    const result = await model.generateContent({ contents: [{ role: 'user', parts }] })
    return normalizeRows(JSON.parse(result.response.text()) as ParsedBankEmail)
  } catch (err) {
    console.warn('Gemini bank parse failed', err)
    return null
  }
}

/**
 * Parse order: HDFC template → generic regex → Gemini only if PDF or both failed.
 */
export async function parseBankEmail(input: {
  subject: string
  snippet: string
  textBody: string
  htmlBody?: string
  pdfAttachments?: Array<{ base64: string; filename?: string }>
}): Promise<ParsedBankEmail> {
  const text = [input.subject, input.snippet, input.textBody, input.htmlBody ? stripHtml(input.htmlBody) : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 20000)

  const hdfc = parseHdfcInstaAlert(input.subject, text)
  if (hdfc?.rows.length) return hdfc

  // Credit-card alerts: placeholder until a real sample email/PDF is shared.
  const cc = parseCreditCardAlert(input.subject, text)
  if (cc?.rows.length) return cc

  const heuristic = heuristicParse(text)
  if (heuristic?.rows.length && !(input.pdfAttachments?.length)) {
    return heuristic
  }

  const hasPdf = (input.pdfAttachments?.length ?? 0) > 0
  if (hasPdf || !heuristic?.rows.length) {
    const ai = await parseWithGemini({
      subject: input.subject,
      snippet: input.snippet,
      text,
      pdfAttachments: input.pdfAttachments,
    })
    if (ai?.rows.length) return ai
  }

  return (
    heuristic ?? {
      source: 'alert',
      rows: [],
      parseNotes: 'Could not parse amount from email',
    }
  )
}
