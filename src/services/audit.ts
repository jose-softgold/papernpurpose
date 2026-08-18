import { addDoc, collection, getDocs, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import type { AuditLog } from '../types'

export const auditService = {
  async log(entry: {
    action: string
    entityType: string
    entityId: string
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    actorName?: string
  }): Promise<void> {
    const uid = auth.currentUser?.uid ?? 'unknown'
    const actorName = entry.actorName || auth.currentUser?.email || uid
    await addDoc(collection(db, 'auditLogs'), {
      actorId: uid,
      actorName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      createdAt: serverTimestamp(),
    })
  },

  async getAll(): Promise<AuditLog[]> {
    const q = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLog))
  },
}
