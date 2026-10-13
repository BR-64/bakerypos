import type { Product, ProductImage } from './types'

/**
 * Rules about product pictures. Pure — no React, no Dexie, no canvas (the
 * canvas work lives in `src/images/resizeImage.ts`).
 *
 * The one rule that outranks every other here: **a picture is decoration.**
 * A missing, corrupt or oversized image must never stop a product being
 * sold, so `isSellable` (`src/domain/cart.ts`) deliberately does not look
 * at `image` at all, and nothing in this file throws. A bad image means
 * "no picture", never "no tile".
 */

/**
 * Longest edge we store, in pixels. Two columns on a 430px-wide phone at
 * DPR 3 gives a tile picture about 600px of device pixels, so 512 is
 * slightly soft at the very top end and indistinguishable in practice —
 * and it is what keeps a photo under `MAX_IMAGE_BYTES`.
 */
export const MAX_IMAGE_EDGE = 512

/**
 * Hard cap on a stored picture. Anything above this is refused with a
 * message rather than written: eleven products at 200 KB is 2.2 MB, which
 * a phone's IndexedDB quota swallows without noticing, while the 3–5 MB
 * straight off a phone camera, times eleven, would not.
 */
export const MAX_IMAGE_BYTES = 200 * 1024

/**
 * What a re-encode aims for. Lower than the cap so the usual case has
 * headroom and only a genuinely pathological photo needs the quality
 * ladder in `resizeImageFile`.
 */
export const TARGET_IMAGE_BYTES = 120 * 1024

/**
 * Biggest file we will even try to decode. A 3–5 MB phone photo is the
 * normal case; a 60 MB scan is someone picking the wrong file, and
 * decoding it is an out-of-memory kill no `try`/`catch` of ours can catch
 * (same reasoning as `MAX_IMPORT_BYTES` in `src/domain/backup.ts`).
 */
export const MAX_SOURCE_IMAGE_BYTES = 24 * 1024 * 1024

/** What we are willing to store. `image/png` is accepted but never produced. */
export const STORED_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const

/** Extensions a repo picture may use, best first. */
export const REPO_IMAGE_EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png'] as const

/**
 * What's wrong with `value` as a stored picture, or `null` if nothing is.
 *
 * Every field is checked without touching the blob's contents, so this is
 * synchronous and safe to call during a render on the checkout path:
 *
 * - a real `Blob` (not an `ArrayBuffer`, not a string, not a plain object a
 *   hand-edited record might hold)
 * - a non-empty blob no larger than `MAX_IMAGE_BYTES`
 * - a `type` we are willing to hand to an `<img>`, matching the blob's own
 *   `type` — a mismatch means the record was assembled by something that
 *   isn't `resizeImageFile`, and is not trusted
 * - `width`/`height` safe integers in `1..MAX_IMAGE_EDGE`, with at least
 *   one of them actually at the long-edge scale we store
 */
export function imageProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'is not an object'
  const { blob, type, width, height } = value as Record<string, unknown>
  if (typeof Blob === 'undefined' || !(blob instanceof Blob)) return 'has no image data'
  if (blob.size === 0) return 'has empty image data'
  if (blob.size > MAX_IMAGE_BYTES) return `is larger than ${MAX_IMAGE_BYTES} bytes`
  if (typeof type !== 'string' || !(STORED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return 'has an unsupported image type'
  }
  // A Blob always reports a type (`''` when it was created without one),
  // so this catches a record whose declared type has drifted from its data.
  if (blob.type !== type) return 'has an image type that does not match its data'
  if (!Number.isSafeInteger(width) || (width as number) < 1 || (width as number) > MAX_IMAGE_EDGE) {
    return 'has an unusable width'
  }
  if (
    !Number.isSafeInteger(height) ||
    (height as number) < 1 ||
    (height as number) > MAX_IMAGE_EDGE
  ) {
    return 'has an unusable height'
  }
  return null
}

