import type {
  Customer, Material, Occasion, OccasionSeason, Order, OrderItem, OrderStatus, Product, Production, Purchase, PurchaseItem, Supplier,
} from '../types'
import { purchaseService } from './purchases'
import { supplierService } from './suppliers'
import { materialService } from './materials'
import { inventoryService } from './inventory'
import { productionService } from './production'
import { orderService } from './orders'
import { productService } from './products'
import { customerService } from './customers'
import { occasionService } from './occasions'

export const UNASSIGNED_SEASON = '__unassigned__'
export const NON_SALE_STATUSES: OrderStatus[] = ['DRAFT', 'QUOTED', 'CANCELLED']
const CLOSED_ORDER_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'DELIVERED']

export interface DashboardData {
  purchases: Purchase[]
  purchaseItems: PurchaseItem[]
  suppliers: Supplier[]
  materials: Material[]
  materialStocks: Record<string, number>
  productions: Production[]
  orders: Order[]
  orderItems: Record<string, OrderItem[]>
  products: Product[]
  customers: Customer[]
  seasons: OccasionSeason[]
  occasions: Occasion[]
}

export interface DashboardFilter {
  from?: Date
  to?: Date
  seasonId?: string
}

/** qty is a count of units, or of bills for payers */
export interface TopEntry {
  key: string
  name: string
  qty: number
  amount: number
}

export interface PayerEntry extends TopEntry {
  share: number
  lastBillMs: number
}

export interface OccasionRow {
  key: string
  name: string
  year: number | null
  status: string
  bills: number
  purchases: number
  productionQty: number
  productionCost: number
  unitsSold: number
  revenue: number
  cogs: number
  profit: number
  payers: TopEntry[]
  topMaterials: TopEntry[]
  topProducts: TopEntry[]
}

export interface PurchaseRow {
  id: string
  dateMs: number
  supplier: string
  paidBy: string
  occasion: string
  items: string
  amount: number
}

export interface DashboardMetrics {
  money: {
    purchases: number
    bills: number
    revenue: number
    cogs: number
    profit: number
    margin: number
    net: number
    orders: number
  }
  whoPaid: PayerEntry[]
  purchaseRows: PurchaseRow[]
  topMaterials: TopEntry[]
  lowStock: { id: string; name: string; unit: string; stock: number; minimum: number }[]
  trend: { label: string; purchases: number; sales: number }[]
  pipeline: { status: OrderStatus; count: number; value: number }[]
  upcoming: { id: string; customer: string; eventType: string; eventMs: number; value: number; status: OrderStatus }[]
  batches: { id: string; batchCode: string; product: string; qty: number; cost: number; dateMs: number }[]
  productsSold: (TopEntry & { profit: number })[]
}

export async function loadDashboardData(opts: { includeSpend: boolean }): Promise<DashboardData> {
  const [purchases, purchaseItems, suppliers, materials, materialStocks, productions, orders, products, customers, seasons, occasions] =
    await Promise.all([
      opts.includeSpend ? purchaseService.getAll() : Promise.resolve([] as Purchase[]),
      opts.includeSpend ? purchaseService.listItems() : Promise.resolve([] as PurchaseItem[]),
      supplierService.getAll().catch(() => [] as Supplier[]),
      materialService.getAll(),
      inventoryService.getMaterialStocks().catch(() => ({} as Record<string, number>)),
      productionService.getAll(),
      orderService.getAll(),
      productService.getAll(),
      customerService.getAll().catch(() => [] as Customer[]),
      occasionService.getAllSeasons().catch(() => [] as OccasionSeason[]),
      occasionService.getAllOccasions().catch(() => [] as Occasion[]),
    ])
  const saleIds = orders.filter(o => !NON_SALE_STATUSES.includes(o.status)).map(o => o.id)
  const orderItems = await orderService.getItemsForOrders(saleIds)
  return { purchases, purchaseItems, suppliers, materials, materialStocks, productions, orders, orderItems, products, customers, seasons, occasions }
}

const ms = (ts?: { toMillis?: () => number } | null) => ts?.toMillis?.() ?? 0
const purchaseAmount = (p: Purchase) => Number(p.grandTotal ?? p.total ?? 0)
const lineRevenue = (i: OrderItem) => Number(i.taxableAmount ?? i.totalPrice ?? 0)
const lineProfit = (i: OrderItem) => Number(i.profit ?? lineRevenue(i) - Number(i.totalCost || 0))

