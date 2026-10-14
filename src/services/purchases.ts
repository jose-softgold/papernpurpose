import { collection, doc, getDoc, getDocs, query, where, orderBy, serverTimestamp, writeBatch, Timestamp, WriteBatch } from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { Purchase, PurchaseItem } from '../types'
import { lineTax, roundMoney } from '../utils/tax'
import { createHash } from '../utils/hash'
import { auditService } from './audit'
import { inventoryService } from './inventory'

export function purchaseIsPaid(p: Purchase, bankPaid = 0): boolean {
  if (p.paymentStatus === 'paid') return true
  if (p.paymentStatus === 'unpaid') return false
  const total = Number(p.grandTotal ?? p.total ?? 0)
  return total > 0 && bankPaid + 0.009 >= total
}

export type PurchaseLine = {
  kind?: 'material' | 'charge'
  description?: string
  materialId: string
  quantity: number
  unitCost: number
  unit: string
  gstRate?: number
}

export const isChargeLine = (l: Pick<PurchaseLine, 'kind'>) => l.kind === 'charge'

export function pricePurchase(items: Array<Pick<PurchaseLine, 'kind' | 'quantity' | 'unitCost' | 'gstRate'>>) {
  const taxLines = items.map(i => lineTax(i.quantity, i.unitCost, i.gstRate ?? 0))
  const taxableSubtotal = roundMoney(taxLines.reduce((s, l) => s + l.taxableAmount, 0))
  const gstTotal = roundMoney(taxLines.reduce((s, l) => s + l.gstAmount, 0))
  const chargesTotal = roundMoney(items.reduce((s, item, idx) => s + (isChargeLine(item) ? taxLines[idx].lineTotal : 0), 0))
  return {
    taxLines,
    taxableSubtotal,
    gstTotal,
    chargesTotal,
    grandTotal: roundMoney(taxableSubtotal + gstTotal),
  }
}

function lineDoc(purchaseId: string, item: PurchaseLine, tax: ReturnType<typeof lineTax>, occasionSeasonId: string | null) {
  const charge = isChargeLine(item)
  return {
    purchaseId,
    occasionSeasonId,
    kind: charge ? 'charge' : 'material',
    description: charge ? (item.description ?? '').trim() : '',
    materialId: charge ? '' : item.materialId,
    quantity: item.quantity,
    unitCost: item.unitCost,
    total: tax.lineTotal,
    gstRate: item.gstRate ?? 0,
    taxableAmount: tax.taxableAmount,
    gstAmount: tax.gstAmount,
  }
}

