export function cell(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k]) return row[k]
  }
  return ''
}

export function parseDate(raw: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime()) && /[a-z/-]/i.test(raw)) return d
  if (!Number.isNaN(d.getTime()) && raw.includes('-') && raw.length >= 8) return d
  const serial = Number(raw)
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const epoch = Date.UTC(1899, 11, 30)
    return new Date(epoch + serial * 86400000)
  }
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])
    return new Date(year, Number(m[2]) - 1, Number(m[1]))
  }
  return null
}

export function parseGst(raw: string): number {
  const n = Number(String(raw).replace('%', '').trim())
  if (!Number.isFinite(n) || n < 0 || n > 100) return 0
  return Math.round(n * 100) / 100
}

export function digits(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function matchName<T extends { name: string }>(list: T[], name: string): T | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return list.find(x => x.name.toLowerCase() === n)
}

export function matchParty<T extends { name: string; phone?: string; companyName?: string }>(
  list: T[],
  name: string,
  phone: string,
): T | undefined {
  const d = digits(phone)
  if (d) {
    const byPhone = list.find(x => digits(x.phone ?? '') === d)
    if (byPhone) return byPhone
  }
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return list.find(x => x.name.toLowerCase() === n || (x.companyName ?? '').toLowerCase() === n)
}
