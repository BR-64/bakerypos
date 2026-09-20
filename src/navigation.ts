import type { PosDatabase } from './db/db'
import type { Order } from './domain/types'
import type { Cart } from './hooks/useCart'

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
