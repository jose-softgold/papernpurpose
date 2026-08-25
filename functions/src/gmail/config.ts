import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

export const GMAIL_DOC = 'integrations/gmail'
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export const DEFAULT_SENDER_ALLOWLIST = [
  // HDFC InstaAlerts — current domain is *.bank.in (older: *.net.in)
  'hdfcbank.bank.in',
  'alerts@hdfcbank.bank.in',
  'mailers.hdfcbank.bank.in',
  'hdfcbank.net.in',
  'hdfcbank.net',
  'hdfcbank.com',
  'alerts@hdfcbank.net.in',
  // Credit card / marketing — extend when template is shared
  'hdfcbankcreditcard',
]

export interface GmailIntegrationDoc {
  refreshToken: string
  email: string
  historyId?: string
  watchExpiration?: string
  connectedAt?: Timestamp | FieldValue
  connectedBy?: string
  senderAllowlist?: string[]
  labelId?: string | null
  lastSyncAt?: Timestamp | FieldValue
  lastError?: string | null
  oauthState?: string | null
  oauthStateExpiresAt?: number | null
}

export function gmailDocRef() {
  return getFirestore().doc(GMAIL_DOC)
}

export function oauthClientId(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || ''
}

export function oauthClientSecret(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
}

export function requireOAuthConfig(): { clientId: string; clientSecret: string } {
  const clientId = oauthClientId()
  const clientSecret = oauthClientSecret()
  if (!clientId || !clientSecret) {
    throw new Error(
      'Gmail OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET on Cloud Functions.',
    )
  }
  return { clientId, clientSecret }
}
