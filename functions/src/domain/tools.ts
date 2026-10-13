import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { Actor } from '../actor'
import { AuthzError, canRead, canWriteMaster, canWriteOps, isAdminOrOwner } from '../authz'

export type ToolName =
  | 'find_customer'
  | 'create_customer'
  | 'list_orders'
  | 'create_order'
  | 'update_order_status'
  | 'log_purchase'
  | 'log_production'
  | 'list_inventory'
  | 'find_material'
  | 'find_supplier'
  | 'find_product'
  | 'create_supplier'
  | 'create_material'
  | 'assign_work'
  | 'analyze_product'
  | 'find_worker'

export const TOOL_DEFINITIONS = [
  {
    name: 'find_customer',
    description: 'Search customers by name or phone',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or phone fragment' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_customer',
    description: 'Create a new individual customer',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        city: { type: 'string' },
        address: { type: 'string' },
        notes: { type: 'string' },
        gstin: { type: 'string', description: 'Customer GSTIN if known' },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'list_orders',
    description: 'List recent orders, optionally filtered by status',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'create_order',
    description: 'Create a confirmed order with line items',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        eventType: { type: 'string' },
        notes: { type: 'string' },
        discount: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              productVersionId: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number' },
              costPerUnit: { type: 'number' },
              gstRate: { type: 'number', description: 'Indian GST slab 0/5/12/18/28' },
            },
            required: ['productId', 'productVersionId', 'quantity', 'unitPrice'],
          },
        },
      },
      required: ['customerId', 'items'],
    },
  },
  {
    name: 'update_order_status',
    description: 'Advance an order status in the workflow',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'CONFIRMED',
            'IN_PRODUCTION',
            'READY',
            'DISPATCHED',
            'DELIVERED',
            'COMPLETED',
            'CANCELLED',
          ],
        },
      },
      required: ['orderId', 'status'],
    },
  },
  {
    name: 'log_purchase',
    description:
      'Log a material purchase from a supplier. Attached bill photos are added automatically.',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string' },
        notes: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              materialId: { type: 'string' },
              quantity: { type: 'number' },
              unitCost: { type: 'number' },
              unit: { type: 'string' },
              gstRate: { type: 'number', description: 'Indian GST slab 0/5/12/18/28' },
            },
            required: ['materialId', 'quantity', 'unitCost', 'unit'],
          },
        },
      },
      required: ['supplierId', 'items'],
    },
  },
  {
    name: 'log_production',
    description: 'Log a production run using BOM materials',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        productVersionId: { type: 'string' },
        quantity: { type: 'number' },
        notes: {
          type: 'string',
        },
        expectedQuantity: { type: 'number' },
        actualQuantity: { type: 'number' },
        orderId: { type: 'string' },
      },
      required: ['productId', 'productVersionId', 'quantity'],
    },
  },
  {
    name: 'list_inventory',
    description: 'Get stock levels for materials and/or products',
    parameters: {
      type: 'object',
      properties: {
        itemType: { type: 'string', enum: ['material', 'product', 'all'] },
        query: { type: 'string' },
      },
    },
  },
  {
    name: 'find_material',
    description: 'Search materials by name',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'find_supplier',
    description: 'Search suppliers by name',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'find_product',
    description: 'Search products by name and return active versions',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'create_supplier',
    description: 'Create a supplier (name + optional phone/GSTIN)',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        gstin: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_material',
    description: 'Create a material. Unit defaults to pcs; cost, GST, color spec, and description are optional.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        unit: { type: 'string' },
        costPerUnit: { type: 'number' },
        gstRate: { type: 'number' },
        supplierId: { type: 'string' },
        hsnSac: { type: 'string' },
        category: { type: 'string' },
        colorSpec: { type: 'string', description: 'Color or finish, e.g. Pink, Gold foil' },
        notes: { type: 'string', description: 'Description / notes' },
      },
      required: ['name'],
    },
  },
  {
    name: 'assign_work',
    description: 'Assign workers to an order or production batch',
    parameters: {
      type: 'object',
      properties: {
        entityType: { type: 'string', enum: ['order', 'production'] },
        entityId: { type: 'string' },
        workerIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['entityType', 'entityId', 'workerIds'],
    },
  },
  {
    name: 'analyze_product',
    description: 'Calculate max buildable qty, cost, suggested sell, and storage notes from BOM, stock, and production history',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
    },
  },
  {
    name: 'find_worker',
    description: 'Search active workers by name or email. Use before assign_work to resolve workerIds.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or email fragment' },
      },
      required: ['query'],
    },
  },
] as const

