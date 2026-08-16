import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc,
  query, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Customer } from '../types'

const col = collection(db, 'customers')

export const customerService = {
  async getAll(): Promise<Customer[]> {
    const q = query(col, orderBy('name'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer))
  },

  async getById(id: string): Promise<Customer | null> {
    const snap = await getDoc(doc(db, 'customers', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Customer
  },

  async create(data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ref = await addDoc(col, {
      ...data,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async update(id: string, data: Partial<Customer>): Promise<void> {
    await updateDoc(doc(db, 'customers', id), { ...data, updatedAt: serverTimestamp() })
  },

  async toggleStatus(id: string, current: 'active' | 'inactive'): Promise<void> {
    const next = current === 'active' ? 'inactive' : 'active'
    await updateDoc(doc(db, 'customers', id), { status: next, updatedAt: serverTimestamp() })
  },
}
