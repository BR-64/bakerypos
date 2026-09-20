import { useCallback, useState } from 'react'

export interface ShareText {
  /**
   * Share `text`. **Call this straight from the tap handler** — it invokes
   * `navigator.share` synchronously, because browsers only allow the share
   * sheet during a real user gesture and an `await` before the call loses
   * that gesture.
   */
  share: (text: string) => void
  /** True once the text has been put on the clipboard instead. */
  copied: boolean
  /**
   * Non-null when neither the share sheet nor the clipboard was usable:
   * the caller renders this in a read-only textarea so the text can at
   * least be selected by hand. That textarea needs `user-select: text` —
   * `src/index.css` turns selection off for the whole app.
   */
  fallbackText: string | null
  /** Clear `copied` / `fallbackText` (e.g. when the report changes). */
  reset: () => void
}

/** Whether a rejection is the user simply dismissing the share sheet. */
function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * Share or copy a block of text, degrading in three steps: the Web Share
 * sheet, then the clipboard, then a selectable read-only textarea.
 *
 * An `AbortError` from `navigator.share` means the person opened the sheet
 * and dismissed it. That is a *successful* cancel: it must not fall
 * through to the clipboard, or tapping Share and changing your mind would
 * silently overwrite whatever you had copied. Every other rejection (no
 * handler registered, a permissions policy block, …) does fall through.
 *
 * Nothing here touches the network, and the hook is off the checkout path
 * entirely — it exists for the Z report.
 */
export function useShareText(): ShareText {
  const [copied, setCopied] = useState(false)
  const [fallbackText, setFallbackText] = useState<string | null>(null)

  const copy = useCallback((text: string) => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setFallbackText(text)
      return
    }
    let writing: Promise<void>
    try {
      writing = Promise.resolve(clipboard.writeText(text))
    } catch {
      setFallbackText(text)
      return
    }
    writing.then(
      () => setCopied(true),
      () => setFallbackText(text),
    )
  }, [])

  const share = useCallback(
    (text: string) => {
      setCopied(false)
      setFallbackText(null)

      const webShare = typeof navigator === 'undefined' ? undefined : navigator.share
      if (typeof webShare !== 'function') {
        copy(text)
        return
      }

      let sharing: Promise<void>
      try {
        // Synchronous, inside the gesture. `.bind` rather than a stored
        // reference so `this` is still the navigator.
        sharing = Promise.resolve(webShare.call(navigator, { text }))
      } catch (error) {
        // A synchronous throw is never a user cancel.
        if (!isAbort(error)) copy(text)
        return
      }

      sharing.then(
        () => {},
        (error: unknown) => {
          if (isAbort(error)) return
          copy(text)
        },
      )
    },
    [copy],
  )

  const reset = useCallback(() => {
    setCopied(false)
    setFallbackText(null)
  }, [])

  return { share, copied, fallbackText, reset }
}
