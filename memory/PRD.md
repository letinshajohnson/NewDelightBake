# POSHub — PRD

## Original problem statement (customer's words, summarised where long)
Offline-first multi-tenant SaaS POS for retail & restaurants: offline selling with queued sync, identical totals on device and server, stock guard, shifts, discounts (cashier/product/subtotal), promotions (vouchers, bundles), loyalty, merchant web panel.
Expanded for "New Delight Food Products": Catalog, Purchasing, Sales, CRM, Finance, Payables & receivables, Stock manager, Reports, Settings, Users.
Latest: "Raw materials (BOM), production data (yield, material usage), other expenses (salaries, extra costs), gift packing, export/import of all data (consider the uploaded purchase bill), suppliers/agents with GST number. Give me final project with credentials for each user."

## User choices (2026-11-05)
- Purchase bills: BOTH photo (AI reads) and spreadsheet template
- Export/import: products & raw materials, customers, suppliers & agents, purchases, sales (export), expenses
- Formats: Excel (.xlsx) AND CSV
- Production batch deducts raw materials and adds finished goods
- Gift packs: selling a pack reduces stock of each item inside it

## Architecture
FastAPI (server.py, core.py, sales.py, pricing.py, reports.py, backoffice.py, production.py) + MongoDB; React + Tailwind + shadcn; SheetJS (xlsx) for Excel; Gemini 3.1 Pro (Emergent LLM key) for bill photo reading.

## Implemented
- 2026-11 (earlier): POS (offline queue, PIN, restaurant/KDS), backoffice sections, roles, reports.
- 2026-11-05:
  - POST /api/purchase-bills/scan — AI reads GST bill photo → editable form → saves received purchase (Purchasing → Bill from photo, Import/export → Scan purchase bill)
  - Import (xlsx/csv) for purchase bills, products (raw_material, unit), customers, suppliers, expenses; row validation with row-numbered errors; export in Excel or CSV
  - Gift packs: kit sale deducts component stock (void/return restore), stock check explodes kits
  - Raw material switch on products; production runs exclude kits; outlet validation
  - Finance → Other expenses with free-text categories (Staff salary, Rent, Miscellaneous purchase suggestions)
  - Suppliers & agents with type + optional GSTIN

## Backlog
- P1: Delete/undo for imported expenses, purchases and production runs
- P2: Shadcn date picker in expenses/production; date-only display for back-office expenses
- P2: Products created from bills with no MRP get price = rate + GST; review prices after import
