import StatusBadge from './StatusBadge'

export interface ChatTableData {
  columns: string[]
  rows: string[][]
}

const ID_COLS = /^(id|order|order id|orderid|doc id)$/i
const STATUS_COLS = /status/i
const MONEY_COLS = /^(total|cost|price|amount|gst)$/i
const STATUSES = new Set([
  'DRAFT',
  'QUOTED',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  'DISPATCHED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'PLANNED',
  'IN_PROGRESS',
  'ACTIVE',
  'INACTIVE',
])

function isIdCol(name: string) {
  return ID_COLS.test(name.trim())
}

function isMoneyCol(name: string) {
  return MONEY_COLS.test(name.trim())
}

function looksLikeStatus(value: string) {
  return STATUSES.has(value.trim().replace(/\s+/g, '_').toUpperCase())
}

function cell(column: string, value: string) {
  const trimmed = value.trim()
  if (STATUS_COLS.test(column) || looksLikeStatus(trimmed)) {
    return <StatusBadge status={trimmed.replace(/\s+/g, '_').toUpperCase()} />
  }
  return trimmed || '—'
}

export function ChatResultTable({
  columns,
  rows,
  hideMoney = false,
}: ChatTableData & { hideMoney?: boolean }) {
  const visible = columns
    .map((col, idx) => ({ col, idx }))
    .filter(({ col }) => !isIdCol(col) && !(hideMoney && isMoneyCol(col)))
  if (!visible.length || !rows.length) return null

  const titleIdx = visible.find(v => !STATUS_COLS.test(v.col) && !isMoneyCol(v.col))?.idx ?? visible[0].idx

  return (
    <div className="pc-chat-records">
      <div className="pc-chat-table-wrap">
        <table className="pc-chat-table">
          <thead>
            <tr>
              {visible.map(({ col }) => (
                <th key={col} className={isMoneyCol(col) ? 'is-num' : undefined}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {visible.map(({ col, idx }) => (
                  <td key={col} className={isMoneyCol(col) ? 'is-num' : undefined}>
                    {cell(col, row[idx] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pc-chat-cards">
        {rows.map((row, r) => (
          <div key={r} className="pc-chat-card">
            <div className="d-flex align-items-start justify-content-between gap-2">
              <strong>{row[titleIdx] || '—'}</strong>
              {visible
                .filter(v => STATUS_COLS.test(v.col))
                .map(v => (
                  <StatusBadge key={v.col} status={(row[v.idx] ?? '').replace(/\s+/g, '_').toUpperCase()} />
                ))}
            </div>
            {visible
              .filter(v => v.idx !== titleIdx && !STATUS_COLS.test(v.col))
              .map(v => (
                <div key={v.col} className={isMoneyCol(v.col) ? 'pc-chat-card-money' : 'small text-muted'}>
                  {isMoneyCol(v.col) ? row[v.idx] : `${v.col}: ${row[v.idx] || '—'}`}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function parsePcTable(json: string): ChatTableData | null {
  try {
    const parsed = JSON.parse(json) as ChatTableData
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null
    if (!parsed.columns.length || !parsed.rows.length) return null
    return parsed
  } catch {
    return null
  }
}

export function parseLabeledList(items: string[]): ChatTableData | null {
  if (items.length < 2) return null
  const records = items.map(parseRecordItem).filter((r): r is Record<string, string> => r != null)
  if (records.length < 2 || records.length < items.length * 0.6) return null
  const columns: string[] = []
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      if (!isIdCol(key) && !columns.includes(key)) columns.push(key)
    }
  }
  if (columns.length < 2) return null
  return {
    columns,
    rows: records.map(rec => columns.map(c => rec[c] ?? '')),
  }
}

/** `Order '#abc' – Anil Kumar | Status: READY | Event: Party | Total: ₹52.50 (GST: ₹2.50)` */
export function parseRecordItem(raw: string): Record<string, string> | null {
  const text = raw.replace(/\*\*/g, '').trim()
  if (!text.includes('|') && !/Status:/i.test(text)) return null
  const parts = text.split('|').map(s => s.trim()).filter(Boolean)
  if (!parts.length) return null

  const rec: Record<string, string> = {}
  parts.forEach((part, i) => {
    const labeled = part.match(/^([A-Za-z][A-Za-z ]{0,20}):\s*(.+)$/)
    if (labeled) {
      const key = labeled[1].trim()
      let val = labeled[2].trim().replace(/^['"`]|['"`]$/g, '')
      const gstInline = val.match(/\(GST:\s*([^)]+)\)/i)
      if (gstInline && /^total$/i.test(key)) {
        rec.GST = gstInline[1].trim()
        val = val.replace(/\(GST:\s*[^)]+\)/i, '').trim()
      }
      rec[key] = val
      return
    }
    if (i !== 0) return
    const lead = part.replace(/^Order\s+/i, '').trim()
    const idName = lead.match(/#([A-Za-z0-9]+)['"]?\s*[–—-]\s*(.+)$/)
    if (idName) {
      rec.Customer = idName[2].trim()
      return
    }
    const nameOnly = lead.replace(/^['"]?#?[A-Za-z0-9]{12,}['"]?\s*[–—-]\s*/, '').trim()
    if (nameOnly) rec.Customer = nameOnly
  })

  return Object.keys(rec).length >= 2 ? rec : null
}
