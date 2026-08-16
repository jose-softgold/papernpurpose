import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099'

initializeApp({ projectId: 'demo-project' })
const db = getFirestore()
const authAdmin = getAuth()

async function seed() {
  console.log('Seeding database...')

  // Create test user
  try {
    await authAdmin.createUser({ email: 'admin@craftbiz.local', password: 'password123', displayName: 'Admin' })
  } catch (e) { console.log('User already exists') }

  // Suppliers
  const supplier1Id = await db.collection('suppliers').add({
    name: 'Paper Mart India', phone: '9876543210', email: 'supplier@papermart.in',
    address: 'Mumbai', notes: '', status: 'active',
  }).then(r => r.id)

  // Materials
  const ts = () => FieldValue.serverTimestamp()
  const materials = {
    pinkPaper:   await db.collection('materials').add({ name: 'Pink Craft Paper', category: 'Paper', unit: 'sheets', minimumStock: 100, costPerUnit: 4, supplierId: supplier1Id, notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    greenPaper:  await db.collection('materials').add({ name: 'Green Craft Paper', category: 'Paper', unit: 'sheets', minimumStock: 50, costPerUnit: 4, supplierId: supplier1Id, notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    whitePaper:  await db.collection('materials').add({ name: 'White Craft Paper', category: 'Paper', unit: 'sheets', minimumStock: 50, costPerUnit: 3, supplierId: supplier1Id, notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    goldRibbon:  await db.collection('materials').add({ name: 'Gold Ribbon', category: 'Ribbon', unit: 'meters', minimumStock: 20, costPerUnit: 15, supplierId: supplier1Id, notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    glue:        await db.collection('materials').add({ name: 'Craft Glue', category: 'Adhesive', unit: 'ml', minimumStock: 500, costPerUnit: 0.05, supplierId: supplier1Id, notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    woodenStick: await db.collection('materials').add({ name: 'Wooden Stick', category: 'Structure', unit: 'pieces', minimumStock: 50, costPerUnit: 5, supplierId: supplier1Id, notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    glitter:     await db.collection('materials').add({ name: 'Glitter', category: 'Decoration', unit: 'grams', minimumStock: 100, costPerUnit: 0.5, supplierId: supplier1Id, notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
  }

  // Customers
  const customers = {
    priya: await db.collection('customers').add({ name: 'Priya Sharma', phone: '9812345678', email: 'priya@example.com', address: '12 Rose Garden', city: 'Mumbai', notes: 'Regular customer', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    anil:  await db.collection('customers').add({ name: 'Anil Kumar', phone: '9823456789', email: 'anil@example.com', address: '45 Patel Nagar', city: 'Delhi', notes: '', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
    smith: await db.collection('customers').add({ name: 'John Smith', phone: '9834567890', email: 'smith@example.com', address: '7 Park Lane', city: 'Bangalore', notes: 'Bulk buyer', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id),
  }

  // Products
  const roseId      = await db.collection('products').add({ name: 'Large Paper Rose', category: 'Paper Craft', description: 'Handmade large paper rose decoration', defaultSellingPrice: 250, status: 'active', imageUrl: '', createdAt: ts(), updatedAt: ts() }).then(r => r.id)
  const bannerId    = await db.collection('products').add({ name: 'Birthday Banner', category: 'Banner', description: 'Custom birthday banner with glitter', defaultSellingPrice: 180, status: 'active', imageUrl: '', createdAt: ts(), updatedAt: ts() }).then(r => r.id)
  const butterflyId = await db.collection('products').add({ name: 'Paper Butterfly', category: 'Paper Craft', description: 'Delicate paper butterfly for decoration', defaultSellingPrice: 120, status: 'active', imageUrl: '', createdAt: ts(), updatedAt: ts() }).then(r => r.id)

  // Product Versions
  await db.collection('productVersions').add({ productId: roseId, version: 'V1', description: 'Original design', status: 'inactive', createdAt: ts(), updatedAt: ts() })
  await db.collection('productVersions').add({ productId: roseId, version: 'V2', description: 'Improved petal shape', status: 'inactive', createdAt: ts(), updatedAt: ts() })
  const roseV3      = await db.collection('productVersions').add({ productId: roseId, version: 'V3', description: 'Premium finish with wooden stick', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id)
  const bannerV1    = await db.collection('productVersions').add({ productId: bannerId, version: 'V1', description: 'Standard banner', status: 'active', createdAt: ts(), updatedAt: ts() }).then(r => r.id)
  await db.collection('productVersions').add({ productId: butterflyId, version: 'V1', description: 'Standard butterfly', status: 'active', createdAt: ts(), updatedAt: ts() })

  // BOM items for Large Paper Rose V3
  await Promise.all([
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.pinkPaper, quantity: 6, unit: 'sheets' }),
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.greenPaper, quantity: 2, unit: 'sheets' }),
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.glue, quantity: 8, unit: 'ml' }),
    db.collection('bomItems').add({ productVersionId: roseV3, materialId: materials.woodenStick, quantity: 1, unit: 'pieces' }),
    // BOM items for Birthday Banner V1
    db.collection('bomItems').add({ productVersionId: bannerV1, materialId: materials.whitePaper, quantity: 4, unit: 'sheets' }),
    db.collection('bomItems').add({ productVersionId: bannerV1, materialId: materials.goldRibbon, quantity: 0.5, unit: 'meters' }),
    db.collection('bomItems').add({ productVersionId: bannerV1, materialId: materials.glitter, quantity: 10, unit: 'grams' }),
  ])

  // Inventory: Pink Paper purchase (with actual purchase doc)
  const purchaseRef = await db.collection('purchases').add({
    supplierId: supplier1Id, purchaseDate: Timestamp.now(),
    total: 2000, status: 'COMPLETED', notes: 'Initial stock',
    createdAt: ts(),
  })
  await db.collection('purchaseItems').add({ purchaseId: purchaseRef.id, materialId: materials.pinkPaper, quantity: 500, unitCost: 4, total: 2000 })
  await db.collection('inventoryTransactions').add({
    itemType: 'material', itemId: materials.pinkPaper, transactionType: 'PURCHASE',
    quantity: 500, unit: 'sheets', referenceType: 'purchase', referenceId: purchaseRef.id,
    notes: 'Initial stock purchase', createdAt: Timestamp.now(),
  })

  // Inventory: remaining materials (manual)
  const manualPurchases: Array<{ materialId: string; quantity: number; unit: string }> = [
    { materialId: materials.greenPaper, quantity: 200, unit: 'sheets' },
    { materialId: materials.whitePaper, quantity: 300, unit: 'sheets' },
    { materialId: materials.goldRibbon, quantity: 50, unit: 'meters' },
    { materialId: materials.glue, quantity: 2000, unit: 'ml' },
    { materialId: materials.woodenStick, quantity: 100, unit: 'pieces' },
    { materialId: materials.glitter, quantity: 500, unit: 'grams' },
  ]
  for (const p of manualPurchases) {
    await db.collection('inventoryTransactions').add({
      itemType: 'material', itemId: p.materialId, transactionType: 'PURCHASE',
      quantity: p.quantity, unit: p.unit, referenceType: 'manual', referenceId: '',
      notes: 'Initial stock', createdAt: Timestamp.now(),
    })
  }

  // Production run: 25 Large Paper Roses V3
  // costPerUnit = (6×4) + (2×4) + (8×0.05) + (1×5) = 24 + 8 + 0.4 + 5 = 37.4
  const costPerUnit = 6 * 4 + 2 * 4 + 8 * 0.05 + 1 * 5 // 37.4
  const prodQuantity = 25
  const prodRef = await db.collection('productions').add({
    productId: roseId, productVersionId: roseV3, quantity: prodQuantity,
    productionDate: Timestamp.now(),
    totalMaterialCost: costPerUnit * prodQuantity, // 935
    costPerUnit,
    status: 'COMPLETED',
    notes: 'First production run',
    createdAt: ts(),
  })

  // ProductionMaterials + CONSUMPTION transactions
  const bomForProduction = [
    { materialId: materials.pinkPaper, qty: 6, unitCost: 4, unit: 'sheets' },
    { materialId: materials.greenPaper, qty: 2, unitCost: 4, unit: 'sheets' },
    { materialId: materials.glue, qty: 8, unitCost: 0.05, unit: 'ml' },
    { materialId: materials.woodenStick, qty: 1, unitCost: 5, unit: 'pieces' },
  ]
  for (const bom of bomForProduction) {
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
      notes: 'Production of 25 Large Paper Roses V3',
      createdAt: Timestamp.now(),
    })
  }

  // PRODUCTION inventory transaction (finished goods +25)
  await db.collection('inventoryTransactions').add({
    itemType: 'product', itemId: roseId,
    transactionType: 'PRODUCTION', quantity: 25, unit: 'units',
    referenceType: 'production', referenceId: prodRef.id,
    notes: 'Completed production of 25 units',
    createdAt: Timestamp.now(),
  })

  // Orders — exact spec section 34 scenario

  // Order 1: Priya buys 10 Large Paper Roses V3 @ ₹250 (COMPLETED)
  const order1Ref = await db.collection('orders').add({
    customerId: customers.priya, orderDate: Timestamp.now(),
    eventDate: null, eventType: 'Birthday',
    subtotal: 2500, discount: 0, total: 2500,
    status: 'COMPLETED', notes: '',
    createdAt: ts(), updatedAt: ts(),
  })
  await db.collection('orderItems').add({
    orderId: order1Ref.id, productId: roseId, productVersionId: roseV3,
    quantity: 10, unitPrice: 250, totalPrice: 2500,
    costPerUnit, totalCost: costPerUnit * 10, profit: 2500 - costPerUnit * 10,
  })
  await db.collection('inventoryTransactions').add({
    itemType: 'product', itemId: roseId, transactionType: 'SALE', quantity: -10, unit: 'units',
    referenceType: 'order', referenceId: order1Ref.id,
    notes: 'Sale order - Priya', createdAt: Timestamp.now(),
  })

  // Order 2: Anil buys 5 Large Paper Roses V3 @ ₹225 (COMPLETED)
  const order2Ref = await db.collection('orders').add({
    customerId: customers.anil, orderDate: Timestamp.now(),
    eventDate: null, eventType: 'Anniversary',
    subtotal: 1125, discount: 0, total: 1125,
    status: 'COMPLETED', notes: '',
    createdAt: ts(), updatedAt: ts(),
  })
  await db.collection('orderItems').add({
    orderId: order2Ref.id, productId: roseId, productVersionId: roseV3,
    quantity: 5, unitPrice: 225, totalPrice: 1125,
    costPerUnit, totalCost: costPerUnit * 5, profit: 1125 - costPerUnit * 5,
  })
  await db.collection('inventoryTransactions').add({
    itemType: 'product', itemId: roseId, transactionType: 'SALE', quantity: -5, unit: 'units',
    referenceType: 'order', referenceId: order2Ref.id,
    notes: 'Sale order - Anil', createdAt: Timestamp.now(),
  })

  // Order 3: John Smith buys 8 Birthday Banners V1 @ ₹200 (CONFIRMED — no inventory transaction)
  const order3Ref = await db.collection('orders').add({
    customerId: customers.smith, orderDate: Timestamp.now(),
    eventDate: null, eventType: 'Party',
    subtotal: 1600, discount: 100, total: 1500,
    status: 'CONFIRMED', notes: 'Bulk discount applied',
    createdAt: ts(), updatedAt: ts(),
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
