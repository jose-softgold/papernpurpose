import { Timestamp } from 'firebase/firestore'

export type UserRole = 'owner' | 'worker'

export interface UserDoc {
  email: string
  name: string
  role: UserRole
  createdAt: Timestamp
  createdBy: string
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
  status: OrderStatus
  notes: string
  statusHistory?: Partial<Record<OrderStatus, Timestamp>>
  shipment?: Shipment
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
}
