import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, query, where, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Product, ProductVersion } from '../types'
import { sortByNewest } from '../utils/sort'
import { bomService } from './bom'
import { auditService } from './audit'

function nextVersionLabel(existing: ProductVersion[]): string {
  let max = 0
  for (const v of existing) {
    const m = /^V(\d+)$/i.exec(v.version.trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `V${max + 1}`
}

export const productService = {
  async getAll(): Promise<Product[]> {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'))
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

  /** Removes the product with its versions and their BOM lines. */
  async delete(id: string, name?: string): Promise<void> {
    const versions = await productService.getVersions(id)
    const boms = await Promise.all(versions.map(v => bomService.getByVersionId(v.id)))
    const batch = writeBatch(db)
    boms.flat().forEach(b => batch.delete(doc(db, 'bomItems', b.id)))
    versions.forEach(v => batch.delete(doc(db, 'productVersions', v.id)))
    batch.delete(doc(db, 'products', id))
    await batch.commit()
    await auditService.log({ action: 'product.delete', entityType: 'product', entityId: id, before: { name: name ?? null } })
  },

  async getVersions(productId: string): Promise<ProductVersion[]> {
    const q = query(
      collection(db, 'productVersions'),
      where('productId', '==', productId),
    )
    const snap = await getDocs(q)
    return sortByNewest(
      snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductVersion)),
      v => v.createdAt,
    )
  },

  async getActiveVersion(productId: string): Promise<ProductVersion | null> {
    const versions = await productService.getVersions(productId)
    return versions.filter(v => v.status === 'active').at(0) ?? null
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
    return sortByNewest(
      snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductVersion)),
      v => v.createdAt,
    )
  },

  /** True if any order line or production batch references this version. */
  async isVersionLocked(versionId: string): Promise<boolean> {
    const [orderSnap, prodSnap] = await Promise.all([
      getDocs(query(collection(db, 'orderItems'), where('productVersionId', '==', versionId))),
      getDocs(query(collection(db, 'productions'), where('productVersionId', '==', versionId))),
    ])
    return !orderSnap.empty || !prodSnap.empty
  },

  /**
   * True when price/margin/BOM must fork: version used in orders/production,
   * or already has a catalog selling price (version snapshot or product default).
   */
  async isVersionImmutable(
    versionId: string,
    opts?: { sellingPrice?: number | null; productDefaultSellingPrice?: number },
  ): Promise<boolean> {
    const locked = await productService.isVersionLocked(versionId)
    if (locked) return true
    const versionPrice = opts?.sellingPrice ?? 0
    const productPrice = opts?.productDefaultSellingPrice ?? 0
    return versionPrice > 0 || productPrice > 0
  },

  /**
   * Create the next version, copy BOM from `sourceVersionId`, apply optional recipe/price patches,
   * mark previous versions inactive, and sync product.defaultSellingPrice when sellingPrice is set.
   */
  async forkVersion(opts: {
    productId: string
    sourceVersionId: string
    description?: string
    sellingPrice?: number
    targetMarginPct?: number | null
    bomPatch?: {
      add?: { materialId: string; quantity: number; unit: string }
      update?: { id: string; quantity: number; unit: string }
      deleteId?: string
    }
  }): Promise<string> {
    const versions = await productService.getVersions(opts.productId)
    const label = nextVersionLabel(versions)
    const sourceBom = await bomService.getByVersionId(opts.sourceVersionId)

    let bomLines = sourceBom.map(b => ({
      materialId: b.materialId,
      quantity: b.quantity,
      unit: b.unit,
      sourceId: b.id,
    }))

    if (opts.bomPatch?.deleteId) {
      bomLines = bomLines.filter(b => b.sourceId !== opts.bomPatch!.deleteId)
    }
    if (opts.bomPatch?.update) {
      const u = opts.bomPatch.update
      bomLines = bomLines.map(b =>
        b.sourceId === u.id ? { ...b, quantity: u.quantity, unit: u.unit } : b,
      )
    }
    if (opts.bomPatch?.add) {
      const a = opts.bomPatch.add
      if (!bomLines.some(b => b.materialId === a.materialId)) {
        bomLines.push({ ...a, sourceId: '' })
      }
    }

    const batch = writeBatch(db)
    const newVersionRef = doc(collection(db, 'productVersions'))
    batch.set(newVersionRef, {
      productId: opts.productId,
      version: label,
      description: opts.description?.trim() || `Forked from ${versions.find(v => v.id === opts.sourceVersionId)?.version ?? 'prior'}`,
      status: 'active',
      sellingPrice: opts.sellingPrice ?? null,
      targetMarginPct: opts.targetMarginPct ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })

    for (const v of versions) {
      if (v.status === 'active') {
        batch.update(doc(db, 'productVersions', v.id), {
          status: 'inactive',
          updatedAt: serverTimestamp(),
        })
      }
    }

    for (const line of bomLines) {
      const bomRef = doc(collection(db, 'bomItems'))
      batch.set(bomRef, {
        productVersionId: newVersionRef.id,
        materialId: line.materialId,
        quantity: line.quantity,
        unit: line.unit,
      })
    }

    if (opts.sellingPrice != null) {
      batch.update(doc(db, 'products', opts.productId), {
        defaultSellingPrice: opts.sellingPrice,
        updatedAt: serverTimestamp(),
      })
    }

    await batch.commit()
    return newVersionRef.id
  },
}
