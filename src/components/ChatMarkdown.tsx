import { ChatResultTable, parseLabeledList, parsePcTable } from './ChatResultTable'

const NUMBERED = /^\s*(?:\*\*)?(\d+)\.(?:\*\*)?\s+(.*)$/

function inline(text: string) {
  const parts: Array<string | { bold: string }> = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push({ bold: match[1] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.map((p, i) =>
    typeof p === 'string' ? <span key={i}>{p}</span> : <strong key={i}>{p.bold}</strong>,
  )
}

function MarkdownBlock({ text, hideMoney }: { text: string; hideMoney?: boolean }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const nodes: JSX.Element[] = []
  let i = 0
  let key = 0

  const flushPara = (buf: string[]) => {
    const joined = buf.join(' ').trim()
    if (joined) nodes.push(<p key={key++}>{inline(joined)}</p>)
  }

  while (i < lines.length) {
    const line = lines[i]
    const numbered = line.match(NUMBERED)
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)

    if (numbered) {
      const items: string[] = []
      while (i < lines.length) {
        while (i < lines.length && !lines[i].trim()) i++
        const m = lines[i]?.match(NUMBERED)
        if (!m) break
        items.push(m[2])
        i++
        while (i < lines.length) {
          const nested = lines[i].match(/^\s{2,}[-*]\s+(.*)$/)
          if (!nested) break
          items[items.length - 1] += ` | ${nested[1].replace(/\*\*/g, '')}`
          i++
        }
      }
      const table = parseLabeledList(items)
      if (table) {
        nodes.push(<ChatResultTable key={key++} hideMoney={hideMoney} {...table} />)
      } else {
        nodes.push(
          <ol key={key++}>
            {items.map((item, idx) => (
              <li key={idx}>{inline(item)}</li>
            ))}
          </ol>,
        )
      }
      continue
    }

    if (bullet) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.*)$/)
        if (!m) break
        items.push(m[1])
        i++
      }
      nodes.push(
        <ul key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{inline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !NUMBERED.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i])) {
      buf.push(lines[i])
      i++
    }
    flushPara(buf)
  }

  return <>{nodes}</>
}

export function ChatMarkdown({ text, hideMoney = false }: { text: string; hideMoney?: boolean }) {
  const chunks: Array<{ type: 'text' | 'code' | 'table'; text: string }> = []
  const fence = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = fence.exec(text))) {
    if (match.index > last) chunks.push({ type: 'text', text: text.slice(last, match.index) })
    const lang = match[1]
    const body = match[2].replace(/\n$/, '')
    chunks.push({ type: lang === 'pc-table' ? 'table' : 'code', text: body })
    last = match.index + match[0].length
  }
  if (last < text.length) chunks.push({ type: 'text', text: text.slice(last) })

  return (
    <div className="pc-md">
      {chunks.map((c, i) => {
        if (c.type === 'table') {
          const table = parsePcTable(c.text)
          return table ? <ChatResultTable key={i} hideMoney={hideMoney} {...table} /> : (
            <pre key={i}>
              <code>{c.text}</code>
            </pre>
          )
        }
        if (c.type === 'code') {
          return (
            <pre key={i}>
              <code>{c.text}</code>
            </pre>
          )
        }
        return <MarkdownBlock key={i} text={c.text} hideMoney={hideMoney} />
      })}
    </div>
  )
}
