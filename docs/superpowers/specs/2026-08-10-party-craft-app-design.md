# Party Craft Inventory & Customer Management App — Design Spec

**Date:** 2026-08-10  
**Project:** party-craft-app  
**Status:** Approved

---

## 1. Overview

A production-quality web application for managing a small party-decoration and paper-craft business. Simple, practical — not an ERP.

**Business entities:** Customers, Products (with versioning), Materials, BOM, Production, Inventory, Orders, Sales, Reports.

---

## 2. Technology Stack

| Layer | Choice |
|-------|--------|
| UI framework | React 18 + Vite + TypeScript |
| Styling | Bootstrap 5 |
| Routing | React Router v6 |
| Backend/DB | Firebase (Firestore, Auth, Storage) |
| Local dev | Firebase Emulator Suite |
| Exports | CSV + Excel (xlsx library) |

No Node/Express backend. Firebase is the sole backend.

---

## 3. Firebase Collections

```
customers
products
productVersions
materials
bomItems
orders
orderItems
productions
productionMaterials
inventoryTransactions
suppliers
purchases
purchaseItems
```

---

## 4. Core Invariants (Data Integrity)

1. **Never delete historical orders** — use `status = CANCELLED`.
2. **Never modify historical selling prices** — stored on orderItem at time of sale.
3. **Never modify historical production costs** — stored on production at time of completion.
4. **Never overwrite inventory history** — always create new transaction.
5. **Product names can change** — historical records reference productId, not name.
6. **Product versions are immutable** once used in production/orders.
7. **Inventory = sum of transactions** — no "currentStock" field edited directly.

---

## 5. Inventory Ledger

`inventoryTransactions` tracks all stock movements:

```
PURCHASE | PRODUCTION | CONSUMPTION | SALE | WASTE | RETURN | ADJUSTMENT | TRANSFORMATION
```

Current stock is always computed: `sum(quantity) where itemId = X`.

---

## 6. Profit Calculation

```
Revenue = quantity × actual selling price (stored on orderItem)
Cost    = quantity × historical production cost (stored on orderItem.costPerUnit)
Profit  = Revenue - Cost
Margin  = Profit / Revenue × 100
```

---

## 7. Application Layout

Left sidebar navigation:

```
Dashboard
Customers
Products
  └─ Product List
  └─ Product Details
Materials
Production
Inventory
Orders
History
Reports
Settings
```

---

## 8. Authentication

Firebase Auth — email/password. Protected routes. No complex roles.

---

## 9. Local Development

- Firebase Emulator Suite: Firestore, Auth, Storage
- Environment variable `VITE_USE_EMULATOR=true` switches to emulators
- Seed script populates realistic sample data (Priya, Anil, Smith; Large Paper Rose V1/V2/V3; etc.)

---

## 10. Seed Data

- 3 customers: Priya, Anil, Smith
- 3 products: Large Paper Rose, Birthday Banner, Paper Butterfly
- Versions: Large Paper Rose V1/V2/V3
- Materials: Pink Paper, Green Paper, White Paper, Gold Ribbon, Glue, Wooden Stick
- BOM for Large Paper Rose V3
- Purchase records, production records, orders at different prices

---

## 11. Export

CSV and Excel export on:
- Customers, Products, Materials, Inventory, Orders
- Sales Report, Profitability Report

No Google Sheets dependency. Firebase is source of truth.

---

## 12. Project Structure

```
src/
  components/       # Reusable UI components
  pages/            # Route-level page components
  layouts/          # App shell, sidebar
  services/
    firebase/       # Firebase init, config
    customers/
    products/
    inventory/
    orders/
    production/
    reports/
  hooks/            # Custom React hooks
  utils/            # Formatters, calculators
  types/            # TypeScript interfaces
  routes/           # Route definitions
```

---

## 13. Firestore Security Rules

- Authenticated users: read/write all business collections.
- Unauthenticated: no access.
- Storage: authenticated read/write.
