interface Props {
  title: string
  subtitle?: string
  icon?: string
  actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, icon, actions }: Props) {
  return (
    <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
      <div className="d-flex align-items-center gap-2">
        {icon && <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{icon}</span>}
        <div>
          <h4 className="pc-page-title">{title}</h4>
          {subtitle && <p className="pc-page-sub">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="d-flex flex-wrap align-items-center gap-2">{actions}</div>}
    </div>
  )
}
