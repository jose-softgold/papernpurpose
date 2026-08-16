import { collection, doc, getDocs, getDoc, addDoc, updateDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Product, ProductVersion } from '../types'

export const productService = {
  async getAll(): Promise<Product[]> {
    const q = query(collection(db, 'products'), orderBy('name'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
  },

  async getById(id: string): Promise<Product | null> {
    const snap = await getDoc(doc(db, 'products', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Product
  },

  async create(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ref = await addDoc(collection(db, 'products'), {
      ...data, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async update(id: string, data: Partial<Product>): Promise<void> {
    await updateDoc(doc(db, 'products', id), { ...data, updatedAt: serverTimestamp() })
  },

  async getVersions(productId: string): Promise<ProductVersion[]> {
    const q = query(
      collection(db, 'productVersions'),
      where('productId', '==', productId),
      orderBy('version'),
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductVersion))
  },

  async getActiveVersion(productId: string): Promise<ProductVersion | null> {
    const versions = await productService.getVersions(productId)
    return versions.filter(v => v.status === 'active').at(-1) ?? null
  },

  async createVersion(data: Omit<ProductVersion, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ref = await addDoc(collection(db, 'productVersions'), {
      ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async updateVersion(id: string, data: Partial<ProductVersion>): Promise<void> {
    await updateDoc(doc(db, 'productVersions', id), { ...data, updatedAt: serverTimestamp() })
  },

  async getAllVersions(): Promise<ProductVersion[]> {
    const snap = await getDocs(collection(db, 'productVersions'))
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductVersion))
  },
}