/** Whether `value` is a picture we are willing to show. */
export function isProductImage(value: unknown): value is ProductImage {
  return imageProblem(value) === null
}

/**
 * `product.image` when it is usable, otherwise `null`. An absent image and
 * a corrupt one both return `null` — the difference is only that the
 * corrupt one has an `imageProblem` for the caller to log once.
 */
export function productImage(product: Product): ProductImage | null {
  const image: unknown = product.image
  if (image === undefined) return null
  return isProductImage(image) ? image : null
}

/**
 * The `imageProblem` of a product's own image, or `null` when there is
 * nothing to complain about (including when there is no image at all —
 * "no picture" is the normal state, not a fault to log).
 */
export function productImageProblem(product: Product): string | null {
  const image: unknown = product.image
  if (image === undefined) return null
  return imageProblem(image)
}

/**
 * The size a `width`x`height` picture should be stored at, with its long
 * edge capped at `edge`. `null` when the source has no usable size.
 *
 * Never upscales — a 200px picture someone picks out of their gallery
 * stays 200px rather than being blown up to 512 and re-encoded into
 * something larger and blurrier than the original. The aspect ratio is
 * kept, and both edges are rounded up to at least 1 so a very wide, very
 * short panorama can't end up 512x0 (a canvas of height 0 encodes to
 * nothing).
 */
export function fitWithin(
  width: unknown,
  height: unknown,
  edge: number = MAX_IMAGE_EDGE,
): { width: number; height: number } | null {
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < 1 || height < 1) return null
  const longest = Math.max(width, height)
  const scale = longest > edge ? edge / longest : 1
  return {
    width: Math.max(1, Math.min(edge, Math.round(width * scale))),
    height: Math.max(1, Math.min(edge, Math.round(height * scale))),
  }
}

/**
 * Whether `id` is safe to put straight into a URL path segment. Product
 * ids are UUIDs or hand-written slugs like `p-brownie-9`, so this is a
 * whitelist rather than an escape: an id with a `/`, a `?` or a `..` in it
 * (which only a hand-edited record could have) gets no repo picture at
 * all, instead of a request for a path we didn't mean to build.
 */
export function isSafeImageId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id)
}

/**
 * The file name of the repo picture for `id`, or `null` if the repo ships
 * none.
 *
 * `files` is the build-time index of `public/products/`
 * (`src/images/repoImages.ts`), so this is a lookup, never a request: a
 * product with no shipped picture causes no fetch, which matters because
 * the Sell grid is the checkout path and a 404 per tile per paint — or a
 * failed fetch per tile in airplane mode — is exactly what "no network
 * call on the checkout path" is there to prevent.
 *
 * The name that comes back out of the index is re-checked with
 * `repoImageId`, and has to be the name for this exact id. The index is a
 * generated file, but it is still a file: an entry someone hand-edited to
 * `"p-brownie-9": "../../secrets.json"` resolves to no picture rather than
 * to a URL we never meant to build.
 */
export function repoImageFileName(id: unknown, files: Record<string, string>): string | null {
  if (!isSafeImageId(id)) return null
  const file = files[id]
  if (typeof file !== 'string' || file.length === 0) return null
  return repoImageId(file) === id ? file : null
}

/**
 * Product id a repo picture's file name is for, or `null` if the name
 * isn't one we would ever serve — the single written-down form of the
 * naming convention in `public/products/README.md`, which
 * `scripts/generate-product-images.mjs` reimplements (it is plain Node,
 * with no TypeScript loader) and which `repoImageFileName` enforces on
 * whatever that script wrote.
 */
export function repoImageId(fileName: unknown): string | null {
  if (typeof fileName !== 'string') return null
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = fileName.slice(dot + 1).toLowerCase()
  if (!(REPO_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return null
  const id = fileName.slice(0, dot)
  return isSafeImageId(id) ? id : null
}
