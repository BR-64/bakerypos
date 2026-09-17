# Bakery POS — product spec (v1)

## Who and where

One small bakery, one kiosk, one phone. Staff ring up sales on the phone's browser (installed
as a PWA on the home screen). Wi-Fi is unreliable. The owner wants to know, at the end of each
day, what sold and how much cash should be in the drawer.

## Goals

1. A sale takes under 10 seconds and at most a few taps.
2. Everything works with no network. Nothing is lost if the phone goes offline mid-shift.
3. Money is never wrong: no rounding drift, no double-counted sales, history never rewritten.
4. The owner gets an end-of-day (Z) report from the phone.

## Non-goals for v1

Inventory tracking, loyalty, discounts/promotions, multiple kiosks or staff logins, receipt
printing, integrated card payments, automatic PromptPay confirmation, tax invoices.

## Screens

**Sell (home).** Product grid, filtered by category tabs, tiles ≥ 88px tall showing name and
price; out-of-stock tiles greyed and untappable. Tapping a tile adds one to the cart. A sticky
bottom bar shows item count and total; tapping it opens the cart.

**Cart.** Lines with name, qty, −/+ steppers, line total. "Clear cart" with confirmation. Two
big buttons: **Cash** and **PromptPay**.

**Cash checkout.** Big total, quick-tender buttons (exact, next notes — see
`quickTenderOptions`), numeric keypad for other amounts, change due in very large type.
"Done" completes the order and returns to Sell.

**PromptPay checkout.** Big total, QR code encoding the shop's PromptPay ID and the exact
amount (`promptpay-qr` package, rendered with `qrcode.react`). Button **"Paid — done"** that
staff tap after seeing the bank notification. Button **Cancel** back to cart.

**Orders (today).** List of today's orders, newest first, with number, time, total, method.
Tap → detail with lines; **Void** requires a reason and a confirmation.

**Z report.** For a chosen day (default today): count and total of completed orders, totals
by payment method (cash expected in drawer), units and revenue by product, voided count and
total. Shareable as plain text (Web Share API / copy to clipboard).

**Admin.** Product list: add, edit name/price/category, toggle out of stock, archive. Shop
settings: shop name, PromptPay ID (phone or national ID), category order.

## Data model

See `src/domain/types.ts`. Key decisions:

| Decision                                     | Why                                             |
| -------------------------------------------- | ----------------------------------------------- |
| Money as integer satang                      | No float errors; 45.50 baht is `4550`           |
| `OrderLine` snapshots `name` and `unitPrice` | Price changes must not rewrite history          |
| `Order.total` stored, not recomputed         | Reports stable even if rules change             |
| Client UUID `id` + per-device `number`       | Offline creation never collides; humans see #42 |
| Void, don't delete                           | Audit trail; Z report shows voids               |
| `sync: 'pending' \| 'synced'` on orders      | Backend sync (later) is idempotent upsert by id |

## Offline / PWA

App shell precached by the service worker (vite-plugin-pwa, `autoUpdate`). All reads and
writes go to Dexie. Show a small offline indicator and an "N unsynced" badge once sync exists.
Lock portrait, disable pinch-zoom and pull-to-refresh.

## Later (v2 candidates, in rough priority)

Backend sync + owner dashboard → simple discounts → Bluetooth receipt printer → daily stock
counts per product → second kiosk.
