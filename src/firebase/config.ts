import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const db = getFirestore(app)
export const auth = getAuth(app)
export const storage = getStorage(app)

// Idempotent emulator connection: guard prevents double-connect on hot-reload
// VITE_EMULATOR_HOST defaults to localhost; set it to your machine's LAN IP
// when testing from a mobile device (e.g. VITE_EMULATOR_HOST=192.168.1.x)
let emulatorsConnected = false
if (import.meta.env.VITE_USE_EMULATOR === 'true' && !emulatorsConnected) {
  emulatorsConnected = true
  const emulatorHost = import.meta.env.VITE_EMULATOR_HOST || 'localhost'
  connectFirestoreEmulator(db, emulatorHost, 8180)
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`)
  connectStorageEmulator(storage, emulatorHost, 9199)
}
