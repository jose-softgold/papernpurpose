export default function QuickSelect({
  label,
  required,
  value,
  onChange,
  placeholder,
  options,
  onAdd,
  addLabel = '+ New',
}: {
  label: string
  required?: boolean
  value: string
  onChange: (id: string) => void
  placeholder: string
  options: Array<{ id: string; label: string }>
  onAdd?: () => void
  addLabel?: string
}) {
  return (
    <div>
      <label className="form-label">
        {label}{required && <span className="text-danger"> *</span>}
      </label>
      <div className="d-flex gap-2">
        <select
          className="form-select"
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
        >
          <option value="">{placeholder}</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {onAdd && (
          <button type="button" className="btn btn-outline-primary text-nowrap" onClick={onAdd}>
            {addLabel}
          </button>
        )}
      </div>
    </div>
  )
}
