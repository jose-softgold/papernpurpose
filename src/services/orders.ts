import {
  collection, doc, getDocs, getDoc, query, where, orderBy, serverTimestamp, writeBatch, updateDoc, Timestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase/config'
import { Order, OrderItem, OrderStatus } from '../types'
import { lineTax, roundMoney } from '../utils/tax'
import { auditService } from './audit'
import { inventoryService } from './inventory'

function actorId() {
  return auth.currentUser?.uid ?? ''
}

function sortByOrderDateDesc(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => (b.orderDate?.toMillis?.() ?? 0) - (a.orderDate?.toMillis?.() ?? 0))
}

const WORKER_READ_STATUSES: OrderStatus[] = [
  'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED',
]

export const orderService = {
  async getAll(statuses?: OrderStatus[], assignedToUid?: string): Promise<Order[]> {
    if (assignedToUid) {
      const statusFilter = statuses?.length ? statuses : WORKER_READ_STATUSES
      const q = query(
        collection(db, 'orders'),
        where('assignedWorkerIds', 'array-contains', assignedToUid),
        where('status', 'in', statusFilter),
      )
      const snap = await getDocs(q)
      return sortByOrderDateDesc(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)))
    }
    const q = statuses?.length
      ? query(collection(db, 'orders'), where('status', 'in', statuses), orderBy('orderDate', 'desc'))
      : query(collection(db, 'orders'), orderBy('orderDate', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Order))
  },

  async getById(id: string): Promise<Order | null> {
    const snap = await getDoc(doc(db, 'orders', id))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() } as Order
  },

  async getByCustomerId(customerId: string): Promise<Order[]> {
    const q = query(
      collection(db, 'orders'),
      where('customerId', '==', customerId),
      orderBy('orderDate', 'desc'),
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Order))
  },

  async getItems(orderId: string): Promise<OrderItem[]> {
    const snap = await getDocs(collection(db, 'orderItems'))
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as OrderItem))
      .filter(i => i.orderId === orderId)
  },

  /** Line items keyed by order id. Used to label and auto-fill production from a linked order. */
  async getItemsForOrders(orderIds: string[]): Promise<Record<string, OrderItem[]>> {
    const unique = [...new Set(orderIds.filter(Boolean))]
    const map: Record<string, OrderItem[]> = {}
    unique.forEach(id => { map[id] = [] })
    if (!unique.length) return map

    const chunks: string[][] = []
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30))
    const snaps = await Promise.all(
      chunks.map(chunk => getDocs(query(collection(db, 'orderItems'), where('orderId', 'in', chunk)))),
    )
    snaps.forEach(snap => {
      snap.docs.forEach(d => {
        const item = { id: d.id, ...d.data() } as OrderItem
        ;(map[item.orderId] ??= []).push(item)
      })
    })
    return map
  },

  /**
   * Orders that can be linked to a production batch.
   * Workers must pass their uid so the query is assignment-gated (unassigned docs are not readable).
   * Workers cannot read QUOTED orders (Firestore rules), so their status set excludes it.
   */
  async listForProductionLink(assignedToUid?: string): Promise<{
    orders: Order[]
    itemsByOrderId: Record<string, OrderItem[]>
  }> {
    const statuses: OrderStatus[] = assignedToUid
      ? ['CONFIRMED', 'IN_PRODUCTION', 'READY']
      : ['QUOTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY']
    const orders = await orderService.getAll(statuses, assignedToUid)
    const visible = assignedToUid
      ? orders.filter(o => (o.assignedWorkerIds ?? []).includes(assignedToUid))
      : orders
    const itemsByOrderId = await orderService.getItemsForOrders(visible.map(o => o.id))
    return { orders: visible, itemsByOrderId }
  },

  async create(data: {
    customerId: string
    orderDate: Timestamp
    eventDate: Timestamp | null
    eventType: string
    occasionId?: string | null
    discount: number
    notes: string
    assignedWorkerIds?: string[]
    assignedWorkerNames?: string[]
    assignedBy?: string
    items: Array<{
      productId: string
      productVersionId: string
      quantity: number
      unitPrice: number
      costPerUnit: number
      gstRate?: number
      occasionSeasonId?: string | null
    }>
  }): Promise<string> {
    const batch = writeBatch(db)
    const taxLines = data.items.map(i => lineTax(i.quantity, i.unitPrice, i.gstRate ?? 0))
    const taxableSubtotal = roundMoney(taxLines.reduce((s, l) => s + l.taxableAmount, 0))
    const gstTotal = roundMoney(taxLines.reduce((s, l) => s + l.gstAmount, 0))
    const subtotal = taxableSubtotal
    const grandTotal = roundMoney(taxableSubtotal + gstTotal - data.discount)
    const total = grandTotal

    const orderRef = doc(collection(db, 'orders'))
    batch.set(orderRef, {
      customerId: data.customerId,
      orderDate: data.orderDate,
      eventDate: data.eventDate,
      eventType: data.eventType,
      occasionId: data.occasionId ?? null,
      subtotal,
      discount: data.discount,
      total,
      taxableSubtotal,
      gstTotal,
      grandTotal,
      status: 'CONFIRMED' as OrderStatus,
      notes: data.notes,
      assignedWorkerIds: data.assignedWorkerIds ?? [],
      assignedWorkerNames: data.assignedWorkerNames ?? [],
      assignedAt: data.assignedWorkerIds?.length ? serverTimestamp() : null,
      assignedBy: data.assignedBy ?? '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      'statusHistory.CONFIRMED': serverTimestamp(),
    })

    data.items.forEach((item, idx) => {
      const tax = taxLines[idx]
      const totalPrice = tax.lineTotal
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
        gstRate: item.gstRate ?? 0,
        taxableAmount: tax.taxableAmount,
        gstAmount: tax.gstAmount,
        occasionSeasonId: item.occasionSeasonId ?? null,
      })
    })

    await batch.commit()
    await auditService.log({
      action: 'order.create',
      entityType: 'order',
      entityId: orderRef.id,
      after: { customerId: data.customerId, grandTotal, itemCount: data.items.length },
    })
    return orderRef.id
  },

  async update(id: string, data: {
    customerId: string
    orderDate: Timestamp
    eventDate: Timestamp | null
    eventType: string
    occasionId?: string | null
    discount: number
    notes: string
    items: Array<{
      productId: string
      productVersionId: string
      quantity: number
      unitPrice: number
      costPerUnit: number
      gstRate?: number
      occasionSeasonId?: string | null
    }>
  }): Promise<void> {
    const existing = await orderService.getItems(id)
    const taxLines = data.items.map(i => lineTax(i.quantity, i.unitPrice, i.gstRate ?? 0))
    const taxableSubtotal = roundMoney(taxLines.reduce((s, l) => s + l.taxableAmount, 0))
    const gstTotal = roundMoney(taxLines.reduce((s, l) => s + l.gstAmount, 0))
    const subtotal = taxableSubtotal
    const grandTotal = roundMoney(taxableSubtotal + gstTotal - data.discount)
    const total = grandTotal

    const batch = writeBatch(db)
    batch.update(doc(db, 'orders', id), {
      customerId: data.customerId,
      orderDate: data.orderDate,
      eventDate: data.eventDate,
      eventType: data.eventType,
      occasionId: data.occasionId ?? null,
      subtotal,
      discount: data.discount,
      total,
      taxableSubtotal,
      gstTotal,
      grandTotal,
      notes: data.notes,
      updatedAt: serverTimestamp(),
    })

    existing.forEach(item => batch.delete(doc(db, 'orderItems', item.id)))
    data.items.forEach((item, idx) => {
      const tax = taxLines[idx]
      const totalPrice = tax.lineTotal
      const totalCost = item.quantity * item.costPerUnit
      const itemRef = doc(collection(db, 'orderItems'))
      batch.set(itemRef, {
        orderId: id,
        productId: item.productId,
        productVersionId: item.productVersionId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice,
        costPerUnit: item.costPerUnit,
        totalCost,
        profit: totalPrice - totalCost,
        gstRate: item.gstRate ?? 0,
        taxableAmount: tax.taxableAmount,
        gstAmount: tax.gstAmount,
        occasionSeasonId: item.occasionSeasonId ?? null,
      })
    })

    await batch.commit()
    await auditService.log({
      action: 'order.update',
      entityType: 'order',
      entityId: id,
      after: { customerId: data.customerId, grandTotal, itemCount: data.items.length },
    })
  },

  async updateStatus(id: string, status: OrderStatus): Promise<void> {
    const batch = writeBatch(db)
    batch.update(doc(db, 'orders', id), {
      status,
      updatedAt: serverTimestamp(),
      [`statusHistory.${status}`]: serverTimestamp(),
    })

    if (status === 'COMPLETED') {
      const items = await orderService.getItems(id)
      const createdBy = actorId()

      for (const item of items) {
        const seasonId = item.occasionSeasonId ?? null
        let stock = await inventoryService.getStockForSeason('product', item.productId, seasonId)
        const sellFromSeason = seasonId

        if (stock < item.quantity && seasonId !== null) {
          const unassigned = await inventoryService.getStockForSeason('product', item.productId, null)
          if (stock + unassigned < item.quantity) {
            throw new Error(
              `Insufficient stock for product ${item.productId}: need ${item.quantity}, have ${stock} in season + ${unassigned} unassigned`,
            )
          }
          if (stock > 0) {
            const txRef = doc(collection(db, 'inventoryTransactions'))
            batch.set(txRef, {
              itemType: 'product',
              itemId: item.productId,
              transactionType: 'SALE',
              quantity: -stock,
              unit: 'units',
              referenceType: 'order',
              referenceId: id,
              notes: `Sale order ${id} (season)`,
              occasionSeasonId: seasonId,
              createdAt: serverTimestamp(),
              createdBy,
            })
          }
          const remainder = item.quantity - stock
          const txRef = doc(collection(db, 'inventoryTransactions'))
          batch.set(txRef, {
            itemType: 'product',
            itemId: item.productId,
            transactionType: 'SALE',
            quantity: -remainder,
            unit: 'units',
            referenceType: 'order',
            referenceId: id,
            notes: `Sale order ${id} (unassigned fallback)`,
            occasionSeasonId: null,
            createdAt: serverTimestamp(),
            createdBy,
          })
          continue
        }

        if (stock < item.quantity) {
          throw new Error(
            `Insufficient stock for product ${item.productId}: need ${item.quantity}, have ${stock}`,
          )
        }

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
          occasionSeasonId: sellFromSeason,
          createdAt: serverTimestamp(),
          createdBy,
        })
      }
    }

    await batch.commit()
    await auditService.log({
      action: 'order.status',
      entityType: 'order',
      entityId: id,
      after: { status },
    })
  },

  async cancel(id: string): Promise<void> {
    const batch = writeBatch(db)
    batch.update(doc(db, 'orders', id), {
      status: 'CANCELLED' as OrderStatus,
      updatedAt: serverTimestamp(),
      'statusHistory.CANCELLED': serverTimestamp(),
    })
    await batch.commit()
    await auditService.log({
      action: 'order.cancel',
      entityType: 'order',
      entityId: id,
    })
  },

  /** Removes the order and its lines; a completed order also gets its sale put back into stock. */
  async delete(id: string): Promise<void> {
    const items = await orderService.getItems(id)
    const batch = writeBatch(db)
    await inventoryService.reverseReference(batch, 'order', id, 'Order deleted')
    items.forEach(item => batch.delete(doc(db, 'orderItems', item.id)))
    batch.delete(doc(db, 'orders', id))
    await batch.commit()
    await auditService.log({ action: 'order.delete', entityType: 'order', entityId: id, before: { itemCount: items.length } })
  },

  async assign(id: string, workerIds: string[], workerNames: string[], assignedBy: string): Promise<void> {
    await updateDoc(doc(db, 'orders', id), {
      assignedWorkerIds: workerIds,
      assignedWorkerNames: workerNames,
      assignedAt: serverTimestamp(),
      assignedBy,
      updatedAt: serverTimestamp(),
    })
    await auditService.log({
      action: 'order.assign',
      entityType: 'order',
      entityId: id,
      after: { assignedWorkerIds: workerIds, assignedWorkerNames: workerNames },
    })
  },

  async updateShipment(id: string, data: {
    logisticsCompany: string
    trackingId: string
    cost: number
    photoUrls: string[]
    bankTransactionId?: string | null
    paidById?: string
    paidByName?: string
  }): Promise<void> {
    const patch: Record<string, unknown> = {
      'shipment.logisticsCompany': data.logisticsCompany,
      'shipment.trackingId': data.trackingId,
      'shipment.cost': data.cost,
      'shipment.photoUrls': data.photoUrls,
      'shipment.paidById': data.paidById ?? '',
      'shipment.paidByName': data.paidByName ?? '',
      'shipment.updatedAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
    if (data.bankTransactionId !== undefined) {
      patch['shipment.bankTransactionId'] = data.bankTransactionId
    }
    await updateDoc(doc(db, 'orders', id), patch)
  },
}
