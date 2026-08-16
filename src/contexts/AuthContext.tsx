import { createContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, User } from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { UserDoc, UserRole } from '../types'

interface AuthContextValue {
  user: User | null
  userDoc: UserDoc | null
  role: UserRole
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({} as AuthContextValue)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null)
  const [role, setRole] = useState<UserRole>('owner')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        const snap = await getDoc(doc(db, 'users', u.uid))
        if (snap.exists()) {
          const data = snap.data() as UserDoc
          setUserDoc(data)
          setRole(data.role)
        } else {
          // First login — create owner doc so rules work consistently
          await setDoc(doc(db, 'users', u.uid), {
            email: u.email ?? '',
            name: u.displayName ?? u.email ?? 'Owner',
            role: 'owner',
            createdAt: serverTimestamp(),
            createdBy: u.uid,
          })
          setUserDoc(null)
          setRole('owner')
        }
      } else {
        setUserDoc(null)
        setRole('owner')
      }
      setLoading(false)
    })
  }, [])

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
  }

  const signOut = async () => {
    await fbSignOut(auth)
    setUserDoc(null)
    setRole('owner')
  }

  return (
    <AuthContext.Provider value={{ user, userDoc, role, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export { AuthContext }
