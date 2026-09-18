import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * Called when "Try again" is tapped. The caller is expected to change a
   * `key` on this `ErrorBoundary` (or an ancestor) in response, which
   * remounts it and its children fresh — including re-running any hook
   * (e.g. `useLiveQuery`) that threw the first time. If omitted, only the
   * "Reload" button is shown.
   */
  onRetry?: () => void
  /**
   * Called when "Back to Sell" is tapped. Shown only when given, between
   * "Try again" and "Reload" — a secondary escape hatch for a screen other
   * than Sell, since "Reload" would lose the in-memory cart.
   */
  onBack?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Last-resort safety net for the Sell screen. Bad product data should
 * already be handled in place (see `isSellable`/`partitionSellable`), but
 * this catches anything unforeseen so the kiosk shows a recoverable screen
 * instead of a blank crash.
 *
 * This must be a class component: `getDerivedStateFromError` and
 * `componentDidCatch` (catching an error thrown during a descendant's
 * render) have no Hook equivalent in React.
 *
 * The fallback's actions never touch the cart or orders — "Try again"
 * only asks the parent to remount this subtree, and "Reload" only reloads
 * the page — so recovering from an error can't make things worse by
 * writing anything.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught an error', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <p>Something went wrong.</p>
          <div className="error-boundary-actions">
            {this.props.onRetry && (
              <button
                type="button"
                className="error-boundary-button error-boundary-retry"
                onClick={this.props.onRetry}
              >
                Try again
              </button>
            )}
            {this.props.onBack && (
              <button
                type="button"
                className="error-boundary-button error-boundary-back"
                onClick={this.props.onBack}
              >
                Back to Sell
              </button>
            )}
            <button
              type="button"
              className="error-boundary-button error-boundary-reload"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