/** Materials only admins/owners may update, so callers opt in for those roles. */
async function setLatestMaterialCosts(batch: WriteBatch, items: PurchaseLine[]) {
  const latest = new Map<string, PurchaseLine>()
  for (const item of items) {
    if (!isChargeLine(item) && item.materialId && Number(item.unitCost) > 0) latest.set(item.materialId, item)
  }
  const existing = await Promise.all([...latest.keys()].map(id => getDoc(doc(db, 'materials', id))))
  for (const snap of existing) {
    if (!snap.exists()) continue
    const item = latest.get(snap.id)!
    batch.update(snap.ref, {
      costPerUnit: Number(item.unitCost),
      gstRate: Number(item.gstRate ?? 0),
      updatedAt: serverTimestamp(),
    })
  }
}

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
    items: PurchaseLine[]
    billPhotoUrls?: string[]
    purchasedById?: string
    purchasedByName?: string
    paymentStatus?: 'paid' | 'unpaid'
    occasionSeasonId?: string | null
    updateMaterialCosts?: boolean
  }): Promise<string> {
    const batch = writeBatch(db)
    const { taxLines, taxableSubtotal, gstTotal, grandTotal, chargesTotal } = pricePurchase(params.items)
    const materialLines = params.items.filter(i => !isChargeLine(i))
    const createdBy = auth.currentUser?.uid ?? ''

    const purchaseRef = doc(collection(db, 'purchases'))
    batch.set(purchaseRef, {
      supplierId: params.supplierId,
      purchaseDate: params.purchaseDate,
      total: grandTotal,
      taxableSubtotal,
      gstTotal,
      grandTotal,
      chargesTotal,
      itemCount: materialLines.length,
      totalQty: materialLines.reduce((s, i) => s + i.quantity, 0),
      status: 'COMPLETED',
      notes: params.notes,
      billPhotoUrls: params.billPhotoUrls ?? [],
      occasionSeasonId: params.occasionSeasonId || null,
      ...(params.purchasedById
        ? {
            purchasedById: params.purchasedById,
            purchasedByName: params.purchasedByName ?? '',
          }
        : {}),
      paymentStatus: params.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      createdAt: serverTimestamp(),
    })

    params.items.forEach((item, idx) => {
      batch.set(doc(collection(db, 'purchaseItems')), lineDoc(purchaseRef.id, item, taxLines[idx], params.occasionSeasonId || null))
      if (isChargeLine(item)) return

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
    if (params.updateMaterialCosts) await setLatestMaterialCosts(batch, params.items)

    await batch.commit()
    await auditService.log({
      action: 'purchase.complete',
      entityType: 'purchase',
      entityId: purchaseRef.id,
      after: {
        supplierId: params.supplierId,
        grandTotal,
        chargesTotal,
        itemCount: params.items.length,
        purchasedById: params.purchasedById ?? null,
        purchasedByName: params.purchasedByName ?? null,
        paymentStatus: params.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      },
    })
    return purchaseRef.id
  },

  async listItems(): Promise<PurchaseItem[]> {
    const snap = await getDocs(collection(db, 'purchaseItems'))
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseItem))
  },

  async getItemsByMaterial(materialId: string): Promise<PurchaseItem[]> {
    const snap = await getDocs(
      query(collection(db, 'purchaseItems'), where('materialId', '==', materialId)),
    )
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseItem))
  },

  async getItems(purchaseId: string): Promise<PurchaseItem[]> {
    const snap = await getDocs(
      query(collection(db, 'purchaseItems'), where('purchaseId', '==', purchaseId)),
    )
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseItem))
  },

  async update(id: string, params: {
    supplierId: string
    purchaseDate: Timestamp
    notes: string
    items: PurchaseLine[]
    billPhotoUrls?: string[]
    purchasedById?: string
    purchasedByName?: string
    occasionSeasonId?: string | null
    updateMaterialCosts?: boolean
  }): Promise<void> {
    const existing = await this.getItems(id)
    const batch = writeBatch(db)
    const { taxLines, taxableSubtotal, gstTotal, grandTotal, chargesTotal } = pricePurchase(params.items)
    const materialLines = params.items.filter(i => !isChargeLine(i))
    const createdBy = auth.currentUser?.uid ?? ''

    batch.update(doc(db, 'purchases', id), {
      supplierId: params.supplierId,
      purchaseDate: params.purchaseDate,
      total: grandTotal,
      taxableSubtotal,
      gstTotal,
      grandTotal,
      chargesTotal,
      logistics: null,
      logisticsTotal: 0,
      itemCount: materialLines.length,
      totalQty: materialLines.reduce((s, i) => s + i.quantity, 0),
      notes: params.notes,
      billPhotoUrls: params.billPhotoUrls ?? [],
      purchasedById: params.purchasedById ?? '',
      purchasedByName: params.purchasedByName ?? '',
      occasionSeasonId: params.occasionSeasonId || null,
      updatedAt: serverTimestamp(),
    })

    for (const item of existing) {
      batch.delete(doc(db, 'purchaseItems', item.id))
    }
    params.items.forEach((item, idx) => {
      batch.set(doc(collection(db, 'purchaseItems')), lineDoc(id, item, taxLines[idx], params.occasionSeasonId || null))
    })

    const oldQty = new Map<string, { quantity: number; unit: string }>()
    for (const item of existing) {
      if (isChargeLine(item) || !item.materialId) continue
      const prev = oldQty.get(item.materialId)
      oldQty.set(item.materialId, {
        quantity: (prev?.quantity ?? 0) + item.quantity,
        unit: prev?.unit ?? '',
      })
    }
    const newQty = new Map<string, { quantity: number; unit: string }>()
    for (const item of materialLines) {
      const prev = newQty.get(item.materialId)
      newQty.set(item.materialId, {
        quantity: (prev?.quantity ?? 0) + item.quantity,
        unit: item.unit,
      })
    }
    for (const materialId of new Set([...oldQty.keys(), ...newQty.keys()])) {
      const before = oldQty.get(materialId)?.quantity ?? 0
      const after = newQty.get(materialId)?.quantity ?? 0
      const delta = after - before
      if (delta === 0) continue
      batch.set(doc(collection(db, 'inventoryTransactions')), {
        itemType: 'material',
        itemId: materialId,
        transactionType: 'PURCHASE',
        quantity: delta,
        unit: newQty.get(materialId)?.unit || oldQty.get(materialId)?.unit || '',
        referenceType: 'purchase',
        referenceId: id,
        notes: 'Purchase edited',
        createdAt: serverTimestamp(),
        createdBy,
      })
    }
    if (params.updateMaterialCosts) await setLatestMaterialCosts(batch, params.items)

    await batch.commit()
    await auditService.log({
      action: 'purchase.update',
      entityType: 'purchase',
      entityId: id,
      after: {
        supplierId: params.supplierId,
        grandTotal,
        chargesTotal,
        itemCount: params.items.length,
        purchasedById: params.purchasedById ?? null,
        purchasedByName: params.purchasedByName ?? null,
      },
    })
  },

  async delete(id: string): Promise<void> {
    const existing = await this.getItems(id)
    const batch = writeBatch(db)
    await inventoryService.reverseReference(batch, 'purchase', id, 'Purchase deleted')
    existing.forEach(item => batch.delete(doc(db, 'purchaseItems', item.id)))
    batch.delete(doc(db, 'purchases', id))
    await batch.commit()
    await auditService.log({ action: 'purchase.delete', entityType: 'purchase', entityId: id, before: { itemCount: existing.length } })
  },

  /** One cash payment that marks the selected open purchases as paid. */
  async settleWithCash(params: {
    purchaseIds: string[]
    amount: number
    occurredAt: Date
    notes?: string
    label?: string
  }): Promise<string> {
    const ids = [...new Set(params.purchaseIds.map(id => id.trim()).filter(Boolean))]
    if (!ids.length) throw new Error('Select at least one purchase')
    const amount = Math.abs(Number(params.amount))
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0')
    const occurredAt = params.occurredAt instanceof Date ? params.occurredAt : new Date(params.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid payment date')

    const fingerprint = createHash(
      ['cash-close', ids.join(','), amount.toFixed(2), occurredAt.toISOString(), String(Date.now())].join('|'),
    )
    const label = params.label?.trim() || `${ids.length} purchase${ids.length === 1 ? '' : 's'}`
    const notes = params.notes?.trim() || ''
    const batch = writeBatch(db)
    const bankRef = doc(collection(db, 'bankTransactions'))

    batch.set(bankRef, {
      gmailMessageId: `manual:${fingerprint}`,
      gmailThreadId: '',
      fingerprint,
      source: 'manual',
      occurredAt: Timestamp.fromDate(occurredAt),
      amount,
      direction: 'debit',
      currency: 'INR',
      bankName: null,
      accountLast4: null,
      counterparty: label,
      description: `Cash close · ${label}`,
      rawSubject: notes,
      snippet: '',
      parseConfidence: 1,
      parseNotes: 'Cash settlement closing purchases',
      status: 'matched',
      books: 'business',
      personalCategory: null,
      category: 'materials',
      workerId: null,
      orderId: null,
      purchaseId: ids.length === 1 ? ids[0] : null,
      purchaseIds: ids,
      materialId: null,
      productId: null,
      paymentKind: null,
      expenseKind: null,
      workerPayKind: null,
      tags: [],
      matchType: 'purchase',
      matchId: ids[0],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reviewedBy: auth.currentUser?.uid ?? '',
    })

    for (const id of ids) {
      batch.update(doc(db, 'purchases', id), {
        paymentStatus: 'paid',
        settlementTransactionId: bankRef.id,
      })
    }

    await batch.commit()
    await auditService.log({
      action: 'purchase.settle_cash',
      entityType: 'purchase',
      entityId: bankRef.id,
      after: { purchaseIds: ids, amount, label },
    })
    return bankRef.id
  },
}