/** Season each record belongs to; order lines fall back to the order's occasion in its event (or order) year. */
export function seasonAttribution(data: Pick<DashboardData, 'seasons'>) {
  const ids = new Set(data.seasons.map(s => s.id))
  const known = (id?: string | null) => (id && ids.has(id) ? id : null)
  return {
    purchase: (p: Purchase) => known(p.occasionSeasonId),
    production: (p: Production) => known(p.occasionSeasonId),
    orderItem: (o: Order, item: OrderItem) => {
      const direct = known(item.occasionSeasonId)
      if (direct) return direct
      if (!o.occasionId) return null
      const year = ((o.eventDate ?? o.orderDate)?.toDate?.() ?? new Date()).getFullYear()
      return data.seasons.find(s => s.occasionId === o.occasionId && s.year === year)?.id ?? null
    },
  }
}

function bump(map: Map<string, TopEntry>, key: string, name: string, qty: number, amount: number) {
  const entry = map.get(key) ?? { key, name, qty: 0, amount: 0 }
  entry.qty += qty
  entry.amount += amount
  map.set(key, entry)
}

const sortByAmount = (map: Map<string, TopEntry>, limit = Infinity) =>
  [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit)

const payerKey = (p: Purchase) => p.purchasedById || p.purchasedByName || ''
const payerName = (p: Purchase) => p.purchasedByName || 'Not recorded'

export function buildOccasionRows(data: DashboardData): OccasionRow[] {
  const season = seasonAttribution(data)
  const materialName = Object.fromEntries(data.materials.map(m => [m.id, m.name]))
  const productName = Object.fromEntries(data.products.map(p => [p.id, p.name]))
  type Acc = OccasionRow & { pays: Map<string, TopEntry>; mats: Map<string, TopEntry>; prods: Map<string, TopEntry> }
  const acc = new Map<string, Acc>()
  const rowFor = (seasonId: string | null) => {
    const key = seasonId ?? UNASSIGNED_SEASON
    let row = acc.get(key)
    if (!row) {
      const s = data.seasons.find(x => x.id === key)
      row = {
        key,
        name: s?.name ?? 'Unassigned',
        year: s?.year ?? null,
        status: s?.status ?? '',
        bills: 0, purchases: 0, productionQty: 0, productionCost: 0,
        unitsSold: 0, revenue: 0, cogs: 0, profit: 0,
        payers: [], topMaterials: [], topProducts: [],
        pays: new Map(), mats: new Map(), prods: new Map(),
      }
      acc.set(key, row)
    }
    return row
  }
  data.seasons.forEach(s => rowFor(s.id))

  const purchaseSeason = new Map(data.purchases.map(p => [p.id, season.purchase(p)]))
  for (const p of data.purchases) {
    const row = rowFor(season.purchase(p))
    row.bills += 1
    row.purchases += purchaseAmount(p)
    bump(row.pays, payerKey(p), payerName(p), 1, purchaseAmount(p))
  }
  for (const item of data.purchaseItems) {
    if (item.kind === 'charge' || !item.materialId || !purchaseSeason.has(item.purchaseId)) continue
    const row = rowFor(purchaseSeason.get(item.purchaseId) ?? null)
    bump(row.mats, item.materialId, materialName[item.materialId] || item.materialId, Number(item.quantity || 0), Number(item.total || 0))
  }
  for (const p of data.productions) {
    if (p.status !== 'COMPLETED') continue
    const row = rowFor(season.production(p))
    row.productionQty += Number(p.actualQuantity ?? p.quantity ?? 0)
    row.productionCost += Number(p.totalMaterialCost || 0)
  }
  for (const o of data.orders) {
    if (NON_SALE_STATUSES.includes(o.status)) continue
    for (const item of data.orderItems[o.id] ?? []) {
      const row = rowFor(season.orderItem(o, item))
      row.unitsSold += Number(item.quantity || 0)
      row.revenue += lineRevenue(item)
      row.cogs += Number(item.totalCost || 0)
      row.profit += lineProfit(item)
      bump(row.prods, item.productId, productName[item.productId] || item.productId, Number(item.quantity || 0), lineRevenue(item))
    }
  }

  const statusRank: Record<string, number> = { active: 0, upcoming: 1, closed: 2 }
  return [...acc.values()]
    .map(({ pays, mats, prods, ...row }) => ({
      ...row,
      payers: sortByAmount(pays),
      topMaterials: sortByAmount(mats, 5),
      topProducts: sortByAmount(prods, 5),
    }))
    .filter(r => r.key !== UNASSIGNED_SEASON || r.bills || r.productionQty || r.unitsSold)
    .sort((a, b) => {
      if (a.key === UNASSIGNED_SEASON) return 1
      if (b.key === UNASSIGNED_SEASON) return -1
      return (b.year ?? 0) - (a.year ?? 0) || (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3) || a.name.localeCompare(b.name)
    })
}

