import { describe, expect, it } from 'vitest'
import {
  fitWithin,
  imageProblem,
  isProductImage,
  isSafeImageId,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  productImage,
  productImageProblem,
  repoImageFileName,
  repoImageId,
} from './productImage'
import type { Product, ProductImage } from './types'

function blobOf(bytes: number, type = 'image/webp'): Blob {
  return new Blob([new Uint8Array(bytes)], { type })
}

function image(overrides: Partial<ProductImage> = {}): ProductImage {
  return { blob: blobOf(1024), type: 'image/webp', width: 512, height: 384, ...overrides }
}

const brownie: Product = {
  id: 'p-brownie-9',
  name: 'Brownie 9 cubes',
  price: 30000,
  category: 'brownies',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

describe('imageProblem', () => {
  it('accepts a picture produced by the resizer', () => {
    expect(imageProblem(image())).toBeNull()
    expect(isProductImage(image())).toBe(true)
  })

  it('accepts a JPEG, for a phone with no WebP encoder', () => {
    expect(imageProblem(image({ blob: blobOf(1024, 'image/jpeg'), type: 'image/jpeg' }))).toBeNull()
  })

  it('rejects a non-object, without throwing', () => {
    for (const value of [null, undefined, 'blob:x', 42, []]) {
      expect(() => imageProblem(value)).not.toThrow()
      expect(imageProblem(value)).not.toBeNull()
    }
  })

  it('rejects something that merely looks like a blob', () => {
    expect(
      imageProblem({
        blob: { size: 10, type: 'image/webp' },
        type: 'image/webp',
        width: 1,
        height: 1,
      }),
    ).toBe('has no image data')
  })

  it('rejects an empty blob', () => {
    expect(imageProblem(image({ blob: blobOf(0) }))).toBe('has empty image data')
  })

  it('rejects a blob over the hard cap', () => {
    const problem = imageProblem(image({ blob: blobOf(MAX_IMAGE_BYTES + 1) }))
    expect(problem).toContain('larger than')
  })

  it('accepts a blob exactly at the cap', () => {
    expect(imageProblem(image({ blob: blobOf(MAX_IMAGE_BYTES) }))).toBeNull()
  })

  it('rejects a type we would not hand to an <img>', () => {
    expect(imageProblem(image({ blob: blobOf(10, 'image/svg+xml'), type: 'image/svg+xml' }))).toBe(
      'has an unsupported image type',
    )
  })

  it('rejects a declared type that has drifted from the blob', () => {
    expect(imageProblem(image({ blob: blobOf(10, 'image/jpeg'), type: 'image/webp' }))).toBe(
      'has an image type that does not match its data',
    )
  })

  it('rejects dimensions that are missing, zero, fractional or beyond the long edge', () => {
    expect(imageProblem(image({ width: undefined as unknown as number }))).toBe(
      'has an unusable width',
    )
    expect(imageProblem(image({ width: 0 }))).toBe('has an unusable width')
    expect(imageProblem(image({ width: 12.5 }))).toBe('has an unusable width')
    expect(imageProblem(image({ width: MAX_IMAGE_EDGE + 1 }))).toBe('has an unusable width')
    expect(imageProblem(image({ height: -1 }))).toBe('has an unusable height')
    expect(imageProblem(image({ height: Number.NaN }))).toBe('has an unusable height')
  })
})

describe('productImage', () => {
  it('is null for a product with no picture, and that is not a problem to log', () => {
    expect(productImage(brownie)).toBeNull()
    expect(productImageProblem(brownie)).toBeNull()
  })

  it('returns the stored picture when it is usable', () => {
    const stored = image()
    expect(productImage({ ...brownie, image: stored })).toBe(stored)
  })

  it('is null for a corrupt picture, and reports the problem for logging', () => {
    const corrupt = { ...brownie, image: { blob: 'not a blob' } as unknown as ProductImage }
    expect(productImage(corrupt)).toBeNull()
    expect(productImageProblem(corrupt)).toBe('has no image data')
  })

  it('never throws on a product whose image is hostile data', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const hostile = { ...brownie, image: circular as unknown as ProductImage }
    expect(() => productImage(hostile)).not.toThrow()
    expect(productImage(hostile)).toBeNull()
  })
})

