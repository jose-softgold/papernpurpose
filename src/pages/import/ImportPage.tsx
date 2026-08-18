import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { parseSpreadsheet, exportToCSV } from '../../utils/export'
import { cell, matchName, matchParty, parseDate, parseGst } from '../../utils/importParse'
import { customerService } from '../../services/customers'
import { supplierService } from '../../services/suppliers'
import { materialService } from '../../services/materials'
import { productService } from '../../services/products'
import { orderService } from '../../services/orders'
import { purchaseService } from '../../services/purchases'
import { bomService } from '../../services/bom'
import { productionService } from '../../services/production'
import { auditService } from '../../services/audit'
import PageHeader from '../../components/PageHeader'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import type { Customer, Material, Product, ProductVersion, Supplier } from '../../types'

export type ImportKind =
  | 'customers'
  | 'suppliers'
  | 'materials'
  | 'products'
  | 'purchases'
  | 'orders'
  | 'bom'
  | 'production'

interface PreviewRow {
  row: number
  error?: string
  badges: string[]
  cells: string[]
  data: Record<string, string | number | boolean | undefined>
}

const KINDS: { id: ImportKind; label: string }[] = [
  { id: 'customers', label: 'Customers' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'materials', label: 'Materials' },
  { id: 'products', label: 'Products' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'orders', label: 'Orders' },
  { id: 'bom', label: 'BOM' },
  { id: 'production', label: 'Production' },
]

const TEMPLATES: Record<ImportKind, Record<string, unknown>> = {
  customers: {
    name: 'Priya Sharma',
    type: 'individual',
    phone: '9876543210',
    email: 'priya@example.com',
    city: 'Chennai',
    address: '12 Flower Street',
    gstin: '',
    notes: '',
    'company name': '',
    'contact person': '',
  },
  suppliers: {
    name: 'Paper Mart',
    type: 'company',
    phone: '9876500001',
    email: 'sales@papermart.example',
    city: 'Chennai',
    address: 'Warehouse Road',
    gstin: '33AAAAA0000A1Z5',
    'company name': 'Paper Mart',
    'contact person': 'Ravi',
    notes: '',
  },
  materials: {
    name: 'Cardstock Red',
    category: 'Paper',
    unit: 'sheet',
    'minimum stock': 50,
    'cost per unit': 18,
    'gst rate': 12,
    hsn: '4802',
    supplier: 'Paper Mart',
    notes: '',
  },
  products: {
    name: 'Floral backdrop',
    category: 'Decor',
    description: 'Standard floral wall',
    'selling price': 2500,
    'gst rate': 12,
    hsn: '9505',
    version: 'V1',
    notes: '',
  },
  purchases: {
    supplier: 'Paper Mart',
    'purchase date': '2026-08-01',
    material: 'Cardstock Red',
    qty: 100,
    'unit cost': 18,
    'gst rate': 12,
    notes: 'Missed bill from August',
  },
  orders: {
    'customer name': 'Priya Sharma',
    phone: '9876543210',
    'order date': '2026-08-01',
    'event date': '2026-08-20',
    'event type': 'Birthday',
    'product name': 'Floral backdrop',
    qty: 1,
    'unit price': 2500,
    notes: 'Missed order from August',
  },
  bom: {
    product: 'Floral backdrop',
    version: 'V1',
    material: 'Cardstock Red',
    qty: 12,
    unit: 'sheet',
  },
  production: {
    product: 'Floral backdrop',
    version: 'V1',
    'expected qty': 10,
    'actual qty': 9,
    date: '2026-08-10',
    notes: 'Catch-up batch',
  },
}

