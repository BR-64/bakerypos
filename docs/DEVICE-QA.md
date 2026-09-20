# Device QA — the checks a person has to do on a real phone

Everything in `npm test` runs in jsdom, which has no fingers, no camera, no home indicator and
no network to switch off. This list is the rest: the things that can only be answered by
holding the phone. Run it before handing a device to the shop, and again after any task that
touches the checkout path, the PWA shell or the PIN.

Nothing here has been run by an agent. Every box starts empty.

|                      |     |
| -------------------- | --- |
| Device / OS          |     |
| Browser              |     |
| App version (commit) |     |
| Tester / date        |     |

## Setting up the device

```
npm run build
npm run preview -- --host      # then open the printed LAN address on the phone
```

**Serve it over https (or localhost).** `crypto.subtle` — which the PIN is hashed with — does
not exist in an insecure context, so over plain `http://192.168.…` the app deliberately
refuses to set or check a PIN and says so, and the PIN sections below cannot be tested. Use a
tunnel, a local certificate, or USB port-forwarding to `localhost` on the phone.

## 1. Install

- [ ] In a browser tab, the "Add this to your Home screen" hint appears at the top, above the
      product grid. It covers nothing: the cart bar, the nav and every tile are still tappable.
- [ ] With the hint still showing (before dismissing it), ring something up and open **Cash**:
      the hint is not there, and the whole keypad and the "Done" button are reachable without
      scrolling. Same for PromptPay: the QR and both buttons fit.
- [ ] "Got it" dismisses it, and it is still gone after a reload.
- [ ] Add to Home screen. The icon on the home screen is the bakery loaf — not a screenshot of
      the page, not a grey globe — and it is not clipped or letterboxed inside the launcher's
      icon shape.
- [ ] Launch from the home screen. It opens full-screen (no browser address bar), portrait,
      and the install hint is **not** shown.
- [ ] Pinch-zoom does nothing; pulling down at the top of the grid does not reload the page.
- [ ] Force-quit and relaunch: the app opens on Sell, and the products are still there.

## 1b. Lighthouse

Desktop Chrome against the same `npm run preview` build (DevTools → Lighthouse → Progressive
Web App, or `npx lighthouse <url> --only-categories=pwa`). It is a build check, not a phone
check, but it catches a broken manifest or service worker before anyone walks a phone over.

- [ ] **Installable**: the manifest, the 192 and 512 icons and the service worker all pass.
- [ ] **`start_url` responds with a 200 when offline.**
- [ ] Record anything it flags here, with the audit name: \_\_\_\_\_\_\_\_

## 2. A cash sale in airplane mode

- [ ] Turn on airplane mode (and turn wifi off — airplane mode alone sometimes leaves it on).
- [ ] An **Offline** badge appears in the bottom nav bar, beside Sell/Orders/Report/Admin. It
      does not cover the cart bar or any nav button.
- [ ] Ring up two or three items, open the cart, tap **Cash**, take a tender, tap **Done**.
- [ ] The sale completes with no spinner and no error. "Order #N — change ฿X" appears at the
      top of Sell, and the cart is empty.
- [ ] Orders shows the sale with the right total and method.
- [ ] Turn airplane mode off: the **Offline** badge disappears on its own, with no reload and
      no tap.

## 3. A PromptPay sale in airplane mode

- [ ] Airplane mode on. Cart → **PromptPay**. The QR appears immediately (it is generated on
      the device; nothing is fetched).
- [ ] **Scan the QR with a real banking app** — the point of this check is that the bank reads
      it at all, and that the amount and the receiving account it shows are the shop's, to the
      satang. Do not tap "Paid — done" until the bank app has shown the right amount.
- [ ] If the shop's PromptPay ID has not been set in Admin yet, the screen says PromptPay
      isn't set up and points at Cash, rather than showing a QR for the placeholder account.
- [ ] "Paid — done" completes the sale; Orders shows it as PromptPay.

## 4. The stray tap right after a sale

- [ ] Complete a cash sale by tapping **Done** with the pad of your thumb, as fast as you
      normally would, and let your hand rest. No product is added to a new cart by that tap or
      by the one immediately after it.
- [ ] The order toast at the top is still tappable during that moment (tap it; it dismisses),
      and so is the bottom nav.
- [ ] **On an iPhone with a home indicator** (X and later), look closely at the bottom of the
      Cash and PromptPay screens: their action bars sit about 3px above where Sell's cart bar
      sits, because of how the home-indicator inset is applied. Check whether that 3px shift
      moves the "Done" button far enough for a thumb resting at the bottom edge to land on a
      product tile after the screen swaps back to Sell. If it does, say so — this is the open
      question from tasks 4–5, and it is a phone-only one.

