import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Occasion, OccasionSeason, OccasionKind, Production } from '../types'
import { sortByNewest } from '../utils/sort'

export function slugifyOccasion(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function formatSeasonBatchCode(slug: string, year: number, seq: number): string {
  const prefix = slug
    .split('-')
    .map(w => w.slice(0, 2).toUpperCase())
    .join('')
    .slice(0, 4) || 'OC'
  return `${prefix}-${year}-${String(seq).padStart(2, '0')}`
}

export const occasionService = {
  async getAllOccasions(): Promise<Occasion[]> {
    const q = query(collection(db, 'occasions'), orderBy('name', 'asc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Occasion))
  },

  async getActiveOccasions(): Promise<Occasion[]> {
    const all = await occasionService.getAllOccasions()
    return all.filter(o => o.status === 'active')
  },

  async getOccasionById(id: string): Promise<Occasion | null> {
    const snap = await getDoc(doc(db, 'occasions', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Occasion
  },

  async createOccasion(data: {
    name: string
    kind: OccasionKind
    typicalMonth?: number | null
    typicalDay?: number | null
  }): Promise<string> {
    const slug = slugifyOccasion(data.name)
    const ref = await addDoc(collection(db, 'occasions'), {
      name: data.name.trim(),
      slug,
      kind: data.kind,
      typicalMonth: data.typicalMonth ?? null,
      typicalDay: data.typicalDay ?? null,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async updateOccasion(id: string, data: Partial<Pick<Occasion, 'name' | 'kind' | 'typicalMonth' | 'typicalDay' | 'status'>>): Promise<void> {
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (data.name !== undefined) {
      patch.name = data.name.trim()
      patch.slug = slugifyOccasion(data.name)
    }
    if (data.kind !== undefined) patch.kind = data.kind
    if (data.typicalMonth !== undefined) patch.typicalMonth = data.typicalMonth
    if (data.typicalDay !== undefined) patch.typicalDay = data.typicalDay
    if (data.status !== undefined) patch.status = data.status
    await updateDoc(doc(db, 'occasions', id), patch)
  },

  async deleteOccasion(id: string): Promise<void> {
    const seasons = await getDocs(query(collection(db, 'occasionSeasons'), where('occasionId', '==', id)))
    const batch = writeBatch(db)
    seasons.docs.forEach(d => batch.delete(d.ref))
    batch.delete(doc(db, 'occasions', id))
    await batch.commit()
  },

  async deleteSeason(id: string): Promise<void> {
    await deleteDoc(doc(db, 'occasionSeasons', id))
  },

  async getAllSeasons(): Promise<OccasionSeason[]> {
    const q = query(collection(db, 'occasionSeasons'), orderBy('year', 'desc'))
    const snap = await getDocs(q)
    return sortByNewest(
      snap.docs.map(d => ({ id: d.id, ...d.data() } as OccasionSeason)),
      s => s.createdAt,
    )
  },

  async getSeasonsByOccasion(occasionId: string): Promise<OccasionSeason[]> {
    const q = query(
      collection(db, 'occasionSeasons'),
      where('occasionId', '==', occasionId),
      orderBy('year', 'desc'),
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as OccasionSeason))
  },

  async getSeasonById(id: string): Promise<OccasionSeason | null> {
    const snap = await getDoc(doc(db, 'occasionSeasons', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as OccasionSeason
  },

  async getActiveSeasonForOccasion(occasionId: string, year?: number): Promise<OccasionSeason | null> {
    const seasons = await occasionService.getSeasonsByOccasion(occasionId)
    const targetYear = year ?? new Date().getFullYear()
    return seasons.find(s => s.year === targetYear && s.status === 'active')
      ?? seasons.find(s => s.status === 'active')
      ?? null
  },

  async openSeason(occasionId: string, year: number): Promise<string> {
    const occasion = await occasionService.getOccasionById(occasionId)
    if (!occasion) throw new Error('Occasion not found')

    const existing = await occasionService.getSeasonsByOccasion(occasionId)
    if (existing.some(s => s.year === year)) {
      throw new Error(`Season for ${occasion.name} ${year} already exists`)
    }

    const ref = await addDoc(collection(db, 'occasionSeasons'), {
      occasionId,
      year,
      name: `${occasion.name} ${year}`,
      startsAt: null,
      endsAt: null,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async updateSeason(id: string, data: Partial<Pick<OccasionSeason, 'status' | 'startsAt' | 'endsAt'>>): Promise<void> {
    await updateDoc(doc(db, 'occasionSeasons', id), {
      ...data,
      updatedAt: serverTimestamp(),
    })
  },

  async nextSeasonBatchCode(occasionSeasonId: string): Promise<string> {
    const season = await occasionService.getSeasonById(occasionSeasonId)
    if (!season) throw new Error('Season not found')
    const occasion = await occasionService.getOccasionById(season.occasionId)
    const slug = occasion?.slug ?? 'oc'

    const snap = await getDocs(collection(db, 'productions'))
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Production))
    const prefix = formatSeasonBatchCode(slug, season.year, 0).replace(/-\d+$/, '-')
    const seqs = all
      .map(p => p.batchCode ?? '')
      .filter(c => c.startsWith(prefix))
      .map(c => Number(c.slice(prefix.length)) || 0)
    const next = (seqs.length ? Math.max(...seqs) : 0) + 1
    return formatSeasonBatchCode(slug, season.year, next)
  },

  /** Case-insensitive match of free-text event type to catalog occasion */
  async matchOccasionByName(text: string): Promise<Occasion | null> {
    const trimmed = text.trim()
    if (!trimmed) return null
    const all = await occasionService.getAllOccasions()
    const lower = trimmed.toLowerCase()
    return all.find(o => o.name.toLowerCase() === lower)
      ?? all.find(o => o.slug === slugifyOccasion(trimmed))
      ?? null
  },
}