const HINTS: Record<ImportKind, string> = {
  customers: 'Columns: name, type (individual/company), phone, email, city, address, gstin, company name, contact person, notes.',
  suppliers: 'Columns: name, type, phone, email, city, address, gstin, company name, contact person, notes.',
  materials: 'Columns: name, category, unit, minimum stock, cost per unit, gst rate, hsn, supplier, notes. Missing suppliers are created.',
  products: 'Columns: name, category, description, selling price, gst rate, hsn, version, notes. A version is created if missing (default V1).',
  purchases: 'Columns: supplier, purchase date, material, qty, unit cost, gst rate, notes. Rows with the same supplier + date become one purchase. Missing suppliers/materials are created.',
  orders: 'Columns: customer name, phone, order date, event date, event type, product name, qty, unit price, notes. Rows with the same customer + dates become one order. Missing customers/products are created.',
  bom: 'Columns: product, version, material, qty, unit. Links a material into a product version recipe. Missing materials/products/versions are created.',
  production: 'Columns: product, version, expected qty, actual qty, date, notes. Completes a batch and updates stock from the BOM. Product must already have a BOM.',
}

const HEADERS: Record<ImportKind, string[]> = {
  customers: ['Row', 'Name', 'Phone', 'City', 'Status'],
  suppliers: ['Row', 'Name', 'Phone', 'GSTIN', 'Status'],
  materials: ['Row', 'Name', 'Unit', 'Cost', 'GST', 'Status'],
  products: ['Row', 'Name', 'Price', 'Version', 'Status'],
  purchases: ['Row', 'Supplier', 'Material', 'Qty', 'Cost', 'Status'],
  orders: ['Row', 'Customer', 'Product', 'Qty', 'Price', 'Status'],
  bom: ['Row', 'Product', 'Version', 'Material', 'Qty', 'Status'],
  production: ['Row', 'Product', 'Version', 'Expected', 'Actual', 'Status'],
}

