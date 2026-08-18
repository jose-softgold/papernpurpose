import { createContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  User,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { UserDoc, UserRole } from '../types'

interface AuthContextValue {
  user: User | null
  userDoc: UserDoc | null
  role: UserRole | null
  loading: boolean
  authError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({} as AuthContextValue)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setAuthError(null)
      setUser(u)
      if (!u) {
        setUserDoc(null)
        setRole(null)
        setLoading(false)
        return
      }

      try {
        const snap = await getDoc(doc(db, 'users', u.uid))
        if (snap.exists()) {
          const data = snap.data() as UserDoc
          if (data.active === false) {
            setAuthError('Your account has been deactivated. Contact an owner.')
            await fbSignOut(auth)
            setUser(null)
            setUserDoc(null)
            setRole(null)
            setLoading(false)
            return
          }
          setUserDoc(data)
          setRole(data.role)
          setLoading(false)
          return
        }

        // No profile yet: only the very first owner may claim the account,
        // enforced by the one-time meta/bootstrap marker in Firestore rules.
        try {
          const profile = {
            email: u.email ?? '',
            name: u.displayName ?? u.email ?? 'Owner',
            role: 'owner' as const,
            active: true,
            createdBy: u.uid,
          }
          const batch = writeBatch(db)
          batch.set(doc(db, 'users', u.uid), {
            ...profile,
            createdAt: serverTimestamp(),
          })
          batch.set(doc(db, 'meta', 'bootstrap'), {
            claimedBy: u.uid,
            claimedAt: serverTimestamp(),
          })
          await batch.commit()

          setUserDoc({ ...profile, createdAt: null as unknown as UserDoc['createdAt'] })
          setRole('owner')
          setLoading(false)
          return
        } catch {
          setAuthError('No user profile found. Ask an owner to create your account.')
          await fbSignOut(auth)
          setUser(null)
          setUserDoc(null)
          setRole(null)
        }
      } catch (err) {
        console.error(err)
        setAuthError('Failed to load user profile.')
        setUserDoc(null)
        setRole(null)
      }
      setLoading(false)
    })
  }, [])

  const signIn = async (email: string, password: string) => {
    setAuthError(null)
    await signInWithEmailAndPassword(auth, email, password)
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUserDoc(null)
    setRole(null)
    setAuthError(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, userDoc, role, loading, authError, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export { AuthContext }
