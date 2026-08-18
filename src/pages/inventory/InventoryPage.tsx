import { useState, useEffect } from 'react'
import { Material, Product, ProductVersion, InventoryTransaction } from '../../types'
import { inventoryService } from '../../services/inventory'
import { materialService } from '../../services/materials'
import { productService } from '../../services/products'
import { formatCurrency, formatDate } from '../../utils/format'
import LoadingSpinner from '../../components/LoadingSpinner'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'

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

interface HistoryModalProps {
  title: string
  transactions: InventoryTransaction[]
  onClose: () => void
}

function HistoryModal({ title, transactions, onClose }: HistoryModalProps) {
  return (
    <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Transaction History — {title}</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body p-0">
            <DataGrid
              items={transactions}
              tableClassName="table table-sm table-hover mb-0"
              empty={<p className="text-muted p-4 text-center mb-0">No transactions found.</p>}
            >
              {pageItems => (
                <>
                  <thead className="table-light">
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(tx => (
                      <tr key={tx.id}>
                        <td>{formatDate(tx.createdAt)}</td>
                        <td>
                          <span className={`badge bg-${TYPE_BADGE[tx.transactionType] ?? 'secondary'} text-${TYPE_BADGE[tx.transactionType] === 'light' ? 'dark' : 'white'}`}>
                            {tx.transactionType}
                          </span>
                        </td>
                        <td>{tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity} {tx.unit}</td>
                        <td>{tx.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </DataGrid>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<'materials' | 'products'>('materials')
  const [loading, setLoading] = useState(true)

  const [materials, setMaterials] = useState<Material[]>([])
  const [materialStocks, setMaterialStocks] = useState<Record<string, number>>({})

  const [products, setProducts] = useState<Product[]>([])
  const [productVersions, setProductVersions] = useState<ProductVersion[]>([])
  const [productStocks, setProductStocks] = useState<Record<string, number>>({})

  const [selectedItem, setSelectedItem] = useState<{ title: string; transactions: InventoryTransaction[] } | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      materialService.getAll(),
      inventoryService.getMaterialStocks(),
      productService.getAll(),
      productService.getAllVersions(),
      inventoryService.getProductStocks(),
    ]).then(([mats, mStocks, prods, versions, pStocks]) => {
      setMaterials(mats)
      setMaterialStocks(mStocks)
      setProducts(prods)
      setProductVersions(versions)
      setProductStocks(pStocks)
    }).finally(() => setLoading(false))
  }, [])

  async function openMaterialHistory(mat: Material) {
    setHistoryLoading(true)
    const txs = await inventoryService.getTransactions({ itemType: 'material', itemId: mat.id })
    setSelectedItem({ title: mat.name, transactions: txs })
    setHistoryLoading(false)
  }

  async function openProductHistory(prod: Product) {
    setHistoryLoading(true)
    const txs = await inventoryService.getTransactions({ itemType: 'product', itemId: prod.id })
    setSelectedItem({ title: prod.name, transactions: txs })
    setHistoryLoading(false)
  }

  function getActiveVersion(productId: string): ProductVersion | undefined {
    const versions = productVersions.filter(v => v.productId === productId && v.status === 'active')
    return versions.at(0)
  }

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Click any row to see its transaction history"
        icon="🗄️"
      />

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'materials' ? 'active' : ''}`}
            onClick={() => setActiveTab('materials')}
          >
            Raw Materials
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            Finished Products
          </button>
        </li>
      </ul>

      {activeTab === 'materials' && (
        <div className="card">
          <DataGrid
            items={materials}
            empty={<p className="text-muted text-center py-4 mb-0">No materials found.</p>}
          >
            {pageItems => (
              <>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Current Stock</th>
                    <th>Unit</th>
                    <th>Min Stock</th>
                    <th>Stock Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(mat => {
                    const stock = materialStocks[mat.id] ?? 0
                    const isLow = stock < mat.minimumStock
                    return (
                      <tr
                        key={mat.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => openMaterialHistory(mat)}
                      >
                        <td>{mat.name}</td>
                        <td>{stock}</td>
                        <td>{mat.unit}</td>
                        <td>{mat.minimumStock}</td>
                        <td>{formatCurrency(stock * mat.costPerUnit)}</td>
                        <td>
                          <span className={`badge bg-${isLow ? 'warning' : 'success'}`}>
                            {isLow ? 'LOW STOCK' : 'OK'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </>
            )}
          </DataGrid>
        </div>
      )}

      {activeTab === 'products' && (
        <div className="card">
          <DataGrid
            items={products}
            empty={<p className="text-muted text-center py-4 mb-0">No products found.</p>}
          >
            {pageItems => (
              <>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Current Version</th>
                    <th>Current Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(prod => {
                    const version = getActiveVersion(prod.id)
                    const stock = productStocks[prod.id] ?? 0
                    return (
                      <tr
                        key={prod.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => openProductHistory(prod)}
                      >
                        <td>{prod.name}</td>
                        <td>{version?.version ?? '—'}</td>
                        <td>{stock}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </>
            )}
          </DataGrid>
        </div>
      )}

      {historyLoading && (
        <div className="position-fixed top-50 start-50 translate-middle">
          <LoadingSpinner />
        </div>
      )}

      {selectedItem && !historyLoading && (
        <HistoryModal
          title={selectedItem.title}
          transactions={selectedItem.transactions}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  )
}
