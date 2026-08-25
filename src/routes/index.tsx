import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'
import OwnerRoute, { OpsRoute, ReadRoute, SettingsRoute } from '../components/OwnerRoute'
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
import AssistantPage from '../pages/assistant/AssistantPage'
import ImportPage from '../pages/import/ImportPage'
import MaterialDetail from '../pages/materials/MaterialDetail'
import BankPage from '../pages/bank/BankPage'
import ExpensePage from '../pages/expenses/ExpensePage'

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={
            <SettingsRoute>
              <AssistantPage />
            </SettingsRoute>
          }
        />
        <Route
          path="dashboard"
          element={
            <ReadRoute>
              <Dashboard />
            </ReadRoute>
          }
        />
        <Route path="assistant" element={<Navigate to="/" replace />} />
        <Route
          path="customers"
          element={
            <ReadRoute>
              <CustomerList />
            </ReadRoute>
          }
        />
        <Route
          path="customers/:id"
          element={
            <ReadRoute>
              <CustomerDetail />
            </ReadRoute>
          }
        />
        <Route
          path="suppliers"
          element={
            <ReadRoute allowWorker>
              <SupplierList />
            </ReadRoute>
          }
        />
        <Route
          path="suppliers/:id"
          element={
            <ReadRoute allowWorker>
              <SupplierDetail />
            </ReadRoute>
          }
        />
        <Route
          path="products"
          element={
            <ReadRoute>
              <ProductList />
            </ReadRoute>
          }
        />
        <Route
          path="products/:id"
          element={
            <ReadRoute>
              <ProductDetail />
            </ReadRoute>
          }
        />
        <Route
          path="materials"
          element={
            <ReadRoute allowWorker>
              <MaterialList />
            </ReadRoute>
          }
        />
        <Route
          path="materials/:id"
          element={
            <ReadRoute allowWorker>
              <MaterialDetail />
            </ReadRoute>
          }
        />
        <Route
          path="import"
          element={
            <OwnerRoute>
              <ImportPage />
            </OwnerRoute>
          }
        />
        <Route path="orders/import" element={<Navigate to="/import?type=orders" replace />} />
        <Route
          path="purchases"
          element={
            <OpsRoute>
              <PurchasePage />
            </OpsRoute>
          }
        />
        <Route
          path="production"
          element={
            <OpsRoute>
              <ProductionPage />
            </OpsRoute>
          }
        />
        <Route
          path="inventory"
          element={
            <ReadRoute>
              <InventoryPage />
            </ReadRoute>
          }
        />
        <Route path="orders" element={<OrderList />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route
          path="history"
          element={
            <ReadRoute>
              <HistoryPage />
            </ReadRoute>
          }
        />
        <Route
          path="reports"
          element={
            <ReadRoute>
              <ReportsPage />
            </ReadRoute>
          }
        />
        <Route
          path="bank"
          element={
            <OwnerRoute>
              <BankPage />
            </OwnerRoute>
          }
        />
        <Route
          path="expenses"
          element={
            <OwnerRoute>
              <ExpensePage />
            </OwnerRoute>
          }
        />
        <Route
          path="settings"
          element={
            <SettingsRoute>
              <SettingsPage />
            </SettingsRoute>
          }
        />
      </Route>
    </Routes>
  )
}
