import {
  fitWithin,
  imageProblem,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  MAX_SOURCE_IMAGE_BYTES,
} from '../domain/productImage'
import type { ProductImage } from '../domain/types'

/**
 * Turning the file a phone's camera or gallery hands us into something we
 * are willing to put in IndexedDB.
 *
 * This is the only place a picture is created. A raw phone photo is 3–5 MB
 * of JPEG with EXIF (including, by default on both iOS and Android, the
 * GPS coordinates of the bakery's counter); what gets stored is a
 * downscaled, re-encoded copy with its long edge at `MAX_IMAGE_EDGE` and
 * no metadata at all — **because it went through a canvas**, which carries
 * pixels and nothing else. Stripping EXIF is a side effect of the resize
 * here, not a separate step that could be forgotten.
 *
 * Nothing here throws: every failure comes back as `{ ok: false, error }`
 * with a sentence the owner can act on.
 *
 * Deliberately no new dependency — `createImageBitmap`, `<canvas>` and
 * `toBlob` are built in. The DOM calls are behind `ImageCodec` so the
 * ladder below can be tested without a real canvas (jsdom has no 2D
 * context), and so an old iOS Safari with no `createImageBitmap` has
 * somewhere to fall back to.
 */

/** A decoded source, ready to draw. `release` frees the bitmap/object URL. */
export interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

export interface ImageCodec {
  /** Decode `file`, honouring EXIF orientation. Rejects if it isn't an image. */
  decode: (file: Blob) => Promise<DecodedImage>
  /**
   * Draw `image` scaled to `width`x`height` and re-encode as `type`.
   * Resolves `null` when this browser cannot encode at all; a browser that
   * cannot encode *this type* resolves a blob of some other type, which
   * `resizeImageFile` detects by reading `blob.type`.
   */
  encode: (
    image: DecodedImage,
    width: number,
    height: number,
    type: string,
    quality: number,
  ) => Promise<Blob | null>
}

export type ResizeResult = { ok: true; image: ProductImage } | { ok: false; error: string }

/**
 * Long edge and WebP quality to try, in order; the first encode that comes
 * out at or under `MAX_IMAGE_BYTES` wins.
 *
 * In practice step 1 always wins: a 512px-long-edge WebP of a cake at
 * q=0.82 is 25–70 KB, well under the 200 KB cap and under the 120 KB
 * target. The rest of the ladder exists for the pathological photo — fine
 * noise over the whole frame, which is what defeats a lossy encoder — and
 * the last step gives up some size rather than some more quality, because
 * a slightly smaller picture reads better on a tile than a blocky one.
 */
const LADDER: readonly { edge: number; quality: number }[] = [
  { edge: MAX_IMAGE_EDGE, quality: 0.82 },
  { edge: MAX_IMAGE_EDGE, quality: 0.65 },
  { edge: MAX_IMAGE_EDGE, quality: 0.5 },
  { edge: 384, quality: 0.6 },
]

const WEBP = 'image/webp'
const JPEG = 'image/jpeg'

function failed(error: string): ResizeResult {
  return { ok: false, error }
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be decoded'))
    image.src = url
  })
}

/** The real browser codec. Replaced wholesale in tests. */
export const domImageCodec: ImageCodec = {
  async decode(file) {
    if (typeof createImageBitmap === 'function') {
      // `from-image` so a photo taken in portrait isn't stored on its
      // side: the orientation is applied to the pixels here, and the EXIF
      // tag that described it is dropped with the rest of the metadata.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    }
    // iOS Safari before 15 has no `createImageBitmap`. An <img> applies
    // EXIF orientation itself (`image-orientation: from-image` is the CSS
    // default), so the drawn pixels come out the same way up.
    const url = URL.createObjectURL(file)
    try {
      const element = await loadImage(url)
      return {
        source: element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      }
    } catch (thrown) {
      URL.revokeObjectURL(url)
      throw thrown
    }
  },

  encode(image, width, height, type, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null || typeof canvas.toBlob !== 'function') return Promise.resolve(null)
    context.drawImage(image.source, 0, 0, width, height)
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality)
    })
  },
}

/**
 * Downscale and re-encode `file` into a `ProductImage`, or explain why not.
 *
 * Checks the file's size *before* decoding it: a 60 MB image decodes to
 * hundreds of MB of bitmap, and that kill isn't catchable.
 *
 * The output type is decided once, on the first encode: WebP where the
 * canvas can produce it, JPEG otherwise (a canvas with no WebP encoder —
 * Safari before 14 — quietly hands back a PNG instead of failing, so the
 * blob's own `type` is what is trusted, never the type we asked for).
 */
export async function resizeImageFile(
  file: Blob,
  codec: ImageCodec = domImageCodec,
): Promise<ResizeResult> {
  if (typeof Blob === 'undefined' || !(file instanceof Blob)) {
    return failed('That file could not be read. Try choosing it again.')
  }
  if (file.size === 0) return failed('That file is empty.')
  if (typeof file.type === 'string' && file.type.length > 0 && !file.type.startsWith('image/')) {
    return failed('That file is not a picture. Choose a photo instead.')
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    const limit = Math.round(MAX_SOURCE_IMAGE_BYTES / (1024 * 1024))
    return failed(`That picture is over ${limit} MB, which is too big to open. Take a new photo.`)
  }

  let decoded: DecodedImage
  try {
    decoded = await codec.decode(file)
  } catch {
    return failed("That picture couldn't be opened. Try a different photo.")
  }

  try {
    let type = WEBP
    let settled = false
    let smallest = Infinity

    for (const step of LADDER) {
      const size = fitWithin(decoded.width, decoded.height, step.edge)
      if (size === null) return failed('That picture has no usable size. Try a different photo.')

      let blob: Blob | null
      try {
        blob = await codec.encode(decoded, size.width, size.height, type, step.quality)
        if (!settled) {
          settled = true
          if (blob === null || blob.type !== type) {
            type = JPEG
            blob = await codec.encode(decoded, size.width, size.height, type, step.quality)
          }
        }
      } catch {
        return failed("This phone couldn't save that picture. Try a different photo.")
      }

      if (blob === null || blob.size === 0 || blob.type !== type) {
        return failed("This phone couldn't save that picture. Try a different photo.")
      }

      smallest = Math.min(smallest, blob.size)
      if (blob.size <= MAX_IMAGE_BYTES) {
        const image: ProductImage = {
          blob,
          type,
          width: size.width,
          height: size.height,
        }
        // Never write something our own reader would then refuse: the
        // tile's guard and this writer agree by construction, not by
        // assumption.
        const problem = imageProblem(image)
        if (problem !== null) {
          return failed("This phone couldn't save that picture. Try a different photo.")
        }
        return { ok: true, image }
      }
    }

    return failed(
      `That picture is still ${kb(smallest)} after shrinking, over the ${kb(MAX_IMAGE_BYTES)} limit. Try a simpler, less detailed photo.`,
    )
  } finally {
    try {
      decoded.release()
    } catch {
      // Freeing a bitmap must never be the thing that fails an upload.
    }
  }
}
