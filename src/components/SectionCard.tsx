interface Props {
  title?: string
  subtitle?: string
  icon?: string
  actions?: React.ReactNode
  /** Drop the card body padding, e.g. when the content is a full-bleed table */
  flush?: boolean
  className?: string
  children: React.ReactNode
}

export default function SectionCard({
  title,
  subtitle,
  icon,
  actions,
  flush,
  className = '',
  children,
}: Props) {
  return (
    <div className={`card h-100 ${className}`}>
      {(title || actions) && (
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div className="d-flex align-items-center gap-2">
            {icon && <span>{icon}</span>}
            <div>
              <span className="fw-semibold">{title}</span>
              {subtitle && <div className="small text-muted fw-normal">{subtitle}</div>}
            </div>
          </div>
          {actions && <div className="d-flex flex-wrap align-items-center gap-2">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className="card-body">{children}</div>}
    </div>
  )
}
