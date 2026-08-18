import { UserRole } from '../types'

export function isOwner(role: UserRole | null | undefined): boolean {
  return role === 'owner'
}

export function isAdminOrOwner(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function isWorker(role: UserRole | null | undefined): boolean {
  return role === 'worker'
}

export function isViewer(role: UserRole | null | undefined): boolean {
  return role === 'viewer'
}

/** Can manage users in Settings */
export function canManageUsers(role: UserRole | null | undefined): boolean {
  return isAdminOrOwner(role)
}

/** Full CRM write access (master data, finances, create orders) */
export function canWriteMaster(role: UserRole | null | undefined): boolean {
  return isAdminOrOwner(role)
}

/** Shop-floor writes: purchases, production, materials/suppliers create, order status */
export function canWriteOps(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'worker'
}

export function canReadAll(role: UserRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'viewer'
}

/** The app opens in AI mode, which every signed-in role can use */
export function defaultHomePath(_role: UserRole | null | undefined): string {
  return '/'
}

/** Where the Workspace side of the mode toggle lands; workers cannot read the dashboard */
export function workspaceHomePath(role: UserRole | null | undefined): string {
  return role === 'worker' ? '/orders' : '/dashboard'
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  worker: 'Worker',
  viewer: 'Viewer',
}
