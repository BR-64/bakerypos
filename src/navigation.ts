import type { PosDatabase } from './db/db'
import type { Cart } from './hooks/useCart'

/** Every screen in the app. Order here has no meaning beyond documentation. */
export const SCREENS = ['sell', 'cart', 'cash', 'promptpay', 'orders', 'report', 'admin'] as const

export type Screen = (typeof SCREENS)[number]

/** The screen App starts on, and the one every "Back" action returns to. */
export const HOME_SCREEN: Screen = 'sell'

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
}
