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

export const GST_RATES = [0, 5, 12, 18, 28] as const
export type GstRate = (typeof GST_RATES)[number]

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

export interface Product {
  id: string
  name: string
  category: string
  description: string
  defaultSellingPrice: number
  status: 'active' | 'inactive'
  imageUrl: string
  photoUrls?: string[]
  packagingNotes?: string
  packagingPhotoUrls?: string[]
  gstRate?: number
  hsnSac?: string
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
  updatedAt?: Timestamp
}

export interface Order {
  id: string
  customerId: string
  orderDate: Timestamp
  eventDate: Timestamp | null
  eventType: string
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
}

export interface PurchaseItem {
  id: string
  purchaseId: string
  materialId: string
  quantity: number
  unitCost: number
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
