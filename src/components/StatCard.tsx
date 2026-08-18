type Tone = 'violet' | 'coral' | 'teal' | 'amber' | 'slate'

interface Props {
  label: string
  value: string | number
  icon?: string
  tone?: Tone
  alert?: boolean
  hint?: string
}

export default function StatCard({ label, value, icon, tone = 'violet', alert, hint }: Props) {
  return (
    <div className={`pc-stat${alert ? ' is-alert' : ''}`}>
      {icon && <span className={`pc-stat-icon tone-${tone}`}>{icon}</span>}
      <div className="pc-stat-value">{value}</div>
      <div className="pc-stat-label">{label}</div>
      {hint && <div className="small text-muted">{hint}</div>}
    </div>
  )
}