## 5. Touch targets and one-handed use

- [ ] Nothing tappable is smaller than a fingertip (48px): the −/+ steppers in the cart, the
      keypad, the nav, the category tabs, "Void", "Got it".
- [ ] Holding the phone one-handed, a sale from grid to "paid" is at most: tile(s) → cart bar
      → Cash/PromptPay → Done. No stretch to the top of the screen is needed for any of it.
- [ ] Nothing important hides under the home indicator or a rounded corner.

## 6. Void behind the PIN

- [ ] Orders → tap an order → **Void**. The PIN keypad appears before anything is voided.
- [ ] The correct PIN voids it after a reason and a confirmation. The order stays in the list,
      marked voided; it is not deleted.
- [ ] The Z report counts it as a void, and today's totals drop by that order's total.

## 7. The lockout, and that it survives a force-quit

- [ ] Admin → enter the **wrong** PIN five times. The keypad locks and counts down from 60
      seconds — the number visibly changes, it is not frozen at 60.
- [ ] While it is counting down, **force-quit the app** (swipe it away from the app switcher)
      and relaunch it. Open Admin: it is **still locked out**, with roughly the time that was
      left, not a fresh five attempts.
- [ ] Wait it out. After the 60 seconds the keypad accepts the correct PIN again.
- [ ] Sanity check that it cannot lock anyone out for good: after unlocking once, force-quit
      and relaunch again — Admin asks for the PIN as normal, with no lockout.

## 8. The 5-minute unlock

- [ ] Enter the correct PIN, leave Admin, and come back within 5 minutes: no PIN is asked for.
- [ ] Leave the app in the background for more than 5 minutes (or lock the screen and come
      back). Admin asks for the PIN again.
- [ ] Sell → Cart → Cash and Sell → Cart → PromptPay never ask for a PIN at any point.

## 9. The Z report and sharing it

- [ ] Report shows today: order count, total, cash vs PromptPay, units and revenue per
      product, and voids.
- [ ] Tap Share. **Note which of the three paths the phone takes** — the share sheet, a "copied
      to clipboard" message, or the report text shown selectable on screen to copy by hand.
      All three are legitimate; the open question from task 7a is simply which one real devices
      use, and whether the fallback is understandable when it happens.
- [ ] Whatever path it took, paste the result into a notes app: the text is complete and
      readable, with the shop name and the day at the top.

## 10. Admin, and history that must not change

- [ ] Add a product; it appears on the Sell grid in the right category.
- [ ] Toggle one out of stock: its tile greys out and cannot be tapped.
- [ ] Archive one: it disappears from the grid, and older orders that contain it still show it
      with its old name and price.
- [ ] **Edit a product's price, then open an order from before the edit.** The line's unit
      price, the line total and the order total are all unchanged, and the Z report for that
      earlier day is unchanged too. (Prices are snapshotted on the order line — this is the
      check that proves it on a real device with real stored data.)
- [ ] In the category order editor, **double-tap "move up" quickly**. It can look as though
      nothing happened and then correct itself a moment later. Confirm what the order ends up
      as — the list that is on screen after a second is the one that was saved — and note
      whether the flicker is confusing enough to need fixing.

## 11. Upgrading a device that already has data

Do this on a device (or profile) that already ran an **older build** and has real orders on it
— not a fresh install. Installing over the top is the case that can silently lose a day's
takings, so it is worth doing deliberately.

- [ ] Before upgrading, note the number of today's orders and today's total.
- [ ] Load the new build (an installed PWA picks it up on relaunch; force-quit twice if the
      service worker is still serving the old one).
- [ ] Orders and the Z report show exactly the same orders and totals as before, with the same
      order numbers.
- [ ] Admin still has the shop name, the PromptPay ID and the category order that were set.
- [ ] The PIN set on the old build still works, and the recovery code from that build still
      resets it.
- [ ] Ring up a sale after the upgrade: the new order's number continues the old sequence
      rather than restarting at 1.

## 12. Offline for a whole shift

- [ ] Airplane mode on, then ring up half a dozen sales over several minutes, including a
      void and a PromptPay sale.
- [ ] Lock the screen, wait a few minutes, unlock, and carry on: the cart and the app are as
      they were.
- [ ] Force-quit and relaunch, still offline: every sale is still in Orders, and the Z report
      totals match what was rung up.
- [ ] Back online, nothing changes retroactively: same orders, same totals, same numbers.

## Notes from this run

<!-- Anything that behaved differently from the above, with device and steps. -->
