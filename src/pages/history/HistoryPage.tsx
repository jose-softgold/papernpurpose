import { useState, useEffect, useMemo } from 'react'
import { Material, Product, InventoryTransaction, TransactionType, AuditLog } from '../../types'
import { inventoryService } from '../../services/inventory'
import { materialService } from '../../services/materials'
import { productService } from '../../services/products'
import { auditService } from '../../services/audit'
import { formatDate } from '../../utils/format'
import { exportToCSV } from '../../utils/export'
import LoadingSpinner from '../../components/LoadingSpinner'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'

const ALL_TYPES: TransactionType[] = [
  'PURCHASE', 'PRODUCTION', 'CONSUMPTION', 'SALE', 'WASTE', 'ADJUSTMENT', 'RETURN', 'TRANSFORMATION',
]

const TYPE_BADGE: Record<string, string> = {
  PURCHASE: 'success',
  CONSUMPTION: 'warning',
  SALE: 'info',
  WASTE: 'danger',
  PRODUCTION: 'primary',
  ADJUSTMENT: 'secondary',
  RETURN: 'light',
  TRANSFORMATION: 'dark',
}

export default function HistoryPage() {
  const [tab, setTab] = useState<'stock' | 'audit'>('stock')
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [products, setProducts] = useState<Product[]>([])

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<Set<TransactionType>>(new Set())
  const [itemSearch, setItemSearch] = useState('')

  useEffect(() => {
    Promise.all([
      inventoryService.getTransactions(),
      materialService.getAll(),
      productService.getAll(),
      auditService.getAll().catch(() => [] as AuditLog[]),
    ]).then(([txs, mats, prods, logs]) => {
      setTransactions(txs)
      setMaterials(mats)
      setProducts(prods)
      setAuditLogs(logs)
    }).finally(() => setLoading(false))
  }, [])

  const matMap = useMemo(() => {
    const m: Record<string, string> = {}
    materials.forEach(mat => { m[mat.id] = mat.name })
    return m
  }, [materials])

  const prodMap = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach(prod => { m[prod.id] = prod.name })
    return m
  }, [products])

  function getItemName(tx: InventoryTransaction): string {
    if (tx.itemType === 'material') return matMap[tx.itemId] ?? tx.itemId
    return prodMap[tx.itemId] ?? tx.itemId
  }

  function getReference(tx: InventoryTransaction): string {
    if (!tx.referenceType && !tx.referenceId) return '—'
    const short = tx.referenceId ? tx.referenceId.slice(0, 6) : ''
    return tx.referenceType ? `${tx.referenceType}/${short}` : short
  }

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (selectedTypes.size > 0 && !selectedTypes.has(tx.transactionType)) return false

      if (dateFrom || dateTo) {
        const d = tx.createdAt?.toDate?.()
        if (d) {
          if (dateFrom && d < new Date(dateFrom)) return false
          if (dateTo) {
            const end = new Date(dateTo)
            end.setHours(23, 59, 59, 999)
            if (d > end) return false
          }
        }
      }

      if (itemSearch.trim()) {
        const name = getItemName(tx).toLowerCase()
        if (!name.includes(itemSearch.toLowerCase())) return false
      }

      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, selectedTypes, dateFrom, dateTo, itemSearch, matMap, prodMap])

  function toggleType(type: TransactionType) {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  function handleExport() {
    const rows = filtered.map(tx => ({
      Date: formatDate(tx.createdAt),
      Type: tx.transactionType,
      'Item Name': getItemName(tx),
      Quantity: tx.quantity,
      Reference: getReference(tx),
      Notes: tx.notes || '',
    }))
    exportToCSV(rows as unknown as Record<string, unknown>[], 'inventory-history')
  }

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="Stock movements and who changed what"
        icon="📜"
        actions={
          <button className="btn btn-outline-secondary btn-sm" onClick={handleExport}>
            Export CSV
          </button>
        }
      />

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link${tab === 'stock' ? ' active' : ''}`} onClick={() => setTab('stock')}>Stock</button>
        </li>
        <li className="nav-item">
          <button className={`nav-link${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')}>Audit</button>
        </li>
      </ul>

      {tab === 'audit' ? (
        <div className="card">
          <DataGrid
            items={auditLogs}
            tableClassName="table table-sm table-hover align-middle mb-0"
            empty={<p className="text-muted text-center py-4 mb-0">No audit events yet.</p>}
          >
            {pageItems => (
              <>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(log => (
                    <tr key={log.id}>
                      <td>{formatDate(log.createdAt)}</td>
                      <td>{log.actorName}</td>
                      <td><span className="badge bg-secondary">{log.action}</span></td>
                      <td className="small">{log.entityType}/{log.entityId.slice(0, 8)}</td>
                      <td className="small text-muted">{log.after ? JSON.stringify(log.after) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </DataGrid>
        </div>
      ) : (
      <>

      {/* Filters */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row g-2 align-items-end">
            <div className="col-auto">
              <label className="form-label small mb-1">Date From</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </div>
            <div className="col-auto">
              <label className="form-label small mb-1">Date To</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </div>
            <div className="col-auto">
              <label className="form-label small mb-1">Item Search</label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search item name..."
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2 d-flex flex-wrap gap-2">
            {ALL_TYPES.map(type => (
              <div className="form-check form-check-inline mb-0" key={type}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`type-${type}`}
                  checked={selectedTypes.has(type)}
                  onChange={() => toggleType(type)}
                />
                <label className="form-check-label small" htmlFor={`type-${type}`}>
                  {type}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <DataGrid
          items={filtered}
          resetKey={`${dateFrom}|${dateTo}|${itemSearch}|${Array.from(selectedTypes).sort().join(',')}`}
          tableClassName="table table-sm table-hover align-middle mb-0"
          empty={<p className="text-muted text-center py-4 mb-0">No transactions match the current filters.</p>}
        >
          {pageItems => (
            <>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Item Name</th>
                  <th>Qty</th>
                  <th>Reference</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(tx => {
                  const name = getItemName(tx)
                  const ref = getReference(tx)
                  const isPos = tx.quantity >= 0
                  return (
                    <tr key={tx.id}>
                      <td>{formatDate(tx.createdAt)}</td>
                      <td>
                        <span className={`badge bg-${TYPE_BADGE[tx.transactionType] ?? 'secondary'} text-${TYPE_BADGE[tx.transactionType] === 'light' ? 'dark' : 'white'}`}>
                          {tx.transactionType}
                        </span>
                      </td>
                      <td>{name}</td>
                      <td>
                        <span className={`fw-semibold ${isPos ? 'text-success' : 'text-danger'}`}>
                          {isPos ? `+${tx.quantity}` : `${tx.quantity}`} {tx.unit}
                        </span>
                      </td>
                      <td className="text-muted small">{ref}</td>
                      <td className="text-muted">{tx.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </>
          )}
        </DataGrid>
      </div>
      </>
      )}
    </div>
  )
}
