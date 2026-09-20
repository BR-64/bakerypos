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

- [x] **3. Cart screen.** `src/domain/cart.ts` `isValidCartLine(line)` (non-null object,
      non-empty `productId` and trimmed `name`, `unitPrice` a non-negative safe integer, `qty` a
      safe integer ≥ 1 — `Number.isSafeInteger`, not just `Number.isInteger`, so e.g.
      `qty: 1e300` is rejected — and `unitPrice * qty` also a safe integer) and
      `partitionCartLines(lines)`, which also treats a _repeated_ `productId` as invalid, keeping
      only the first occurrence in `valid` (lines are keyed by `productId` everywhere
      downstream — React's list key and every action's lookup — so a duplicate would collide or
      get double-mutated). `useCart(initialLines = [])` exposes only valid, de-duplicated `lines`
      (same reference when none are invalid) and computes `count` from them; every action
      (`add`/`increment`/`decrement`/`remove`) runs on that same cleaned subset, never on the raw
      state, so a hidden invalid raw line (e.g. a stray `qty: 0` duplicate) can never be silently
      resurrected or cross-mutated by `+`/`-`. `partitionCartLines` also keeps a running total as
      it builds `valid`; a line that would push that running total past `Number.MAX_SAFE_INTEGER`
      is itself treated as invalid and skipped (same "first occurrence(s) win" rule as duplicates)
      instead of being counted — so `total` (plain `cartTotal(lines)`) is always the exact sum of
      the visible lines, never a fallback or an approximation of money. `increment` is a no-op
      (same reference) if bumping a line would make its own `unitPrice * qty` unsafe or would push
      the cart total past `Number.MAX_SAFE_INTEGER`, so "+" can never be what makes a line or the
      cart invalid. Each invalid or duplicate or overflow-causing line is logged once per productId
      via `src/hooks/useLogInvalidOnce.ts` (extracted from `SellScreen`);
      `lineTotal`/`cartTotal` stay unguarded — callers pass validated lines. `src/navigation.ts`:
      `SCREENS`, `Screen` union (sell/cart/cash/promptpay/orders/report/admin), `SCREEN_TITLES`,
      `HOME_SCREEN`, `ScreenProps { cart, navigate, database }`. `App.tsx` (optional `database`
      prop) keeps `useState<Screen>(HOME_SCREEN)` and a non-exported `screens: Record<Screen,
    (props: ScreenProps) => ReactNode>` registry, rendered as `<Entry {...props} />` (a real
      component, never called as a plain function during App's render); `navigate` is `setScreen`
      directly, so it's stable across renders. Each screen sits in an `ErrorBoundary` keyed by
      screen + retry count, with a new optional "Back to Sell" (`onBack`) between "Try again" and
      "Reload" (omitted on the home screen itself), since Reload loses the in-memory cart.
      `PlaceholderScreen` (title, "Coming soon", "Back to Sell") fills cash/promptpay/orders/
      report/admin; for most of them, a later task swapping in the real screen is just one
      registry line plus an import, but not always — task 4 also needs an order-confirmation
      toast and task 6 a bottom nav and order-detail view, both App-level additions. Shared
      `.screen`/`.bottom-bar` CSS extracted from `.sell-screen`/`.cart-bar`. `src/screens/
    CartScreen.tsx` (no Dexie reads): "Back to Sell"; lines with snapshot name, muted unit
      price, −/qty/+ steppers ≥ 48px labelled "Remove one X"/"Add one X", line total via
      `lineTotal`; inline clear-confirm (a labelled prompt takes "Clear cart"'s place, showing
      "Remove all N item?"/"items?" singular/plural, with "Keep" — which takes focus and sits
      beside a danger-styled "Yes, clear", which clears and returns to Sell — where "Clear cart"
      was; Clear disabled when empty; `confirming` is reset during render — not in an
      effect — whenever the cart is empty, so it can never silently resurface if the cart is
      cleared and refilled from outside this screen while it's open); empty state "Cart is
      empty."; pinned bottom bar with the total and big Cash / PromptPay buttons that navigate in
      one tap, disabled when empty. `+` ignores current stock state (task 1 decision). Sell's
      `CartBar` gets `onOpenCart`; the Sell tab resets to All. No new dependencies, no schema
      change, no network.
      _Accept:_ Testing Library tests around the real `useCart` — stepping a line to 0 removes
      it and the total updates (฿110 → ฿55 → ฿0, empty state, Cash/PromptPay disabled); Clear
      needs the confirm and "Keep" leaves the cart untouched; Cash/PromptPay call `navigate` in
      one tap; corrupt, duplicate-productId, and total-overflowing lines are skipped, excluded
      from the total and logged once, and never crash `+`/`-` even for a `null`/circular/BigInt
      raw line; "+" is a no-op rather than ever making a line or the cart total unsafe; `fetch`
      is never called; an App test on
      a fresh `PosDatabase` goes Sell → Cart → Cash placeholder → Sell with the cart intact, and
      a forced error in the Cart screen shows Try again/Back to Sell/Reload, with the cart intact
      after either recovery path and no Back to Sell on Sell's own boundary.

- [x] **4. Cash checkout.** Builds on the shared checkout commit already on master — do not edit
      any of it: `ScreenProps.onOrderComplete` (App clears the cart, returns to Sell and shows
      "Order #N — change ฿X" via `OrderToast`), `useCompleteOrder` (the only way to store a sale:
      synchronous double-tap guard, `pending`/`error`, calls `onOrderComplete` exactly once),
      hardened `completeOrder` (rejects invalid lines and negative/fractional cash), and the
      `.checkout-total`/`.checkout-error` classes. `src/domain/tender.ts`: whole-baht keypad
      entry (`pressDigit`, `deleteDigit`, `entryToSatang`, max 6 digits, leading zeros dropped,
      no "." key — a satang total is paid with "Exact") and `cashPayment(total, tendered)`
      returning a `CashPayment` via `changeDue`, or `null` when tendered < total, so `changeDue`
      is never called with too little. `src/screens/CashScreen.tsx` (+ `CashScreen.css`, classes
      prefixed `cash-`): "Back to Cart"; big total (`.checkout-total`); keypad (keys ≥ 56px) with
      the entered amount and, once tendered ≥ total, the change due in very large type
      (otherwise "฿X short"). A bottom bar the same height and position as Sell's cart bar holds
      the `quickTenderOptions(total)` buttons ("Exact ฿X" first) while the keypad is empty — one
      tap completes the sale (Cart → Cash → note = two taps) — and **Done** (disabled until
      tendered ≥ total) once digits are entered. All buttons incl. Back are disabled while
      `pending`; on failure the cart is kept, `error` shows in a `role="alert"` and buttons
      re-enable; on success the screen does nothing itself. A ฿0 cart (free items) completes with
      "Exact ฿0". Empty cart: "Cart is empty." + Back, never calls `complete`. No
      `role="status"`/`<output>` in the screen (App's toast owns that role). No new dependencies,
      no schema change, no network.
      Files (only these): `src/domain/tender.ts`, `src/domain/tender.test.ts`,
      `src/screens/CashScreen.tsx`, `src/screens/CashScreen.test.tsx`,
      `src/screens/CashScreen.css`, `src/App.cash.test.tsx` (rewrite it around the real screen,
      dropping the "Simulate sale" placeholder mock), and in `src/App.tsx` only the `cash:`
      registry line (→ `cash: (props) => <CashScreen {...props} />,`) and one `CashScreen` import
      line inserted directly after the `CartScreen` import. Do not tick this box — 4 and 5 are
      ticked together at merge.
      _Accept:_ unit tests for `tender.ts`; Testing Library tests around the real `useCart` and a
      fresh `PosDatabase` — "Exact" stores `{method: 'cash', tendered: total, change: 0}` and
      calls `onOrderComplete` once; ฿500 stores the correct `change`; Done is disabled while
      tendered < total and nothing throws; the keypad path stores the correct change; under
      StrictMode a double tap creates exactly one order; a rejected save shows an error, keeps
      the cart and a retry creates one order; an empty cart never writes; `fetch` is never
      called; `App.cash.test.tsx` goes Sell → Cart → Cash → Exact → Sell with the toast and an
      empty cart. `npm test`, `npm run typecheck` and `npm run lint` pass.

- [x] **5. PromptPay checkout.** Builds on the same shared commit (do not edit any of it).
      `src/config.ts` `PROMPTPAY_ID` (digits only; the placeholder is the obviously fake
      `'0000000000'`; task 7 moves it to settings). `src/domain/promptpay.ts`:
      `isValidPromptPayId` (10-digit phone starting with 0, or 13 digits), `formatPromptPayAmount`
      (satang → "110.00" with integer maths), and `promptPayPayload(id, total)` calling
      `promptpay-qr` (default import; it type-checks as is) with `total / 100` and throwing
      unless the payload's field 54 equals the integer-built amount; it throws for total ≤ 0
      (the library would emit an amount-less static QR), non-safe-integers and amounts over 13
      characters. `src/screens/PromptPayScreen.tsx` (+ `PromptPayScreen.css`, classes prefixed
      `promptpay-`; optional `promptPayId` prop defaulting to `PROMPTPAY_ID`): "Cancel" back to
      Cart; big total (`.checkout-total`); `QRCodeSVG` (not Canvas — jsdom has no canvas) with a
      quiet zone, white background and a `title`; while the ID is still the placeholder, a
      visible "Test PromptPay ID — not a real account" warning above the QR; "Paid — done" in
      the bottom bar calls `useCompleteOrder`'s `complete({method: 'promptpay', confirmedAt:
    now})`; everything disabled while `pending`; failure keeps the cart and shows `error` in a
      `role="alert"`. States: ฿0 total → "Nothing to charge — use Cash", no QR, Paid disabled;
      invalid ID → "PromptPay isn't set up", no QR; empty cart → empty state. No
      `role="status"`/`<output>` in the screen. QR is rendered locally — no network. Verify the
      screen in `npm run dev` and in `npm run build && npm run preview` in a real browser
      (`promptpay-qr` → `crc` → `buffer`, which tests in Node cannot catch); if the browser build
      fails there, stop and report rather than adding a dependency.
      Files (only these): `src/config.ts`, `src/domain/promptpay.ts`,
      `src/domain/promptpay.test.ts`, `src/screens/PromptPayScreen.tsx`,
      `src/screens/PromptPayScreen.test.tsx`, `src/screens/PromptPayScreen.css`,
      `src/App.promptpay.test.tsx` (rewrite it around the real screen, dropping the "Simulate
      sale" placeholder mock), and in `src/App.tsx` only the `promptpay:` registry line (→
      `promptpay: (props) => <PromptPayScreen {...props} />,`) and one `PromptPayScreen` import
      line inserted directly after the `PlaceholderScreen` import. Do not tick this box.
      _Accept:_ unit tests — the payload contains the amount in baht with two decimals
      (`5406110.00`, `540545.50`, `54040.05`), is dynamic (`010212`), and its last 4 characters
      match a CRC16 computed independently in the test; 0/negative/fractional amounts and bad IDs
      throw. Screen tests — the QR's value equals `promptPayPayload(id, total)`; "Paid — done"
      stores `method: 'promptpay'` with a valid `confirmedAt` and calls `onOrderComplete` once;
      StrictMode double tap → one order; rejection keeps the cart; ฿0 shows no QR and never
      writes; the placeholder ID shows the test-ID warning; `fetch` is never called;
      `App.promptpay.test.tsx` goes Sell → Cart → PromptPay → Paid → Sell with "Order #N — paid".
      `npm test`, `npm run typecheck` and `npm run lint` pass.

- [x] **6. Orders + void, bottom nav.** `src/domain/day.ts` (`localDayRange(now)` — local
      midnight to next local midnight via `setDate(+1)`, not `+86400000`, returned as ISO;
      `formatLocalTime(iso)` with a fixed `'en-GB'` locale so CI's locale can't change the
      output). `src/db/orders.ts` gains `todaysOrders(database, now?)` — additive only, do not
      touch `completeOrder`/`voidOrder` — reading `where('createdAt').between(startISO, endISO,
      true, false)` (fixed-width `toISOString()` strings sort chronologically) and sorting
      newest-first in JS by `createdAt` then `number` as a tiebreaker; document that an order
      with a missing/non-string `createdAt` isn't in the index and so can't appear, a
      deliberate divergence from `sellableProducts`' full `toArray()` (order history grows
      without bound). `src/domain/order.ts` `isValidOrder`/`partitionOrders` checking header
      fields only — `id`, `number` >= 1, `total` a non-negative safe integer (rejects `NaN`,
      `1e18`), `createdAt` parseable, `status` exactly `'completed'`/`'voided'`, `payment`
      well-shaped incl. cash `tendered`/`change`; lines are validated separately in the detail
      by reusing `partitionCartLines`, since a row renders no lines and `total` is stored, not
      recomputed. `src/domain/voidReason.ts` (`VOID_REASONS`, `MAX_VOID_REASON_LENGTH = 80`,
      `normalizeVoidReason`). `src/screens/OrdersScreen.tsx` (+ `.css`, classes prefixed
      `orders-`): `useLiveQuery` inside an inner `ErrorBoundary` like Sell's grid; rows (one
      >= 48px button each) show number, time, `formatBaht(order.total)`, method and a "Voided"
      badge; invalid orders are skipped and logged once per id via `useLogInvalidOnce` +
      `safeString`, with a muted "N orders couldn't be displayed." footer so hidden money is
      still counted. The detail is this screen's own `selectedId` state, not a new `Screen`
      member — Back is `setSelectedId(null)`, the nav keeps highlighting Orders, and the one
      live query feeds both views; an order that vanishes while open shows a message, never
      auto-navigates. Void: "Void this order" opens an inline reason+confirm panel modelled on
      CartScreen's clear-confirm (presets + "Other…" free text, mandatory, focused "Keep
      order" beside a danger "Yes, void"), calling `voidOrder` through a new
      `src/hooks/useVoidOrder.ts` — the `useCompleteOrder` in-flight-guard shape, but `pending`
      returns to false on success since the screen stays mounted; a voided order renders the
      badge and reason instead of the Void button, so double-voiding is impossible.
      `src/navigation.ts` gains `NAV_SCREENS` + `showsBottomNav`; `src/components/BottomNav.tsx`
      renders Sell / Orders / Report / Admin as >= 48px buttons with `aria-current="page"`, and
      App renders it as a *sibling* of the ErrorBoundary (a crashed screen must still be
      navigable) and outside the tap shield. Hidden on cart/cash/promptpay so nothing tappable
      sits under the pay buttons. `src/index.css`: `--nav-h`/`--nav-total`, `.bottom-nav`, and
      under `.app-shell-with-nav` both `.screen { min-height: calc(100dvh - var(--nav-total)) }`
      and `.bottom-bar { bottom: var(--nav-total); padding-bottom: 12px }` — Sell stacks its
      cart bar directly on the nav, and the safe-area inset moves to the nav.
      `src/hooks/useTapShield.ts` (`TAP_SHIELD_MS = 400`): App raises it in `onOrderComplete`
      and applies it as capture-phase `onClickCapture`/`onPointerDownCapture` on a
      `.screen-wrap` around the boundary — not a CSS overlay, which jsdom's lack of hit-testing
      would make untestable. The toast and the nav sit outside that wrapper and stay tappable
      throughout. Report and Admin stay placeholders (task 7). No new dependencies, **no schema
      change** (`createdAt`/`status` are already indexed in v1; `voidedAt`/`voidReason` are
      unindexed fields `voidOrder` already writes), no network.
      Files (only these): `src/domain/day.ts`, `src/domain/day.test.ts`, `src/domain/order.ts`,
      `src/domain/order.test.ts`, `src/domain/voidReason.ts`, `src/domain/voidReason.test.ts`,
      `src/db/orders.ts` (add `todaysOrders` only), `src/db/orders.test.ts`,
      `src/hooks/useTapShield.ts`, `src/hooks/useTapShield.test.ts`,
      `src/hooks/useVoidOrder.ts`, `src/hooks/useVoidOrder.test.ts`,
      `src/components/BottomNav.tsx`, `src/components/BottomNav.test.tsx`,
      `src/screens/OrdersScreen.tsx`, `src/screens/OrdersScreen.test.tsx`,
      `src/screens/OrdersScreen.css`, `src/App.shield.test.tsx`, `src/App.test.tsx`,
      `src/navigation.ts`, `src/index.css`, and in `src/App.tsx` the shell/nav/shield wiring
      plus the `orders:` registry line and its import.
      _Accept:_ unit tests for `day.ts` (a local `new Date(2026, 0, 2, 14, 5)` formats as
      "14:05" in any timezone), `order.ts` (NaN/negative/`1e18` total, bad `createdAt`, unknown
      status, missing payment, cash without `tendered` are all invalid; `null`/array/BigInt
      never throw), `voidReason.ts`, `todaysOrders` (midnight boundaries on a fresh
      `PosDatabase`; ties broken by `number`; a timestamp-less order neither appears nor
      throws), `useTapShield` (false at 0, true at 399ms, false at 400ms, a re-`raise`
      restarts rather than stacks, no timer left after unmount) and `useVoidOrder`. Testing
      Library tests on a fresh `PosDatabase` — a voided order shows a "voided" badge and stays
      in the list; tapping a row opens the detail with snapshot lines, the stored total and
      cash tendered/change; "Yes, void" is disabled until a reason is picked, then writes
      `status`/`voidReason`/`voidedAt` and the detail live-updates; a StrictMode double tap
      voids once; a rejected void shows a `role="alert"` and leaves the order completed;
      corrupt orders are skipped, logged once and counted in the footer; yesterday's order is
      absent. Nav tests — present on sell/orders/report/admin, absent on cart/cash/promptpay,
      and still usable when the current screen's boundary has crashed. Shield test
      (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`, so fake-indexeddb keeps
      running) — right after a cash sale a tile tap leaves the cart bar at ฿0, while the toast
      still dismisses on tap and the nav still navigates; after 400ms the same tap adds ฿55.
      `fetch` is never called. `npm test`, `npm run typecheck`, `npm run lint` and
      `npm run build` pass (run as separate commands).

