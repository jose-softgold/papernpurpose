/** Single source of truth for status colors across dashboard, lists and detail pages */
const TONES: Record<string, string> = {
  DRAFT: 'secondary',
  QUOTED: 'info',
  CONFIRMED: 'primary',
  IN_PRODUCTION: 'warning',
  READY: 'success',
  DISPATCHED: 'info',
  DELIVERED: 'success',
  COMPLETED: 'dark',
  CANCELLED: 'danger',
  active: 'success',
  inactive: 'secondary',
}

export function statusTone(status: string): string {
  return TONES[status] ?? TONES[status?.toUpperCase()] ?? 'secondary'
}

export default function StatusBadge({
  status,
  className = '',
}: {
  status: string
  className?: string
}) {
  return (
    <span className={`badge bg-${statusTone(status)} ${className}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
