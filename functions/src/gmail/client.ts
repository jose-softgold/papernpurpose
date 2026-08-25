import { google } from 'googleapis'
import { requireOAuthConfig, GMAIL_SCOPE, gmailDocRef, GmailIntegrationDoc } from './config'

export function createOAuthClient(redirectUri: string) {
  const { clientId, clientSecret } = requireOAuthConfig()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const client = createOAuthClient(redirectUri)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: [GMAIL_SCOPE],
    state,
    include_granted_scopes: true,
  })
}

export async function exchangeCode(
  redirectUri: string,
  code: string,
): Promise<{ refreshToken: string; accessToken?: string | null }> {
  const client = createOAuthClient(redirectUri)
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Disconnect the app in Google Account permissions and try again.',
    )
  }
  return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token }
}

export async function getAuthedGmail() {
  const snap = await gmailDocRef().get()
  if (!snap.exists) throw new Error('Gmail inbox is not connected')
  const data = snap.data() as GmailIntegrationDoc
  if (!data.refreshToken) throw new Error('Gmail inbox is not connected')

  const { clientId, clientSecret } = requireOAuthConfig()
  const client = new google.auth.OAuth2(clientId, clientSecret)
  client.setCredentials({ refresh_token: data.refreshToken })
  const gmail = google.gmail({ version: 'v1', auth: client })
  return { gmail, integration: data, ref: gmailDocRef() }
}

export function toPublicStatus(data: Partial<GmailIntegrationDoc> | undefined) {
  if (!data?.refreshToken) {
    return {
      connected: false,
      email: null as string | null,
      connectedAt: null as string | null,
      senderAllowlist: [] as string[],
      labelId: null as string | null,
      watchExpiration: null as string | null,
      lastSyncAt: null as string | null,
      lastError: null as string | null,
    }
  }
  const connectedAt =
    data.connectedAt && typeof (data.connectedAt as { toDate?: () => Date }).toDate === 'function'
      ? (data.connectedAt as { toDate: () => Date }).toDate().toISOString()
      : null
  const lastSyncAt =
    data.lastSyncAt && typeof (data.lastSyncAt as { toDate?: () => Date }).toDate === 'function'
      ? (data.lastSyncAt as { toDate: () => Date }).toDate().toISOString()
      : null
  return {
    connected: true,
    email: data.email ?? null,
    connectedAt,
    senderAllowlist: data.senderAllowlist ?? [],
    labelId: data.labelId ?? null,
    watchExpiration: data.watchExpiration ?? null,
    lastSyncAt,
    lastError: data.lastError ?? null,
  }
}