export default function ImportPage() {
  const [params, setParams] = useSearchParams()
  const kind = (KINDS.some(k => k.id === params.get('type')) ? params.get('type') : 'orders') as ImportKind
  const { toasts, showToast } = useToast()
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(0)

  useEffect(() => {
    setRows([])
    setDone(0)
  }, [kind])

  const setKind = (next: ImportKind) => {
    setParams({ type: next })
  }

  const downloadTemplate = () => {
    exportToCSV([TEMPLATES[kind]], `${kind}-import-template`)
  }

  const handleFile = async (file: File) => {
    setParsing(true)
    setDone(0)
    try {
      const raw = await parseSpreadsheet(file)
      if (!raw.length) {
        showToast('No rows found in that file', 'warning')
        setRows([])
        return
      }
      const catalog = await loadCatalog()
      setRows(raw.map((r, i) => mapKind(kind, r, i + 2, catalog)))
    } catch {
      showToast('Could not read that file', 'danger')
    } finally {
      setParsing(false)
    }
  }

  const valid = rows.filter(r => !r.error)
  const invalid = rows.filter(r => r.error)

  const runImport = async () => {
    if (!valid.length || importing) return
    setImporting(true)
    setDone(0)
    try {
      const imported = await commitKind(kind, valid, n => setDone(n))
      await auditService.log({
        action: `${kind}.bulk_import`,
        entityType: kind,
        entityId: 'bulk',
        after: { imported, skipped: invalid.length },
      })
      showToast(`Imported ${imported} ${kind} row${imported === 1 ? '' : 's'}`)
      setRows([])
    } catch (err) {
      console.error(err)
      showToast('Import failed part-way. Check the list and retry remaining rows.', 'danger')
    } finally {
      setImporting(false)
    }
  }

  const previewCols = useMemo(() => HEADERS[kind], [kind])

  return (
    <div>
      <ToastContainer toasts={toasts} />
      <PageHeader
        title="Bulk import"
        subtitle="Catch up missed records from CSV or Excel"
        icon="📥"
        actions={
          <Link to="/dashboard" className="btn btn-outline-secondary btn-sm">Back</Link>
        }
      />

      <ul className="nav nav-pills flex-wrap gap-1 mb-3">
        {KINDS.map(k => (
          <li key={k.id} className="nav-item">
            <button
              type="button"
              className={`nav-link${kind === k.id ? ' active' : ''}`}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="card mb-3">
        <div className="card-body">
          <p className="text-muted mb-3">{HINTS[kind]}</p>
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={downloadTemplate}>
              Download template
            </button>
            <label className="btn btn-primary mb-0">
              {parsing ? 'Reading…' : 'Choose file'}
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="d-none"
                disabled={parsing || importing}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            <div className="text-muted">
              {valid.length} ready · {invalid.length} with errors
              {importing && ` · imported ${done}`}
            </div>
            <button className="btn btn-primary" disabled={!valid.length || importing} onClick={runImport}>
              {importing ? 'Importing…' : `Import ${valid.length} rows`}
            </button>
          </div>
          <div className="card">
            <div className="table-responsive">
              <table className="table table-sm mb-0 align-middle">
                <thead>
                  <tr>
                    {previewCols.map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.row} className={r.error ? 'table-danger' : ''}>
                      <td>{r.row}</td>
                      {r.cells.map((c, i) => (
                        <td key={i}>
                          {c || '—'}
                          {i === 0 && r.badges.map(b => (
                            <span key={b} className="badge bg-info text-dark ms-1">{b}</span>
                          ))}
                        </td>
                      ))}
                      <td className="small">{r.error || 'OK'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface Catalog {
  customers: Customer[]
  suppliers: Supplier[]
  materials: Material[]
  products: Product[]
  versions: ProductVersion[]
  bomVersionIds: Set<string>
}

async function loadCatalog(): Promise<Catalog> {
  const [customers, suppliers, materials, products, versions, boms] = await Promise.all([
    customerService.getAll(),
    supplierService.getAll(),
    materialService.getAll(),
    productService.getAll(),
    productService.getAllVersions(),
    bomService.getAll(),
  ])
  return {
    customers,
    suppliers,
    materials,
    products,
    versions,
    bomVersionIds: new Set(boms.map(b => b.productVersionId)),
  }
}

function mapKind(kind: ImportKind, r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  switch (kind) {
    case 'customers': return mapCustomer(r, row, cat)
    case 'suppliers': return mapSupplier(r, row, cat)
    case 'materials': return mapMaterial(r, row, cat)
    case 'products': return mapProduct(r, row, cat)
    case 'purchases': return mapPurchase(r, row, cat)
    case 'orders': return mapOrder(r, row, cat)
    case 'bom': return mapBom(r, row, cat)
    case 'production': return mapProduction(r, row, cat)
  }
}

function mapCustomer(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const name = cell(r, 'name', 'customer name', 'customer')
  const phone = cell(r, 'phone', 'mobile')
  const type = cell(r, 'type').toLowerCase() === 'company' ? 'company' : 'individual'
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [name, phone, cell(r, 'city')],
    data: {
      name,
      phone,
      type,
      email: cell(r, 'email'),
      city: cell(r, 'city'),
      address: cell(r, 'address'),
      gstin: cell(r, 'gstin'),
      notes: cell(r, 'notes', 'note'),
      companyName: cell(r, 'company name', 'company'),
      contactPerson: cell(r, 'contact person'),
    },
  }
  if (!name) out.error = 'Name required'
  const existing = matchParty(cat.customers, name, phone)
  if (existing) {
    out.error = 'Already exists'
    out.data.id = existing.id
  } else {
    out.badges.push('new')
  }
  return out
}

function mapSupplier(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const name = cell(r, 'name', 'supplier', 'supplier name')
  const phone = cell(r, 'phone', 'mobile')
  const gstin = cell(r, 'gstin')
  const type = cell(r, 'type').toLowerCase() === 'company' ? 'company' : 'individual'
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [name, phone, gstin],
    data: {
      name,
      phone,
      gstin,
      type,
      email: cell(r, 'email'),
      city: cell(r, 'city'),
      address: cell(r, 'address'),
      notes: cell(r, 'notes', 'note'),
      companyName: cell(r, 'company name', 'company'),
      contactPerson: cell(r, 'contact person'),
    },
  }
  if (!name) out.error = 'Name required'
  const existing = matchParty(cat.suppliers, name, phone)
  if (existing) out.error = 'Already exists'
  else out.badges.push('new')
  return out
}

function mapMaterial(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const name = cell(r, 'name', 'material', 'material name')
  const unit = cell(r, 'unit') || 'pcs'
  const cost = Number(cell(r, 'cost per unit', 'cost', 'unit cost') || 0)
  const gstRate = parseGst(cell(r, 'gst rate', 'gst'))
  const supplierName = cell(r, 'supplier', 'supplier name')
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [name, unit, String(cost || ''), gstRate ? `${gstRate}%` : '0%'],
    data: {
      name,
      unit,
      cost,
      gstRate,
      category: cell(r, 'category'),
      minimumStock: Number(cell(r, 'minimum stock', 'min stock') || 0),
      hsnSac: cell(r, 'hsn', 'hsn sac', 'hsn/sac'),
      notes: cell(r, 'notes', 'note'),
      supplierName,
    },
  }
  if (!name) out.error = 'Name required'
  if (matchName(cat.materials, name)) out.error = 'Already exists'
  else out.badges.push('new')
  if (supplierName && !matchParty(cat.suppliers, supplierName, '')) out.badges.push('new supplier')
  return out
}

function mapProduct(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const name = cell(r, 'name', 'product', 'product name')
  const version = cell(r, 'version') || 'V1'
  const price = Number(cell(r, 'selling price', 'price', 'default selling price') || 0)
  const existing = matchName(cat.products, name)
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [name, String(price || ''), version],
    data: {
      name,
      version,
      price,
      category: cell(r, 'category'),
      description: cell(r, 'description', 'notes', 'note'),
      gstRate: parseGst(cell(r, 'gst rate', 'gst')),
      hsnSac: cell(r, 'hsn', 'hsn sac'),
    },
  }
  if (!name) out.error = 'Name required'
  if (existing) {
    const hasVersion = cat.versions.some(v => v.productId === existing.id && v.version.toLowerCase() === version.toLowerCase())
    if (hasVersion) out.error = 'Product + version already exist'
    else {
      out.data.productId = existing.id
      out.badges.push('new version')
    }
  } else {
    out.badges.push('new')
  }
  return out
}

function mapPurchase(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const supplierName = cell(r, 'supplier', 'supplier name')
  const materialName = cell(r, 'material', 'material name')
  const qty = Number(cell(r, 'qty', 'quantity') || 0)
  const unitCost = Number(cell(r, 'unit cost', 'cost', 'cost per unit') || 0)
  const gstRate = parseGst(cell(r, 'gst rate', 'gst'))
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [supplierName, materialName, String(qty || ''), String(unitCost || '')],
    data: {
      supplierName,
      materialName,
      qty,
      unitCost,
      gstRate,
      notes: cell(r, 'notes', 'note'),
      purchaseDate: cell(r, 'purchase date', 'date'),
    },
  }
  if (!supplierName) out.error = 'Supplier required'
  else if (!materialName) out.error = 'Material required'
  else if (!(qty > 0)) out.error = 'Qty must be > 0'
  if (supplierName && !matchParty(cat.suppliers, supplierName, '')) out.badges.push('new supplier')
  const mat = matchName(cat.materials, materialName)
  if (materialName && !mat) out.badges.push('new material')
  else if (mat && !out.data.unitCost) {
    out.data.unitCost = mat.costPerUnit
    out.data.gstRate = gstRate || mat.gstRate || 0
    out.cells[3] = String(mat.costPerUnit)
  }
  return out
}

function mapOrder(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const customerName = cell(r, 'customer name', 'customer', 'name')
  const phone = cell(r, 'phone', 'mobile')
  const productName = cell(r, 'product name', 'product')
  const qty = Number(cell(r, 'qty', 'quantity') || 0)
  const unitPrice = Number(cell(r, 'unit price', 'price', 'selling price') || 0)
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [customerName, productName, String(qty || ''), String(unitPrice || '')],
    data: {
      customerName,
      phone,
      productName,
      qty,
      unitPrice,
      notes: cell(r, 'notes', 'note'),
      orderDate: cell(r, 'order date', 'date'),
      eventDate: cell(r, 'event date'),
      eventType: cell(r, 'event type', 'event'),
    },
  }
  if (!customerName) out.error = 'Customer name required'
  else if (!productName) out.error = 'Product name required'
  else if (!(qty > 0)) out.error = 'Qty must be > 0'
  if (!matchParty(cat.customers, customerName, phone)) out.badges.push('new customer')
  const product = matchName(cat.products, productName)
  if (!product) out.badges.push('new product')
  else {
    out.data.gstRate = product.gstRate ?? 0
    if (!unitPrice) {
      out.data.unitPrice = product.defaultSellingPrice
      out.cells[3] = String(product.defaultSellingPrice)
    }
    const vers = cat.versions.filter(v => v.productId === product.id)
    const active = vers.filter(v => v.status === 'active')
    out.data.productId = product.id
    out.data.productVersionId = active.at(0)?.id ?? vers[0]?.id
    if (!out.data.productVersionId) out.error = 'Product has no version'
  }
  return out
}

