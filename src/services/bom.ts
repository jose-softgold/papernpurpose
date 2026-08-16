import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { BomItem } from '../types'

const col = collection(db, 'bomItems')

export const bomService = {
  async getByVersionId(productVersionId: string): Promise<BomItem[]> {
    const q = query(col, where('productVersionId', '==', productVersionId))
    const snap = await getDocs(q)
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
