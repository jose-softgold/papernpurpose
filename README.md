# Paper&Purpose — Inventory & Customer Management

A web app for a small party-decoration / paper-craft business. Track stock with an append-only ledger, manage customers and orders, import spreadsheets, and use an optional Gemini-powered CRM assistant. Profit reports use historical cost and price snapshots.

## Tech Stack

- **Frontend:** React 18 + Vite + TypeScript
- **Styling:** Bootstrap 5 + custom theme (`src/styles/theme.css`)
- **Backend:** Firebase (Firestore, Authentication, Storage, Cloud Functions)
- **AI assistant:** Gemini (optional API key) via Cloud Function `chatAssistant`
- **Local development:** Firebase Emulator Suite

## Roles

| Role | Access |
|------|--------|
| `owner` | Full access + user management |
| `admin` | Same CRM access as owner; can manage users (cannot create owners unless already owner) |
| `worker` | Orders status, purchases, production, materials/suppliers |
| `viewer` | Read-only dashboards and lists |

Accounts are created under **Settings → Users**. The first login bootstraps an owner only when the `users` collection is empty.

After sign-in, the home route is the **AI assistant** (`/`). Use the sidebar **Workspace** links for CRM pages (workers land on orders instead of the dashboard).

## Features

- **AI assistant** — domain tools (`log_purchase`, `create_order`, etc.) with confirm-before-write
- **Import** — spreadsheet import for orders and related master data (owners/admins)
- **GST fields** — GSTIN and tax helpers on customers, suppliers, and orders
- **Inventory ledger** — append-only stock transactions (never edit qty in place)
- **Orders** — status pipeline with timeline, shipment details, and role-aware advancement
- **Reports & history** — profitability and audit-friendly history views

## Prerequisites

- Node.js 18+ (Functions target Node 20)
- Firebase CLI: `npm install -g firebase-tools`

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
npm install --prefix functions
npm run build:functions
```

### 2. Start Firebase Emulators

In one terminal (Auth, Firestore, Storage, Functions). Persist data across restarts with `--import` / `--export-on-exit`:

```bash
npm run emulators:persist
```

Or equivalently:

```bash
firebase emulators:start --project demo-project --import=./emulator-data --export-on-exit=./emulator-data
```

Optional AI key for the Functions emulator:

```bash
export LLM_API_KEY=your-gemini-key
export LLM_MODEL=gemini-3.6-flash
```

Emulator UI: http://localhost:4000  
Functions: http://localhost:5001

Copy `.env.example` to `.env.local` and set `VITE_USE_EMULATOR=true` for local runs.

### 3. Start Dev Server

```bash
npm run dev
```

App: http://localhost:5173

### 4. Create Owner Account (first run only)

With emulators running on a fresh database:

```bash
npm run seed
```

Then log in:

| Field    | Value                  |
|----------|------------------------|
| Email    | `admin@partycraft.com` |
| Password | `Admin@1234`           |
| Role     | Owner                  |

After the first run, always start emulators with `--import=./emulator-data` so accounts survive restarts.

### Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run emulators` | Emulators without persistence |
| `npm run emulators:persist` | Emulators with import/export |
| `npm run build:functions` | Compile Cloud Functions |
| `npm run rules:check` | Firestore rules unit checks |
| `npm run seed` | Seed owner + sample data (emulator) |

---

## Testing on Mobile / Other Devices

Same Wi-Fi as the machine running the app:

### 1. Find your LAN IP

```bash
ipconfig getifaddr en0   # macOS
hostname -I              # Linux
```

### 2. Set the emulator host in `.env.local`

```env
VITE_USE_EMULATOR=true
VITE_EMULATOR_HOST=192.168.0.110   # replace with your IP
```

If `VITE_EMULATOR_HOST` is empty, the app uses the page hostname (localhost or your LAN IP).

### 3. Start the dev server with host flag

```bash
npm run dev -- --host
```