- [ ] **7a. Settings table + Z report.** `src/domain/settings.ts` (`SETTINGS_ID = 'shop'`,
      `Settings { id; shopName; promptPayId }`, `DEFAULT_SETTINGS` (shopName `'Bakery'`),
      `isValidSettings`, total `coerceSettings` that never throws and corrects *field by field* —
      a corrupt `shopName` must not revert a valid real `promptPayId` to the placeholder, and a
      corrupt `promptPayId` falls back to the placeholder so the test-ID warning shows).
      `src/db/db.ts`: a brand-new `.version(2).stores({ settings: 'id' })` block with version 1
      left byte-identical and `products`/`orders` deliberately **not** re-listed (Dexie carries
      them forward; re-listing risks a typo dropping the `createdAt` index). No `upgrade()`
      callback — adding a store needs no data transformation. `src/db/seed.ts` is untouched: no
      settings row is seeded (`seedIfEmpty` short-circuits on a non-empty products table, so an
      upgraded device would never get one anyway); `getSettings` falls back to `DEFAULT_SETTINGS`
      when the row is missing, corrupt, or the read fails, and `saveSettings` upserts with `put`,
      so 7b's first Admin save creates it. `getSettings` is the one db reader that swallows its
      own errors — `useSettings` is called in `App.tsx`'s body, *above* every `ErrorBoundary`,
      where a re-thrown rejection would take down Sell, the cart bar and the nav at once.
      `src/config.ts` is **deleted**: `PLACEHOLDER_PROMPTPAY_ID` moves to
      `src/domain/promptpay.ts`, `PROMPTPAY_ID` ceases to exist, `ScreenProps` gains
      `settings: Settings | null` (`null` means *not loaded yet*, never "use defaults"), App reads
      settings once next to `useCart()` so the query is warm before anyone taps PromptPay, and
      `PromptPayScreen`'s `promptPayId` becomes a required `string | null` prop with no
      module-level default — `null` renders "Loading PromptPay settings…", no QR, Paid disabled,
      so the checkout never shows a QR built from a guessed ID. `PromptPayScreen.config.test.tsx`
      is deleted with the module it tested and replaced by `src/App.settings.test.tsx`.
      `src/domain/day.ts` gains `localDayKey`/`parseLocalDayKey` (local parts, never
      `toISOString().slice(0,10)` or `new Date('YYYY-MM-DD')` — both are UTC and land on the wrong
      day); `src/db/orders.ts` gains `ordersForDay(database, day)` holding the old `todaysOrders`
      body and its `createdAt` blind-spot comment, with `todaysOrders` delegating so Orders and
      its tests don't change (additive only — do not touch `completeOrder`/`voidOrder`).
      `src/domain/report.ts` (no React, no Dexie, so task 9's server can import it): pure
      `buildZReport(orders: unknown[], day)` → counts/totals of completed orders, per-method
      totals (cash = expected in drawer), units and revenue per product from snapshot prices,
      `voidedCount`/`voidedTotal` excluded from every total but reported, `invalidCount` via
      `partitionOrders` and `mismatchedTotalCount` via `partitionCartLines`; it re-filters by
      *parsed* instant against `localDayRange(day)` so an odd-but-parseable `createdAt` can't land
      in the wrong day's takings, uses the **stored** `order.total` for the drawer figure, and
      never throws; plus `formatZReport(report, shopName)` for share/copy. The task-6 blind spot
      stands and is documented in `report.ts`: an order whose `createdAt` isn't a Z-normalised ISO
      string is invisible to the indexed read and so appears in no day's report and no count.
      `src/screens/ReportScreen.tsx` (+ `.css`, classes prefixed `report-`): native
      `<input type="date">` (`max` = today) and the inner-`ErrorBoundary` + `useLiveQuery` pattern
      from `OrdersScreen`, with the picker *outside* the boundary so a crashed body can still be
      escaped by choosing another day, and the query keyed on the `dayKey` **string**, never a
      `Date` (a fresh object each render re-queries forever). `src/hooks/useShareText.ts`:
      `navigator.share` called synchronously from the tap (gesture requirement), `AbortError` =
      silent cancel with no clipboard attempt, any other rejection falls through to
      `navigator.clipboard.writeText`, neither → a selectable read-only textarea that must set
      `user-select: text` (index.css disables selection globally). Off the checkout path. No new
      dependencies, no network.
      Files (only these): `src/domain/settings.ts`, `src/domain/settings.test.ts`,
      `src/db/db.ts`, `src/db/db.test.ts`, `src/db/settings.ts`, `src/db/settings.test.ts`,
      `src/hooks/useSettings.ts`, `src/hooks/useSettings.test.ts`,
      `src/hooks/useShareText.ts`, `src/hooks/useShareText.test.ts`, `src/domain/day.ts`,
      `src/domain/day.test.ts`, `src/db/orders.ts` (add `ordersForDay` only),
      `src/db/orders.test.ts`, `src/domain/report.ts`, `src/domain/report.test.ts`,
      `src/domain/promptpay.ts`, `src/domain/promptpay.test.ts`,
      `src/screens/ReportScreen.tsx`, `src/screens/ReportScreen.test.tsx`,
      `src/screens/ReportScreen.css`, `src/screens/PromptPayScreen.tsx`,
      `src/screens/PromptPayScreen.test.tsx`, `src/App.settings.test.tsx`,
      `src/navigation.ts`, deleted `src/config.ts` and
      `src/screens/PromptPayScreen.config.test.tsx`, and in `src/App.tsx` only the `useSettings`
      call, `settings` in the props passed to `<Entry>`, the `report:` and `promptpay:` registry
      lines and their imports.
      _Accept:_ unit tests for `buildZReport` incl. voids excluded from totals but counted, and
      corrupt/`null`/BigInt records never throwing; day boundaries use local time (a hand-built
      list either side of local midnight, and `localDayKey`/`parseLocalDayKey` round-tripping in
      any timezone); `formatZReport` matches one exact expected string. A db test opens a **v1**
      database — a bare `new Dexie(name)` declaring only version 1, asserted at `verno === 1`,
      never `PosDatabase` — writes products and orders into it, closes it, reopens the same name
      with `PosDatabase`, and shows the migration keeps existing data: `verno === 2`, every
      product and order still present and `toEqual`-unchanged (not merely counted), the
      `createdAt` index still working through `ordersForDay`, the running order `number`
      continuing from the v1 orders, and the new `settings` table usable via
      `saveSettings`/`getSettings`. Settings tests — defaults with no row, defaults for a junk
      row, defaults when the read rejects (and App still renders Sell), a saved value surviving
      a reopen. Screen tests on a fresh `PosDatabase` — cash, PromptPay and voided orders give
      the right counts, `formatBaht` totals, "cash expected in drawer", per-product rows and
      voided line; changing the date input re-queries; an empty day says so; Share copies
      exactly `formatZReport(...)`; a cancelled share shows no error and never touches the
      clipboard; with neither API the text appears selectable. PromptPay tests — a stored real
      ID renders its QR with no test-ID warning, no stored row renders the placeholder QR *with*
      the warning, and an unloaded read renders no QR at all. `fetch` is never called.
      `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` pass (run as separate
      commands).

- [ ] **7b. Admin screen + PIN lock.** Admin screen for products (add, edit name/price/category,
      toggle out of stock, archive) and settings (shop name, PromptPay ID, category order), on
      top of 7a's `settings` table. PIN lock per SPEC: `src/domain/pin.ts` (pure `hashPin(pin,
      salt)`, `verifyPin`, `generateRecoveryCode`), `pinHash`/`pinSalt`/`recoveryHash` in the
      settings table, `src/components/PinPrompt.tsx` (numeric keypad ≥ 48px, masked dots, lockout
      message), first-run set-PIN flow with the recovery code shown once, unlock state held in
      App.tsx with a 5-minute expiry. Admin and Void use it.
      _Accept:_ tests — wrong PIN rejected and never stored in plain text; 5 wrong attempts lock
      for 60s; unlock expires after 5 minutes; recovery code resets the PIN; Sell → Cart → Cash
      never shows the prompt.

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
