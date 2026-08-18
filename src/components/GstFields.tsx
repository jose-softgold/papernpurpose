import { GST_RATE_OPTIONS } from '../utils/tax'

export function GstRateSelect({
  value,
  onChange,
  id,
  label = 'GST rate',
}: {
  value: number | string
  onChange: (rate: number) => void
  id?: string
  label?: string
}) {
  return (
    <div>
      {label && <label className="form-label" htmlFor={id}>{label}</label>}
      <select
        id={id}
        className="form-select"
        value={String(value || 0)}
        onChange={e => onChange(Number(e.target.value))}
      >
        {GST_RATE_OPTIONS.map(rate => (
          <option key={rate} value={rate}>{rate}%</option>
        ))}
      </select>
    </div>
  )
}
