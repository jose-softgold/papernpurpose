interface Props { message: string; icon?: string }
export default function EmptyState({ message, icon = '📭' }: Props) {
  return (
    <div className="text-center p-5 text-muted">
      <div style={{ fontSize: '3rem' }}>{icon}</div>
      <p className="mt-2">{message}</p>
    </div>
  )
}
