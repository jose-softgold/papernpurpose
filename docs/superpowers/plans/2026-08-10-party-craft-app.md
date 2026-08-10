# Party Craft App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-quality React + Firebase web app for managing a small paper-craft business: customers, products, materials, BOM, production, inventory, orders, reports, and exports.

**Architecture:** Firebase-only backend (Firestore + Auth + Storage). Inventory is tracked via an append-only ledger of `inventoryTransactions`. Historical costs are frozen at time of production/sale — never recalculated from today's prices.

**Tech Stack:** React 18, Vite, TypeScript, Bootstrap 5, React Router v6, Firebase SDK v9 (modular), xlsx (exports), Firebase Emulator Suite (local dev).

## Global Constraints

- Currency: always display as ₹ (INR), e.g. `₹1,250`
- Dates: display as `DD-MMM-YYYY` (e.g. `10-Aug-2026`)
- Never delete historical records — use status fields (`CANCELLED`, `inactive`)
- Never edit inventory transactions — always append new ones
- Historical production cost and selling price must be stored at time of event, never recalculated
- Firebase SDK: use modular v9 imports (`firebase/firestore`, `firebase/auth`, etc.)
- All Firestore writes must use `serverTimestamp()` for `createdAt`/`updatedAt`
- `npm run dev` must work after every task — keep app runnable throughout

---

### Task 1: Project Scaffold

**Files:**
- Create: `party-craft-app/` (root)
- Create: `package.json` (via `npm create vite`)
- Create: `.env.local`
- Create: `.env.production`
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `firestore.indexes.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`

**Interfaces:**
- Produces: Running Vite dev server at `localhost:5173`; Firebase emulator config loaded; Bootstrap available globally

- [ ] **Step 1: Scaffold Vite + React + TypeScript project**

```bash
cd /Users/sjose/projects
npm create vite@latest party-craft-app -- --template react-ts
cd party-craft-app
npm install
```

- [ ] **Step 2: Install dependencies**

```bash
npm install firebase bootstrap react-router-dom xlsx
npm install -D @types/node
```

- [ ] **Step 3: Import Bootstrap in main.tsx**

Replace `src/main.tsx`:
```tsx
import 'bootstrap/dist/css/bootstrap.min.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 4: Create environment files**

`.env.local`:
```
VITE_USE_EMULATOR=true
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-project
VITE_FIREBASE_STORAGE_BUCKET=demo-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

`.env.production`:
```
VITE_USE_EMULATOR=false
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 5: Create Firebase Emulator config**

`firebase.json`:
```json
{
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true, "port": 4000 }
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  }
}
```

`.firebaserc`:
```json
{
  "projects": {
    "default": "demo-project"
  }
}
```

`firestore.indexes.json`:
```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 6: Placeholder App.tsx**

```tsx
export default function App() {
  return <div className="container mt-4"><h1>Party Craft App</h1></div>
}
```

- [ ] **Step 7: Verify dev server runs**

```bash
npm run dev
```
Expected: Vite server at `localhost:5173`, page shows "Party Craft App"


---

### Task 2: Firebase Initialization + TypeScript Types

**Files:**
- Create: `src/firebase/config.ts`
- Create: `src/types/index.ts`

**Interfaces:**
- Produces: `db` (Firestore instance), `auth` (Auth instance), `storage` (Storage instance) — imported by all service files
- Produces: TypeScript interfaces for all 13 Firestore collections

- [ ] **Step 1: Create Firebase config with emulator support**

`src/firebase/config.ts`:
```ts
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

const firebaseConfig = {
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

if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectAuthEmulator(auth, 'http://localhost:9099')
  connectStorageEmulator(storage, 'localhost', 9199)
}
```

- [ ] **Step 2: Create all TypeScript types**

`src/types/index.ts`:
```ts
import { Timestamp } from 'firebase/firestore'

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  address: string
  city: string
  notes: string
  status: 'active' | 'inactive'
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Product {
  id: string
  name: string
  category: string
  description: string
  defaultSellingPrice: number
  status: 'active' | 'inactive'
  imageUrl: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ProductVersion {
  id: string
  productId: string
  version: string
  description: string
  status: 'active' | 'inactive'
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Material {
  id: string
  name: string
  category: string
  unit: string
  minimumStock: number
  costPerUnit: number
  supplierId: string
  notes: string
  status: 'active' | 'inactive'
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface BomItem {
  id: string
  productVersionId: string
  materialId: string
  quantity: number
  unit: string
}

export type TransactionType =
  | 'PURCHASE'
  | 'PRODUCTION'
  | 'CONSUMPTION'
  | 'SALE'
  | 'WASTE'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFORMATION'

export interface InventoryTransaction {
  id: string
  itemType: 'material' | 'product'
  itemId: string
  transactionType: TransactionType
  quantity: number
  unit: string
  referenceType: string
  referenceId: string
  notes: string
  createdAt: Timestamp
}

export type OrderStatus =
  | 'DRAFT'
  | 'QUOTED'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'READY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'

export interface Order {
  id: string
  customerId: string
  orderDate: Timestamp
  eventDate: Timestamp | null
  eventType: string
  subtotal: number
  discount: number
  total: number
  status: OrderStatus
  notes: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  productVersionId: string
  quantity: number
  unitPrice: number
  totalPrice: number
  costPerUnit: number
  totalCost: number
  profit: number
}

export type ProductionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface Production {
  id: string
  productId: string
  productVersionId: string
  quantity: number
  productionDate: Timestamp
  totalMaterialCost: number
  costPerUnit: number
  status: ProductionStatus
  notes: string
  createdAt: Timestamp
}

export interface ProductionMaterial {
  id: string
  productionId: string
  materialId: string
  plannedQuantity: number
  actualQuantity: number
  wasteQuantity: number
  unitCost: number
  totalCost: number
}

export interface Supplier {
  id: string
  name: string
  phone: string
  email: string
  address: string
  notes: string
  status: 'active' | 'inactive'
}

export interface Purchase {
  id: string
  supplierId: string
  purchaseDate: Timestamp
  total: number
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED'
  notes: string
  createdAt: Timestamp
}

export interface PurchaseItem {
  id: string
  purchaseId: string
  materialId: string
  quantity: number
  unitCost: number
  total: number
}
```


---

### Task 3: Utilities + Common Components

**Files:**
- Create: `src/utils/format.ts`
- Create: `src/utils/export.ts`
- Create: `src/components/LoadingSpinner.tsx`
- Create: `src/components/EmptyState.tsx`
- Create: `src/components/ConfirmModal.tsx`
- Create: `src/hooks/useToast.ts`
- Create: `src/components/ToastContainer.tsx`

**Interfaces:**
- Produces: `formatCurrency(n)`, `formatDate(ts)`, `formatQuantity(n, unit)` — used by all pages
- Produces: `exportToCSV(data, filename)`, `exportToExcel(data, filename)` — used by export buttons
- Produces: `<LoadingSpinner />`, `<EmptyState message />`, `<ConfirmModal />` — used by all pages
- Produces: `useToast()` hook returning `{ showToast, ToastContainer }`

- [ ] **Step 1: Create format utilities**

`src/utils/format.ts`:
```ts
import { Timestamp } from 'firebase/firestore'

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function formatDate(ts: Timestamp | null | undefined): string {
  if (!ts) return '—'
  const d = ts.toDate()
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`
}

export function formatQuantity(quantity: number, unit: string): string {
  return `${quantity} ${unit}`
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}
```

- [ ] **Step 2: Create export utilities**

`src/utils/export.ts`:
```ts
import * as XLSX from 'xlsx'

