import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { UserDoc, WorkerOption } from '../types'
import { sortByNewest } from '../utils/sort'

export const usersService = {
  async listWorkers(): Promise<WorkerOption[]> {
    const snap = await getDocs(collection(db, 'users'))
    return sortByNewest(
      snap.docs
        .map(d => ({ id: d.id, ...(d.data() as UserDoc) }))
        .filter(u => u.role === 'worker' && u.active !== false),
      u => u.createdAt,
    ).map(u => ({ id: u.id, name: u.name, email: u.email }))
  },
}
