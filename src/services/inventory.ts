import { collection, getDocs, addDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { InventoryTransaction, TransactionType } from '../types'

const col = collection(db, 'inventoryTransactions')

export const inventoryService = {
  async getStock(itemType: string, itemId: string): Promise<number> {
    const q = query(col, where('itemType', '==', itemType), where('itemId', '==', itemId))
    const snap = await getDocs(q)
    return snap.docs.reduce((sum, d) => sum + (d.data().quantity as number), 0)
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
