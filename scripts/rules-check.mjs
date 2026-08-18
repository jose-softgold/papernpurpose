/**
 * Firestore rules smoke test. Requires the emulator suite to be running:
 *   npm run emulators
 *   node scripts/rules-check.mjs
 */
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore'

const results = []
const check = async (label, promise) => {
  try {
    await promise
    results.push(`PASS  ${label}`)
  } catch (err) {
    results.push(`FAIL  ${label} — ${err.message}`)
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: 'rules-check',
  firestore: {
    host: '127.0.0.1',
    port: 8180,
    rules: readFileSync('firestore.rules', 'utf8'),
  },
})

await testEnv.clearFirestore()

// Seed profiles: legacy owner has no `active` field on purpose
await testEnv.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/legacyOwner'), {
    email: 'legacy@x.com',
    name: 'Legacy',
    role: 'owner',
  })
  await setDoc(doc(db, 'users/worker1'), {
    email: 'w@x.com',
    name: 'Worker',
    role: 'worker',
    active: true,
  })
  await setDoc(doc(db, 'users/viewer1'), {
    email: 'v@x.com',
    name: 'Viewer',
    role: 'viewer',
    active: true,
  })
  await setDoc(doc(db, 'users/gone'), {
    email: 'g@x.com',
    name: 'Gone',
    role: 'admin',
    active: false,
  })
  await setDoc(doc(db, 'suppliers/s1'), { name: 'Paper Mart', phone: '1', email: '', status: 'active' })
  await setDoc(doc(db, 'customers/c1'), { name: 'Priya', phone: '2' })
})

const legacyOwner = testEnv.authenticatedContext('legacyOwner').firestore()
const worker = testEnv.authenticatedContext('worker1').firestore()
const viewer = testEnv.authenticatedContext('viewer1').firestore()
const deactivated = testEnv.authenticatedContext('gone').firestore()
const stranger = testEnv.authenticatedContext('nobody').firestore()

// Legacy owner (no `active` field) must still work
await check(
  'legacy owner reads suppliers',
  assertSucceeds(getDocs(collection(legacyOwner, 'suppliers'))),
)
await check(
  'legacy owner lists users',
  assertSucceeds(getDocs(collection(legacyOwner, 'users'))),
)
await check(
  'legacy owner creates a user profile',
  assertSucceeds(
    setDoc(doc(legacyOwner, 'users/newWorker'), {
      email: 'n@x.com',
      name: 'New',
      role: 'worker',
      active: true,
      createdBy: 'legacyOwner',
    }),
  ),
)
await check(
  'legacy owner writes a customer',
  assertSucceeds(setDoc(doc(legacyOwner, 'customers/c2'), { name: 'Anil', phone: '3' })),
)

// Worker permissions
await check('worker reads suppliers', assertSucceeds(getDocs(collection(worker, 'suppliers'))))
await check(
  'worker creates a supplier',
  assertSucceeds(setDoc(doc(worker, 'suppliers/s2'), { name: 'New Supplier', status: 'active' })),
)
await check('worker cannot read customers', assertFails(getDoc(doc(worker, 'customers/c1'))))
await check('worker cannot list users', assertFails(getDocs(collection(worker, 'users'))))
await check(
  'worker cannot promote self',
  assertFails(setDoc(doc(worker, 'users/worker1'), { role: 'owner', active: true })),
)

// Viewer permissions
await check('viewer reads customers', assertSucceeds(getDocs(collection(viewer, 'customers'))))
await check(
  'viewer cannot write customers',
  assertFails(setDoc(doc(viewer, 'customers/c3'), { name: 'Nope', phone: '0' })),
)
await check(
  'viewer cannot create a supplier',
  assertFails(setDoc(doc(viewer, 'suppliers/s3'), { name: 'Nope' })),
)

// Deactivated account is locked out
await check(
  'deactivated admin cannot read suppliers',
  assertFails(getDocs(collection(deactivated, 'suppliers'))),
)

// Bootstrap protection
await check(
  'stranger cannot list users',
  assertFails(getDocs(collection(stranger, 'users'))),
)
await check(
  'stranger can claim first owner when bootstrap is unclaimed',
  assertSucceeds(
    setDoc(doc(stranger, 'users/nobody'), {
      email: 'nobody@x.com',
      name: 'First',
      role: 'owner',
      active: true,
      createdBy: 'nobody',
    }),
  ),
)
await testEnv.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'meta/bootstrap'), { claimedBy: 'legacyOwner' })
})
const stranger2 = testEnv.authenticatedContext('intruder').firestore()
await check(
  'stranger cannot self-promote after bootstrap is claimed',
  assertFails(
    setDoc(doc(stranger2, 'users/intruder'), {
      email: 'i@x.com',
      name: 'Intruder',
      role: 'owner',
      active: true,
      createdBy: 'intruder',
    }),
  ),
)

await testEnv.cleanup()

console.log(results.join('\n'))
const failed = results.filter(r => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
