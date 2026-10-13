import { useEffect, useMemo, useState } from 'react'
import { safeString } from '../domain/log'
import { productImage, productImageProblem, repoImageFileName } from '../domain/productImage'
import type { Product } from '../domain/types'
import { REPO_PRODUCT_IMAGE_FILES } from '../images/repoImages'
import { useLogInvalidOnce } from './useLogInvalidOnce'

/**
 * Where a product's picture should come from, device first.
 *
 * `src` is `null` when there is no picture to show, which is the normal
 * state for a product nobody has photographed — the tile then renders
 * exactly what it rendered before pictures existed. A caller that gets
 * `null` must render no `<img>` at all: that is what keeps a missing
 * picture from costing a request, a broken-image icon or a console line.
 */
export interface ProductImageSource {
  src: string | null
  /** Hand to `<img onError>`; drops to the next source down, then to text. */
  onError: () => void
}

function invalidImageKey(product: Product): string {
  return typeof product.id === 'string' && product.id.length > 0 ? product.id : safeString(product)
}

function describeInvalidImage(product: Product): string {
  return (
    `useProductImage: ignoring the stored picture for product ${invalidImageKey(product)} — ` +
    `it ${safeString(productImageProblem(product))}. The product is still sellable.`
  )
}

/**
 * Resolve a product's picture and own the object URL for it.
 *
 * Order, which the Sell grid and Admin both use so a photo looks the same
 * in both places:
 *
 * 1. the photo uploaded in Admin, stored on this device — overrides
 *    everything;
 * 2. the picture shipped in the repo at `public/products/<id>.<ext>`, which
 *    is a build-time lookup (`REPO_PRODUCT_IMAGE_FILES`), never a guessed
 *    URL — a product with no shipped picture causes no request;
 * 3. nothing, and the tile is name + price.
 *
 * A stored photo that fails `imageProblem` is skipped and logged once
 * (CLAUDE.md), and resolution carries on at step 2 — a corrupt blob costs
 * the product its picture, never its tile. A photo that passes the guard
 * and then fails to *decode* behaves the same way, via `onError`, but
 * silently: `onError` is a normal thing for a browser to call and is not
 * worth a console line.
 *
 * **Object URLs.** One is created in an effect — never during render, and
 * never for a product with no photo — and revoked in that effect's
 * cleanup, so it goes away on unmount and when the photo is replaced. The
 * effect re-runs whenever the `Blob` identity changes, which includes
 * every re-emission of the products live query (a sold-out toggle, say),
 * because a fresh IndexedDB read is a fresh Blob. That costs one
 * `createObjectURL` and one `revokeObjectURL` per emission and leaks
 * nothing; it is not per render.
 */
export function useProductImage(
  product: Product,
  files: Record<string, string> = REPO_PRODUCT_IMAGE_FILES,
): ProductImageSource {
  const image = useMemo(() => productImage(product), [product])
  const problem = productImageProblem(product)
  const invalid = useMemo(() => (problem === null ? [] : [product]), [problem, product])
  useLogInvalidOnce(invalid, invalidImageKey, describeInvalidImage)

  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (image === null) {
      setObjectUrl(null)
      return
    }
    let url: string
    try {
      url = URL.createObjectURL(image.blob)
    } catch {
      // No object-URL support (or a blob the browser refused). Fall through
      // to the repo picture rather than failing the tile.
      setObjectUrl(null)
      return
    }
    setObjectUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [image])

  const repoUrl = useMemo(() => {
    const file = repoImageFileName(product.id, files)
    if (file === null) return null
    // `BASE_URL` always ends in `/`, and is `/` unless Vite is configured
    // with a sub-path. The file name came from the generated index, so it
    // needs no escaping beyond the id whitelist `repoImageFileName` applies.
    return `${import.meta.env.BASE_URL}products/${file}`
  }, [product.id, files])

  const candidates = useMemo(() => {
    const list: string[] = []
    if (objectUrl !== null) list.push(objectUrl)
    if (repoUrl !== null) list.push(repoUrl)
    return list
  }, [objectUrl, repoUrl])

  // Kept as a list of URLs rather than an index so it needs no resetting
  // when `candidates` changes: a replaced (and revoked) object URL simply
  // never matches again. Bounded by the number of pictures that have
  // actually failed, which is normally zero.
  const [failedUrls, setFailedUrls] = useState<readonly string[]>([])
  const src = candidates.find((candidate) => !failedUrls.includes(candidate)) ?? null

  return {
    src,
    onError: () => {
      if (src === null) return
      setFailedUrls((previous) => (previous.includes(src) ? previous : [...previous, src]))
    },
  }
}
