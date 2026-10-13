import { describe, expect, it } from 'vitest'
import {
  isProductImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  MAX_SOURCE_IMAGE_BYTES,
} from '../domain/productImage'
import { resizeImageFile, type DecodedImage, type ImageCodec } from './resizeImage'

interface EncodeCall {
  width: number
  height: number
  type: string
  quality: number
}

interface CodecConfig {
  width?: number
  height?: number
  /** Bytes the encoder "produces" for a given attempt. Default: 40 KB. */
  bytes?: (call: EncodeCall) => number
  /** What the canvas actually hands back for a requested type. Default: the same type. */
  produces?: (requested: string) => string
  /** Make `encode` resolve `null`, as a canvas with no 2D context does. */
  encodeNull?: boolean
  /** Make `decode` reject, as a file that isn't really an image does. */
  decodeFails?: boolean
}

/**
 * A stand-in for the browser codec. jsdom has no 2D canvas context and no
 * `createImageBitmap`, so this is what makes the quality ladder, the WebP
 * fallback and the size cap testable at all. The DOM half of
 * `resizeImage.ts` (`domImageCodec`) is deliberately thin for the same
 * reason.
 */
function makeCodec(config: CodecConfig = {}) {
  const calls: EncodeCall[] = []
  const state = { released: 0 }
  const codec: ImageCodec = {
    decode: async (): Promise<DecodedImage> => {
      if (config.decodeFails === true) throw new Error('not an image')
      return {
        source: {} as unknown as CanvasImageSource,
        width: config.width ?? 4032,
        height: config.height ?? 3024,
        release: () => {
          state.released += 1
        },
      }
    },
    encode: async (_image, width, height, type, quality) => {
      const call = { width, height, type, quality }
      calls.push(call)
      if (config.encodeNull === true) return null
      const produced = config.produces === undefined ? type : config.produces(type)
      const bytes = config.bytes === undefined ? 40 * 1024 : config.bytes(call)
      return new Blob([new Uint8Array(bytes)], { type: produced })
    },
  }
  return { codec, calls, state }
}

function photo(bytes = 4 * 1024 * 1024, type = 'image/jpeg'): Blob {
  const blob = new Blob([new Uint8Array(1)], { type })
  // Faking the size keeps the test from allocating megabytes just to check
  // a limit that is about allocation.
  Object.defineProperty(blob, 'size', { value: bytes })
  return blob
}

describe('resizeImageFile', () => {
  it('shrinks a phone photo to the long edge and stores it as WebP', async () => {
    const { codec, calls, state } = makeCodec()
    const result = await resizeImageFile(photo(), codec)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.width).toBe(MAX_IMAGE_EDGE)
    expect(result.image.height).toBe(384)
    expect(result.image.type).toBe('image/webp')
    expect(result.image.blob.type).toBe('image/webp')
    // One encode is the normal case: the first quality already fits.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ width: 512, height: 384, type: 'image/webp' })
    // The decoded source is always freed.
    expect(state.released).toBe(1)
  })

  it('produces a picture its own reader accepts', async () => {
    const { codec } = makeCodec()
    const result = await resizeImageFile(photo(), codec)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isProductImage(result.image)).toBe(true)
    expect(result.image.blob.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
  })

  it('does not upscale a small picture out of the gallery', async () => {
    const { codec, calls } = makeCodec({ width: 200, height: 150 })
    const result = await resizeImageFile(photo(80 * 1024), codec)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.width).toBe(200)
    expect(result.image.height).toBe(150)
    expect(calls[0]).toMatchObject({ width: 200, height: 150 })
  })

  it('falls back to JPEG on a canvas with no WebP encoder', async () => {
    // Safari before 14 quietly hands back a PNG for an unsupported type
    // rather than failing, so the blob's own type is what is trusted.
    const { codec, calls } = makeCodec({
      produces: (requested) => (requested === 'image/webp' ? 'image/png' : requested),
    })
    const result = await resizeImageFile(photo(), codec)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.type).toBe('image/jpeg')
    expect(result.image.blob.type).toBe('image/jpeg')
    expect(calls.map((call) => call.type)).toEqual(['image/webp', 'image/jpeg'])
  })

  it('drops down the quality ladder until the picture fits under the cap', async () => {
    const { codec, calls } = makeCodec({
      bytes: (call) => (call.quality >= 0.65 ? MAX_IMAGE_BYTES + 1 : 150 * 1024),
    })
    const result = await resizeImageFile(photo(), codec)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.blob.size).toBe(150 * 1024)
    expect(calls).toHaveLength(3)
    expect(calls.map((call) => call.quality)).toEqual([0.82, 0.65, 0.5])
    // Still the full long edge — only the quality was given up.
    expect(result.image.width).toBe(512)
  })

  it('shrinks the long edge as a last resort before giving up', async () => {
    const { codec, calls } = makeCodec({
      bytes: (call) => (call.width === 512 ? MAX_IMAGE_BYTES + 1 : 90 * 1024),
    })
    const result = await resizeImageFile(photo(), codec)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.image.width).toBe(384)
    expect(calls[calls.length - 1]).toMatchObject({ width: 384 })
  })

  it('rejects a picture that is still over the cap after the whole ladder', async () => {
    const { codec, calls } = makeCodec({ bytes: () => 260 * 1024 })
    const result = await resizeImageFile(photo(), codec)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('260 KB')
    expect(result.error).toContain('200 KB')
    expect(calls).toHaveLength(4)
  })

  it('rejects a file bigger than we are willing to decode, before decoding it', async () => {
    const { codec, calls } = makeCodec()
    const result = await resizeImageFile(photo(MAX_SOURCE_IMAGE_BYTES + 1), codec)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('24 MB')
    // Never decoded, which is the point: that allocation is not catchable.
    expect(calls).toHaveLength(0)
  })

  it('rejects a file that is not a picture at all', async () => {
    const { codec } = makeCodec()
    const result = await resizeImageFile(photo(2048, 'application/pdf'), codec)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not a picture')
  })

  it('rejects an empty file', async () => {
    const { codec } = makeCodec()
    const result = await resizeImageFile(new Blob([], { type: 'image/jpeg' }), codec)
    expect(result.ok).toBe(false)
  })

  it('rejects something that is not a file, without throwing', async () => {
    const { codec } = makeCodec()
    const result = await resizeImageFile('photo.jpg' as unknown as Blob, codec)
    expect(result.ok).toBe(false)
  })

  it('explains a file that cannot be decoded instead of throwing', async () => {
    const { codec } = makeCodec({ decodeFails: true })
    const result = await resizeImageFile(photo(), codec)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("couldn't be opened")
  })

  it('explains a canvas that cannot encode, and still frees the source', async () => {
    const { codec, state } = makeCodec({ encodeNull: true })
    const result = await resizeImageFile(photo(), codec)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("couldn't save")
    expect(state.released).toBe(1)
  })

  it('refuses a source with no usable size rather than encoding a 0-pixel canvas', async () => {
    const { codec, calls } = makeCodec({ width: 0, height: 0 })
    const result = await resizeImageFile(photo(), codec)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
