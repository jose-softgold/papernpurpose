import { Timestamp } from 'firebase/firestore'

export type UserRole = 'owner' | 'admin' | 'worker' | 'viewer'

export interface UserDoc {
  email: string
  name: string
  role: UserRole
  active: boolean
  whatsappPhone?: string
  createdAt: Timestamp
  createdBy: string
}

export interface WorkerOption {
  id: string
  name: string
  email: string
}

export const DEFAULT_GST_RATES = [0, 5, 12, 18, 28] as const
/** @deprecated Prefer DEFAULT_GST_RATES — kept for older imports. */
export const GST_RATES = DEFAULT_GST_RATES
export type GstRate = number

/** Company-wide GST slab list (`meta/gstSlabs`). */
export interface GstSlabsSettings {
  rates: number[]
}

export interface Customer {
  id: string
  type: 'individual' | 'company'
  name: string
  companyName?: string
  contactPerson?: string
  phone: string
  email: string
  address: string
  city: string
  notes: string
  status: 'active' | 'inactive'
  mapLink?: string
  photoUrls?: string[]
  gstin?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type OccasionKind = 'festival' | 'national' | 'personal' | 'other'
export type OccasionStatus = 'active' | 'inactive'
export type OccasionSeasonStatus = 'upcoming' | 'active' | 'closed'

export interface Occasion {
  id: string
  name: string
  slug: string
  kind: OccasionKind
  typicalMonth?: number | null
  typicalDay?: number | null
  status: OccasionStatus
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface OccasionSeason {
  id: string
  occasionId: string
  year: number
  name: string
  startsAt?: Timestamp | null
  endsAt?: Timestamp | null
  status: OccasionSeasonStatus
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Product {
  id: string
  name: string
  category: string
  description: string
  defaultSellingPrice: number
  /**
   * Optional product override for BOM suggested selling price.
   * Null/absent = inherit company default from Settings (`meta/pricing`).
   */
  targetMarginPct?: number | null
  status: 'active' | 'inactive'
  imageUrl: string
  photoUrls?: string[]
  packagingNotes?: string
  packagingPhotoUrls?: string[]
  gstRate?: number
  hsnSac?: string
  occasionIds?: string[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ProductVersion {
  id: string
  productId: string
  version: string
  description: string
  status: 'active' | 'inactive'
  /** Taxable catalog selling price frozen on this recipe version. */
  sellingPrice?: number
  /** Effective margin % when this version was created (display / audit). */
  targetMarginPct?: number | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Company-wide pricing defaults (`meta/pricing`). */
export interface PricingSettings {
  targetMarginPct: number
}

export interface Material {
  id: string
  name: string
  category: string
  unit: string
  minimumStock: number
  costPerUnit: number
  supplierId: string
  /** Free-text description / notes (shown as Description in the UI). */
  notes: string
  /** Optional color or finish spec, e.g. "Pink", "Gold foil". */
  colorSpec?: string
  status: 'active' | 'inactive'
  photoUrls?: string[]
  gstRate?: number
  hsnSac?: string
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
  /** Finished-goods season pile; null = unassigned / legacy stock */
  occasionSeasonId?: string | null
  createdAt: Timestamp
  createdBy?: string
}

export type OrderStatus =
  | 'DRAFT'
  | 'QUOTED'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'READY'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'

export interface Shipment {
  logisticsCompany?: string
  trackingId?: string
  cost?: number
  photoUrls?: string[]
  /** Linked bank debit when logistics was tagged from Bank */
  bankTransactionId?: string | null
  paidById?: string
  paidByName?: string
  updatedAt?: Timestamp
}

export interface Order {
  id: string
  customerId: string
  orderDate: Timestamp
  eventDate: Timestamp | null
  eventType: string
  /** Catalog occasion; legacy orders may omit */
  occasionId?: string | null
  subtotal: number
  discount: number
  total: number
  taxableSubtotal?: number
  gstTotal?: number
  grandTotal?: number
  status: OrderStatus
  notes: string
  statusHistory?: Partial<Record<OrderStatus, Timestamp>>
  shipment?: Shipment
  assignedWorkerIds?: string[]
  assignedWorkerNames?: string[]
  assignedAt?: Timestamp
  assignedBy?: string
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
  gstRate?: number
  taxableAmount?: number
  gstAmount?: number
  /** Which season pile to sell from; null = unassigned stock */
  occasionSeasonId?: string | null
}

export type ProductionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface Production {
  id: string
  productId: string
  productVersionId: string
  quantity: number
  expectedQuantity?: number
  actualQuantity?: number
  wasteQuantity?: number
  batchCode?: string
  orderId?: string | null
  occasionSeasonId?: string | null
  productionDate: Timestamp
  totalMaterialCost: number
  costPerUnit: number
  status: ProductionStatus
  notes: string
  assignedWorkerIds?: string[]
  assignedWorkerNames?: string[]
  assignedAt?: Timestamp
  assignedBy?: string
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
  type: 'individual' | 'company'
  name: string
  companyName?: string
  contactPerson?: string
  phone: string
  email: string
  address: string
  city: string
  notes: string
  status: 'active' | 'inactive'
  mapLink?: string
  photoUrls?: string[]
  gstin?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Purchase {
  id: string
  supplierId: string
  /** Platform user who paid the vendor. */
  purchasedById?: string
  purchasedByName?: string
  /** Whether this purchase is still open, or closed (including by a cash settlement). */
  paymentStatus?: 'paid' | 'unpaid'
  settlementTransactionId?: string
  purchaseDate: Timestamp
  total: number
  itemCount?: number
  totalQty?: number
  taxableSubtotal?: number
  gstTotal?: number
  grandTotal?: number
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED'
  notes: string
  createdAt: Timestamp
  billPhotoUrls?: string[]
  /** Delivery from the supplier; never adds stock. */
  logistics?: PurchaseLogistics | null
  /** Delivery amount including GST; already part of grandTotal. */
  logisticsTotal?: number
}

export interface PurchaseLogistics {
  mode: string
  /** Taxable amount */
  amount: number
  gstRate: number
  gstAmount: number
  paidById?: string
  paidByName?: string
  photoUrls?: string[]
}

export interface PurchaseItem {
  id: string
  purchaseId: string
  materialId: string
  quantity: number
  unitCost: number
  /** unitCost plus this line's share of the purchase delivery charge */
  landedUnitCost?: number
  total: number
  gstRate?: number
  taxableAmount?: number
  gstAmount?: number
}

export interface AuditLog {
  id: string
  actorId: string
  actorName: string
  action: string
  entityType: string
  entityId: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  createdAt: Timestamp
}

export interface WorkAssignment {
  id: string
  entityType: 'order' | 'production'
  entityId: string
  workerId: string
  workerName: string
  assignedBy: string
  assignedAt: Timestamp
  unassignedAt?: Timestamp | null
  note?: string
}

export type BankDirection = 'credit' | 'debit'
export type BankSource = 'alert' | 'statement' | 'import' | 'manual'
export type BankTxStatus = 'pending' | 'reviewed' | 'matched' | 'ignored'
export type BankMatchType = 'order' | 'purchase'
export type BankBooks = 'unassigned' | 'business' | 'personal'
/** Customer money in against an order */
export type BankPaymentKind = 'advance' | 'final'
/** Business expense kind on a bank row */
export type BankExpenseKind = 'logistics' | 'recce'
/** Simplified business tag reasons (Bank Tag modal) */
export type BankTagReason =
  | 'customer_payment'
  | 'logistics'
  | 'worker'
  | 'recce'
  | 'purchase'
  | 'other'
  | 'ignore'

export const DEFAULT_BANK_TAGS = [
  'materials',
  'shipping',
  'upi',
  'gst',
  'recce',
  'other',
] as const

export const DEFAULT_BANK_CATEGORIES = [
  'advance',
  'worker-spend',
  'materials',
  'shipping',
  'recce',
  'salary',
  'payout',
  'rent',
  'groceries',
  'fuel',
  'utilities',
  'health',
  'entertainment',
  'transfer',
  'other',
] as const

/** @deprecated use DEFAULT_BANK_CATEGORIES */
export const DEFAULT_PERSONAL_CATEGORIES = DEFAULT_BANK_CATEGORIES

export interface BankTransaction {
  id: string
  gmailMessageId: string
  gmailThreadId: string
  fingerprint: string
  source: BankSource
  occurredAt: Timestamp | null
  amount: number
  direction: BankDirection
  currency: string
  bankName?: string
  accountLast4?: string
  counterparty?: string
  description: string
  rawSubject: string
  snippet: string
  parseConfidence: number
  parseNotes?: string
  status: BankTxStatus
  books: BankBooks
  /** @deprecated prefer category */
  personalCategory?: string | null
  /** Shared custom category name */
  category?: string | null
  workerId?: string | null
  orderId?: string | null
  purchaseId?: string | null
  /** Set when one cash payment closes several purchases. */
  purchaseIds?: string[]
  materialId?: string | null
  productId?: string | null
  /** Customer payment against an order */
  paymentKind?: BankPaymentKind | null
  /** Logistics / recce expense */
  expenseKind?: BankExpenseKind | null
  /** Worker float/payout subtype when tagged as worker */
  workerPayKind?: 'payout' | 'out' | 'spend' | null
  tags: string[]
  matchType?: BankMatchType | null
  matchId?: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
  reviewedBy?: string
}

export type WorkerAdvanceKind = 'out' | 'spend'

export interface WorkerAdvanceEntry {
  id: string
  workerId: string
  workerName: string
  kind: WorkerAdvanceKind
  amount: number
  bankTransactionId?: string | null
  materialId?: string | null
  orderId?: string | null
  category?: string | null
  notes?: string
  occurredAt: Timestamp
  createdAt: Timestamp
  createdBy: string
}

export interface WorkerAdvanceBalance {
  workerId: string
  workerName: string
  sent: number
  spent: number
  remaining: number
}

/** Business expense buckets for budget tracking (debits only in UI). */
export type BusinessExpenseBucket = 'logistics' | 'recce' | 'worker' | 'purchase' | 'other'

export const BUSINESS_EXPENSE_BUCKETS: BusinessExpenseBucket[] = [
  'logistics',
  'purchase',
  'worker',
  'recce',
  'other',
]

export const BUSINESS_EXPENSE_BUCKET_LABELS: Record<BusinessExpenseBucket, string> = {
  logistics: 'Logistics / courier',
  purchase: 'Purchases / materials',
  worker: 'Worker pay / float',
  recce: 'Recce / site visits',
  other: 'Other business',
}

export interface ExpenseBudgetsDoc {
  personal: Record<string, number>
  business: Record<string, number>
}

export interface ExpenseBudgetRow {
  key: string
  label: string
  spent: number
  budget: number
  remaining: number
  pct: number
  overBudget: boolean
  credits: number
}

export interface ExpenseSectionTotals {
  totalBudget: number
  totalSpent: number
  remaining: number
  overBy: number
  totalCredits: number
}

/** Safe Gmail connection status returned by callables (never includes tokens). */
export interface GmailConnectionStatus {
  connected: boolean
  email: string | null
  connectedAt: string | null
  senderAllowlist: string[]
  labelId: string | null
  watchExpiration: string | null
  lastSyncAt: string | null
  lastError: string | null
}

export interface GmailSyncResult {
  ok: boolean
  days?: number
  processed: number
  written: number
  skippedDuplicates: number
}
