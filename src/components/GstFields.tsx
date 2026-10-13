import { useGstSlabs } from '../hooks/useGstSlabs'

export function GstRateSelect({
  value,
  onChange,
  id,
  label = 'GST rate',
  rates: ratesProp,
  className = 'form-select',
  compact = false,
  disabled = false,
}: {
  value: number | string
  onChange: (rate: number) => void
  id?: string
  label?: string | null
  /** Override slabs (e.g. already loaded). When omitted, loads from Settings. */
  rates?: number[]
  className?: string
  compact?: boolean
  disabled?: boolean
}) {
  const { rates: loaded } = useGstSlabs()
  const rates = ratesProp?.length ? ratesProp : loaded
  const current = String(value || 0)
  const options = rates.includes(Number(current))
    ? rates
    : [...rates, Number(current)].filter(n => Number.isFinite(n)).sort((a, b) => a - b)

  const select = (
    <select
      id={id}
      className={className}
      value={current}
      disabled={disabled}
      onChange={e => onChange(Number(e.target.value))}
    >
      {options.map(rate => (
        <option key={rate} value={rate}>{rate}%</option>
      ))}
    </select>
  )

  if (compact || label === null) return select

  return (
    <div>
      {label && <label className="form-label" htmlFor={id}>{label}</label>}
      {select}
    </div>
  )
}
