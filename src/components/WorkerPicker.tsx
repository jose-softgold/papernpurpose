import type { WorkerOption } from '../types'

export default function WorkerPicker({
  workers,
  selectedIds,
  onChange,
  label = 'Assigned workers',
}: {
  workers: WorkerOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  label?: string
}) {
  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }

  return (
    <div>
      <label className="form-label">{label}</label>
      {workers.length === 0 ? (
        <div className="form-control bg-light text-muted">No active workers</div>
      ) : (
        <div className="border rounded p-2" style={{ maxHeight: 160, overflowY: 'auto' }}>
          {workers.map(w => (
            <label key={w.id} className="form-check d-flex align-items-center gap-2 mb-1">
              <input
                className="form-check-input"
                type="checkbox"
                checked={selectedIds.includes(w.id)}
                onChange={() => toggle(w.id)}
              />
              <span>{w.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
