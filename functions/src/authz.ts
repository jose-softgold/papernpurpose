export type UserRole = 'owner' | 'admin' | 'worker' | 'viewer'

export function isAdminOrOwner(role: UserRole): boolean {
  return role === 'owner' || role === 'admin'
}

export function canWriteOps(role: UserRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'worker'
}

export function canWriteMaster(role: UserRole): boolean {
  return isAdminOrOwner(role)
}

export function canRead(role: UserRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'worker' || role === 'viewer'
}

export class AuthzError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthzError'
  }
}
