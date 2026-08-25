export type DatePresetKind = 'this_month' | 'last_month' | 'last_7' | 'last_30' | 'all'

export function isoDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function datePreset(kind: DatePresetKind): { from: string; to: string } {
  if (kind === 'all') return { from: '', to: '' }
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (kind === 'this_month') {
    return {
      from: isoDateLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: isoDateLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    }
  }
  if (kind === 'last_month') {
    return {
      from: isoDateLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: isoDateLocal(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
  }
  const days = kind === 'last_7' ? 6 : 29
  const from = new Date(end)
  from.setDate(from.getDate() - days)
  return { from: isoDateLocal(from), to: isoDateLocal(end) }
}

/** @deprecated use datePreset */
export const bankDatePreset = datePreset