function mapBom(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const productName = cell(r, 'product', 'product name')
  const versionLabel = cell(r, 'version') || 'V1'
  const materialName = cell(r, 'material', 'material name')
  const qty = Number(cell(r, 'qty', 'quantity') || 0)
  const unit = cell(r, 'unit')
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [productName, versionLabel, materialName, String(qty || '')],
    data: { productName, versionLabel, materialName, qty, unit },
  }
  if (!productName) out.error = 'Product required'
  else if (!materialName) out.error = 'Material required'
  else if (!(qty > 0)) out.error = 'Qty must be > 0'
  if (!matchName(cat.products, productName)) out.badges.push('new product')
  if (!matchName(cat.materials, materialName)) out.badges.push('new material')
  return out
}

function mapProduction(r: Record<string, string>, row: number, cat: Catalog): PreviewRow {
  const productName = cell(r, 'product', 'product name')
  const versionLabel = cell(r, 'version')
  const expected = Number(cell(r, 'expected qty', 'qty', 'quantity') || 0)
  const actual = Number(cell(r, 'actual qty', 'actual') || expected)
  const out: PreviewRow = {
    row,
    badges: [],
    cells: [productName, versionLabel || 'active', String(expected || ''), String(actual || '')],
    data: {
      productName,
      versionLabel,
      expected,
      actual,
      notes: cell(r, 'notes', 'note'),
      date: cell(r, 'date', 'production date'),
    },
  }
  if (!productName) out.error = 'Product required'
  else if (!(expected > 0)) out.error = 'Expected qty must be > 0'
  const product = matchName(cat.products, productName)
  if (!product) out.error = 'Product not found — import products and BOM first'
  else {
    out.data.productId = product.id
    const vers = cat.versions.filter(v => v.productId === product.id)
    const match = versionLabel
      ? vers.find(v => v.version.toLowerCase() === versionLabel.toLowerCase())
      : vers.filter(v => v.status === 'active').at(0) ?? vers.at(0)
    if (!match) out.error = 'Product version not found'
    else {
      out.data.productVersionId = match.id
      out.cells[1] = match.version
      if (!cat.bomVersionIds.has(match.id)) out.error = 'No BOM for this version — import BOM first'
    }
  }
  return out
}

