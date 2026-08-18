interface Props {
  message: string
  icon?: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ message, icon = '📭', description, action }: Props) {
  return (
    <div className="pc-empty">
      <div className="pc-empty-icon">{icon}</div>
      <div className="fw-semibold">{message}</div>
      {description && (
        <p className="text-muted small mt-1 mb-0 mx-auto" style={{ maxWidth: 380 }}>
          {description}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
