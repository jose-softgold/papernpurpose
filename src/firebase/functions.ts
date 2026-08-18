import { getApp } from 'firebase/app'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'
import { auth } from './config'
import { emulatorHost } from './emulator'

const functions = getFunctions(getApp(), 'asia-south1')

let functionsEmulatorConnected = false
if (import.meta.env.VITE_USE_EMULATOR === 'true' && !functionsEmulatorConnected) {
  functionsEmulatorConnected = true
  connectFunctionsEmulator(functions, emulatorHost(), 5001)
}

export { functions }

export async function callChatAssistant(payload: {
  message: string
  sessionId?: string
  confirm?: boolean
  cancel?: boolean
  attachments?: Array<{ url: string; contentType: string; name: string }>
}) {
  await auth.currentUser?.getIdToken()
  const fn = httpsCallable(functions, 'chatAssistant')
  const res = await fn(payload)
  return res.data as {
    sessionId: string
    reply: string
    pendingTool?: { name: string; args: Record<string, unknown> } | null
    needsConfirmation?: boolean
    configured?: boolean
    result?: unknown
  }
}

export async function callRunDomainTool(name: string, args: Record<string, unknown>) {
  await auth.currentUser?.getIdToken()
  const fn = httpsCallable(functions, 'runDomainTool')
  const res = await fn({ name, args })
  return res.data
}

export async function callSyncUserClaims(uid: string) {
  await auth.currentUser?.getIdToken()
  const fn = httpsCallable(functions, 'syncUserClaims')
  const res = await fn({ uid })
  return res.data
}
