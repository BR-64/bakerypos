import { useCallback, useEffect, useRef, useState } from 'react'

/** A file to offer: its name, its whole text, and what it is. */
export interface ShareFile {
  name: string
  text: string
  type: string
}

/** A file the person can tap to download, when the share sheet wasn't usable. */
export interface DownloadLink {
  name: string
  href: string
}

export interface ShareFiles {
  /**
   * Offer `files` through the share sheet. **Call this straight from the
   * tap handler**: `navigator.share` only opens during a real user
   * gesture, and an `await` before it loses that gesture — which is why
   * the Backup section has its data loaded and waiting before the tap.
   */
  share: (files: ShareFile[]) => void
  /** True once the share sheet accepted the files. */
  shared: boolean
  /** Non-empty when the sheet wasn't usable: download links, rendered instead. */
  downloads: DownloadLink[]
}

/** Whether a rejection is the person simply dismissing the share sheet. */
function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * A URL that downloads `file`. An object URL when the browser has them
 * (cheap, no size limit worth worrying about), otherwise a `data:` URL,
 * which every browser can follow — the person must always end up with a
 * way to get the file.
 */
function toHref(file: ShareFile): string {
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(new Blob([file.text], { type: file.type }))
    }
  } catch {
    // Fall through to the data URL.
  }
  return `data:${file.type};charset=utf-8,${encodeURIComponent(file.text)}`
}

/**
 * Share one or more generated files, falling back to download links.
 *
 * The same three-step shape as `useShareText` (sheet → fallback → the
 * person still gets the content), but the steps themselves differ: a
 * backup is a *file*, so the clipboard is no use for it and the fallback
 * is a link with a `download` attribute. `navigator.canShare({ files })`
 * is checked first because sharing files is unsupported on a good number
 * of browsers that still have `navigator.share` for text — calling it
 * anyway would reject *after* the gesture is gone.
 *
 * An `AbortError` is a successful cancel: the person opened the sheet and
 * changed their mind, and must not then be shown a fallback they didn't
 * ask for. Every other rejection falls back.
 *
 * Nothing here touches the network, and nothing here is on the checkout
 * path — it exists for Admin → Backup.
 */
export function useShareFiles(): ShareFiles {
  const [shared, setShared] = useState(false)
  const [downloads, setDownloads] = useState<DownloadLink[]>([])
  const created = useRef<string[]>([])

  const revoke = useCallback(() => {
    for (const href of created.current) {
      if (!href.startsWith('blob:')) continue
      try {
        URL.revokeObjectURL(href)
      } catch {
        // Nothing to do; the URL dies with the page anyway.
      }
    }
    created.current = []
  }, [])

  // Object URLs outlive the component unless they're revoked.
  useEffect(() => revoke, [revoke])

  const offerDownloads = useCallback(
    (files: ShareFile[]) => {
      revoke()
      const links = files.map((file) => ({ name: file.name, href: toHref(file) }))
      created.current = links.map((link) => link.href)
      setDownloads(links)
    },
    [revoke],
  )

  const share = useCallback(
    (files: ShareFile[]) => {
      setShared(false)
      revoke()
      setDownloads([])
      if (files.length === 0) return

      const webShare = typeof navigator === 'undefined' ? undefined : navigator.share
      const canShare = typeof navigator === 'undefined' ? undefined : navigator.canShare
      if (typeof webShare !== 'function' || typeof canShare !== 'function') {
        offerDownloads(files)
        return
      }

      let payload: { files: File[] }
      try {
        payload = {
          files: files.map((file) => new File([file.text], file.name, { type: file.type })),
        }
        if (!canShare.call(navigator, payload)) {
          offerDownloads(files)
          return
        }
      } catch {
        offerDownloads(files)
        return
      }

      let sharing: Promise<void>
      try {
        // Synchronous, inside the gesture.
        sharing = Promise.resolve(webShare.call(navigator, payload))
      } catch (error) {
        // A synchronous throw is never a user cancel.
        if (!isAbort(error)) offerDownloads(files)
        return
      }

      sharing.then(
        () => setShared(true),
        (error: unknown) => {
          if (isAbort(error)) return
          offerDownloads(files)
        },
      )
    },
    [offerDownloads, revoke],
  )

  return { share, shared, downloads }
}