function requireOps(actor: Actor) {
  if (!canWriteOps(actor.role)) throw new AuthzError('Not allowed to write operations')
}

function requireMaster(actor: Actor) {
  if (!canWriteMaster(actor.role)) throw new AuthzError('Not allowed to change master data')
}

function requireRead(actor: Actor) {
  if (!canRead(actor.role)) throw new AuthzError('Not allowed to read')
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function lineTax(qty: number, unit: number, gstRate = 0) {
  const taxableAmount = round2(qty * unit)
  const gstAmount = round2(taxableAmount * (gstRate / 100))
  return { taxableAmount, gstAmount, lineTotal: round2(taxableAmount + gstAmount), gstRate }
}

function tokenMatches(hay: string, token: string): boolean {
  if (hay.includes(token)) return true
  if (token.endsWith('s') && token.length > 3 && hay.includes(token.slice(0, -1))) return true
  if (!token.endsWith('s') && hay.includes(`${token}s`)) return true
  return false
}

/** Match when every query word appears somewhere in the text (order-independent). */
function matchesQuery(text: string, query: string): boolean {
  const hay = text.toLowerCase()
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  return tokens.every(token => tokenMatches(hay, token))
}

export async function getCatalogNames(
  kind: 'products' | 'materials' | 'suppliers' | 'customers',
): Promise<string[]> {
  const db = getFirestore()
  const snap = await db.collection(kind).limit(20).get()
  return snap.docs.map(d => String(d.data().name ?? '')).filter(Boolean)
}

export function catalogForTool(
  name: ToolName,
): 'products' | 'materials' | 'suppliers' | 'customers' | null {
  switch (name) {
    case 'find_product':
      return 'products'
    case 'find_material':
      return 'materials'
    case 'find_supplier':
      return 'suppliers'
    case 'find_customer':
      return 'customers'
    default:
      return null
  }
}

const FINANCIAL_KEYS = new Set([
  'total',
  'gstTotal',
  'grandTotal',
  'subtotal',
  'taxableSubtotal',
  'taxableAmount',
  'gstAmount',
  'unitPrice',
  'unitCost',
  'costPerUnit',
  'totalCost',
  'totalPrice',
  'profit',
  'defaultSellingPrice',
  'suggestedTaxableSell',
  'suggestedInvoiceTotal',
  'gstRate',
])

function stripFinancial(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFinancial)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (FINANCIAL_KEYS.has(key)) continue
    out[key] = stripFinancial(val)
  }
  return out
}

export async function runTool(
  actor: Actor,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await executeTool(actor, name, args)
  return actor.role === 'worker' ? stripFinancial(result) : result
}

