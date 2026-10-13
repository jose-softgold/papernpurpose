import { useEffect, useState } from 'react'
import { settingsService } from '../services/settings'
import { DEFAULT_GST_RATES } from '../types'

/** Loads company GST slabs from Settings (`meta/gstSlabs`), with built-in fallback. */
export function useGstSlabs() {
  const [rates, setRates] = useState<number[]>([...DEFAULT_GST_RATES])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    settingsService.getGstSlabs()
      .then(s => {
        if (!cancelled) setRates(s.rates)
      })
      .catch(() => {
        if (!cancelled) setRates([...DEFAULT_GST_RATES])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { rates, loading }
}
