import { collection, getDocs, addDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { InventoryTransaction, TransactionType } from '../types'

const col = collection(db, 'inventoryTransactions')

const UNASSIGNED_KEY = '__unassigned__'

export type ProductStockBySeason = Record<string, Record<string, number>>

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
