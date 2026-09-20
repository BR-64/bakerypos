import { useSyncExternalStore } from 'react'

/**
 * Whether the device currently believes it has a network connection.
 *
 * `navigator.onLine` plus the `online`/`offline` window events — **nothing
 * is ever fetched to find out**. A connectivity "check" that hit the
 * network would be a request on the checkout path (CLAUDE.md), and this
 * app has no server to ask anyway: the value is shown to reassure the
 * person at the counter, never to decide whether a sale can go through.
 *
 * `navigator.onLine` is famously optimistic — a phone on a captive-portal
 * wifi reports `true` — which is fine for exactly that reason: the app
 * works either way, so the worst a wrong value can do is show or hide a
 * badge.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: reading the
 * value during render is what keeps a change that lands *between* the
 * first render and the subscription from being missed, and React handles
 * that re-check itself.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

function getSnapshot(): boolean {
  const value: unknown = typeof navigator === 'undefined' ? undefined : navigator.onLine
  // Anything other than a real boolean (an ancient or exotic browser, a
  // stubbed navigator) counts as online, so the badge stays hidden rather
  // than telling the shop it is offline on no evidence.
  return typeof value === 'boolean' ? value : true
}

// Nothing here is server-rendered, but React requires this third argument
// for a hook that could be; "online" matches `getSnapshot`'s fallback.
function getServerSnapshot(): boolean {
  return true
}