Emulators bind to `0.0.0.0`, so they are reachable at your LAN IP. On mobile open `http://<your-ip>:5173`.

---

## AI assistant

The assistant is the default home page and also available from **Ask the AI** in the sidebar. It calls Cloud Function `chatAssistant`, which uses Gemini plus domain tools. Writes require explicit confirmation in the UI.

Set `LLM_API_KEY` (from [Google AI Studio](https://aistudio.google.com/)) on Functions. Without a key, the chat still responds with a setup hint. Optional: `LLM_MODEL` (default `gemini-3.6-flash`).

---

## Order Status Flow

```
DRAFT → QUOTED → CONFIRMED → IN PRODUCTION → READY → DISPATCHED → DELIVERED → COMPLETED
```

| Status        | Who can advance | Notes                                      |
|---------------|-----------------|--------------------------------------------|
| DRAFT         | Owner / Admin   | Initial state when order is created        |
| QUOTED        | Owner / Admin   | Price quote sent to customer               |
| CONFIRMED     | Owner / Admin   | Customer confirmed, work can begin         |
| IN PRODUCTION | Owner / Admin / Worker | Items being made                    |
| READY         | Owner / Admin / Worker | Production complete, ready to ship  |
| DISPATCHED    | Owner / Admin / Worker | Courier + shipment details          |
| DELIVERED     | Owner / Admin   | Customer received the order                |
| COMPLETED     | Owner / Admin   | Payment received, order closed             |
| CANCELLED     | Owner / Admin   | From any non-completed state               |

Status changes are timestamped on the **Order Timeline**. At DISPATCHED you can record logistics company, tracking ID, shipping cost, and photos.

---

## Production Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable: Firestore, Authentication (email/password), Cloud Storage, Cloud Functions
3. Copy config values into `.env.production` (see `.env.example`)
4. Set Functions secrets/env: `LLM_API_KEY` (and optional `LLM_MODEL`)
5. Deploy rules, indexes, and functions:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage,functions
   ```
6. Build and deploy the CRM to the `app` Hosting target (keeps the public site on `www` separate):
   ```bash
   npm run build
   firebase deploy --only hosting:app
   ```
   The public marketing site is a separate repo ([papernpurpose-site](https://github.com/jose-softgold/papernpurpose-site)) and deploys to Hosting target `www`.

---

## Project Structure

```
functions/                # Cloud Functions (chatAssistant + domain tools)
├── src/
│   ├── domain/tools.ts
│   ├── llm/gemini.ts
│   ├── actor.ts
│   ├── authz.ts
│   └── index.ts
src/
├── components/           # UI primitives (DataGrid, GstFields, routes guards, …)
├── firebase/             # App + emulator wiring
├── layouts/              # AppLayout, Sidebar, TopBar
├── pages/
│   ├── assistant/        # AI home
│   ├── import/           # Spreadsheet import
│   ├── customers/
│   ├── history/
│   ├── inventory/
│   ├── materials/
│   ├── orders/
│   ├── products/
│   ├── production/
│   ├── purchases/
│   ├── reports/
│   ├── settings/         # UserManager
│   ├── Dashboard.tsx
│   └── Login.tsx
├── services/             # Firestore layer (+ audit, users)
├── styles/theme.css
├── types/
└── utils/                # roles, tax, importParse, export, …
scripts/
├── seed.ts
└── rules-check.mjs
```

---

## Key Business Rules

- **Inventory ledger:** Stock changes only via transactions (`PRODUCTION`, `PURCHASE`, `ORDER`, `TRANSFER`). Never edit quantities directly.
- **Historical snapshots:** Production costs and selling prices are frozen at event time for accurate profit.
- **Order cancellation:** Set `status = CANCELLED` instead of deleting; keep the audit trail.
- **Product versions:** Immutable once used in production or orders; create a new version for changes.
- **Profit:** `(Selling Price × Qty) − (Cost Price × Qty)` using snapshot prices.
- **Status timestamps:** Every transition is stored in `statusHistory` on the order timeline.
