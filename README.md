# Party Craft — Inventory & Customer Management

A web application for managing a small party-decoration and paper-craft business. Track inventory using an append-only transaction ledger, manage customers and orders, and generate profitability reports with historical cost and price snapshots.

## Tech Stack

- **Frontend:** React 18 + Vite + TypeScript
- **Styling:** Bootstrap 5
- **Backend:** Firebase (Firestore, Authentication, Storage)
- **Local Development:** Firebase Emulator Suite

## Prerequisites

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Firebase Emulators

In one terminal, start the Firebase Emulator Suite. Use `--import` and `--export-on-exit` to persist data (accounts, Firestore docs) across restarts:

```bash
firebase emulators:start --project demo-project --import=./emulator-data --export-on-exit=./emulator-data
```

The Emulator UI will be available at: http://localhost:4000

> **First run:** The `emulator-data/` directory won't exist yet — that's fine. The flag is ignored on first run and the directory is created on exit.

### 3. Start Dev Server

In a separate terminal:

```bash
npm run dev
```

The app will be available at: http://localhost:5173

### 4. Create Owner Account (first run only)

On a fresh emulator the database is empty. Run this script to create the owner account and seed sample data:

```bash
npm run seed
```

Then log in with:

| Field    | Value                     |
|----------|---------------------------|
| Email    | `admin@partycraft.com`    |
| Password | `Admin@1234`              |
| Role     | Owner                     |

> After first run, always start emulators with `--import=./emulator-data` so accounts survive restarts.

---

## Testing on Mobile / Other Devices

To access the app from a phone or another device on the same Wi-Fi:

### 1. Find your machine's LAN IP

```bash
ipconfig getifaddr en0
# e.g. 192.168.0.110
```

### 2. Set the emulator host in `.env.local`

```env
VITE_USE_EMULATOR=true
VITE_EMULATOR_HOST=192.168.0.110   # replace with your IP
```

### 3. Start the dev server with host flag

```bash
npm run dev -- --host
```

The emulators already bind to `0.0.0.0` (all interfaces) so they're reachable at your LAN IP. On your mobile, open `http://192.168.0.110:5173`.

> Remove `VITE_EMULATOR_HOST` (or set it back to `localhost`) when testing on your own machine only.

---

## User Roles

The app has two roles: **Owner** and **Worker**.

### Owner
Full access to all pages and data including costs, pricing, and profit figures.

### Worker
Restricted access — sees no financial data. Can:
- View and advance orders: CONFIRMED → IN PRODUCTION → READY → DISPATCHED
- Fill in shipment details (logistics company, tracking ID, shipping cost, photos)
- Record material purchases (quantities only, no costs shown)
- Log production runs
- Add materials and suppliers

Workers are created by the owner via **Settings → Worker Accounts**.

---

## Order Status Flow

Orders move through the following stages:

```
DRAFT → QUOTED → CONFIRMED → IN PRODUCTION → READY → DISPATCHED → DELIVERED → COMPLETED
```

| Status        | Who can advance | Notes                                      |
|---------------|-----------------|--------------------------------------------|
| DRAFT         | Owner           | Initial state when order is created        |
| QUOTED        | Owner           | Price quote sent to customer               |
| CONFIRMED     | Owner           | Customer confirmed, work can begin         |
| IN PRODUCTION | Owner / Worker  | Items being made                           |
| READY         | Owner / Worker  | Production complete, ready to ship         |
| DISPATCHED    | Owner / Worker  | Handed to courier — shipment details added |
| DELIVERED     | Owner           | Customer received the order                |
| COMPLETED     | Owner           | Payment received, order closed             |
| CANCELLED     | Owner           | Can be set from any non-completed state    |

Each status change is timestamped and shown on the **Order Timeline** in the order detail page, along with the event date as a deadline marker.

### Shipment Details

When an order reaches DISPATCHED, a Shipment Details card appears where you can record:
- Logistics company
- Tracking ID
- Shipping cost
- Photos (receipts, proof of dispatch)

Workers can fill in all shipment fields including cost.

---

## Seed Sample Data

With emulators running, populate the database with sample data:

```bash
npm run seed
```

This creates customers, products, materials, and associated transactions for testing.

---

## Production Firebase Setup

To deploy to production Firebase:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable: Firestore Database, Authentication (email/password), Cloud Storage
3. Copy your Firebase config values to `.env.production`
4. Deploy Firestore and Storage rules:
   ```bash
   firebase deploy --only firestore:rules,storage
   ```
5. Build and deploy the app:
   ```bash
   npm run build
   ```

---

## Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── ConfirmModal.tsx
│   ├── EmptyState.tsx
│   ├── LoadingSpinner.tsx
│   ├── ProtectedRoute.tsx
│   └── ToastContainer.tsx
├── firebase/             # Firebase configuration and initialization
├── hooks/                # Custom React hooks
├── layouts/              # Page layout wrappers
├── pages/                # Feature pages
│   ├── customers/
│   ├── history/
│   ├── inventory/
│   ├── materials/
│   ├── orders/
│   ├── products/
│   ├── production/
│   ├── purchases/
│   ├── reports/
│   ├── settings/
│   ├── Dashboard.tsx
│   └── Login.tsx
├── routes/               # Route configuration
├── services/             # Firestore service layer
│   ├── bom.ts           # Bill of Materials
│   ├── customers.ts
│   ├── inventory.ts
│   ├── materials.ts
│   ├── orders.ts
│   ├── production.ts
│   ├── products.ts
│   ├── purchases.ts
│   ├── reports.ts
│   └── suppliers.ts
├── types/                # TypeScript type definitions
├── utils/                # Utility functions and helpers
├── App.tsx
└── main.tsx
```

---

## Key Business Rules

- **Inventory Ledger:** Stock is tracked via an append-only transaction ledger. Never directly edit stock quantities — all changes must be recorded as transactions (PRODUCTION, PURCHASE, ORDER, TRANSFORMATION).
- **Historical Snapshots:** Production costs and selling prices are frozen at the time of the event. Historical records remain immutable for accurate profit calculations.
- **Order Cancellation:** Orders are cancelled (`status = CANCELLED`) rather than deleted, preserving the full transaction history for audit trails.
- **Product Versions:** Product versions are immutable once used in production or orders. Create a new version if specifications need to change.
- **Profit Calculation:** Profit = (Selling Price × Quantity Sold) − (Cost Price × Quantity Sold), using historical prices captured at transaction time.
- **Status Timestamps:** Every order status transition is recorded with a server timestamp in `statusHistory`, shown on the order timeline.