async function executeTool(
  actor: Actor,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const db = getFirestore()

  switch (name) {
    case 'find_customer': {
      requireRead(actor)
      if (actor.role === 'worker') throw new AuthzError('Workers cannot search customers')
      const q = String(args.query ?? '').toLowerCase()
      const snap = await db.collection('customers').limit(50).get()
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => {
          const name = String((c as { name?: string }).name ?? '')
          const phone = String((c as { phone?: string }).phone ?? '')
          return matchesQuery(name, q) || phone.includes(q)
        })
        .slice(0, 10)
        .map(c => ({
          id: c.id,
          name: (c as { name?: string }).name,
          phone: (c as { phone?: string }).phone,
          city: (c as { city?: string }).city,
          status: (c as { status?: string }).status,
        }))
    }

    case 'create_customer': {
      requireMaster(actor)
      const ref = await db.collection('customers').add({
        type: 'individual',
        name: String(args.name),
        companyName: '',
        contactPerson: '',
        phone: String(args.phone ?? ''),
        email: String(args.email ?? ''),
        address: String(args.address ?? ''),
        city: String(args.city ?? ''),
        notes: String(args.notes ?? ''),
        status: 'active',
        gstin: String(args.gstin ?? ''),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { id: ref.id, name: args.name, phone: args.phone }
    }

    case 'list_orders': {
      requireRead(actor)
      const limit = Number(args.limit) || 10
      let rows: Array<{ id: string } & Record<string, unknown>>
      if (actor.role === 'worker') {
        const snap = await db.collection('orders').where('assignedWorkerIds', 'array-contains', actor.uid).get()
        const allowed = new Set([
          'CONFIRMED',
          'IN_PRODUCTION',
          'READY',
          'DISPATCHED',
          'DELIVERED',
          'COMPLETED',
        ])
        rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as { id: string } & Record<string, unknown>))
          .filter(r => allowed.has(String(r.status ?? '')))
        if (args.status) {
          rows = rows.filter(r => String(r.status) === String(args.status))
        }
        rows.sort((a, b) => {
          const ta = (a.orderDate as Timestamp | undefined)?.toMillis?.() ?? 0
          const tb = (b.orderDate as Timestamp | undefined)?.toMillis?.() ?? 0
          return tb - ta
        })
        rows = rows.slice(0, limit)
        return rows.map(r => ({
          id: r.id,
          status: r.status,
          eventType: r.eventType,
          notes: r.notes,
          assignedWorkerNames: (r.assignedWorkerNames as string[] | undefined) ?? [],
        }))
      }
      let query = db.collection('orders').orderBy('orderDate', 'desc').limit(limit)
      if (args.status) {
        query = db
          .collection('orders')
          .where('status', '==', String(args.status))
          .orderBy('orderDate', 'desc')
          .limit(limit)
      }
      const snap = await query.get()
      rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const customerIds = [...new Set(rows.map(r => String(r.customerId ?? '')))]
      const customerNames = new Map<string, string>()
      await Promise.all(
        customerIds.map(async id => {
          if (!id) return
          const doc = await db.collection('customers').doc(id).get()
          customerNames.set(id, String(doc.data()?.name ?? 'Unknown customer'))
        }),
      )
      return rows.map(r => ({
        id: r.id,
        customerId: r.customerId,
        customerName: customerNames.get(String(r.customerId)) ?? 'Unknown customer',
        status: r.status,
        eventType: r.eventType,
        notes: r.notes,
        assignedWorkerNames: (r.assignedWorkerNames as string[] | undefined) ?? [],
        total: r.total,
        gstTotal: r.gstTotal,
      }))
    }

    case 'create_order': {
      requireMaster(actor)
      const items = (args.items as Array<Record<string, unknown>>) ?? []
      if (!items.length) throw new AuthzError('Order needs at least one item')
      const batch = db.batch()
      const orderRef = db.collection('orders').doc()
      const discount = Number(args.discount ?? 0)
      const taxLines = items.map(i => lineTax(Number(i.quantity), Number(i.unitPrice), Number(i.gstRate ?? 0)))
      const taxableSubtotal = round2(taxLines.reduce((s, l) => s + l.taxableAmount, 0))
      const gstTotal = round2(taxLines.reduce((s, l) => s + l.gstAmount, 0))
      const grandTotal = round2(taxableSubtotal + gstTotal - discount)
      batch.set(orderRef, {
        customerId: String(args.customerId),
        orderDate: Timestamp.now(),
        eventDate: null,
        eventType: String(args.eventType ?? ''),
        subtotal: taxableSubtotal,
        discount,
        total: grandTotal,
        taxableSubtotal,
        gstTotal,
        grandTotal,
        status: 'CONFIRMED',
        notes: String(args.notes ?? ''),
        assignedWorkerIds: [],
        assignedWorkerNames: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        'statusHistory.CONFIRMED': FieldValue.serverTimestamp(),
      })
      items.forEach((item, idx) => {
        const qty = Number(item.quantity)
        const unitPrice = Number(item.unitPrice)
        const costPerUnit = Number(item.costPerUnit ?? 0)
        const tax = taxLines[idx]
        const itemRef = db.collection('orderItems').doc()
        const totalPrice = tax.lineTotal
        const totalCost = qty * costPerUnit
        batch.set(itemRef, {
          orderId: orderRef.id,
          productId: String(item.productId),
          productVersionId: String(item.productVersionId),
          quantity: qty,
          unitPrice,
          totalPrice,
          costPerUnit,
          totalCost,
          profit: totalPrice - totalCost,
          gstRate: tax.gstRate,
          taxableAmount: tax.taxableAmount,
          gstAmount: tax.gstAmount,
        })
      })
      await batch.commit()
      return { id: orderRef.id, total: grandTotal, status: 'CONFIRMED' }
    }

    case 'update_order_status': {
      requireOps(actor)
      const orderId = String(args.orderId)
      const status = String(args.status)
      const orderRef = db.collection('orders').doc(orderId)
      const snap = await orderRef.get()
      if (!snap.exists) throw new AuthzError('Order not found')
      const current = String(snap.data()?.status)

      if (!isAdminOrOwner(actor.role)) {
        const assigned = (snap.data()?.assignedWorkerIds as string[] | undefined) ?? []
        if (!assigned.includes(actor.uid)) throw new AuthzError('Order is not assigned to you')
        const ok =
          (current === 'CONFIRMED' && status === 'IN_PRODUCTION') ||
          (current === 'IN_PRODUCTION' && status === 'READY') ||
          (current === 'READY' && status === 'DISPATCHED')
        if (!ok) throw new AuthzError(`Worker cannot change ${current} → ${status}`)
      }

      const batch = db.batch()
      batch.update(orderRef, {
        status,
        updatedAt: FieldValue.serverTimestamp(),
        [`statusHistory.${status}`]: FieldValue.serverTimestamp(),
      })

      if (status === 'COMPLETED') {
        const items = await db.collection('orderItems').where('orderId', '==', orderId).get()
        for (const d of items.docs) {
          const item = d.data()
          const txRef = db.collection('inventoryTransactions').doc()
          batch.set(txRef, {
            itemType: 'product',
            itemId: item.productId,
            transactionType: 'SALE',
            quantity: -Number(item.quantity),
            unit: 'units',
            referenceType: 'order',
            referenceId: orderId,
            notes: `Sale order ${orderId}`,
            createdAt: FieldValue.serverTimestamp(),
          })
        }
      }
      await batch.commit()
      return { id: orderId, status }
    }

    case 'log_purchase': {
      requireOps(actor)
      const items = (args.items as Array<Record<string, unknown>>) ?? []
      if (!items.length) throw new AuthzError('Purchase needs items')
      const batch = db.batch()
      const purchaseRef = db.collection('purchases').doc()
      const taxLines = items.map(i => lineTax(Number(i.quantity), Number(i.unitCost), Number(i.gstRate ?? 0)))
      const taxableSubtotal = round2(taxLines.reduce((s, l) => s + l.taxableAmount, 0))
      const gstTotal = round2(taxLines.reduce((s, l) => s + l.gstAmount, 0))
      const grandTotal = round2(taxableSubtotal + gstTotal)
      const billPhotoUrls = Array.isArray(args.billPhotoUrls)
        ? (args.billPhotoUrls as unknown[]).map(String)
        : []
      batch.set(purchaseRef, {
        supplierId: String(args.supplierId),
        purchaseDate: Timestamp.now(),
        total: grandTotal,
        taxableSubtotal,
        gstTotal,
        grandTotal,
        itemCount: items.length,
        totalQty: items.reduce((s, i) => s + Number(i.quantity), 0),
        status: 'COMPLETED',
        notes: String(args.notes ?? ''),
        billPhotoUrls,
        createdAt: FieldValue.serverTimestamp(),
      })
      items.forEach((item, idx) => {
        const tax = taxLines[idx]
        const piRef = db.collection('purchaseItems').doc()
        batch.set(piRef, {
          purchaseId: purchaseRef.id,
          materialId: String(item.materialId),
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          total: tax.lineTotal,
          gstRate: tax.gstRate,
          taxableAmount: tax.taxableAmount,
          gstAmount: tax.gstAmount,
        })
        const txRef = db.collection('inventoryTransactions').doc()
        batch.set(txRef, {
          itemType: 'material',
          itemId: String(item.materialId),
          transactionType: 'PURCHASE',
          quantity: Number(item.quantity),
          unit: String(item.unit),
          referenceType: 'purchase',
          referenceId: purchaseRef.id,
          notes: 'Purchase from supplier',
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
      })
      await batch.commit()
      return { id: purchaseRef.id, total: grandTotal }
    }

    case 'log_production': {
      requireOps(actor)
      const productId = String(args.productId)
      const productVersionId = String(args.productVersionId)
      const expected = Number(args.expectedQuantity ?? args.quantity)
      const actual = Number(args.actualQuantity ?? expected)
      const bomSnap = await db
        .collection('bomItems')
        .where('productVersionId', '==', productVersionId)
        .get()
      if (bomSnap.empty) throw new AuthzError('No BOM for this product version')

      const bomMaterials: Array<{
        materialId: string
        plannedQty: number
        unitCost: number
        unit: string
      }> = []
      for (const b of bomSnap.docs) {
        const bom = b.data()
        const mat = await db.collection('materials').doc(bom.materialId).get()
        const unitCost = Number(mat.data()?.costPerUnit ?? 0)
        bomMaterials.push({
          materialId: bom.materialId,
          plannedQty: Number(bom.quantity),
          unitCost,
          unit: String(bom.unit),
        })
      }

      const batch = db.batch()
      const totalMaterialCost = bomMaterials.reduce(
        (sum, m) => sum + m.plannedQty * actual * m.unitCost,
        0,
      )
      const costPerUnit = actual > 0 ? totalMaterialCost / actual : 0
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const prodRef = db.collection('productions').doc()
      const batchCode = `PC-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${prodRef.id.slice(0, 4).toUpperCase()}`
      batch.set(prodRef, {
        productId,
        productVersionId,
        quantity: actual,
        expectedQuantity: expected,
        actualQuantity: actual,
        wasteQuantity: Math.max(0, expected - actual),
        batchCode,
        orderId: args.orderId ? String(args.orderId) : null,
        productionDate: Timestamp.now(),
        totalMaterialCost,
        costPerUnit,
        status: 'COMPLETED',
        notes: String(args.notes ?? ''),
        assignedWorkerIds: actor.role === 'worker' ? [actor.uid] : [],
        assignedWorkerNames: actor.role === 'worker' ? [actor.name] : [],
        createdAt: FieldValue.serverTimestamp(),
      })
      for (const m of bomMaterials) {
        const plannedQuantity = m.plannedQty * expected
        const actualQuantity = m.plannedQty * actual
        const wasteQuantity = Math.max(0, actualQuantity - plannedQuantity)
        const consumedPlanned = Math.min(actualQuantity, plannedQuantity)
        const pmRef = db.collection('productionMaterials').doc()
        batch.set(pmRef, {
          productionId: prodRef.id,
          materialId: m.materialId,
          plannedQuantity,
          actualQuantity,
          wasteQuantity,
          unitCost: m.unitCost,
          totalCost: actualQuantity * m.unitCost,
        })
        if (consumedPlanned > 0) {
          const txRef = db.collection('inventoryTransactions').doc()
          batch.set(txRef, {
            itemType: 'material',
            itemId: m.materialId,
            transactionType: 'CONSUMPTION',
            quantity: -consumedPlanned,
            unit: m.unit,
            referenceType: 'production',
            referenceId: prodRef.id,
            notes: `Batch ${batchCode}`,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: actor.uid,
          })
        }
        if (wasteQuantity > 0) {
          const wasteRef = db.collection('inventoryTransactions').doc()
          batch.set(wasteRef, {
            itemType: 'material',
            itemId: m.materialId,
            transactionType: 'WASTE',
            quantity: -wasteQuantity,
            unit: m.unit,
            referenceType: 'production',
            referenceId: prodRef.id,
            notes: `Batch ${batchCode} extra vs plan`,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: actor.uid,
          })
        }
      }
      const finishedTx = db.collection('inventoryTransactions').doc()
      batch.set(finishedTx, {
        itemType: 'product',
        itemId: productId,
        transactionType: 'PRODUCTION',
        quantity: actual,
        unit: 'units',
        referenceType: 'production',
        referenceId: prodRef.id,
        notes: `Batch ${batchCode}`,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      await batch.commit()
      return actor.role === 'worker'
        ? { id: prodRef.id, batchCode, expectedQuantity: expected, actualQuantity: actual }
        : { id: prodRef.id, batchCode, expectedQuantity: expected, actualQuantity: actual, costPerUnit }
    }

    case 'list_inventory': {
      requireRead(actor)
      const itemType = String(args.itemType ?? 'all')
      const q = String(args.query ?? '').toLowerCase()
      const txSnap = await db.collection('inventoryTransactions').get()
      const stock = new Map<string, { itemType: string; itemId: string; quantity: number }>()
      for (const d of txSnap.docs) {
        const t = d.data()
        const key = `${t.itemType}:${t.itemId}`
        const prev = stock.get(key) ?? {
          itemType: String(t.itemType),
          itemId: String(t.itemId),
          quantity: 0,
        }
        prev.quantity += Number(t.quantity)
        stock.set(key, prev)
      }
      const rows = [...stock.values()].filter(r => {
        if (itemType !== 'all' && r.itemType !== itemType) return false
        return true
      })
      const enriched = []
      for (const r of rows) {
        const col = r.itemType === 'material' ? 'materials' : 'products'
        const doc = await db.collection(col).doc(r.itemId).get()
        const name = String(doc.data()?.name ?? r.itemId)
        if (q && !matchesQuery(name, q)) continue
        enriched.push({ ...r, name })
      }
      return enriched.slice(0, 30)
    }

    case 'find_material': {
      requireRead(actor)
      const q = String(args.query ?? '').toLowerCase()
      const snap = await db.collection('materials').limit(100).get()
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => matchesQuery(String((m as { name?: string }).name ?? ''), q))
        .slice(0, 10)
        .map(m => {
          const row: Record<string, unknown> = {
            id: m.id,
            name: (m as { name?: string }).name,
            unit: (m as { unit?: string }).unit,
            supplierId: (m as { supplierId?: string }).supplierId,
          }
          if (actor.role !== 'worker') {
            row.gstRate = (m as { gstRate?: number }).gstRate
            row.costPerUnit = (m as { costPerUnit?: number }).costPerUnit
          }
          return row
        })
    }

    case 'find_supplier': {
      requireRead(actor)
      const q = String(args.query ?? '').toLowerCase()
      const snap = await db.collection('suppliers').limit(100).get()
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => matchesQuery(String((s as { name?: string }).name ?? ''), q))
        .slice(0, 10)
        .map(s => ({
          id: s.id,
          name: (s as { name?: string }).name,
          phone: (s as { phone?: string }).phone,
          gstin: (s as { gstin?: string }).gstin,
        }))
    }

    case 'find_product': {
      requireRead(actor)
      const q = String(args.query ?? '').toLowerCase()
      const snap = await db.collection('products').limit(100).get()
      const products = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => matchesQuery(String((p as { name?: string }).name ?? ''), q))
        .slice(0, 10)
      const out = []
      for (const p of products) {
        const versions = await db
          .collection('productVersions')
          .where('productId', '==', p.id)
          .where('status', '==', 'active')
          .get()
        const row: Record<string, unknown> = {
          id: p.id,
          name: (p as { name?: string }).name,
          versions: versions.docs.map(v => ({
            id: v.id,
            version: v.data().version,
          })),
        }
        if (actor.role !== 'worker') {
          row.defaultSellingPrice = (p as { defaultSellingPrice?: number }).defaultSellingPrice
        }
        out.push(row)
      }
      return out
    }

    case 'create_supplier': {
      requireOps(actor)
      const ref = await db.collection('suppliers').add({
        type: 'individual',
        name: String(args.name),
        companyName: '',
        contactPerson: '',
        phone: String(args.phone ?? ''),
        email: '',
        address: '',
        city: '',
        notes: '',
        status: 'active',
        gstin: String(args.gstin ?? ''),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { id: ref.id, name: args.name }
    }

    case 'create_material': {
      requireOps(actor)
      const ref = await db.collection('materials').add({
        name: String(args.name),
        category: String(args.category ?? ''),
        unit: String(args.unit ?? 'pcs'),
        minimumStock: 0,
        costPerUnit: Number(args.costPerUnit ?? 0),
        supplierId: String(args.supplierId ?? ''),
        notes: String(args.notes ?? ''),
        colorSpec: String(args.colorSpec ?? ''),
        status: 'active',
        gstRate: Number(args.gstRate ?? 0),
        hsnSac: String(args.hsnSac ?? ''),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { id: ref.id, name: args.name }
    }

    case 'assign_work': {
      if (!isAdminOrOwner(actor.role)) throw new AuthzError('Only owners and admins can assign work')
      const entityType = String(args.entityType)
      const entityId = String(args.entityId)
      const workerIds = Array.isArray(args.workerIds) ? args.workerIds.map(String) : []
      const names: string[] = []
      for (const wid of workerIds) {
        const snap = await db.collection('users').doc(wid).get()
        names.push(String(snap.data()?.name ?? wid))
      }
      const col = entityType === 'production' ? 'productions' : 'orders'
      await db.collection(col).doc(entityId).update({
        assignedWorkerIds: workerIds,
        assignedWorkerNames: names,
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      await db.collection('auditLogs').add({
        actorId: actor.uid,
        actorName: actor.name,
        action: `${entityType}.assign`,
        entityType,
        entityId,
        after: { assignedWorkerIds: workerIds, assignedWorkerNames: names },
        createdAt: FieldValue.serverTimestamp(),
      })
      return { entityType, entityId, assignedWorkerNames: names }
    }

    case 'find_worker': {
      if (!isAdminOrOwner(actor.role)) throw new AuthzError('Only owners and admins can search workers')
      const q = String(args.query ?? '').toLowerCase()
      const snap = await db.collection('users').where('role', '==', 'worker').limit(50).get()
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => {
          if ((u as { active?: boolean }).active === false) return false
          const name = String((u as { name?: string }).name ?? '')
          const email = String((u as { email?: string }).email ?? '')
          return matchesQuery(name, q) || email.toLowerCase().includes(q)
        })
        .slice(0, 10)
        .map(u => ({
          id: u.id,
          name: (u as { name?: string }).name,
          email: (u as { email?: string }).email,
        }))
    }

    case 'analyze_product': {
      requireRead(actor)
      if (actor.role === 'worker') throw new AuthzError('Workers cannot run product costing')
      const productId = String(args.productId)
      const productSnap = await db.collection('products').doc(productId).get()
      if (!productSnap.exists) throw new AuthzError('Product not found')
      const product = productSnap.data()!
      const versions = await db.collection('productVersions').where('productId', '==', productId).get()
      const active = versions.docs.filter(d => d.data().status === 'active').at(-1) ?? versions.docs.at(-1)
      if (!active) return { maxBuildable: 0, guidance: 'No product version yet.' }
      const boms = await db.collection('bomItems').where('productVersionId', '==', active.id).get()
      const txSnap = await db.collection('inventoryTransactions').get()
      const stocks = new Map<string, number>()
      for (const d of txSnap.docs) {
        const t = d.data()
        if (t.itemType !== 'material') continue
        stocks.set(String(t.itemId), (stocks.get(String(t.itemId)) ?? 0) + Number(t.quantity))
      }
      let maxBuildable = Number.POSITIVE_INFINITY
      let costPerUnit = 0
      const bottlenecks: string[] = []
      for (const b of boms.docs) {
        const bom = b.data()
        const mat = await db.collection('materials').doc(bom.materialId).get()
        const name = String(mat.data()?.name ?? bom.materialId)
        const per = Number(bom.quantity) || 0
        const unitCost = Number(mat.data()?.costPerUnit ?? 0)
        costPerUnit += per * unitCost
        const avail = stocks.get(bom.materialId) ?? 0
        const canMake = per > 0 ? Math.floor(avail / per) : 0
        if (canMake < maxBuildable) maxBuildable = canMake
        if (canMake === 0) bottlenecks.push(name)
      }
      if (!Number.isFinite(maxBuildable)) maxBuildable = 0
      const gstRate = Number(product.gstRate ?? 0)
      const pricingSnap = await db.collection('meta').doc('pricing').get()
      const globalMargin = Number(pricingSnap.data()?.targetMarginPct ?? 30)
      const productMargin = product.targetMarginPct
      const rawMargin = productMargin != null && productMargin !== ''
        ? Number(productMargin)
        : globalMargin
      const marginPct = Number.isFinite(rawMargin) ? Math.min(99, Math.max(0, rawMargin)) : 30
      const suggestedTaxableSell = costPerUnit > 0
        ? round2(marginPct >= 100 ? costPerUnit : costPerUnit / (1 - marginPct / 100))
        : Number(product.defaultSellingPrice ?? 0)
      const gstAmount = round2(suggestedTaxableSell * (gstRate / 100))
      const productions = await db.collection('productions').where('productId', '==', productId).get()
      let expected = 0
      let actual = 0
      productions.docs.forEach(d => {
        const p = d.data()
        expected += Number(p.expectedQuantity ?? p.quantity ?? 0)
        actual += Number(p.actualQuantity ?? p.quantity ?? 0)
      })
      const yieldPct = expected > 0 ? `${round2((actual / expected) * 100)}%` : '—'
      const notes = [product.description, product.packagingNotes].filter(Boolean).join(' ')
      const guidance = [
        notes || 'No packaging or product notes yet.',
        bottlenecks.length ? `Stock bottleneck: ${bottlenecks.join(', ')}.` : 'Materials currently cover at least one unit.',
        actual < expected && expected > 0 ? 'Recent batches ran short of expected qty — plan extra material for waste.' : '',
      ].filter(Boolean).join(' ')
      return {
        productId,
        versionId: active.id,
        maxBuildable,
        costPerUnit: round2(costPerUnit),
        suggestedTaxableSell,
        suggestedInvoiceTotal: round2(suggestedTaxableSell + gstAmount),
        gstRate,
        yieldPct,
        guidance,
      }
    }

    default:
      throw new AuthzError(`Unknown tool: ${name}`)
  }
}
