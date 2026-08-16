interface Toast { id: number; message: string; type: string }
interface Props { toasts: Toast[] }
export default function ToastContainer({ toasts }: Props) {
  return (
    <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 9999 }}>
      {toasts.map(t => (
        <div key={t.id} className={`toast show align-items-center text-bg-${t.type} border-0 mb-2`}>
          <div className="d-flex">
            <div className="toast-body">{t.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
