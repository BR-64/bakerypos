import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Last-resort safety net for the Sell screen. Bad product data should
 * already be handled in place (see `isSellable`, `categoryLabel`,
 * `visibleCategories`), but this catches anything unforeseen so the kiosk
 * shows a recoverable screen instead of a blank crash.
 *
 * The fallback only reloads the page — it never touches the cart or orders,
 * so it can't make a bad situation worse by writing anything.
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
          <p>Something went wrong. Please reload.</p>
          <button type="button" className="error-boundary-reload" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