describe('fitWithin', () => {
  it('caps the long edge and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 512)).toEqual({ width: 512, height: 384 })
    expect(fitWithin(3024, 4032, 512)).toEqual({ width: 384, height: 512 })
  })

  it('never upscales a picture that is already small', () => {
    expect(fitWithin(200, 150, 512)).toEqual({ width: 200, height: 150 })
  })

  it('leaves a picture exactly at the edge alone', () => {
    expect(fitWithin(512, 512, 512)).toEqual({ width: 512, height: 512 })
  })

  it('never rounds an extreme panorama down to a zero-height canvas', () => {
    expect(fitWithin(8000, 10, 512)).toEqual({ width: 512, height: 1 })
  })

  it('defaults to the long edge we store at', () => {
    expect(fitWithin(4000, 2000)).toEqual({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE / 2 })
  })

  it('is null for a source with no usable size', () => {
    expect(fitWithin(0, 100, 512)).toBeNull()
    expect(fitWithin(Number.NaN, 100, 512)).toBeNull()
    expect(fitWithin(Infinity, 100, 512)).toBeNull()
    expect(fitWithin('512' as unknown as number, 100, 512)).toBeNull()
  })
})

describe('isSafeImageId', () => {
  it('accepts the ids the app actually generates', () => {
    expect(isSafeImageId('p-brownie-9')).toBe(true)
    expect(isSafeImageId('0b6e6d3e-6b2a-4f3e-8a1e-5f6c7d8e9a0b')).toBe(true)
  })

  it('refuses anything that would not be safe in a URL path', () => {
    for (const id of ['', '../secret', 'a/b', 'a?b', 'a b', 'ขนม', 'x'.repeat(129), 42, null]) {
      expect(isSafeImageId(id)).toBe(false)
    }
  })
})

describe('repoImageFileName', () => {
  const files = { 'p-brownie-9': 'p-brownie-9.webp' }

  it('finds the shipped picture for a product', () => {
    expect(repoImageFileName('p-brownie-9', files)).toBe('p-brownie-9.webp')
  })

  it('is null when the repo ships none — the normal state, with no request made', () => {
    expect(repoImageFileName('p-cake-jar', files)).toBeNull()
    expect(repoImageFileName('p-cake-jar', {})).toBeNull()
  })

  it('is null for an id that could not go in a URL', () => {
    expect(repoImageFileName('../p-brownie-9', files)).toBeNull()
    expect(repoImageFileName(undefined, files)).toBeNull()
  })

  it('refuses an index entry whose file name is not this id, however it got there', () => {
    expect(repoImageFileName('p-brownie-9', { 'p-brownie-9': '../../secrets.json' })).toBeNull()
    expect(repoImageFileName('p-brownie-9', { 'p-brownie-9': 'p-cake-jar.webp' })).toBeNull()
    expect(repoImageFileName('p-brownie-9', { 'p-brownie-9': 'p-brownie-9.svg' })).toBeNull()
  })

  it('ignores inherited object properties, so no id resolves by accident', () => {
    expect(repoImageFileName('constructor', files)).toBeNull()
    expect(repoImageFileName('toString', files)).toBeNull()
  })
})

describe('repoImageId', () => {
  it('reads the product id off each accepted extension', () => {
    expect(repoImageId('p-brownie-9.webp')).toBe('p-brownie-9')
    expect(repoImageId('p-brownie-9.JPG')).toBe('p-brownie-9')
    expect(repoImageId('p-cake-jar.jpeg')).toBe('p-cake-jar')
    expect(repoImageId('p-cake-jar.png')).toBe('p-cake-jar')
  })

  it('refuses anything else in the folder', () => {
    expect(repoImageId('README.md')).toBeNull()
    expect(repoImageId('p-brownie-9.svg')).toBeNull()
    expect(repoImageId('.webp')).toBeNull()
    expect(repoImageId('no-extension')).toBeNull()
    expect(repoImageId('a b.webp')).toBeNull()
  })
})
