import {
  collection,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { WorkerAdvanceBalance, WorkerAdvanceEntry, WorkerAdvanceKind } from '../types'

function actorId() {
  return auth.currentUser?.uid ?? ''
}

export const advancesService = {
  async listEntries(workerId?: string): Promise<WorkerAdvanceEntry[]> {
    try {
      const q = workerId
        ? query(
            collection(db, 'workerAdvances'),
            where('workerId', '==', workerId),
            orderBy('occurredAt', 'desc'),
          )
        : query(collection(db, 'workerAdvances'), orderBy('occurredAt', 'desc'))
      const snap = await getDocs(q)
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkerAdvanceEntry))
    } catch {
      const snap = await getDocs(collection(db, 'workerAdvances'))
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkerAdvanceEntry))
      if (workerId) rows = rows.filter(r => r.workerId === workerId)
      rows.sort((a, b) => (b.occurredAt?.toMillis?.() ?? 0) - (a.occurredAt?.toMillis?.() ?? 0))
      return rows
    }
  },

  async addEntry(params: {
    workerId: string
    workerName: string
    kind: WorkerAdvanceKind
    amount: number
    bankTransactionId?: string | null
    materialId?: string | null
    orderId?: string | null
    category?: string | null
    notes?: string
    occurredAt?: Date
  }): Promise<string> {
    const amount = Math.abs(Number(params.amount))
    if (!params.workerId || !Number.isFinite(amount) || amount <= 0) {
      throw new Error('Worker and positive amount required')
    }
    const ref = await addDoc(collection(db, 'workerAdvances'), {
      workerId: params.workerId,
      workerName: params.workerName,
      kind: params.kind,
      amount,
      bankTransactionId: params.bankTransactionId ?? null,
      materialId: params.materialId ?? null,
      orderId: params.orderId ?? null,
      category: params.category ?? null,
      notes: params.notes ?? '',
      occurredAt: params.occurredAt
        ? Timestamp.fromDate(params.occurredAt)
        : Timestamp.now(),
      createdAt: serverTimestamp(),
      createdBy: actorId(),
    })
    return ref.id
  },

  balances(entries: WorkerAdvanceEntry[]): WorkerAdvanceBalance[] {
    const map = new Map<string, WorkerAdvanceBalance>()
    for (const e of entries) {
      let row = map.get(e.workerId)
      if (!row) {
        row = {
          workerId: e.workerId,
          workerName: e.workerName || e.workerId,
          sent: 0,
          spent: 0,
          remaining: 0,
        }
        map.set(e.workerId, row)
      }
      if (e.kind === 'out') row.sent += e.amount
      else row.spent += e.amount
      row.remaining = row.sent - row.spent
      if (e.workerName) row.workerName = e.workerName
    }
    return [...map.values()].sort((a, b) => a.workerName.localeCompare(b.workerName))
  },
}