export function buildMetrics(data: DashboardData, filter: DashboardFilter): DashboardMetrics {
  const season = seasonAttribution(data)
  const fromMs = filter.from?.getTime() ?? -Infinity
  const toMs = filter.to?.getTime() ?? Infinity
  const inRange = (t: number) => t >= fromMs && t <= toMs
  const inSeason = (id: string | null) => !filter.seasonId || id === filter.seasonId

  const supplierName = Object.fromEntries(data.suppliers.map(s => [s.id, s.name]))
  const materialName = Object.fromEntries(data.materials.map(m => [m.id, m.name]))
  const productName = Object.fromEntries(data.products.map(p => [p.id, p.name]))
  const customerName = Object.fromEntries(data.customers.map(c => [c.id, c.name]))
  const seasonName = Object.fromEntries(data.seasons.map(s => [s.id, s.name]))

  const purchases = data.purchases.filter(p => inRange(ms(p.purchaseDate)) && inSeason(season.purchase(p)))
  const purchaseIds = new Set(purchases.map(p => p.id))
  const itemsByPurchase = new Map<string, PurchaseItem[]>()
  for (const item of data.purchaseItems) {
    if (!purchaseIds.has(item.purchaseId)) continue
    itemsByPurchase.set(item.purchaseId, [...(itemsByPurchase.get(item.purchaseId) ?? []), item])
  }

  const purchaseTotal = purchases.reduce((s, p) => s + purchaseAmount(p), 0)
  const pays = new Map<string, PayerEntry>()
  for (const p of purchases) {
    const key = payerKey(p)
    const entry = pays.get(key) ?? { key, name: payerName(p), qty: 0, amount: 0, share: 0, lastBillMs: 0 }
    entry.qty += 1
    entry.amount += purchaseAmount(p)
    entry.lastBillMs = Math.max(entry.lastBillMs, ms(p.purchaseDate))
    pays.set(key, entry)
  }
  const whoPaid = [...pays.values()]
    .map(e => ({ ...e, share: purchaseTotal > 0 ? (e.amount / purchaseTotal) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)

  const purchaseRows: PurchaseRow[] = [...purchases]
    .sort((a, b) => ms(b.purchaseDate) - ms(a.purchaseDate))
    .map(p => {
      const items = itemsByPurchase.get(p.id) ?? []
      return {
        id: p.id,
        dateMs: ms(p.purchaseDate),
        supplier: supplierName[p.supplierId] || p.supplierId,
        paidBy: p.purchasedByName || '',
        occasion: (p.occasionSeasonId && seasonName[p.occasionSeasonId]) || '',
        items: items
          .map(i => (i.kind === 'charge' ? i.description || 'Charge' : `${materialName[i.materialId] || 'Material'} × ${i.quantity}`))
          .join(', '),
        amount: purchaseAmount(p),
      }
    })

  const mats = new Map<string, TopEntry>()
  for (const items of itemsByPurchase.values()) {
    for (const i of items) {
      if (i.kind === 'charge' || !i.materialId) continue
      bump(mats, i.materialId, materialName[i.materialId] || i.materialId, Number(i.quantity || 0), Number(i.total || 0))
    }
  }

  let revenue = 0
  let cogs = 0
  let profit = 0
  const saleOrderIds = new Set<string>()
  const prods = new Map<string, TopEntry>()
  const prodProfit = new Map<string, number>()
  for (const o of data.orders) {
    if (NON_SALE_STATUSES.includes(o.status) || !inRange(ms(o.orderDate))) continue
    for (const item of data.orderItems[o.id] ?? []) {
      if (!inSeason(season.orderItem(o, item))) continue
      saleOrderIds.add(o.id)
      revenue += lineRevenue(item)
      cogs += Number(item.totalCost || 0)
      profit += lineProfit(item)
      bump(prods, item.productId, productName[item.productId] || item.productId, Number(item.quantity || 0), lineRevenue(item))
      prodProfit.set(item.productId, (prodProfit.get(item.productId) ?? 0) + lineProfit(item))
    }
  }

  const now = new Date()
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1))
  const monthIdx = (t: number) => {
    const d = new Date(t)
    const idx = (d.getFullYear() - months[0].getFullYear()) * 12 + d.getMonth() - months[0].getMonth()
    return idx >= 0 && idx < 12 ? idx : -1
  }
  const trend = months.map(d => ({ label: d.toLocaleString('en-IN', { month: 'short' }), purchases: 0, sales: 0 }))
  for (const p of data.purchases) {
    if (!inSeason(season.purchase(p))) continue
    const idx = monthIdx(ms(p.purchaseDate))
    if (idx >= 0) trend[idx].purchases += purchaseAmount(p)
  }
  for (const o of data.orders) {
    if (NON_SALE_STATUSES.includes(o.status)) continue
    const idx = monthIdx(ms(o.orderDate))
    if (idx < 0) continue
    for (const item of data.orderItems[o.id] ?? []) {
      if (inSeason(season.orderItem(o, item))) trend[idx].sales += lineRevenue(item)
    }
  }

  const orderInSeason = (o: Order) => {
    if (!filter.seasonId) return true
    const items = data.orderItems[o.id]
    if (items?.length) return items.some(i => season.orderItem(o, i) === filter.seasonId)
    const year = ((o.eventDate ?? o.orderDate)?.toDate?.() ?? now).getFullYear()
    return data.seasons.some(s => s.id === filter.seasonId && s.occasionId === o.occasionId && s.year === year)
  }
  const pipelineOrders = data.orders.filter(orderInSeason)
  const pipelineMap = new Map<OrderStatus, { status: OrderStatus; count: number; value: number }>()
  for (const o of pipelineOrders) {
    const entry = pipelineMap.get(o.status) ?? { status: o.status, count: 0, value: 0 }
    entry.count += 1
    entry.value += Number(o.grandTotal ?? o.total ?? 0)
    pipelineMap.set(o.status, entry)
  }
  const statusOrder: OrderStatus[] = ['DRAFT', 'QUOTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED', 'CANCELLED']
  const pipeline = statusOrder.flatMap(s => (pipelineMap.has(s) ? [pipelineMap.get(s)!] : []))

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const upcoming = pipelineOrders
    .filter(o => !CLOSED_ORDER_STATUSES.includes(o.status) && ms(o.eventDate) >= today)
    .sort((a, b) => ms(a.eventDate) - ms(b.eventDate))
    .slice(0, 5)
    .map(o => ({
      id: o.id,
      customer: customerName[o.customerId] || '—',
      eventType: o.eventType || '',
      eventMs: ms(o.eventDate),
      value: Number(o.grandTotal ?? o.total ?? 0),
      status: o.status,
    }))

  const lowStock = data.materials
    .filter(m => m.status === 'active' && (data.materialStocks[m.id] ?? 0) < Number(m.minimumStock || 0))
    .map(m => ({ id: m.id, name: m.name, unit: m.unit, stock: data.materialStocks[m.id] ?? 0, minimum: Number(m.minimumStock || 0) }))
    .sort((a, b) => a.stock / (a.minimum || 1) - b.stock / (b.minimum || 1))

  const batches = data.productions
    .filter(p => p.status === 'COMPLETED' && inRange(ms(p.productionDate)) && inSeason(season.production(p)))
    .sort((a, b) => ms(b.productionDate) - ms(a.productionDate))
    .map(p => ({
      id: p.id,
      batchCode: p.batchCode || '',
      product: productName[p.productId] || p.productId,
      qty: Number(p.actualQuantity ?? p.quantity ?? 0),
      cost: Number(p.totalMaterialCost || 0),
      dateMs: ms(p.productionDate),
    }))

  return {
    money: {
      purchases: purchaseTotal,
      bills: purchases.length,
      revenue,
      cogs,
      profit,
      margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      net: revenue - purchaseTotal,
      orders: saleOrderIds.size,
    },
    whoPaid,
    purchaseRows,
    topMaterials: sortByAmount(mats, 8),
    lowStock,
    trend,
    pipeline,
    upcoming,
    batches,
    productsSold: sortByAmount(prods).map(p => ({ ...p, profit: prodProfit.get(p.key) ?? 0 })),
  }
}
