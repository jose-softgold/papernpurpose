import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { BomItem, Material } from '../types'
import { roundMoney } from '../utils/tax'

export function bomCostBreakdown(
  items: BomItem[],
  materials: Pick<Material, 'id' | 'costPerUnit' | 'gstRate'>[],
): { taxable: number; gst: number; total: number } {
  const map = Object.fromEntries(materials.map(m => [m.id, m]))
  let taxable = 0
  let gst = 0
  for (const b of items) {
    const mat = map[b.materialId]
    const line = b.quantity * (mat?.costPerUnit ?? 0)
    taxable += line
    gst += line * ((mat?.gstRate ?? 0) / 100)
  }
  return {
    taxable: roundMoney(taxable),
    gst: roundMoney(gst),
    total: roundMoney(taxable + gst),
  }
}

/** Landed material cost per finished item, including GST paid on materials. */
export function bomCostPerItem(
  items: BomItem[],
  materials: Pick<Material, 'id' | 'costPerUnit' | 'gstRate'>[],
): number {
  return bomCostBreakdown(items, materials).total
}

const col = collection(db, 'bomItems')

export const bomService = {
  async getByVersionId(productVersionId: string): Promise<BomItem[]> {
    const q = query(col, where('productVersionId', '==', productVersionId))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BomItem))
  },

  async getByMaterialId(materialId: string): Promise<BomItem[]> {
    const q = query(col, where('materialId', '==', materialId))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BomItem))
  },

  async getAll(): Promise<BomItem[]> {
    const snap = await getDocs(col)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BomItem))
  },

  async create(item: Omit<BomItem, 'id'>): Promise<string> {
    const ref = await addDoc(col, item)
    return ref.id
  },

  async update(id: string, data: Partial<BomItem>): Promise<void> {
    await updateDoc(doc(db, 'bomItems', id), data)
  },

  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, 'bomItems', id))
  },
}
