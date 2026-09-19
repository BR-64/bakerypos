# Bakery POS — agent instructions

Offline-first point-of-sale web app (PWA) for a single bakery kiosk, used on a phone by one
member of staff. Cash and PromptPay QR only. See `docs/SPEC.md` for the product spec and
`docs/PLAN.md` for the ordered task list.

## Commands

```
npm run dev        # Vite dev server
npm test           # Vitest, run once (must pass before any task is "done")
npm run test:watch
npm run typecheck  # tsc -b
npm run lint       # oxlint
npm run format     # prettier (also runs automatically via hook on every edit)
npm run build      # typecheck + production build (generates the service worker)
```

## Architecture in five sentences

React 19 + TypeScript + Vite, installed as a PWA on the phone. All data lives on the device in
IndexedDB via Dexie (`src/db/db.ts`); there is no server on the checkout path. Pure business
rules (money, cart, reports) live in `src/domain/` with no React or Dexie imports, so they are
trivially unit-tested. Data access lives in `src/db/`, UI in `src/components/` (reusable) and
`src/screens/` (one per screen). A backend for sync/reports is a later task and must never be
required for a sale to complete.

## Non-negotiable rules

- **Money is integer satang** (`Satang` type). Never `number` baht with decimals, never
  floating-point arithmetic on money. Use `src/domain/money.ts` helpers.
- **Snapshot prices on order lines.** `OrderLine.unitPrice` and `name` are copied from the
  product at time of sale. Changing a product must never change historical orders.
- **Never hard-delete orders or products.** Orders are voided (`status: 'voided'`), products are
  archived (`archived: true`).
- **No network call on the checkout path.** Grid → cart → pay → done must work in airplane mode.
- **Dexie schema changes** add a new `.version(n)` block; never edit an existing version.
- **Touch targets ≥ 48px**; the checkout flow is at most two taps from cart to "paid".
- Do not add dependencies without saying why in the PR description.
- Do not edit `package-lock.json` by hand, `.env*`, or anything under `dev-dist/`.
- Search and read only inside this repo; never run find or grep on / or the home folder.
- **The Sell screen must never crash.** Invalid product or order data is skipped and logged, never thrown.
- **The never-crash rule applies to data read from Dexie (products, orders, settings). In-memory state created by our own code is trusted.**

## Conventions

- Tests sit next to the code: `foo.ts` → `foo.test.ts`. Domain and db code must have tests;
  screens get a Testing Library test for their main interaction.
- Dexie tests get a fresh `new PosDatabase('test-' + Math.random())`; fake-indexeddb is preloaded
  by `src/test/setup.ts`.
- Booleans are not indexable in IndexedDB — filter `archived` / `outOfStock` in JS.
- Named exports, function components, no default exports except `App`.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). One task per branch/PR.

## Definition of done for any task

1. Acceptance criterion from `docs/PLAN.md` demonstrably met.
2. `npm test`, `npm run typecheck`, `npm run lint` all pass.
3. New behaviour has a test. No assertion was weakened to make a test pass.
4. PR description says what changed, why, and how to verify it on a phone.
