import {
  collection, doc, getDocs, getDoc, query, where, orderBy, serverTimestamp, writeBatch, updateDoc, Timestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Order, OrderItem, OrderStatus } from '../types'

export const orderService = {
  async getAll(statuses?: OrderStatus[]): Promise<Order[]> {
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

  async create(data: {
    customerId: string
    orderDate: Timestamp
    eventDate: Timestamp | null
    eventType: string
    discount: number
    notes: string
    items: Array<{
      productId: string
      productVersionId: string
      quantity: number
      unitPrice: number
      costPerUnit: number
    }>
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
      status: 'CONFIRMED' as OrderStatus,
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
    batch.update(doc(db, 'orders', id), {
      status,
      updatedAt: serverTimestamp(),
      [`statusHistory.${status}`]: serverTimestamp(),
    })

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
    const batch = writeBatch(db)
    batch.update(doc(db, 'orders', id), {
      status: 'CANCELLED' as OrderStatus,
      updatedAt: serverTimestamp(),
      'statusHistory.CANCELLED': serverTimestamp(),
    })
    await batch.commit()
  },

  async updateShipment(id: string, data: {
    logisticsCompany: string
    trackingId: string
    cost: number
    photoUrls: string[]
  }): Promise<void> {
    await updateDoc(doc(db, 'orders', id), {
      'shipment.logisticsCompany': data.logisticsCompany,
      'shipment.trackingId': data.trackingId,
      'shipment.cost': data.cost,
      'shipment.photoUrls': data.photoUrls,
      'shipment.updatedAt': serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  },
}
