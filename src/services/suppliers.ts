import { collection, doc, getDocs, getDoc, addDoc, updateDoc, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Supplier } from '../types'

const col = collection(db, 'suppliers')

export const supplierService = {
  async getAll(): Promise<Supplier[]> {
    const q = query(col, orderBy('name'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier))
  },

  async getById(id: string): Promise<Supplier | null> {
    const snap = await getDoc(doc(db, 'suppliers', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Supplier
  },

  async create(data: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ref = await addDoc(col, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return ref.id
  },

  async update(id: string, data: Partial<Supplier>): Promise<void> {
    await updateDoc(doc(db, 'suppliers', id), { ...data, updatedAt: serverTimestamp() })
  },

  async toggleStatus(id: string, current: 'active' | 'inactive'): Promise<void> {
    const next = current === 'active' ? 'inactive' : 'active'
    await updateDoc(doc(db, 'suppliers', id), { status: next, updatedAt: serverTimestamp() })
  },
}
