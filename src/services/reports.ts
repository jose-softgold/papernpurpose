import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import { orderService } from './orders'
import { productionService } from './production'
import { customerService } from './customers'
import { productService } from './products'
import { bankService, BankCashSummary } from './bank'
import { OrderItem, BankTransaction } from '../types'
import { formatDate } from '../utils/format'
import { Timestamp } from 'firebase/firestore'

export type { BankCashSummary }

export interface SalesReportRow {
  date: string
  customer: string
  product: string
  version: string
  quantity: number
  unitPrice: number
  revenue: number
  cost: number
  profit: number
}

export interface ProductProfitabilityRow {
  productId: string
  productVersionId: string
  product: string
  version: string
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

export interface ProductionReportRow {
  date: string
  product: string
  version: string
  quantity: number
  costPerUnit: number
  totalCost: number
}

export interface BankCashReport {
  rows: BankTransaction[]
  summary: BankCashSummary
}

async function fetchAllOrderItems(): Promise<OrderItem[]> {
  const snap = await getDocs(collection(db, 'orderItems'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem))
}

function inRange(ts: Timestamp, from?: Date, to?: Date): boolean {
  const d = ts.toDate()
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

export const reportService = {
  async getSalesReport(from?: Date, to?: Date): Promise<SalesReportRow[]> {
    const [orders, allItems, customers, products, versions] = await Promise.all([
      orderService.getAll(),
      fetchAllOrderItems(),
      customerService.getAll(),
      productService.getAll(),
      productService.getAllVersions(),
    ])

    const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]))
    const productMap = Object.fromEntries(products.map(p => [p.id, p.name]))
    const versionMap = Object.fromEntries(versions.map(v => [v.id, v.version]))
    const itemsByOrder = allItems.reduce<Record<string, OrderItem[]>>((acc, item) => {
      ;(acc[item.orderId] ??= []).push(item)
      return acc
    }, {})

    const rows: SalesReportRow[] = []
    for (const order of orders) {
      if (order.status === 'CANCELLED') continue
      if (!inRange(order.orderDate, from, to)) continue
      const items = itemsByOrder[order.id] ?? []
      for (const item of items) {
        rows.push({
          date: formatDate(order.orderDate),
          customer: customerMap[order.customerId] ?? '?',
          product: productMap[item.productId] ?? '?',
          version: versionMap[item.productVersionId] ?? '?',
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
    const [orders, allItems, products, versions] = await Promise.all([
      orderService.getAll(),
      fetchAllOrderItems(),
      productService.getAll(),
      productService.getAllVersions(),
    ])

    const productMap = Object.fromEntries(products.map(p => [p.id, p.name]))
    const versionMap = Object.fromEntries(versions.map(v => [v.id, v.version]))
    const validOrderIds = new Set(
      orders
        .filter(o => o.status !== 'CANCELLED' && inRange(o.orderDate, from, to))
        .map(o => o.id),
    )

    const map: Record<string, ProductProfitabilityRow> = {}
    for (const item of allItems) {
      if (!validOrderIds.has(item.orderId)) continue
      const key = `${item.productId}::${item.productVersionId}`
      if (!map[key]) {
        map[key] = {
          productId: item.productId,
          productVersionId: item.productVersionId,
          product: productMap[item.productId] ?? '?',
          version: versionMap[item.productVersionId] ?? '?',
          unitsSold: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          margin: 0,
        }
      }
      map[key].unitsSold += item.quantity
      map[key].revenue += item.totalPrice
      map[key].cost += item.totalCost
      map[key].profit += item.profit
    }

    return Object.values(map)
      .map(r => ({ ...r, margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit)
  },

  async getCustomerSales(from?: Date, to?: Date): Promise<CustomerSalesRow[]> {
    const [orders, customers] = await Promise.all([
      orderService.getAll(),
      customerService.getAll(),
    ])
    const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]))

    const map: Record<string, CustomerSalesRow> = {}
    for (const order of orders) {
      if (order.status === 'CANCELLED') continue
      if (!inRange(order.orderDate, from, to)) continue
      const cid = order.customerId
      if (!map[cid]) {
        map[cid] = { customerId: cid, customer: customerMap[cid] ?? '?', orders: 0, revenue: 0 }
      }
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
      .filter(p => p.status === 'COMPLETED' && inRange(p.productionDate, from, to))
      .map(p => ({
        date: formatDate(p.productionDate),
        product: productMap[p.productId] ?? '?',
        version: versionMap[p.productVersionId] ?? '?',
        quantity: p.quantity,
        costPerUnit: p.costPerUnit,
        totalCost: p.totalMaterialCost,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  },

  async getBankCashReport(from?: Date, to?: Date): Promise<BankCashReport> {
    const all = await bankService.getAll({ max: 1000 })
    const rows = all
      .filter(t => {
        if (!t.occurredAt) return !from && !to
        return inRange(t.occurredAt, from, to)
      })
      .sort((a, b) => (b.occurredAt?.toMillis?.() ?? 0) - (a.occurredAt?.toMillis?.() ?? 0))
    return { rows, summary: bankService.summarizeRange(rows) }
  },
}
