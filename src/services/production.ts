import {
  collection, doc, getDocs, query, where, orderBy, serverTimestamp, writeBatch, Timestamp, getDoc, updateDoc,
} from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { Production, ProductionMaterial } from '../types'
import { auditService } from './audit'

function actorId() {
  return auth.currentUser?.uid ?? ''
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function formatBatchCode(date: Date, seq: number) {
  return `PC-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(seq)}`
}

export const productionService = {
  async getAll(assignedToUid?: string): Promise<Production[]> {
    if (assignedToUid) {
      const q = query(
        collection(db, 'productions'),
        where('assignedWorkerIds', 'array-contains', assignedToUid),
      )
      const snap = await getDocs(q)
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Production))
        .sort((a, b) => (b.productionDate?.toMillis?.() ?? 0) - (a.productionDate?.toMillis?.() ?? 0))
    }
    const q = query(collection(db, 'productions'), orderBy('productionDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Production))
  },

  async getById(id: string): Promise<Production | null> {
    const snap = await getDoc(doc(db, 'productions', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Production
  },

  async getByProductId(productId: string): Promise<Production[]> {
    const all = await productionService.getAll()
    return all.filter(p => p.productId === productId)
  },

  async getMaterials(productionId: string): Promise<ProductionMaterial[]> {
    const snap = await getDocs(collection(db, 'productionMaterials'))
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as ProductionMaterial))
      .filter(m => m.productionId === productionId)
  },

  async nextBatchCode(date: Date): Promise<string> {
    const all = await productionService.getAll()
    const prefix = `PC-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-`
    const seqs = all
      .map(p => p.batchCode ?? '')
      .filter(c => c.startsWith(prefix))
      .map(c => Number(c.slice(prefix.length)) || 0)
    const next = (seqs.length ? Math.max(...seqs) : 0) + 1
    return formatBatchCode(date, next)
  },

  async start(params: {
    productId: string
    productVersionId: string
    expectedQuantity: number
    productionDate: Timestamp
    notes: string
    orderId?: string | null
    batchCode?: string
    occasionSeasonId?: string | null
    assignedWorkerIds?: string[]
    assignedWorkerNames?: string[]
    assignedBy?: string
    bomMaterials: Array<{ materialId: string; plannedQty: number; unitCost: number; unit: string }>
  }): Promise<string> {
    const batch = writeBatch(db)
    const expected = params.expectedQuantity
    const plannedCost = params.bomMaterials.reduce(
      (sum, m) => sum + m.plannedQty * expected * m.unitCost,
      0,
    )
    const prodRef = doc(collection(db, 'productions'))
    const d = params.productionDate.toDate()
    const batchCode = params.batchCode || `PC-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${prodRef.id.slice(0, 4).toUpperCase()}`
    batch.set(prodRef, {
      productId: params.productId,
      productVersionId: params.productVersionId,
      quantity: expected,
      expectedQuantity: expected,
      actualQuantity: 0,
      wasteQuantity: 0,
      batchCode,
      orderId: params.orderId ?? null,
      occasionSeasonId: params.occasionSeasonId ?? null,
      productionDate: params.productionDate,
      totalMaterialCost: plannedCost,
      costPerUnit: expected ? plannedCost / expected : 0,
      status: 'IN_PROGRESS',
      notes: params.notes,
      assignedWorkerIds: params.assignedWorkerIds ?? [],
      assignedWorkerNames: params.assignedWorkerNames ?? [],
      assignedAt: params.assignedWorkerIds?.length ? serverTimestamp() : null,
      assignedBy: params.assignedBy ?? '',
      createdAt: serverTimestamp(),
    })

    for (const m of params.bomMaterials) {
      const plannedQuantity = m.plannedQty * expected
      const pmRef = doc(collection(db, 'productionMaterials'))
      batch.set(pmRef, {
        productionId: prodRef.id,
        materialId: m.materialId,
        plannedQuantity,
        actualQuantity: 0,
        wasteQuantity: 0,
        unitCost: m.unitCost,
        totalCost: 0,
        unit: m.unit,
      })
    }

    await batch.commit()
    await auditService.log({
      action: 'production.start',
      entityType: 'production',
      entityId: prodRef.id,
      after: { batchCode, expectedQuantity: expected, productId: params.productId },
    })
    return prodRef.id
  },

  async complete(params: {
    productionId?: string
    productId: string
    productVersionId: string
    expectedQuantity: number
    actualQuantity: number
    productionDate: Timestamp
    notes: string
    orderId?: string | null
    batchCode?: string
    occasionSeasonId?: string | null
    assignedWorkerIds?: string[]
    assignedWorkerNames?: string[]
    assignedBy?: string
    bomMaterials: Array<{
      materialId: string
      plannedQty: number
      actualQty: number
      unitCost: number
      unit: string
    }>
  }): Promise<string> {
    const batch = writeBatch(db)
    const expected = params.expectedQuantity
    const actual = params.actualQuantity
    const wasteFg = Math.max(0, expected - actual)
    const createdBy = actorId()

    const totalMaterialCost = params.bomMaterials.reduce(
      (sum, m) => sum + m.actualQty * m.unitCost,
      0,
    )
    const costPerUnit = actual > 0 ? totalMaterialCost / actual : 0

    const prodRef = params.productionId
      ? doc(db, 'productions', params.productionId)
      : doc(collection(db, 'productions'))
    const d = params.productionDate.toDate()
    const batchCode = params.batchCode
      || `PC-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${prodRef.id.slice(0, 4).toUpperCase()}`

    const productionFields = {
      productId: params.productId,
      productVersionId: params.productVersionId,
      quantity: actual,
      expectedQuantity: expected,
      actualQuantity: actual,
      wasteQuantity: wasteFg,
      batchCode,
      orderId: params.orderId ?? null,
      occasionSeasonId: params.occasionSeasonId ?? null,
      productionDate: params.productionDate,
      totalMaterialCost,
      costPerUnit,
      status: 'COMPLETED' as const,
      notes: params.notes,
      assignedWorkerIds: params.assignedWorkerIds ?? [],
      assignedWorkerNames: params.assignedWorkerNames ?? [],
      assignedAt: params.assignedWorkerIds?.length ? serverTimestamp() : null,
      assignedBy: params.assignedBy ?? '',
    }

    if (params.productionId) {
      batch.update(prodRef, productionFields)
    } else {
      batch.set(prodRef, { ...productionFields, createdAt: serverTimestamp() })
    }

    if (params.productionId) {
      const existing = await productionService.getMaterials(params.productionId)
      for (const row of existing) {
        batch.delete(doc(db, 'productionMaterials', row.id))
      }
    }

    for (const m of params.bomMaterials) {
      const plannedQuantity = m.plannedQty * expected
      const actualQuantity = m.actualQty
      const wasteQuantity = Math.max(0, actualQuantity - plannedQuantity)
      const consumedPlanned = Math.min(actualQuantity, plannedQuantity)
      const totalCost = actualQuantity * m.unitCost

      const pmRef = doc(collection(db, 'productionMaterials'))
      batch.set(pmRef, {
        productionId: prodRef.id,
        materialId: m.materialId,
        plannedQuantity,
        actualQuantity,
        wasteQuantity,
        unitCost: m.unitCost,
        totalCost,
      })

      if (consumedPlanned > 0) {
        const txRef = doc(collection(db, 'inventoryTransactions'))
        batch.set(txRef, {
          itemType: 'material',
          itemId: m.materialId,
          transactionType: 'CONSUMPTION',
          quantity: -consumedPlanned,
          unit: m.unit,
          referenceType: 'production',
          referenceId: prodRef.id,
          notes: `Batch ${batchCode} consumption`,
          createdAt: serverTimestamp(),
          createdBy,
        })
      }

      if (wasteQuantity > 0) {
        const wasteRef = doc(collection(db, 'inventoryTransactions'))
        batch.set(wasteRef, {
          itemType: 'material',
          itemId: m.materialId,
          transactionType: 'WASTE',
          quantity: -wasteQuantity,
          unit: m.unit,
          referenceType: 'production',
          referenceId: prodRef.id,
          notes: `Batch ${batchCode} extra usage vs plan`,
          createdAt: serverTimestamp(),
          createdBy,
        })
      }
    }

    const finishedTxRef = doc(collection(db, 'inventoryTransactions'))
    batch.set(finishedTxRef, {
      itemType: 'product',
      itemId: params.productId,
      transactionType: 'PRODUCTION',
      quantity: actual,
      unit: 'units',
      referenceType: 'production',
      referenceId: prodRef.id,
      notes: `Batch ${batchCode}`,
      occasionSeasonId: params.occasionSeasonId ?? null,
      createdAt: serverTimestamp(),
      createdBy,
    })

    await batch.commit()
    await auditService.log({
      action: 'production.complete',
      entityType: 'production',
      entityId: prodRef.id,
      after: { batchCode, expectedQuantity: expected, actualQuantity: actual },
    })
    return prodRef.id
  },

  async assign(id: string, workerIds: string[], workerNames: string[], assignedBy: string): Promise<void> {
    await updateDoc(doc(db, 'productions', id), {
      assignedWorkerIds: workerIds,
      assignedWorkerNames: workerNames,
      assignedAt: serverTimestamp(),
      assignedBy,
    })
    await auditService.log({
      action: 'production.assign',
      entityType: 'production',
      entityId: id,
      after: { assignedWorkerIds: workerIds, assignedWorkerNames: workerNames },
    })
  },
}