export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
  const ws = XLSX.utils.json_to_sheet(data)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function exportToExcel(data: Record<string, unknown>[], filename: string): void {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
```

- [ ] **Step 3: Create common components**

`src/components/LoadingSpinner.tsx`:
```tsx
export default function LoadingSpinner() {
  return (
    <div className="d-flex justify-content-center p-5">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Loading...</span>
      </div>
    </div>
  )
}
```

`src/components/EmptyState.tsx`:
```tsx
interface Props { message: string; icon?: string }
export default function EmptyState({ message, icon = '📭' }: Props) {
  return (
    <div className="text-center p-5 text-muted">
      <div style={{ fontSize: '3rem' }}>{icon}</div>
      <p className="mt-2">{message}</p>
    </div>
  )
}
```

`src/components/ConfirmModal.tsx`:
```tsx
interface Props {
  show: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}
export default function ConfirmModal({ show, title, message, confirmLabel = 'Confirm', onConfirm, onCancel }: Props) {
  if (!show) return null
  return (
    <>
      <div className="modal-backdrop fade show" />
      <div className="modal d-block" tabIndex={-1}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button className="btn-close" onClick={onCancel} />
            </div>
            <div className="modal-body"><p>{message}</p></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
              <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Create toast hook**

`src/hooks/useToast.ts`:
```ts
import { useState, useCallback } from 'react'

interface Toast { id: number; message: string; type: 'success' | 'danger' | 'warning' }

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: 'success' | 'danger' | 'warning' = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  return { toasts, showToast }
}
```

`src/components/ToastContainer.tsx`:
```tsx
interface Toast { id: number; message: string; type: string }
interface Props { toasts: Toast[] }
export default function ToastContainer({ toasts }: Props) {
  return (
    <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 9999 }}>
      {toasts.map(t => (
        <div key={t.id} className={`toast show align-items-center text-bg-${t.type} border-0 mb-2`}>
          <div className="d-flex">
            <div className="toast-body">{t.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
```


---

### Task 4: Authentication

**Files:**
- Create: `src/hooks/useAuth.ts`
- Create: `src/pages/Login.tsx`
- Create: `src/components/ProtectedRoute.tsx`

**Interfaces:**
- Produces: `useAuth()` returning `{ user, loading, signIn, signOut }`
- Produces: `<ProtectedRoute />` — wraps all app routes, redirects to `/login` if unauthenticated

- [ ] **Step 1: Create auth hook**

`src/hooks/useAuth.ts`:
```ts
import { useState, useEffect } from 'react'
import { User, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/config'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false) })
    return unsub
  }, [])

  const signIn = (email: string, password: string) =>
    signInWithEmailAndPassword(auth, email, password)

  const signOut = () => firebaseSignOut(auth)

  return { user, loading, signIn, signOut }
}
```

- [ ] **Step 2: Create Login page**

`src/pages/Login.tsx`:
```tsx
import { useState, FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
    } catch {
      setError('Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <div className="card shadow" style={{ width: '380px' }}>
        <div className="card-body p-4">
          <h4 className="card-title mb-1">Party Craft</h4>
          <p className="text-muted small mb-4">Inventory & Customer Management</p>
          {error && <div className="alert alert-danger py-2">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">Email</label>
              <input type="email" className="form-control" value={email}
                onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="mb-3">
              <label className="form-label">Password</label>
              <input type="password" className="form-control" value={password}
                onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary w-100" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create ProtectedRoute**

`src/components/ProtectedRoute.tsx`:
```tsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from './LoadingSpinner'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
```


---

### Task 5: App Layout + Routing

**Files:**
- Create: `src/layouts/Sidebar.tsx`
- Create: `src/layouts/AppLayout.tsx`
- Create: `src/routes/index.tsx`
- Create: `src/pages/Dashboard.tsx` (stub)
- Create: `src/pages/customers/CustomerList.tsx` (stub)
- Create: `src/pages/customers/CustomerDetail.tsx` (stub)
- Create: `src/pages/products/ProductList.tsx` (stub)
- Create: `src/pages/products/ProductDetail.tsx` (stub)
- Create: `src/pages/materials/MaterialList.tsx` (stub)
- Create: `src/pages/production/ProductionPage.tsx` (stub)
- Create: `src/pages/inventory/InventoryPage.tsx` (stub)
- Create: `src/pages/orders/OrderList.tsx` (stub)
- Create: `src/pages/orders/OrderDetail.tsx` (stub)
- Create: `src/pages/history/HistoryPage.tsx` (stub)
- Create: `src/pages/reports/ReportsPage.tsx` (stub)
- Create: `src/pages/settings/SettingsPage.tsx` (stub)
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: Full routing tree; sidebar navigation; runnable app with all route stubs

- [ ] **Step 1: Create Sidebar**

`src/layouts/Sidebar.tsx`:
```tsx
import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/products', label: 'Products', icon: '🎀' },
  { to: '/materials', label: 'Materials', icon: '📦' },
  { to: '/production', label: 'Production', icon: '🏭' },
  { to: '/inventory', label: 'Inventory', icon: '🗄️' },
  { to: '/orders', label: 'Orders', icon: '📋' },
  { to: '/history', label: 'History', icon: '📜' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Sidebar() {
  const { signOut } = useAuth()
  return (
    <div className="d-flex flex-column bg-dark text-white" style={{ width: '220px', minHeight: '100vh' }}>
      <div className="p-3 border-bottom border-secondary">
        <h6 className="mb-0 fw-bold">🎉 Party Craft</h6>
      </div>
      <nav className="flex-grow-1 py-2">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `d-block px-3 py-2 text-decoration-none small ${isActive ? 'bg-primary text-white' : 'text-light'}`
            }
          >
            <span className="me-2">{item.icon}</span>{item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-top border-secondary">
        <button className="btn btn-sm btn-outline-light w-100" onClick={signOut}>Sign Out</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create AppLayout**

`src/layouts/AppLayout.tsx`:
```tsx
import Sidebar from './Sidebar'
import { Outlet } from 'react-router-dom'

export default function AppLayout() {
  return (
    <div className="d-flex">
      <Sidebar />
      <main className="flex-grow-1 p-4 bg-light" style={{ minHeight: '100vh', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Create all page stubs**

Each stub follows this pattern (replace `PageName`/`title`):
```tsx
// src/pages/dashboard/Dashboard.tsx
export default function Dashboard() {
  return <div><h4>Dashboard</h4><p className="text-muted">Coming soon</p></div>
}
```

Create stubs for: Dashboard, CustomerList, CustomerDetail, ProductList, ProductDetail, MaterialList, ProductionPage, InventoryPage, OrderList, OrderDetail, HistoryPage, ReportsPage, SettingsPage.

- [ ] **Step 4: Create routes**

`src/routes/index.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import AppLayout from '../layouts/AppLayout'
import Login from '../pages/Login'
import Dashboard from '../pages/Dashboard'
import CustomerList from '../pages/customers/CustomerList'
import CustomerDetail from '../pages/customers/CustomerDetail'
import ProductList from '../pages/products/ProductList'
import ProductDetail from '../pages/products/ProductDetail'
import MaterialList from '../pages/materials/MaterialList'
import ProductionPage from '../pages/production/ProductionPage'
import InventoryPage from '../pages/inventory/InventoryPage'
import OrderList from '../pages/orders/OrderList'
import OrderDetail from '../pages/orders/OrderDetail'
import HistoryPage from '../pages/history/HistoryPage'
import ReportsPage from '../pages/reports/ReportsPage'
import SettingsPage from '../pages/settings/SettingsPage'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="customers" element={<CustomerList />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="products" element={<ProductList />} />
        <Route path="products/:id" element={<ProductDetail />} />
        <Route path="materials" element={<MaterialList />} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="orders" element={<OrderList />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 5: Wire up App.tsx**

`src/App.tsx`:
```tsx
import { BrowserRouter } from 'react-router-dom'
import AppRoutes from './routes'

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
```

- [ ] **Step 6: Verify app runs and all routes work**

```bash
npm run dev
```
Navigate to each route — all should render their stub content.


---

### Task 6: Customer Service + Customer List + Customer Detail

**Files:**
- Create: `src/services/customers.ts`
- Replace: `src/pages/customers/CustomerList.tsx`
- Replace: `src/pages/customers/CustomerDetail.tsx`

**Interfaces:**
- Consumes: `Customer` type, `db` from firebase/config, `formatCurrency`, `formatDate`
- Produces: `customerService.getAll()`, `customerService.getById(id)`, `customerService.create(data)`, `customerService.update(id, data)`, `customerService.toggleStatus(id, status)`

- [ ] **Step 1: Create customer service**

`src/services/customers.ts`:
```ts
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc,
  query, orderBy, serverTimestamp, Timestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Customer } from '../types'

const col = collection(db, 'customers')

export const customerService = {
  async getAll(): Promise<Customer[]> {
    const q = query(col, orderBy('name'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer))
  },

  async getById(id: string): Promise<Customer | null> {
    const snap = await getDoc(doc(db, 'customers', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Customer
  },

  async create(data: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ref = await addDoc(col, {
      ...data,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async update(id: string, data: Partial<Customer>): Promise<void> {
    await updateDoc(doc(db, 'customers', id), { ...data, updatedAt: serverTimestamp() })
  },

  async toggleStatus(id: string, current: 'active' | 'inactive'): Promise<void> {
    const next = current === 'active' ? 'inactive' : 'active'
    await updateDoc(doc(db, 'customers', id), { status: next, updatedAt: serverTimestamp() })
  },
}
```

- [ ] **Step 2: Implement CustomerList page**

`src/pages/customers/CustomerList.tsx`:

Features:
- Table: Name, Phone, Email, City, Status, Actions
- Search by name/email/phone (client-side filter)
- Add Customer modal (form: name, phone, email, address, city, notes)
- Edit Customer modal
- Toggle active/inactive with confirmation
- Export to CSV button
- Loading + empty states

Key implementation pattern:
```tsx
import { useState, useEffect } from 'react'
import { customerService } from '../../services/customers'
import { Customer } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { exportToCSV } from '../../utils/export'

// CustomerForm component (inline or separate file)
function CustomerForm({ initial, onSave, onCancel }: {
  initial?: Partial<Customer>
  onSave: (data: Omit<Customer, 'id'|'createdAt'|'updatedAt'>) => Promise<void>
  onCancel: () => void
}) { /* form with all fields */ }

export default function CustomerList() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<Customer | null>(null)
  const { toasts, showToast } = useToast()

  // load, filter, add, edit, toggle handlers
}
```

Implement the full component with all handlers. The modal should use Bootstrap modal classes (`.modal`, `.modal-backdrop`). The customer form must have all 6 fields: name, phone, email, address, city, notes.

- [ ] **Step 3: Implement CustomerDetail page**

`src/pages/customers/CustomerDetail.tsx`:

Sections:
1. **Customer Information** — all fields with edit button
2. **Order History** — table: Order ID, Date, Event, Amount, Status (loaded from orderService)
3. **Product Purchase History** — aggregated from orderItems: Product, Qty Bought, Avg Price, Total Spent
4. **Summary** — Total Orders, Total Revenue, Last Order

Use `useParams()` to get customer ID. Load customer data and orders on mount.

For order history and product purchase history, use the `orderService.getByCustomerId(id)` (defined in Task 10).  Until Task 10, show "Loading..." placeholder sections.

- [ ] **Step 4: Verify navigation works**

Start dev server. Navigate to `/customers`. Add a customer. Edit it. Toggle status. Verify list updates.


---

### Task 7: Supplier Service + Supplier Management (via Settings)

**Files:**
- Create: `src/services/suppliers.ts`
- Replace: `src/pages/settings/SettingsPage.tsx`

**Interfaces:**
- Produces: `supplierService.getAll()`, `supplierService.create(data)`, `supplierService.update(id, data)`

- [ ] **Step 1: Create supplier service**

`src/services/suppliers.ts`:
```ts
import { collection, doc, getDocs, addDoc, updateDoc, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Supplier } from '../types'

const col = collection(db, 'suppliers')

export const supplierService = {
  async getAll(): Promise<Supplier[]> {
    const q = query(col, orderBy('name'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Supplier))
  },

  async create(data: Omit<Supplier, 'id'>): Promise<string> {
    const ref = await addDoc(col, { ...data, status: 'active' })
    return ref.id
  },

  async update(id: string, data: Partial<Supplier>): Promise<void> {
    await updateDoc(doc(db, 'suppliers', id), data)
  },
}
```

- [ ] **Step 2: Implement Settings page with supplier management**

`src/pages/settings/SettingsPage.tsx`:

Two tabs: **Suppliers** | **Account**

Suppliers tab: table with Name, Phone, Email, Status; Add/Edit modal.

Account tab: show current user email; Sign Out button.


---

### Task 8: Material Service + BOM Service + Materials Page

**Files:**
- Create: `src/services/materials.ts`
- Create: `src/services/bom.ts`
- Create: `src/services/inventory.ts` (stock calculation only — full service in Task 11)
- Replace: `src/pages/materials/MaterialList.tsx`

**Interfaces:**
- Produces: `materialService.getAll()`, `materialService.create(data)`, `materialService.update(id, data)`, `materialService.getById(id)`
- Produces: `bomService.getByVersionId(versionId)`, `bomService.create(item)`, `bomService.update(id, data)`, `bomService.delete(id)`
- Produces: `inventoryService.getStock(itemType, itemId)` — computes sum of transactions
- Produces: `inventoryService.getMaterialStocks()` — returns map of materialId → stock quantity

- [ ] **Step 1: Create material service**

`src/services/materials.ts`:
```ts
import { collection, doc, getDocs, getDoc, addDoc, updateDoc, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Material } from '../types'

const col = collection(db, 'materials')

export const materialService = {
  async getAll(): Promise<Material[]> {
    const q = query(col, orderBy('name'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Material))
  },

  async getById(id: string): Promise<Material | null> {
    const snap = await getDoc(doc(db, 'materials', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Material
  },

  async create(data: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ref = await addDoc(col, { ...data, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return ref.id
  },

  async update(id: string, data: Partial<Material>): Promise<void> {
    await updateDoc(doc(db, 'materials', id), { ...data, updatedAt: serverTimestamp() })
  },
}
```

- [ ] **Step 2: Create inventory service (stock calculation)**

`src/services/inventory.ts`:
```ts
import { collection, getDocs, addDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { InventoryTransaction, TransactionType } from '../types'

const col = collection(db, 'inventoryTransactions')

export const inventoryService = {
  async getStock(itemType: string, itemId: string): Promise<number> {
    const q = query(col, where('itemType', '==', itemType), where('itemId', '==', itemId))
    const snap = await getDocs(q)
    return snap.docs.reduce((sum, d) => sum + (d.data().quantity as number), 0)
  },

  async getMaterialStocks(): Promise<Record<string, number>> {
    const q = query(col, where('itemType', '==', 'material'))
    const snap = await getDocs(q)
    const stocks: Record<string, number> = {}
    snap.docs.forEach(d => {
      const { itemId, quantity } = d.data()
      stocks[itemId] = (stocks[itemId] ?? 0) + quantity
    })
    return stocks
  },

  async getProductStocks(): Promise<Record<string, number>> {
    const q = query(col, where('itemType', '==', 'product'))
    const snap = await getDocs(q)
    const stocks: Record<string, number> = {}
    snap.docs.forEach(d => {
      const { itemId, quantity } = d.data()
      stocks[itemId] = (stocks[itemId] ?? 0) + quantity
    })
    return stocks
  },

  async addTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<string> {
    const ref = await addDoc(col, { ...tx, createdAt: serverTimestamp() })
    return ref.id
  },

  async getTransactions(filters?: { itemType?: string; itemId?: string; transactionType?: TransactionType }): Promise<InventoryTransaction[]> {
    let q = query(col, orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    let txs = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryTransaction))
    if (filters?.itemType) txs = txs.filter(t => t.itemType === filters.itemType)
    if (filters?.itemId) txs = txs.filter(t => t.itemId === filters.itemId)
    if (filters?.transactionType) txs = txs.filter(t => t.transactionType === filters.transactionType)
    return txs
  },
}
```

- [ ] **Step 3: Create BOM service**

`src/services/bom.ts`:
```ts
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { BomItem } from '../types'

const col = collection(db, 'bomItems')

export const bomService = {
  async getByVersionId(productVersionId: string): Promise<BomItem[]> {
    const q = query(col, where('productVersionId', '==', productVersionId))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BomItem))
  },

  async create(item: Omit<BomItem, 'id'>): Promise<string> {
    const ref = await addDoc(col, item)
    return ref.id
  },

  async update(id: string, data: Partial<BomItem>): Promise<void> {
    await updateDoc(doc(db, 'bomItems', id), data)
  },

  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, 'bomItems', id))
  },
}
```

- [ ] **Step 4: Implement Materials page**

`src/pages/materials/MaterialList.tsx`:

Table columns: Material, Category, Current Stock, Unit, Min Stock, Cost/Unit, Status, Actions

- Load materials + stock quantities simultaneously (`Promise.all`)
- Highlight row if current stock < minimum stock (use `table-warning` Bootstrap class)
- Add/Edit material modal: name, category, unit, minimumStock, costPerUnit, supplierId (select from suppliers), notes
- Stock value = currentStock × costPerUnit
- Click row → drawer/section showing transaction history for that material
- Export button


---

### Task 9: Product Service + Product List + Product Detail

**Files:**
- Create: `src/services/products.ts`
- Replace: `src/pages/products/ProductList.tsx`
- Replace: `src/pages/products/ProductDetail.tsx`

**Interfaces:**
- Produces: `productService.getAll()`, `productService.getById(id)`, `productService.create(data)`, `productService.update(id, data)`
- Produces: `productService.getVersions(productId)`, `productService.createVersion(data)`, `productService.getActiveVersion(productId)`

- [ ] **Step 1: Create product service**

`src/services/products.ts`:
```ts
import { collection, doc, getDocs, getDoc, addDoc, updateDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Product, ProductVersion } from '../types'

export const productService = {
  async getAll(): Promise<Product[]> {
    const q = query(collection(db, 'products'), orderBy('name'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
  },

  async getById(id: string): Promise<Product | null> {
    const snap = await getDoc(doc(db, 'products', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Product
  },

  async create(data: Omit<Product, 'id'|'createdAt'|'updatedAt'>): Promise<string> {
    const ref = await addDoc(collection(db, 'products'), {
      ...data, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    })
    return ref.id
  },

  async update(id: string, data: Partial<Product>): Promise<void> {
    await updateDoc(doc(db, 'products', id), { ...data, updatedAt: serverTimestamp() })
  },

  async getVersions(productId: string): Promise<ProductVersion[]> {
    const q = query(
      collection(db, 'productVersions'),
      where('productId', '==', productId),
      orderBy('version')
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductVersion))
  },

  async getActiveVersion(productId: string): Promise<ProductVersion | null> {
    const versions = await productService.getVersions(productId)
    return versions.filter(v => v.status === 'active').at(-1) ?? null
  },

  async createVersion(data: Omit<ProductVersion, 'id'|'createdAt'|'updatedAt'>): Promise<string> {
    const ref = await addDoc(collection(db, 'productVersions'), {
      ...data, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    })
    return ref.id
  },

  async updateVersion(id: string, data: Partial<ProductVersion>): Promise<void> {
    await updateDoc(doc(db, 'productVersions', id), { ...data, updatedAt: serverTimestamp() })
  },

  async getAllVersions(): Promise<ProductVersion[]> {
    const snap = await getDocs(collection(db, 'productVersions'))
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductVersion))
  },
}
```

- [ ] **Step 2: Implement ProductList page**

`src/pages/products/ProductList.tsx`:

Table columns: Product, Category, Current Version, Current Stock, Default Price, Status, Actions

- Load products + active versions + product stocks simultaneously
- Add Product modal: name, category, description, defaultSellingPrice, creates product and prompts to add first version
- Link to product detail: click product name → `/products/:id`
- Export button

- [ ] **Step 3: Implement ProductDetail page**

`src/pages/products/ProductDetail.tsx`:

This is the most complex page. Sections:

**Header:** Product name, edit button

**Tabs:** Overview | Performance | Production History | Sales History | Customers | BOM

**Overview tab:**
- Current Version (dropdown to switch viewed version)
- Current Stock (from inventoryTransactions sum)
- Default Selling Price
- Version management: list all versions, add new version, mark active

**Performance tab:**
Calculate from productions + orderItems:
```
Total Produced = sum(production.quantity where productId = X)
Total Sold     = sum(orderItem.quantity where productId = X and order.status != CANCELLED)
Current Stock  = Total Produced - Total Sold (cross-check with inventory)

Total Revenue  = sum(orderItem.totalPrice)
Total Cost     = sum(orderItem.totalCost)
Total Profit   = Revenue - Cost
Avg Price      = Revenue / Total Sold
Avg Cost       = Total Cost / Total Sold
Profit/Unit    = Avg Price - Avg Cost
Margin         = Profit / Revenue * 100
```

**Production History tab:**
Table: Date, Version, Quantity, Cost/Unit, Total Cost

**Sales History tab:**
Table: Date, Customer Name, Qty, Unit Price, Revenue, Cost, Profit
(Join orderItems with orders → customers)

**Customers tab:**
Aggregate: Customer, Qty Bought, Avg Price, Total Spent

**BOM tab:**
For selected version: list bomItems with materials. Add/Edit/Delete BOM items.
BOM form: select material (from materials list), quantity, unit.

- [ ] **Step 4: Verify product flow**

Create product → add V1 → add BOM to V1 → navigate to detail → see all tabs.


---

### Task 10: Production Service + Production Page

**Files:**
- Create: `src/services/production.ts`
- Replace: `src/pages/production/ProductionPage.tsx`

**Interfaces:**
- Consumes: `productService`, `bomService`, `inventoryService`, `materialService`
- Produces: `productionService.getAll()`, `productionService.create(data)`, `productionService.complete(id)`
- Produces: Production page with material check before completion

- [ ] **Step 1: Create production service**

`src/services/production.ts`:
```ts
import {
  collection, doc, getDocs, addDoc, updateDoc,
  query, orderBy, serverTimestamp, writeBatch, Timestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Production, ProductionMaterial, InventoryTransaction } from '../types'
import { inventoryService } from './inventory'

export const productionService = {
  async getAll(): Promise<Production[]> {
    const q = query(collection(db, 'productions'), orderBy('productionDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Production))
  },

  async getByProductId(productId: string): Promise<Production[]> {
    const all = await productionService.getAll()
    return all.filter(p => p.productId === productId)
  },

  async getMaterials(productionId: string): Promise<ProductionMaterial[]> {
    const q = query(collection(db, 'productionMaterials'), ...[])
    // filter client-side for simplicity
    const snap = await getDocs(collection(db, 'productionMaterials'))
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as ProductionMaterial))
      .filter(m => m.productionId === productionId)
  },

  // Complete production: creates productionMaterials + inventory transactions in a batch
  async complete(params: {
    productId: string
    productVersionId: string
    quantity: number
    productionDate: Timestamp
    notes: string
    bomMaterials: Array<{ materialId: string; plannedQty: number; unitCost: number }>
  }): Promise<string> {
    const batch = writeBatch(db)

    // Calculate costs
    const totalMaterialCost = params.bomMaterials.reduce(
      (sum, m) => sum + m.plannedQty * params.quantity * m.unitCost, 0
    )
    const costPerUnit = totalMaterialCost / params.quantity

    // Create production record
    const prodRef = doc(collection(db, 'productions'))
    batch.set(prodRef, {
      productId: params.productId,
      productVersionId: params.productVersionId,
      quantity: params.quantity,
      productionDate: params.productionDate,
      totalMaterialCost,
      costPerUnit,
      status: 'COMPLETED',
      notes: params.notes,
      createdAt: serverTimestamp(),
    })

    // Create productionMaterials + CONSUMPTION transactions
    for (const m of params.bomMaterials) {
      const totalQty = m.plannedQty * params.quantity
      const totalCost = totalQty * m.unitCost

      const pmRef = doc(collection(db, 'productionMaterials'))
      batch.set(pmRef, {
        productionId: prodRef.id,
        materialId: m.materialId,
        plannedQuantity: totalQty,
        actualQuantity: totalQty,
        wasteQuantity: 0,
        unitCost: m.unitCost,
        totalCost,
      })

      const txRef = doc(collection(db, 'inventoryTransactions'))
      batch.set(txRef, {
        itemType: 'material',
        itemId: m.materialId,
        transactionType: 'CONSUMPTION',
        quantity: -totalQty,
        unit: '',
        referenceType: 'production',
        referenceId: prodRef.id,
        notes: `Production of ${params.quantity} units`,
        createdAt: serverTimestamp(),
      })
    }

    // PRODUCTION transaction for finished product
    const finishedTxRef = doc(collection(db, 'inventoryTransactions'))
    batch.set(finishedTxRef, {
      itemType: 'product',
      itemId: params.productId,
      transactionType: 'PRODUCTION',
      quantity: params.quantity,
      unit: 'units',
      referenceType: 'production',
      referenceId: prodRef.id,
      notes: `Completed production run`,
      createdAt: serverTimestamp(),
    })

    await batch.commit()
    return prodRef.id
  },
}
```

- [ ] **Step 2: Implement Production page**

`src/pages/production/ProductionPage.tsx`:

Two sections:
1. **New Production** (form at top)
2. **Production History** (table below)

**New Production form:**
- Select Product (dropdown from products list)
- Select Version (filtered by product, shows active version by default)
- Enter Quantity
- Production Date (date picker)
- Notes

**After product/version/quantity selected, show:**
```
Required Materials

| Material | Req/Unit | Required Total | Available | Status |
|----------|----------|----------------|-----------|--------|
| Pink Paper | 6 sheets | 150 sheets | 350 | ✅ OK |
| Glue | 8 ml | 200 ml | 50 ml | ❌ INSUFFICIENT |
```

- Calculate: required = bomItem.quantity × productionQuantity
- Available = current stock from `inventoryService.getMaterialStocks()`
- Status: OK (green badge) or INSUFFICIENT (red badge)
- Disable "Complete Production" button if any material insufficient
- On submit: call `productionService.complete()`, show success toast, reload history

**Production History table:**
Date | Product | Version | Qty | Cost/Unit | Total Cost | Status


---

### Task 11: Purchase Service + Purchase Page

**Files:**
- Create: `src/services/purchases.ts`
- Create: `src/pages/purchases/PurchasePage.tsx`
- Add route: purchases → AppRoutes + Sidebar

**Interfaces:**
- Produces: `purchaseService.getAll()`, `purchaseService.complete(data)` — on completion creates inventory PURCHASE transaction
- Consumes: `materialService`, `supplierService`, `inventoryService.addTransaction()`

- [ ] **Step 1: Create purchase service**

`src/services/purchases.ts`:
```ts
import { collection, doc, getDocs, addDoc, query, orderBy, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Purchase, PurchaseItem } from '../types'

export const purchaseService = {
  async getAll(): Promise<Purchase[]> {
    const q = query(collection(db, 'purchases'), orderBy('purchaseDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Purchase))
  },

  async complete(params: {
    supplierId: string
    purchaseDate: Timestamp
    notes: string
    items: Array<{ materialId: string; quantity: number; unitCost: number; unit: string }>
  }): Promise<string> {
    const batch = writeBatch(db)
    const total = params.items.reduce((s, i) => s + i.quantity * i.unitCost, 0)

    const purchaseRef = doc(collection(db, 'purchases'))
    batch.set(purchaseRef, {
      supplierId: params.supplierId,
      purchaseDate: params.purchaseDate,
      total,
      status: 'COMPLETED',
      notes: params.notes,
      createdAt: serverTimestamp(),
    })

    for (const item of params.items) {
      const piRef = doc(collection(db, 'purchaseItems'))
      batch.set(piRef, {
        purchaseId: purchaseRef.id,
        materialId: item.materialId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        total: item.quantity * item.unitCost,
      })

      const txRef = doc(collection(db, 'inventoryTransactions'))
      batch.set(txRef, {
        itemType: 'material',
        itemId: item.materialId,
        transactionType: 'PURCHASE',
        quantity: item.quantity,
        unit: item.unit,
        referenceType: 'purchase',
        referenceId: purchaseRef.id,
        notes: `Purchase from supplier`,
        createdAt: serverTimestamp(),
      })
    }

    await batch.commit()
    return purchaseRef.id
  },
}
```

- [ ] **Step 2: Add Purchase page**

`src/pages/purchases/PurchasePage.tsx`:

- Form: Supplier (select), Purchase Date, Notes
- Add multiple line items: Material (select), Quantity, Unit Cost
- Shows running total
- Submit calls `purchaseService.complete()`
- History table below: Date, Supplier, Items, Total

- [ ] **Step 3: Wire purchases into routing**

Add to `src/routes/index.tsx` and `src/layouts/Sidebar.tsx`:
- Route: `path="purchases"` → PurchasePage
- Nav item: Purchases (between Materials and Production)


---

### Task 12: Order Service + Order List + Order Detail

**Files:**
- Create: `src/services/orders.ts`
- Replace: `src/pages/orders/OrderList.tsx`
- Replace: `src/pages/orders/OrderDetail.tsx`

**Interfaces:**
- Produces: `orderService.getAll()`, `orderService.getById(id)`, `orderService.getByCustomerId(id)`, `orderService.create(data)`, `orderService.updateStatus(id, status)`, `orderService.getItems(orderId)`, `orderService.addItem(item)`, `orderService.removeItem(id)`
- Consumes: `inventoryService.addTransaction()` — when order status → COMPLETED, creates SALE transactions

- [ ] **Step 1: Create order service**

`src/services/orders.ts`:
```ts
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc,
  query, where, orderBy, serverTimestamp, writeBatch, Timestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Order, OrderItem, OrderStatus } from '../types'

export const orderService = {
  async getAll(): Promise<Order[]> {
    const q = query(collection(db, 'orders'), orderBy('orderDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Order))
  },

  async getById(id: string): Promise<Order | null> {
    const snap = await getDoc(doc(db, 'orders', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Order
  },

  async getByCustomerId(customerId: string): Promise<Order[]> {
    const q = query(collection(db, 'orders'), where('customerId', '==', customerId), orderBy('orderDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Order))
  },

  async getItems(orderId: string): Promise<OrderItem[]> {
    const snap = await getDocs(collection(db, 'orderItems'))
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as OrderItem))
      .filter(i => i.orderId === orderId)
  },

  async create(data: {
    customerId: string
    orderDate: Timestamp
    eventDate: Timestamp | null
    eventType: string
    discount: number
    notes: string
    items: Array<{ productId: string; productVersionId: string; quantity: number; unitPrice: number; costPerUnit: number }>
  }): Promise<string> {
    const batch = writeBatch(db)
    const subtotal = data.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    const total = subtotal - data.discount

    const orderRef = doc(collection(db, 'orders'))
    batch.set(orderRef, {
      customerId: data.customerId,
      orderDate: data.orderDate,
      eventDate: data.eventDate,
      eventType: data.eventType,
      subtotal,
      discount: data.discount,
      total,
      status: 'CONFIRMED',
      notes: data.notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })

    for (const item of data.items) {
      const totalPrice = item.quantity * item.unitPrice
      const totalCost = item.quantity * item.costPerUnit
      const itemRef = doc(collection(db, 'orderItems'))
      batch.set(itemRef, {
        orderId: orderRef.id,
        productId: item.productId,
        productVersionId: item.productVersionId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice,
        costPerUnit: item.costPerUnit,
        totalCost,
        profit: totalPrice - totalCost,
      })
    }

    await batch.commit()
    return orderRef.id
  },

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    const batch = writeBatch(db)
    batch.update(doc(db, 'orders', id), { status, updatedAt: serverTimestamp() })

    // When completing, create SALE inventory transactions
    if (status === 'COMPLETED') {
      const items = await orderService.getItems(id)
      for (const item of items) {
        const txRef = doc(collection(db, 'inventoryTransactions'))
        batch.set(txRef, {
          itemType: 'product',
          itemId: item.productId,
          transactionType: 'SALE',
          quantity: -item.quantity,
          unit: 'units',
          referenceType: 'order',
          referenceId: id,
          notes: `Sale order ${id}`,
          createdAt: serverTimestamp(),
        })
      }
    }

    await batch.commit()
  },

  async cancel(id: string): Promise<void> {
    await orderService.updateStatus(id, 'CANCELLED')
  },
}
```

- [ ] **Step 2: Implement Order List page**

`src/pages/orders/OrderList.tsx`:

Table: Order ID (short), Customer, Date, Event, Amount, Status, Actions

- Status badge colors: DRAFT=secondary, CONFIRMED=primary, COMPLETED=success, CANCELLED=danger, etc.
- New Order modal:
  - Select Customer
  - Order Date, Event Date, Event Type, Discount, Notes
  - Add line items: Select Product → Select Version → Quantity → Unit Price (pre-filled from defaultSellingPrice, editable) → Cost/Unit (pre-filled from last production costPerUnit, editable)
  - Running total display
- Click order row → `/orders/:id`
- Filter by status
- Export button

- [ ] **Step 3: Implement Order Detail page**

`src/pages/orders/OrderDetail.tsx`:

- Order header: Customer, Dates, Status, Total
- Status update buttons (move to next status)
- Order items table: Product, Version, Qty, Unit Price, Total, Cost, Profit
- Cancel order button (with confirmation)
- Summary: Subtotal, Discount, Total, Total Cost, Total Profit


---

### Task 13: Inventory Page + History Page

**Files:**
- Replace: `src/pages/inventory/InventoryPage.tsx`
- Replace: `src/pages/history/HistoryPage.tsx`

**Interfaces:**
- Consumes: `inventoryService`, `materialService`, `productService`

- [ ] **Step 1: Implement Inventory page**

`src/pages/inventory/InventoryPage.tsx`:

Two Bootstrap tabs:

**Raw Materials tab:**
Table: Material, Current Stock, Unit, Min Stock, Value (stock × costPerUnit), Status (OK/LOW STOCK)
- Click row → show transaction history panel/modal for that material

**Finished Products tab:**
Table: Product, Current Version, Current Stock
- Click row → show transaction history panel/modal

Filters: Date range, Transaction Type

- [ ] **Step 2: Implement History page**

`src/pages/history/HistoryPage.tsx`:

Single unified activity log from `inventoryTransactions` ordered by createdAt desc.

Table:
| Date | Type | Item Name | Qty | Reference | Notes |

- Resolve item names: join with material/product names client-side
- Transaction type badge colors: PURCHASE=success, CONSUMPTION=warning, SALE=info, WASTE=danger, PRODUCTION=primary
- Filters: Date Range (from/to), Type (multi-select checkboxes), Item search
- Export button


---

### Task 14: Reports Page

**Files:**
- Create: `src/services/reports.ts`
- Replace: `src/pages/reports/ReportsPage.tsx`

**Interfaces:**
- Produces: Report data computed from orders, productions, inventoryTransactions — no duplicate collections
- Consumes: `orderService`, `productionService`, `materialService`, `productService`, `customerService`

- [ ] **Step 1: Create reports service**

`src/services/reports.ts`:
```ts
import { orderService } from './orders'
import { productionService } from './production'
import { inventoryService } from './inventory'
import { customerService } from './customers'
import { productService } from './products'
import { materialService } from './materials'
import { Timestamp } from 'firebase/firestore'

export interface SalesReportRow {
  date: string
  customer: string
  product: string
  quantity: number
  unitPrice: number
  revenue: number
  cost: number
  profit: number
}

export interface ProductProfitabilityRow {
  productId: string
  product: string
  unitsSold: number
  revenue: number
  cost: number
  profit: number
  margin: number
}

export interface CustomerSalesRow {
  customerId: string
  customer: string
  orders: number
  revenue: number
}

export interface MaterialConsumptionRow {
  material: string
  quantityUsed: number
  cost: number
}

export interface ProductionReportRow {
  date: string
  product: string
  version: string
  quantity: number
  costPerUnit: number
  totalCost: number
}

export const reportService = {
  async getSalesReport(from?: Date, to?: Date): Promise<SalesReportRow[]> {
    const [orders, customers, products] = await Promise.all([
      orderService.getAll(),
      customerService.getAll(),
      productService.getAll(),
    ])

    const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]))
    const productMap = Object.fromEntries(products.map(p => [p.id, p.name]))

    const rows: SalesReportRow[] = []
    for (const order of orders) {
      if (order.status === 'CANCELLED') continue
      const orderDate = order.orderDate.toDate()
      if (from && orderDate < from) continue
      if (to && orderDate > to) continue

      const items = await orderService.getItems(order.id)
      for (const item of items) {
        rows.push({
          date: orderDate.toLocaleDateString('en-IN'),
          customer: customerMap[order.customerId] ?? '?',
          product: productMap[item.productId] ?? '?',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          revenue: item.totalPrice,
          cost: item.totalCost,
          profit: item.profit,
        })
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date))
  },

  async getProductProfitability(from?: Date, to?: Date): Promise<ProductProfitabilityRow[]> {
    const [orders, products] = await Promise.all([orderService.getAll(), productService.getAll()])
    const productMap = Object.fromEntries(products.map(p => [p.id, p.name]))

    const map: Record<string, ProductProfitabilityRow> = {}
    for (const order of orders) {
      if (order.status === 'CANCELLED') continue
      const items = await orderService.getItems(order.id)
      for (const item of items) {
        const pid = item.productId
        if (!map[pid]) map[pid] = { productId: pid, product: productMap[pid]??'?', unitsSold: 0, revenue: 0, cost: 0, profit: 0, margin: 0 }
        map[pid].unitsSold += item.quantity
        map[pid].revenue += item.totalPrice
        map[pid].cost += item.totalCost
        map[pid].profit += item.profit
      }
    }
    return Object.values(map).map(r => ({
      ...r,
      margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0,
    })).sort((a, b) => b.profit - a.profit)
  },

  async getCustomerSales(from?: Date, to?: Date): Promise<CustomerSalesRow[]> {
    const [orders, customers] = await Promise.all([orderService.getAll(), customerService.getAll()])
    const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]))

    const map: Record<string, CustomerSalesRow> = {}
    for (const order of orders) {
      if (order.status === 'CANCELLED') continue
      const cid = order.customerId
      if (!map[cid]) map[cid] = { customerId: cid, customer: customerMap[cid]??'?', orders: 0, revenue: 0 }
      map[cid].orders += 1
      map[cid].revenue += order.total
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue)
  },

  async getProductionReport(from?: Date, to?: Date): Promise<ProductionReportRow[]> {
    const [productions, products, versions] = await Promise.all([
      productionService.getAll(),
      productService.getAll(),
      productService.getAllVersions(),
    ])
    const productMap = Object.fromEntries(products.map(p => [p.id, p.name]))
    const versionMap = Object.fromEntries(versions.map(v => [v.id, v.version]))

    return productions
      .filter(p => p.status === 'COMPLETED')
      .map(p => ({
        date: p.productionDate.toDate().toLocaleDateString('en-IN'),
        product: productMap[p.productId] ?? '?',
        version: versionMap[p.productVersionId] ?? '?',
        quantity: p.quantity,
        costPerUnit: p.costPerUnit,
        totalCost: p.totalMaterialCost,
      }))
  },
}
```

- [ ] **Step 2: Implement Reports page**

`src/pages/reports/ReportsPage.tsx`:

Bootstrap tabs: Sales Report | Product Profitability | Customer Sales | Production Report

Each tab:
- Date range filter (From, To date inputs)
- "Generate Report" button
- Table with all columns from spec
- Export CSV + Export Excel buttons
- Loading state while generating

**Product Profitability tab** — also show a simple horizontal bar or stat cards for top 3 products.


---

### Task 15: Dashboard

**Files:**
- Replace: `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: all services (customers, products, orders, inventory, materials)
- No new services needed — all data computed from existing services

- [ ] **Step 1: Implement Dashboard**

`src/pages/Dashboard.tsx`:

Load all data in parallel on mount. Show loading spinner while loading.

**Stat cards row (6 cards):**
```tsx
// Use Bootstrap col-md-2 or col-md-4 layout
// Total Customers: customerService.getAll() → length (active only)
// Total Products: productService.getAll() → length (active only)
// Open Orders: orderService.getAll() → filter status not in [COMPLETED, CANCELLED]
// Raw Material Stock Value: sum(stock × costPerUnit) for all materials
// Finished Product Units: sum of product stocks
// Low Stock Items: materials where currentStock < minimumStock
```

**Recent Orders table:**
Last 5 orders: Order ID, Customer, Date, Amount, Status badge

**Recent Production table:**
Last 5 productions: Date, Product, Version, Quantity

**Low Stock Materials table:**
Materials where stock < minimumStock: Material, Current Stock, Minimum Stock

**Product Profitability Summary:**
Top 5 products by profit (from reportService.getProductProfitability())

Each section in its own Bootstrap card with a heading.

- [ ] **Step 2: Verify dashboard loads correctly with seed data**

Start emulators + app. Verify all 6 stat cards show numbers, tables show data.


---

### Task 16: Firestore Security Rules

**Files:**
- Create: `firestore.rules`
- Create: `storage.rules`

**Interfaces:**
- Produces: Firestore + Storage locked to authenticated users

- [ ] **Step 1: Write Firestore rules**

`firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

- [ ] **Step 2: Write Storage rules**

`storage.rules`:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```


---

### Task 17: Seed Data Script

**Files:**
- Create: `scripts/seed.ts`
- Create: `scripts/tsconfig.json`

**Interfaces:**
- Produces: `npm run seed` that populates all collections in the local emulator with the end-to-end test scenario from spec section 34

- [ ] **Step 1: Set up scripts environment**

```bash
npm install -D ts-node @types/node firebase-admin
```

`scripts/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es2020",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist-scripts"
  },
  "include": ["scripts/**/*"]
}
```

Add to `package.json` scripts:
```json
"seed": "FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 ts-node --project scripts/tsconfig.json scripts/seed.ts"
```

- [ ] **Step 2: Write seed script**

`scripts/seed.ts`:

The script must implement the complete end-to-end scenario from spec section 34:

```ts
import * as admin from 'firebase-admin'

// Initialize with emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'

admin.initializeApp({ projectId: 'demo-project' })
const db = admin.firestore()
const authAdmin = admin.auth()

async function seed() {
  console.log('Seeding database...')

  // Create test user
  try {
    await authAdmin.createUser({ email: 'admin@craftbiz.local', password: 'password123', displayName: 'Admin' })
  } catch (e) { console.log('User already exists') }

  // Suppliers
  const [supplier1Id] = await Promise.all([
    db.collection('suppliers').add({ name: 'Paper Mart India', phone: '9876543210', email: 'supplier@papermart.in', address: 'Mumbai', notes: '', status: 'active' }).then(r => r.id),
  ])

  // Materials
  const materials = {
    pinkPaper:    await db.collection('materials').add({ name: 'Pink Craft Paper', category: 'Paper', unit: 'sheets', minimumStock: 100, costPerUnit: 4, supplierId: supplier1Id, notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    greenPaper:   await db.collection('materials').add({ name: 'Green Craft Paper', category: 'Paper', unit: 'sheets', minimumStock: 50, costPerUnit: 4, supplierId: supplier1Id, notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    whitePaper:   await db.collection('materials').add({ name: 'White Craft Paper', category: 'Paper', unit: 'sheets', minimumStock: 50, costPerUnit: 3, supplierId: supplier1Id, notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    goldRibbon:   await db.collection('materials').add({ name: 'Gold Ribbon', category: 'Ribbon', unit: 'meters', minimumStock: 20, costPerUnit: 15, supplierId: supplier1Id, notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    glue:         await db.collection('materials').add({ name: 'Craft Glue', category: 'Adhesive', unit: 'ml', minimumStock: 500, costPerUnit: 0.05, supplierId: supplier1Id, notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    woodenStick:  await db.collection('materials').add({ name: 'Wooden Stick', category: 'Structure', unit: 'pieces', minimumStock: 50, costPerUnit: 5, supplierId: supplier1Id, notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    glitter:      await db.collection('materials').add({ name: 'Glitter', category: 'Decoration', unit: 'grams', minimumStock: 100, costPerUnit: 0.5, supplierId: supplier1Id, notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
  }

  // Customers
  const customers = {
    priya: await db.collection('customers').add({ name: 'Priya Sharma', phone: '9812345678', email: 'priya@example.com', address: '12 Rose Garden', city: 'Mumbai', notes: 'Regular customer', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    anil:  await db.collection('customers').add({ name: 'Anil Kumar', phone: '9823456789', email: 'anil@example.com', address: '45 Patel Nagar', city: 'Delhi', notes: '', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
    smith: await db.collection('customers').add({ name: 'John Smith', phone: '9834567890', email: 'smith@example.com', address: '7 Park Lane', city: 'Bangalore', notes: 'Bulk buyer', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id),
  }

  // Products
  const roseId = await db.collection('products').add({ name: 'Large Paper Rose', category: 'Paper Craft', description: 'Handmade large paper rose decoration', defaultSellingPrice: 250, status: 'active', imageUrl: '', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)
  const bannerId = await db.collection('products').add({ name: 'Birthday Banner', category: 'Banner', description: 'Custom birthday banner with glitter', defaultSellingPrice: 180, status: 'active', imageUrl: '', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)
  const butterflyId = await db.collection('products').add({ name: 'Paper Butterfly', category: 'Paper Craft', description: 'Delicate paper butterfly for decoration', defaultSellingPrice: 120, status: 'active', imageUrl: '', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)

  // Product Versions
  const roseV1 = await db.collection('productVersions').add({ productId: roseId, version: 'V1', description: 'Original design', status: 'inactive', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)
  const roseV2 = await db.collection('productVersions').add({ productId: roseId, version: 'V2', description: 'Improved petal shape', status: 'inactive', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)
  const roseV3 = await db.collection('productVersions').add({ productId: roseId, version: 'V3', description: 'Premium finish with wooden stick', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)
  const bannerV1 = await db.collection('productVersions').add({ productId: bannerId, version: 'V1', description: 'Standard banner', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)
  const butterflyV1 = await db.collection('productVersions').add({ productId: butterflyId, version: 'V1', description: 'Standard butterfly', status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }).then(r => r.id)

  // BOM for Large Paper Rose V3
  await Promise.all([
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.pinkPaper, quantity: 6, unit: 'sheets' }),
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.greenPaper, quantity: 2, unit: 'sheets' }),
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.glue, quantity: 8, unit: 'ml' }),
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.woodenStick, quantity: 1, unit: 'pieces' }),
    // BOM for Banner V1
    db.collection('bomItems').add({ productVersionId: bannerV1, materialId: materials.whitePaper, quantity: 4, unit: 'sheets' }),
    db.collection('bomItems').add({ productVersionId: bannerV1, materialId: materials.goldRibbon, quantity: 0.5, unit: 'meters' }),
    db.collection('bomItems').add({ productVersionId: bannerV1, materialId: materials.glitter, quantity: 10, unit: 'grams' }),
  ])

  // Purchase: Pink Paper 500 sheets @ ₹4
  const purchaseRef = await db.collection('purchases').add({ supplierId: supplier1Id, purchaseDate: admin.firestore.Timestamp.now(), total: 2000, status: 'COMPLETED', notes: 'Initial stock', createdAt: admin.firestore.FieldValue.serverTimestamp() })
  await db.collection('purchaseItems').add({ purchaseId: purchaseRef.id, materialId: materials.pinkPaper, quantity: 500, unitCost: 4, total: 2000 })
  await db.collection('inventoryTransactions').add({ itemType: 'material', itemId: materials.pinkPaper, transactionType: 'PURCHASE', quantity: 500, unit: 'sheets', referenceType: 'purchase', referenceId: purchaseRef.id, notes: 'Initial stock purchase', createdAt: admin.firestore.FieldValue.serverTimestamp() })

  // More material purchases for green paper, glue, wooden sticks
  await db.collection('inventoryTransactions').add({ itemType: 'material', itemId: materials.greenPaper, transactionType: 'PURCHASE', quantity: 200, unit: 'sheets', referenceType: 'manual', referenceId: '', notes: 'Initial stock', createdAt: admin.firestore.FieldValue.serverTimestamp() })
  await db.collection('inventoryTransactions').add({ itemType: 'material', itemId: materials.glue, transactionType: 'PURCHASE', quantity: 2000, unit: 'ml', referenceType: 'manual', referenceId: '', notes: 'Initial stock', createdAt: admin.firestore.FieldValue.serverTimestamp() })
  await db.collection('inventoryTransactions').add({ itemType: 'material', itemId: materials.woodenStick, transactionType: 'PURCHASE', quantity: 100, unit: 'pieces', referenceType: 'manual', referenceId: '', notes: 'Initial stock', createdAt: admin.firestore.FieldValue.serverTimestamp() })
  await db.collection('inventoryTransactions').add({ itemType: 'material', itemId: materials.whitePaper, transactionType: 'PURCHASE', quantity: 300, unit: 'sheets', referenceType: 'manual', referenceId: '', notes: 'Initial stock', createdAt: admin.firestore.FieldValue.serverTimestamp() })
  await db.collection('inventoryTransactions').add({ itemType: 'material', itemId: materials.goldRibbon, transactionType: 'PURCHASE', quantity: 50, unit: 'meters', referenceType: 'manual', referenceId: '', notes: 'Initial stock', createdAt: admin.firestore.FieldValue.serverTimestamp() })
  await db.collection('inventoryTransactions').add({ itemType: 'material', itemId: materials.glitter, transactionType: 'PURCHASE', quantity: 500, unit: 'grams', referenceType: 'manual', referenceId: '', notes: 'Initial stock', createdAt: admin.firestore.FieldValue.serverTimestamp() })

  // Production: 25 Large Paper Roses V3
  // costPerUnit = (6×4 + 2×4 + 8×0.05 + 1×5) = 24+8+0.4+5 = 37.4 per unit
  const costPerUnit = 6*4 + 2*4 + 8*0.05 + 1*5  // 37.4
  const prodQuantity = 25
  const prodRef = await db.collection('productions').add({
    productId: roseId, productVersionId: roseV3, quantity: prodQuantity,
    productionDate: admin.firestore.Timestamp.now(),
    totalMaterialCost: costPerUnit * prodQuantity,
    costPerUnit,
    status: 'COMPLETED',
    notes: 'First production run',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // ProductionMaterials + CONSUMPTION transactions
  const bomItems = [
    { materialId: materials.pinkPaper, qty: 6, unitCost: 4, unit: 'sheets' },
    { materialId: materials.greenPaper, qty: 2, unitCost: 4, unit: 'sheets' },
    { materialId: materials.glue, qty: 8, unitCost: 0.05, unit: 'ml' },
    { materialId: materials.woodenStick, qty: 1, unitCost: 5, unit: 'pieces' },
  ]
  for (const bom of bomItems) {
    const totalQty = bom.qty * prodQuantity
    await db.collection('productionMaterials').add({
      productionId: prodRef.id, materialId: bom.materialId,
      plannedQuantity: totalQty, actualQuantity: totalQty, wasteQuantity: 0,
      unitCost: bom.unitCost, totalCost: totalQty * bom.unitCost,
    })
    await db.collection('inventoryTransactions').add({
      itemType: 'material', itemId: bom.materialId,
      transactionType: 'CONSUMPTION', quantity: -totalQty, unit: bom.unit,
      referenceType: 'production', referenceId: prodRef.id,
      notes: `Production of 25 Large Paper Roses V3`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
  // Finished product inventory
  await db.collection('inventoryTransactions').add({
    itemType: 'product', itemId: roseId,
    transactionType: 'PRODUCTION', quantity: 25, unit: 'units',
    referenceType: 'production', referenceId: prodRef.id,
    notes: 'Completed production of 25 units',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Orders (using exact scenario from spec section 34)
  // Order 1: Priya buys 10 @ ₹250
  const order1Ref = await db.collection('orders').add({
    customerId: customers.priya, orderDate: admin.firestore.Timestamp.now(),
    eventDate: null, eventType: 'Birthday',
    subtotal: 2500, discount: 0, total: 2500,
    status: 'COMPLETED', notes: '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  await db.collection('orderItems').add({
    orderId: order1Ref.id, productId: roseId, productVersionId: roseV3,
    quantity: 10, unitPrice: 250, totalPrice: 2500,
    costPerUnit, totalCost: costPerUnit * 10, profit: 2500 - costPerUnit * 10,
  })
  await db.collection('inventoryTransactions').add({
    itemType: 'product', itemId: roseId, transactionType: 'SALE', quantity: -10, unit: 'units',
    referenceType: 'order', referenceId: order1Ref.id,
    notes: 'Sale order - Priya', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Order 2: Anil buys 5 @ ₹225
  const order2Ref = await db.collection('orders').add({
    customerId: customers.anil, orderDate: admin.firestore.Timestamp.now(),
    eventDate: null, eventType: 'Anniversary',
    subtotal: 1125, discount: 0, total: 1125,
    status: 'COMPLETED', notes: '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  await db.collection('orderItems').add({
    orderId: order2Ref.id, productId: roseId, productVersionId: roseV3,
    quantity: 5, unitPrice: 225, totalPrice: 1125,
    costPerUnit, totalCost: costPerUnit * 5, profit: 1125 - costPerUnit * 5,
  })
  await db.collection('inventoryTransactions').add({
    itemType: 'product', itemId: roseId, transactionType: 'SALE', quantity: -5, unit: 'units',
    referenceType: 'order', referenceId: order2Ref.id,
    notes: 'Sale order - Anil', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Order 3: Smith buys 8 Birthday Banners @ ₹200 (different product, different price)
  const order3Ref = await db.collection('orders').add({
    customerId: customers.smith, orderDate: admin.firestore.Timestamp.now(),
    eventDate: null, eventType: 'Party',
    subtotal: 1600, discount: 100, total: 1500,
    status: 'CONFIRMED', notes: 'Bulk discount applied',
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  await db.collection('orderItems').add({
    orderId: order3Ref.id, productId: bannerId, productVersionId: bannerV1,
    quantity: 8, unitPrice: 200, totalPrice: 1600,
    costPerUnit: 20, totalCost: 160, profit: 1440,
  })

  console.log('✅ Seed complete!')
  console.log('Login: admin@craftbiz.local / password123')
  process.exit(0)
}

seed().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Test seed script**

```bash
# In one terminal:
npx firebase emulators:start --project demo-project

# In another terminal:
npm run seed
```

Expected: All collections populated. "Seed complete!" message.


---

### Task 18: README + Final Verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

`README.md`:
```markdown
# Party Craft — Inventory & Customer Management

A web application for managing a small party-decoration and paper-craft business.

## Tech Stack

- React 18 + Vite + TypeScript
- Bootstrap 5
- Firebase (Firestore, Auth, Storage)
- Firebase Emulator Suite (local dev)

## Local Development

### Prerequisites

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`

### Setup

```bash
npm install
```

### Start Firebase Emulators

```bash
npx firebase emulators:start --project demo-project
```

Emulator UI: http://localhost:4000

### Start Dev Server

```bash
npm run dev
```

App: http://localhost:5173

### Seed Sample Data

With emulators running:
```bash
npm run seed
```

### Test Login

Email: admin@craftbiz.local
Password: password123

## Production Firebase Setup

1. Create a Firebase project at console.firebase.google.com
2. Enable Firestore, Authentication (email/password), and Storage
3. Copy your Firebase config values to `.env.production`
4. Deploy rules: `firebase deploy --only firestore:rules,storage`
5. Deploy app: `npm run build && firebase deploy --only hosting`

## End-to-End Test Scenario

After seeding, verify:
1. Dashboard shows 3 customers, 3 products, stock values
2. Products → Large Paper Rose → Performance tab shows:
   - Produced: 25, Sold: 15, Stock: 10
   - Revenue: ₹3,625, Cost based on ₹37.40/unit
3. Products → Large Paper Rose → Customers tab shows:
   - Priya: 10 units @ ₹250
   - Anil: 5 units @ ₹225
4. Customers → Priya → Order History shows 1 completed order
```

- [ ] **Step 2: Full end-to-end verification**

With emulators running and seed data loaded:
1. Open http://localhost:5173
2. Login with admin@craftbiz.local / password123
3. Check Dashboard — all 6 stat cards populated
4. Customers — list shows 3 customers
5. Products → Large Paper Rose → Performance tab — verify numbers
6. Materials — all 7 materials with stock levels
7. Production — create a new production run
8. Orders — verify existing orders show correct amounts
9. Reports → Product Profitability → verify Large Paper Rose shows profit
10. History — shows all transactions


---

## Spec Coverage Check

| Spec Section | Task |
|---|---|
| 1. Tech Stack | Task 1 |
| 2. Local Development | Task 1, 17 |
| 3. Application Layout | Task 5 |
| 4. Authentication | Task 4 |
| 5. Dashboard | Task 15 |
| 6. Customers | Task 6 |
| 7. Products | Task 9 |
| 8. Product Versions | Task 9 |
| 9. Product Details Page | Task 9 |
| 10. Materials | Task 8 |
| 11. BOM | Task 8, 9 |
| 12. Production | Task 10 |
| 13. Production Material Details | Task 10 |
| 14. Inventory (ledger) | Task 8, 11 |
| 15. Inventory Page | Task 13 |
| 16. Orders | Task 12 |
| 17. Order Items | Task 12 |
| 18. Sales / Profitability | Task 9, 14 |
| 19. Product Transformation | Task 13 (TRANSFORMATION tx type) |
| 20. Suppliers | Task 7 |
| 21. Purchases | Task 11 |
| 22. History Page | Task 13 |
| 23. Reports | Task 14 |
| 24. Export | Task 3, 14 |
| 25. Profit Calculation | Task 9, 14 |
| 26. Data Integrity Rules | Tasks 10, 12 (status-based cancel) |
| 27. Firestore Design | Task 2 |
| 28. Security Rules | Task 16 |
| 29. Seed Data | Task 17 |
| 30. UI Requirements | All tasks |
| 31. Project Structure | Task 5 |
| 34. End-to-End Test | Task 17-18 |
