import type { PosDatabase } from './db/db'
import type { Settings } from './domain/settings'
import type { Order } from './domain/types'
import type { Cart } from './hooks/useCart'
import type { PinLock } from './hooks/usePinLock'

/** Every screen in the app. Order here has no meaning beyond documentation. */
export const SCREENS = ['sell', 'cart', 'cash', 'promptpay', 'orders', 'report', 'admin'] as const

export type Screen = (typeof SCREENS)[number]

/** The screen App starts on, and the one every "Back" action returns to. */
export const HOME_SCREEN: Screen = 'sell'

/**
 * Screens with a bottom nav bar (see `src/components/BottomNav.tsx`).
 * Cart/cash/promptpay are deliberately excluded so nothing tappable sits
 * under the pay buttons during checkout.
 */
export const NAV_SCREENS = ['sell', 'orders', 'report', 'admin'] as const

export type NavScreen = (typeof NAV_SCREENS)[number]

/** Whether `screen` should show the bottom nav bar. */
export function showsBottomNav(screen: Screen): screen is NavScreen {
  return (NAV_SCREENS as readonly Screen[]).includes(screen)
}

export const SCREEN_TITLES: Record<Screen, string> = {
  sell: 'Sell',
  cart: 'Cart',
  cash: 'Cash',
  promptpay: 'PromptPay',
  orders: 'Orders',
  report: 'Report',
  admin: 'Admin',
}

/** Props every screen component receives from App's registry. */
export interface ScreenProps {
  cart: Cart
  navigate: (screen: Screen) => void
  database: PosDatabase
  /**
   * Shop settings (shop name, PromptPay ID), read once in App's body via
   * `useSettings` so the query is already warm before anyone taps
   * PromptPay.
   *
   * `null` means **not loaded yet** — never "use the defaults". A screen
   * that needs a real value renders a loading state for `null`; it must
   * never substitute a guess, least of all a PromptPay ID, which decides
   * who the customer's money goes to. Every case where there genuinely is
   * no usable stored value (no row, a corrupt row, a failed read) already
   * resolves to `DEFAULT_SETTINGS` inside `getSettings`.
   */
  settings: Settings | null
  /**
   * True when the settings **read failed**, as opposed to "there's no row
   * yet" (the normal state until the first Admin save, which keeps using
   * `DEFAULT_SETTINGS`). `settings` then holds defaults that were never
   * stored, so a screen that would act on them has to say so instead:
   * PromptPay shows "PromptPay isn't set up — use Cash" rather than a QR
   * for the placeholder account, Admin won't overwrite what it couldn't
   * read, and the PIN prompt refuses to offer the first-run set-PIN flow.
   */
  settingsFailed: boolean
  /**
   * The Admin PIN lock (`src/hooks/usePinLock.ts`), created once in App so
   * the unlock, the wrong-attempt count and the 60-second lockout are
   * shared by every screen that uses them (Admin, and Void inside Orders)
   * and survive navigating away and back. Sell, Cart, checkout and Report
   * never touch it.
   */
  pinLock: PinLock
  /**
   * Call once `completeOrder` has resolved. App clears the cart, returns to
   * Sell and shows "Order #N — change ฿X" / "Order #N — paid". A checkout
   * screen must not clear the cart or navigate on success itself. Call it
   * exactly once per stored order, even if the screen has since unmounted —
   * the order is already in Dexie, so the cart must still be cleared.
   * `useCompleteOrder` does all of this; use it rather than calling
   * `completeOrder` directly.
   */
  onOrderComplete: (order: Order) => void
}
