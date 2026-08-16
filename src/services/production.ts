import {
  collection, doc, getDocs, query, orderBy, serverTimestamp, writeBatch, Timestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Production, ProductionMaterial } from '../types'

export const productionService = {
  async getAll(): Promise<Production[]> {
    const q = query(collection(db, 'productions'), orderBy('productionDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Production))
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

  async complete(params: {
    productId: string
    productVersionId: string
    quantity: number
    productionDate: Timestamp
    notes: string
    bomMaterials: Array<{ materialId: string; plannedQty: number; unitCost: number; unit: string }>
  }): Promise<string> {
    const batch = writeBatch(db)

    const totalMaterialCost = params.bomMaterials.reduce(
      (sum, m) => sum + m.plannedQty * params.quantity * m.unitCost,
      0
    )
    const costPerUnit = totalMaterialCost / params.quantity

    const prodRef = doc(collection(db, 'productions'))
    batch.set(prodRef, {
      productId: params.productId,
      productVersionId: params.productVersionId,
      quantity: params.quantity,
      productionDate: params.productionDate,
      totalMaterialCost,
      costPerUnit,
      status: 'COMPLETED',
      notes: params.notes,
      createdAt: serverTimestamp(),
    })

    for (const m of params.bomMaterials) {
      const totalQty = m.plannedQty * params.quantity
      const totalCost = totalQty * m.unitCost

      const pmRef = doc(collection(db, 'productionMaterials'))
      batch.set(pmRef, {
        productionId: prodRef.id,
        materialId: m.materialId,
        plannedQuantity: totalQty,
        actualQuantity: totalQty,
        wasteQuantity: 0,
        unitCost: m.unitCost,
        totalCost,
      })

      const txRef = doc(collection(db, 'inventoryTransactions'))
      batch.set(txRef, {
        itemType: 'material',
        itemId: m.materialId,
        transactionType: 'CONSUMPTION',
        quantity: -totalQty,
        unit: m.unit,
        referenceType: 'production',
        referenceId: prodRef.id,
        notes: `Production of ${params.quantity} units`,
        createdAt: serverTimestamp(),
      })
    }

    const finishedTxRef = doc(collection(db, 'inventoryTransactions'))
    batch.set(finishedTxRef, {
      itemType: 'product',
      itemId: params.productId,
      transactionType: 'PRODUCTION',
      quantity: params.quantity,
      unit: 'units',
      referenceType: 'production',
      referenceId: prodRef.id,
      notes: 'Completed production run',
      createdAt: serverTimestamp(),
    })

    await batch.commit()
    return prodRef.id
  },
}
