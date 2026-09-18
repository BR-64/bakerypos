import type { Screen } from '../navigation'

export interface PlaceholderScreenProps {
  title: string
  navigate: (screen: Screen) => void
}

/**
 * Filler for a screen that isn't built yet (cash, promptpay, orders,
 * report, admin — see `src/App.tsx`'s registry). Renders a title,
 * "Coming soon", and a way back to Sell; never reads or writes anything,
 * and never touches the cart.
 */
export function PlaceholderScreen({ title, navigate }: PlaceholderScreenProps) {
  return (
    <main className="app screen placeholder-screen">
      <header className="screen-header">
        <button type="button" className="back-button" onClick={() => navigate('sell')}>
          Back to Sell
        </button>
        <h1>{title}</h1>
      </header>
      <p className="muted">Coming soon</p>
    </main>
  )
}