async function ensureSupplier(name: string, cache: Map<string, string>, list: Supplier[]): Promise<string> {
  const key = name.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key)!
  const existing = matchParty(list, name, '')
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }
  const id = await supplierService.create({
    type: 'individual',
    name: name.trim(),
    companyName: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    notes: 'Created from bulk import',
    status: 'active',
  })
  cache.set(key, id)
  return id
}

async function ensureMaterial(
  name: string,
  cache: Map<string, Material>,
  extras?: { unit?: string; cost?: number; gstRate?: number; supplierId?: string },
): Promise<Material> {
  const key = name.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key)!
  const id = await materialService.create({
    name: name.trim(),
    category: '',
    unit: extras?.unit || 'pcs',
    minimumStock: 0,
    costPerUnit: extras?.cost ?? 0,
    supplierId: extras?.supplierId ?? '',
    notes: 'Created from bulk import',
    status: 'active',
    gstRate: extras?.gstRate ?? 0,
  })
  const mat: Material = {
    id,
    name: name.trim(),
    category: '',
    unit: extras?.unit || 'pcs',
    minimumStock: 0,
    costPerUnit: extras?.cost ?? 0,
    supplierId: extras?.supplierId ?? '',
    notes: '',
    status: 'active',
    gstRate: extras?.gstRate ?? 0,
    createdAt: undefined as never,
    updatedAt: undefined as never,
  }
  cache.set(key, mat)
  return mat
}

