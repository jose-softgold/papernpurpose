import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { AuthzError, UserRole } from './authz'

export interface Actor {
  uid: string
  role: UserRole
  email: string
  name: string
}

export async function resolveActor(uid: string): Promise<Actor> {
  const db = getFirestore()
  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) {
    throw new AuthzError('User profile not found')
  }
  const data = snap.data()!
  if (data.active === false) {
    throw new AuthzError('Account deactivated')
  }
  const role = data.role as UserRole
  return {
    uid,
    role,
    email: data.email ?? '',
    name: data.name ?? '',
  }
}

export async function syncCustomClaims(uid: string, role: UserRole, active: boolean): Promise<void> {
  await getAuth().setCustomUserClaims(uid, { role, active })
}
