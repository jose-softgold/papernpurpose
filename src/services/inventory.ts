import { collection, doc, getDocs, addDoc, query, where, orderBy, serverTimestamp, WriteBatch } from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { InventoryTransaction, TransactionType } from '../types'

const col = collection(db, 'inventoryTransactions')

const UNASSIGNED_KEY = '__unassigned__'

export type ProductStockBySeason = Record<string, Record<string, number>>

export interface StockTarget {
  itemType: 'material' | 'product'
  itemId: string
  unit: string
  quantity: number
  occasionSeasonId?: string | null
}

export const inventoryService = {
  async getStock(itemType: string, itemId: string): Promise<number> {
    const q = query(col, where('itemType', '==', itemType), where('itemId', '==', itemId))
    const snap = await getDocs(q)
    return snap.docs.reduce((sum, d) => sum + (d.data().quantity as number), 0)
  },

  async getStockForSeason(itemType: 'product', itemId: string, occasionSeasonId: string | null): Promise<number> {
    const q = query(col, where('itemType', '==', itemType), where('itemId', '==', itemId))
    const snap = await getDocs(q)
    return snap.docs.reduce((sum, d) => {
      const data = d.data()
      const seasonId = (data.occasionSeasonId as string | null | undefined) ?? null
      if (seasonId !== occasionSeasonId) return sum
      return sum + (data.quantity as number)
    }, 0)
  },

  async getMaterialStocks(): Promise<Record<string, number>> {
    const q = query(col, where('itemType', '==', 'material'))
    const snap = await getDocs(q)
    const stocks: Record<string, number> = {}
    snap.docs.forEach(d => {
      const { itemId, quantity } = d.data()
      stocks[itemId] = (stocks[itemId] ?? 0) + quantity
    })
    return stocks
  },

  async getProductStocks(): Promise<Record<string, number>> {
    const q = query(col, where('itemType', '==', 'product'))
    const snap = await getDocs(q)
    const stocks: Record<string, number> = {}
    snap.docs.forEach(d => {
      const { itemId, quantity } = d.data()
      stocks[itemId] = (stocks[itemId] ?? 0) + quantity
    })
    return stocks
  },

  /** Per-product stock split by occasionSeasonId; null season → UNASSIGNED_KEY */
  async getProductStocksBySeason(): Promise<ProductStockBySeason> {
    const q = query(col, where('itemType', '==', 'product'))
    const snap = await getDocs(q)
    const stocks: ProductStockBySeason = {}
    snap.docs.forEach(d => {
      const { itemId, quantity, occasionSeasonId } = d.data()
      const key = (occasionSeasonId as string | null | undefined) ?? UNASSIGNED_KEY
      if (!stocks[itemId]) stocks[itemId] = {}
      stocks[itemId][key] = (stocks[itemId][key] ?? 0) + quantity
    })
    return stocks
  },

  unassignedSeasonKey: UNASSIGNED_KEY,

  async addTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<string> {
    const ref = await addDoc(col, { ...tx, createdAt: serverTimestamp() })
    return ref.id
  },

  /**
   * Ledger rows cannot be edited or deleted, so this posts ADJUSTMENT rows that bring
   * the net movement of one purchase, batch, or sale to `targets`. Items left out of
   * `targets` are brought back to zero. Returns how many rows were added.
   */
  async adjustReferenceTo(
    batch: WriteBatch,
    referenceType: string,
    referenceId: string,
    targets: StockTarget[],
    notes: string,
  ): Promise<number> {
    const snap = await getDocs(query(col, where('referenceType', '==', referenceType), where('referenceId', '==', referenceId)))
    const keyOf = (itemType: string, itemId: string, seasonId: string | null) => `${itemType}|${itemId}|${seasonId ?? ''}`
    const rows = new Map<string, StockTarget & { current: number; target: number }>()
    for (const d of snap.docs) {
      const t = d.data() as InventoryTransaction
      const seasonId = t.occasionSeasonId ?? null
      const key = keyOf(t.itemType, t.itemId, seasonId)
      const prev = rows.get(key)
      rows.set(key, {
        itemType: t.itemType,
        itemId: t.itemId,
        unit: prev?.unit || t.unit || '',
        occasionSeasonId: seasonId,
        quantity: 0,
        current: (prev?.current ?? 0) + Number(t.quantity || 0),
        target: 0,
      })
    }
    for (const t of targets) {
      const seasonId = t.occasionSeasonId ?? null
      const key = keyOf(t.itemType, t.itemId, seasonId)
      const prev = rows.get(key)
      rows.set(key, {
        ...t,
        unit: t.unit || prev?.unit || '',
        occasionSeasonId: seasonId,
        current: prev?.current ?? 0,
        target: (prev?.target ?? 0) + t.quantity,
      })
    }
    let written = 0
    for (const row of rows.values()) {
      const delta = row.target - row.current
      if (Math.abs(delta) < 1e-9) continue
      batch.set(doc(col), {
        itemType: row.itemType,
        itemId: row.itemId,
        transactionType: 'ADJUSTMENT',
        quantity: delta,
        unit: row.unit,
        referenceType,
        referenceId,
        notes,
        occasionSeasonId: row.occasionSeasonId ?? null,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid ?? '',
      })
      written++
    }
    return written
  },

  /** Puts back everything a purchase, batch, or sale moved, before the record is deleted. */
  reverseReference(batch: WriteBatch, referenceType: string, referenceId: string, notes: string): Promise<number> {
    return inventoryService.adjustReferenceTo(batch, referenceType, referenceId, [], notes)
  },

  async getTransactions(filters?: { itemType?: string; itemId?: string; transactionType?: TransactionType }): Promise<InventoryTransaction[]> {
    const q = query(col, orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    let txs = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryTransaction))
    if (filters?.itemType) txs = txs.filter(t => t.itemType === filters.itemType)
    if (filters?.itemId) txs = txs.filter(t => t.itemId === filters.itemId)
    if (filters?.transactionType) txs = txs.filter(t => t.transactionType === filters.transactionType)
    return txs
  },
}
