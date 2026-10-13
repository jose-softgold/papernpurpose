import { collection, doc, getDocs, getDoc, addDoc, updateDoc, query, where, orderBy, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Material } from '../types'
import { auditService } from './audit'

const col = collection(db, 'materials')

export const materialService = {
  async getAll(): Promise<Material[]> {
    const q = query(col, orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Material))
  },

  async getById(id: string): Promise<Material | null> {
    const snap = await getDoc(doc(db, 'materials', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Material
  },

  async create(data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ref = await addDoc(col, { ...data, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    await auditService.log({
      action: 'material.create',
      entityType: 'material',
      entityId: ref.id,
      after: { name: data.name },
    })
    return ref.id
  },

  async update(id: string, data: Partial<Material>): Promise<void> {
    await updateDoc(doc(db, 'materials', id), { ...data, updatedAt: serverTimestamp() })
  },

  /** Also drops recipe (BOM) lines that use this material. */
  async delete(id: string, name?: string): Promise<void> {
    const bomSnap = await getDocs(query(collection(db, 'bomItems'), where('materialId', '==', id)))
    const batch = writeBatch(db)
    bomSnap.docs.forEach(d => batch.delete(d.ref))
    batch.delete(doc(db, 'materials', id))
    await batch.commit()
    await auditService.log({ action: 'material.delete', entityType: 'material', entityId: id, before: { name: name ?? null } })
  },
}
