import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import OwnerRoute from '../components/OwnerRoute'
import AppLayout from '../layouts/AppLayout'
import Login from '../pages/Login'
import Dashboard from '../pages/Dashboard'
import CustomerList from '../pages/customers/CustomerList'
import CustomerDetail from '../pages/customers/CustomerDetail'
import ProductList from '../pages/products/ProductList'
import ProductDetail from '../pages/products/ProductDetail'
import SupplierList from '../pages/suppliers/SupplierList'
import SupplierDetail from '../pages/suppliers/SupplierDetail'
import MaterialList from '../pages/materials/MaterialList'
import PurchasePage from '../pages/purchases/PurchasePage'
import ProductionPage from '../pages/production/ProductionPage'
import InventoryPage from '../pages/inventory/InventoryPage'
import OrderList from '../pages/orders/OrderList'
import OrderDetail from '../pages/orders/OrderDetail'
import HistoryPage from '../pages/history/HistoryPage'
import ReportsPage from '../pages/reports/ReportsPage'
import SettingsPage from '../pages/settings/SettingsPage'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<OwnerRoute><Dashboard /></OwnerRoute>} />
        <Route path="customers" element={<OwnerRoute><CustomerList /></OwnerRoute>} />
        <Route path="customers/:id" element={<OwnerRoute><CustomerDetail /></OwnerRoute>} />
        <Route path="suppliers" element={<SupplierList />} />
        <Route path="suppliers/:id" element={<OwnerRoute><SupplierDetail /></OwnerRoute>} />
        <Route path="products" element={<OwnerRoute><ProductList /></OwnerRoute>} />
        <Route path="products/:id" element={<OwnerRoute><ProductDetail /></OwnerRoute>} />
        <Route path="materials" element={<MaterialList />} />
        <Route path="purchases" element={<PurchasePage />} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="inventory" element={<OwnerRoute><InventoryPage /></OwnerRoute>} />
        <Route path="orders" element={<OrderList />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="history" element={<OwnerRoute><HistoryPage /></OwnerRoute>} />
        <Route path="reports" element={<OwnerRoute><ReportsPage /></OwnerRoute>} />
        <Route path="settings" element={<OwnerRoute><SettingsPage /></OwnerRoute>} />
      </Route>
    </Routes>
  )
}
