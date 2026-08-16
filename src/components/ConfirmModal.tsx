interface Props {
  show: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}
export default function ConfirmModal({ show, title, message, confirmLabel = 'Confirm', onConfirm, onCancel }: Props) {
  if (!show) return null
  return (
    <>
      <div className="modal-backdrop fade show" />
      <div className="modal d-block" tabIndex={-1}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button className="btn-close" onClick={onCancel} />
            </div>
            <div className="modal-body"><p>{message}</p></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
              <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