async function ensureProduct(
  name: string,
  cache: Map<string, { id: string; versionId: string }>,
  extras?: { price?: number; gstRate?: number; version?: string; category?: string; description?: string; hsnSac?: string },
): Promise<{ id: string; versionId: string }> {
  const key = name.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key)!
  const id = await productService.create({
    name: name.trim(),
    category: extras?.category ?? '',
    description: extras?.description ?? 'Created from bulk import',
    defaultSellingPrice: extras?.price ?? 0,
    status: 'active',
    imageUrl: '',
    gstRate: extras?.gstRate ?? 0,
    hsnSac: extras?.hsnSac ?? '',
  })
  const versionId = await productService.createVersion({
    productId: id,
    version: extras?.version || 'V1',
    description: 'Imported',
    status: 'active',
  })
  const pair = { id, versionId }
  cache.set(key, pair)
  return pair
}

async function commitKind(kind: ImportKind, rows: PreviewRow[], onProgress: (n: number) => void): Promise<number> {
  const cat = await loadCatalog()
  let n = 0

  if (kind === 'customers') {
    for (const row of rows) {
      const d = row.data
      await customerService.create({
        type: d.type === 'company' ? 'company' : 'individual',
        name: String(d.name),
        companyName: String(d.companyName ?? ''),
        contactPerson: String(d.contactPerson ?? ''),
        phone: String(d.phone ?? ''),
        email: String(d.email ?? ''),
        address: String(d.address ?? ''),
        city: String(d.city ?? ''),
        notes: String(d.notes ?? 'Created from bulk import'),
        status: 'active',
        gstin: String(d.gstin ?? ''),
      })
      onProgress(++n)
    }
    return n
  }

  if (kind === 'suppliers') {
    for (const row of rows) {
      const d = row.data
      await supplierService.create({
        type: d.type === 'company' ? 'company' : 'individual',
        name: String(d.name),
        companyName: String(d.companyName ?? ''),
        contactPerson: String(d.contactPerson ?? ''),
        phone: String(d.phone ?? ''),
        email: String(d.email ?? ''),
        address: String(d.address ?? ''),
        city: String(d.city ?? ''),
        notes: String(d.notes ?? 'Created from bulk import'),
        status: 'active',
        gstin: String(d.gstin ?? ''),
      })
      onProgress(++n)
    }
    return n
  }

  if (kind === 'materials') {
    const supplierIds = new Map<string, string>()
    for (const row of rows) {
      const d = row.data
      let supplierId = ''
      if (d.supplierName) supplierId = await ensureSupplier(String(d.supplierName), supplierIds, cat.suppliers)
      await materialService.create({
        name: String(d.name),
        category: String(d.category ?? ''),
        unit: String(d.unit || 'pcs'),
        minimumStock: Number(d.minimumStock || 0),
        costPerUnit: Number(d.cost || 0),
        supplierId,
        notes: String(d.notes ?? 'Created from bulk import'),
        status: 'active',
        gstRate: Number(d.gstRate || 0),
        hsnSac: String(d.hsnSac ?? ''),
      })
      onProgress(++n)
    }
    return n
  }

  if (kind === 'products') {
    for (const row of rows) {
      const d = row.data
      if (d.productId) {
        await productService.createVersion({
          productId: String(d.productId),
          version: String(d.version || 'V1'),
          description: 'Imported',
          status: 'active',
        })
      } else {
        const id = await productService.create({
          name: String(d.name),
          category: String(d.category ?? ''),
          description: String(d.description ?? ''),
          defaultSellingPrice: Number(d.price || 0),
          status: 'active',
          imageUrl: '',
          gstRate: Number(d.gstRate || 0),
          hsnSac: String(d.hsnSac ?? ''),
        })
        await productService.createVersion({
          productId: id,
          version: String(d.version || 'V1'),
          description: 'Imported',
          status: 'active',
        })
      }
      onProgress(++n)
    }
    return n
  }

  if (kind === 'purchases') {
    const supplierIds = new Map<string, string>()
    const materials = new Map<string, Material>(cat.materials.map(m => [m.name.toLowerCase(), m]))
    const groups = new Map<string, PreviewRow[]>()
    for (const row of rows) {
      const key = `${String(row.data.supplierName).toLowerCase()}|${String(row.data.purchaseDate)}`
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }
    for (const group of groups.values()) {
      const first = group[0].data
      const supplierId = await ensureSupplier(String(first.supplierName), supplierIds, cat.suppliers)
      const items = []
      for (const row of group) {
        const d = row.data
        const mat = await (async () => {
          const existing = materials.get(String(d.materialName).toLowerCase())
          if (existing) return existing
          return ensureMaterial(String(d.materialName), materials, {
            cost: Number(d.unitCost || 0),
            gstRate: Number(d.gstRate || 0),
            supplierId,
          })
        })()
        items.push({
          materialId: mat.id,
          quantity: Number(d.qty),
          unitCost: Number(d.unitCost || mat.costPerUnit || 0),
          unit: mat.unit,
          gstRate: Number(d.gstRate || mat.gstRate || 0),
        })
        onProgress(++n)
      }
      await purchaseService.complete({
        supplierId,
        purchaseDate: Timestamp.fromDate(parseDate(String(first.purchaseDate)) ?? new Date()),
        notes: String(first.notes ?? 'Bulk import'),
        items,
      })
    }
    return n
  }

  if (kind === 'orders') {
    const customers = [...cat.customers]
    const products = new Map<string, { id: string; versionId: string }>()
    for (const p of cat.products) {
      const vers = cat.versions.filter(v => v.productId === p.id)
      const active = vers.filter(v => v.status === 'active').at(0) ?? vers.at(0)
      if (active) products.set(p.name.toLowerCase(), { id: p.id, versionId: active.id })
    }
    const groups = new Map<string, PreviewRow[]>()
    for (const row of rows) {
      const d = row.data
      const key = [
        String(d.customerName).toLowerCase(),
        String(d.phone ?? ''),
        String(d.orderDate ?? ''),
        String(d.eventDate ?? ''),
        String(d.eventType ?? ''),
      ].join('|')
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }
    for (const group of groups.values()) {
      const first = group[0].data
      let customerId = matchParty(customers, String(first.customerName), String(first.phone ?? ''))?.id
      if (!customerId) {
        customerId = await customerService.create({
          type: 'individual',
          name: String(first.customerName),
          companyName: '',
          contactPerson: '',
          phone: String(first.phone ?? ''),
          email: '',
          address: '',
          city: '',
          notes: 'Created from bulk import',
          status: 'active',
        })
        customers.push({ id: customerId, name: String(first.customerName), phone: String(first.phone ?? '') } as Customer)
      }
      const items = []
      for (const row of group) {
        const d = row.data
        let prod = products.get(String(d.productName).toLowerCase())
        if (!prod) {
          prod = await ensureProduct(String(d.productName), products, { price: Number(d.unitPrice || 0), gstRate: Number(d.gstRate || 0) })
        }
        items.push({
          productId: prod.id,
          productVersionId: prod.versionId,
          quantity: Number(d.qty),
          unitPrice: Number(d.unitPrice || 0),
          costPerUnit: 0,
          gstRate: Number(d.gstRate || 0),
        })
        onProgress(++n)
      }
      await orderService.create({
        customerId,
        orderDate: Timestamp.fromDate(parseDate(String(first.orderDate)) ?? new Date()),
        eventDate: parseDate(String(first.eventDate ?? '')) ? Timestamp.fromDate(parseDate(String(first.eventDate))!) : null,
        eventType: String(first.eventType ?? ''),
        discount: 0,
        notes: String(first.notes ?? ''),
        items,
      })
    }
    return n
  }

  if (kind === 'bom') {
    const products = new Map<string, { id: string; versionId: string }>()
    for (const p of cat.products) {
      const vers = cat.versions.filter(v => v.productId === p.id)
      const active = vers.filter(v => v.status === 'active').at(0) ?? vers.at(0)
      if (active) products.set(p.name.toLowerCase(), { id: p.id, versionId: active.id })
    }
    const materials = new Map<string, Material>(cat.materials.map(m => [m.name.toLowerCase(), m]))
    const existingBom = await bomService.getAll()
    for (const row of rows) {
      const d = row.data
      let prod = products.get(String(d.productName).toLowerCase())
      if (!prod) {
        prod = await ensureProduct(String(d.productName), products, { version: String(d.versionLabel || 'V1') })
      } else if (d.versionLabel) {
        const match = cat.versions.find(v => v.productId === prod!.id && v.version.toLowerCase() === String(d.versionLabel).toLowerCase())
        if (match) prod = { id: prod.id, versionId: match.id }
        else {
          const versionId = await productService.createVersion({
            productId: prod.id,
            version: String(d.versionLabel),
            description: 'Imported',
            status: 'active',
          })
          prod = { id: prod.id, versionId }
          products.set(String(d.productName).toLowerCase(), prod)
        }
      }
      let mat = materials.get(String(d.materialName).toLowerCase())
      if (!mat) mat = await ensureMaterial(String(d.materialName), materials, { unit: String(d.unit || 'pcs') })
      const dup = existingBom.some(b => b.productVersionId === prod.versionId && b.materialId === mat.id)
      if (!dup) {
        await bomService.create({
          productVersionId: prod.versionId,
          materialId: mat.id,
          quantity: Number(d.qty),
          unit: String(d.unit || mat.unit),
        })
        existingBom.push({ id: 'new', productVersionId: prod.versionId, materialId: mat.id, quantity: Number(d.qty), unit: String(d.unit || mat.unit) })
      }
      onProgress(++n)
    }
    return n
  }

  if (kind === 'production') {
    for (const row of rows) {
      const d = row.data
      const productId = String(d.productId)
      const productVersionId = String(d.productVersionId)
      const expected = Number(d.expected)
      const actual = Number(d.actual || expected)
      const boms = await bomService.getByVersionId(productVersionId)
      if (!boms.length) continue
      const bomMaterials = []
      for (const b of boms) {
        const mat = cat.materials.find(m => m.id === b.materialId)
        bomMaterials.push({
          materialId: b.materialId,
          plannedQty: b.quantity,
          actualQty: b.quantity * actual,
          unitCost: mat?.costPerUnit ?? 0,
          unit: mat?.unit ?? b.unit,
        })
      }
      await productionService.complete({
        productId,
        productVersionId,
        expectedQuantity: expected,
        actualQuantity: actual,
        productionDate: Timestamp.fromDate(parseDate(String(d.date)) ?? new Date()),
        notes: String(d.notes ?? 'Bulk import'),
        bomMaterials,
      })
      onProgress(++n)
    }
    return n
  }

  return n
}
