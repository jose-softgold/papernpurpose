import { collection, doc, getDocs, query, orderBy, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Purchase } from '../types'

export const purchaseService = {
  async getAll(): Promise<Purchase[]> {
    const q = query(collection(db, 'purchases'), orderBy('purchaseDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Purchase))
  },

  async complete(params: {
    supplierId: string
    purchaseDate: Timestamp
    notes: string
    items: Array<{ materialId: string; quantity: number; unitCost: number; unit: string }>
    billPhotoUrls?: string[]
  }): Promise<string> {
    const batch = writeBatch(db)
    const total = params.items.reduce((s, i) => s + i.quantity * i.unitCost, 0)

    const purchaseRef = doc(collection(db, 'purchases'))
    batch.set(purchaseRef, {
      supplierId: params.supplierId,
      purchaseDate: params.purchaseDate,
      total,
      itemCount: params.items.length,
      totalQty: params.items.reduce((s, i) => s + i.quantity, 0),
      status: 'COMPLETED',
      notes: params.notes,
      billPhotoUrls: params.billPhotoUrls ?? [],
      createdAt: serverTimestamp(),
    })

    for (const item of params.items) {
      const piRef = doc(collection(db, 'purchaseItems'))
      batch.set(piRef, {
        purchaseId: purchaseRef.id,
        materialId: item.materialId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        total: item.quantity * item.unitCost,
      })

      const txRef = doc(collection(db, 'inventoryTransactions'))
      batch.set(txRef, {
        itemType: 'material',
        itemId: item.materialId,
        transactionType: 'PURCHASE',
        quantity: item.quantity,
        unit: item.unit,
        referenceType: 'purchase',
        referenceId: purchaseRef.id,
        notes: 'Purchase from supplier',
        createdAt: serverTimestamp(),
      })
    }

    await batch.commit()
    return purchaseRef.id
  },
}
