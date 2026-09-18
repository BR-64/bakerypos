# Build plan — ordered tasks for the implementer agent

Each task is one branch, one PR, one agent session. Do them in order; each has a single
acceptance criterion the reviewer/tester agents check against. Tick the box when merged.

Files already in place from the scaffold: `src/domain/{types,money}.ts` (+tests),
`src/db/{db,seed,orders}.ts` (+tests), PWA config, placeholder `App.tsx`.

- [x] **1. Cart state + hook.** `src/domain/cart.ts` pure functions (`addProduct`, `increment`,
      `decrement`, `remove`, `clear`) operating on `CartLine[]`, snapshotting name/price from the
      `Product`; `src/hooks/useCart.ts` wrapping them in React state.
      _Accept:_ unit tests cover every function incl. decrement-to-zero removes the line; qty
      never goes negative.

- [x] **2. Sell screen.** `src/db/products.ts` `sellableProducts(database = db)` (reads with
      `toArray()` and sorts by `sortOrder` in JS — an indexed `orderBy` would silently drop a
      record with a missing/non-numeric `sortOrder`; archived filtered with a strict `=== true`
      check, out-of-stock kept); `src/domain/cart.ts` `partitionSellable(products)` splitting a
      list into `sellable`/`invalid` via `isSellable` (checks id, name, price, sortOrder, and
      strict boolean `archived`/`outOfStock`); `src/domain/categories.ts` (`CATEGORY_ORDER`,
      `categoryLabel`, `visibleCategories`, `productsInCategory`, "All" tab). Components
      `ProductTile` (disabled + "Sold out" when out of stock — invalid products are never passed
      to it in the first place), `CategoryTabs`, `CartBar` (count + `formatBaht(total)`, sticky,
      full-bleed, `onOpen`), `ErrorBoundary` (class component; fallback offers "Try again", which
      remounts the failed subtree via a `key`, and "Reload" as a fallback to reloading the page).
      `src/screens/SellScreen.tsx` uses `useLiveQuery` with an injectable `database` prop and a
      `cart: Pick<Cart, 'add' | 'count' | 'total'>` prop; the cart bar is a sibling of the
      query-consuming grid, not a child of it, so it stays visible through the loading state, the
      empty-menu state, and a rejected product query. `App.tsx` calls `useCart()` once and passes
      it down. `useCart.add` never throws (try/catch inside the updater, now a last-resort guard
      since `addProduct` itself no longer throws for bad data). Tiles ≥ 88px, all other touch
      targets ≥ 48px. Invalid product data is skipped and logged once per id, never shown and
      never thrown. No new dependencies, no schema change, no network.
      _Accept:_ Testing Library test on a fresh `PosDatabase` — tapping an in-stock tile updates
      the bottom bar total (฿0 → ฿55 → ฿110); an out-of-stock tile is disabled and does not
      change it; archived products are not rendered; a category tab filters the grid; products
      with an invalid price/name/category/sortOrder/archived/outOfStock are skipped (never
      rendered) and logged once, while good products still work; `fetch` is never called; when
      the product query rejects the cart bar stays visible with its total and "Try again"
      recovers once the query succeeds.

- [ ] **3. Cart screen.** `src/screens/CartScreen.tsx` with lines, steppers, clear-with-confirm,
      Cash and PromptPay buttons. Simple screen state in `App.tsx` (no router needed yet).
      _Accept:_ test — stepping a line to 0 removes it; total updates.

- [ ] **4. Cash checkout.** `src/screens/CashScreen.tsx`: quick-tender buttons from
      `quickTenderOptions`, keypad, change due, Done calls `completeOrder`. Returns to Sell with
      an empty cart and a brief "Order #N — change ฿X" toast.
      _Accept:_ test — Done with tendered < total is disabled; a completed order appears in Dexie
      with the correct `change`.

- [ ] **5. PromptPay checkout.** `src/screens/PromptPayScreen.tsx`: QR from `promptpay-qr` with
      the shop's PromptPay ID (from settings, task 7 — for now a constant in
      `src/config.ts`) and the exact amount; "Paid — done" calls `completeOrder`.
      _Accept:_ test — the generated payload contains the amount in baht with two decimals; order
      stored with `method: 'promptpay'`.

- [ ] **6. Orders + void.** `src/screens/OrdersScreen.tsx` (today's orders) and detail with
      Void (reason + confirm) via `voidOrder`. Bottom nav: Sell / Orders / Report / Admin.
      _Accept:_ test — voided order shows a "voided" badge and stays in the list.

- [ ] **7. Z report + settings.** `src/domain/report.ts` pure `buildZReport(orders, day)`;
      `src/screens/ReportScreen.tsx` with day picker and share/copy as text. `settings` table in
      Dexie (schema version 2) with shop name and PromptPay ID; Admin screen for products +
      settings.
      _Accept:_ unit tests for `buildZReport` incl. voids excluded from totals but counted; day
      boundaries use local time.

- [ ] **8. PWA polish + device QA.** Offline indicator, install prompt hint, icon set (192/512
      PNG), Lighthouse PWA pass, manual test in airplane mode on a real phone. Write
      `docs/DEVICE-QA.md` checklist.
      _Accept:_ `npm run build && npm run preview` installs on a phone and completes a cash sale
      offline.

- [ ] **9. (Later) Backend sync.** Minimal Node/Hono API with SQLite, `POST /orders` upsert by
      id, `useSync` pushes `pending` orders when online and marks them `synced`. Owner dashboard
      page. Only start after 1–8 are boring and reliable.

## How to run a task with the agents

```
claude
> use the planner agent to check task 2 in docs/PLAN.md against the current code and refine it
> use the implementer agent to do task 2
> use the reviewer agent on the diff
> use the tester agent on the diff
```

Read the plan the planner proposes and edit it before implementing — that is where a human
adds the most value. Merge only after review and tests pass.
