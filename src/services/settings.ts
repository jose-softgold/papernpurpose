import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { GstSlabsSettings, PricingSettings } from '../types'
import { DEFAULT_GST_RATES } from '../types'
import { clampTargetMargin, DEFAULT_TARGET_MARGIN_PCT, normalizeGstRates } from '../utils/tax'

const PRICING_DOC = 'pricing'
const GST_SLABS_DOC = 'gstSlabs'

export const settingsService = {
  async getPricing(): Promise<PricingSettings> {
    const snap = await getDoc(doc(db, 'meta', PRICING_DOC))
    if (!snap.exists()) {
      return { targetMarginPct: DEFAULT_TARGET_MARGIN_PCT }
    }
    const data = snap.data()
    return {
      targetMarginPct: clampTargetMargin(data.targetMarginPct, DEFAULT_TARGET_MARGIN_PCT),
    }
  },

  async setPricing(data: PricingSettings): Promise<void> {
    await setDoc(
      doc(db, 'meta', PRICING_DOC),
      {
        targetMarginPct: clampTargetMargin(data.targetMarginPct, DEFAULT_TARGET_MARGIN_PCT),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  },

  async getGstSlabs(): Promise<GstSlabsSettings> {
    const snap = await getDoc(doc(db, 'meta', GST_SLABS_DOC))
    if (!snap.exists()) {
      return { rates: [...DEFAULT_GST_RATES] }
    }
    return { rates: normalizeGstRates(snap.data()?.rates) }
  },

  async setGstSlabs(data: GstSlabsSettings): Promise<void> {
    const rates = normalizeGstRates(data.rates)
    await setDoc(
      doc(db, 'meta', GST_SLABS_DOC),
      {
        rates,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  },
}
