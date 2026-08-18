import { collection, doc, getDocs, query, orderBy, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { Purchase } from '../types'
import { lineTax, roundMoney } from '../utils/tax'
import { auditService } from './audit'

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
    items: Array<{ materialId: string; quantity: number; unitCost: number; unit: string; gstRate?: number }>
    billPhotoUrls?: string[]
  }): Promise<string> {
    const batch = writeBatch(db)
    const taxLines = params.items.map(i => lineTax(i.quantity, i.unitCost, i.gstRate ?? 0))
    const taxableSubtotal = roundMoney(taxLines.reduce((s, l) => s + l.taxableAmount, 0))
    const gstTotal = roundMoney(taxLines.reduce((s, l) => s + l.gstAmount, 0))
    const grandTotal = roundMoney(taxableSubtotal + gstTotal)
    const createdBy = auth.currentUser?.uid ?? ''

    const purchaseRef = doc(collection(db, 'purchases'))
    batch.set(purchaseRef, {
      supplierId: params.supplierId,
      purchaseDate: params.purchaseDate,
      total: grandTotal,
      taxableSubtotal,
      gstTotal,
      grandTotal,
      itemCount: params.items.length,
      totalQty: params.items.reduce((s, i) => s + i.quantity, 0),
      status: 'COMPLETED',
      notes: params.notes,
      billPhotoUrls: params.billPhotoUrls ?? [],
      createdAt: serverTimestamp(),
    })

    params.items.forEach((item, idx) => {
      const tax = taxLines[idx]
      const piRef = doc(collection(db, 'purchaseItems'))
      batch.set(piRef, {
        purchaseId: purchaseRef.id,
        materialId: item.materialId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        total: tax.lineTotal,
        gstRate: item.gstRate ?? 0,
        taxableAmount: tax.taxableAmount,
        gstAmount: tax.gstAmount,
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
        createdBy,
      })
    })

    await batch.commit()
    await auditService.log({
      action: 'purchase.complete',
      entityType: 'purchase',
      entityId: purchaseRef.id,
      after: { supplierId: params.supplierId, grandTotal, itemCount: params.items.length },
    })
    return purchaseRef.id
  },
}
