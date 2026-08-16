import { useState, useCallback } from 'react'

interface Toast { id: number; message: string; type: 'success' | 'danger' | 'warning' }

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: 'success' | 'danger' | 'warning' = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  return { toasts, showToast }
}
