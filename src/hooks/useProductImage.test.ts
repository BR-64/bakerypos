import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product, ProductImage } from '../domain/types'
import { useProductImage } from './useProductImage'

function photoBlob(type = 'image/webp'): Blob {
  return new Blob([new Uint8Array(2048)], { type })
}

function photo(blob = photoBlob()): ProductImage {
  return { blob, type: blob.type, width: 512, height: 384 }
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

const shipped = { 'p-brownie-9': 'p-brownie-9.webp' }

// jsdom's object-URL support is not what is under test here, and stubbing
// it is the only way to assert that every URL created is also revoked.
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
let created: Blob[] = []
let revoked: string[] = []
let nextUrl = 0

beforeEach(() => {
  created = []
  revoked = []
  nextUrl = 0
  URL.createObjectURL = (blob: Blob) => {
    created.push(blob)
    nextUrl += 1
    return `blob:photo-${nextUrl}`
  }
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
  }
})

afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.restoreAllMocks()
})

describe('useProductImage', () => {
  it('has no source, and creates no object URL, for a product with no picture', () => {
    const { result } = renderHook(() => useProductImage(brownie, {}))
    expect(result.current.src).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('uses the picture shipped in the repo when the device has no photo', () => {
    const { result } = renderHook(() => useProductImage(brownie, shipped))
    expect(result.current.src).toBe('/products/p-brownie-9.webp')
    expect(created).toHaveLength(0)
  })

  it('prefers the photo stored on the device over the shipped picture', () => {
    const product = { ...brownie, image: photo() }
    const { result } = renderHook(() => useProductImage(product, shipped))
    expect(result.current.src).toBe('blob:photo-1')
    expect(created).toHaveLength(1)
    expect(created[0]).toBe(product.image?.blob)
  })

  // Build the product outside the render callback, as the live query does: a
  // fresh Blob on every render would create a new object URL, set state and
  // render again, forever.
  it('revokes the object URL on unmount', () => {
    const product = { ...brownie, image: photo() }
    const { result, unmount } = renderHook(() => useProductImage(product, {}))
    expect(result.current.src).toBe('blob:photo-1')
    unmount()
    expect(revoked).toEqual(['blob:photo-1'])
  })

  it('revokes the old object URL when the photo is replaced', () => {
    const { result, rerender } = renderHook(
      ({ product }: { product: Product }) => useProductImage(product, {}),
      { initialProps: { product: { ...brownie, image: photo() } } },
    )
    expect(result.current.src).toBe('blob:photo-1')

    rerender({ product: { ...brownie, image: photo(photoBlob('image/jpeg')) } })
    expect(revoked).toEqual(['blob:photo-1'])
    expect(result.current.src).toBe('blob:photo-2')
    expect(created).toHaveLength(2)
  })

  it('revokes the object URL when the photo is removed', () => {
    const { result, rerender } = renderHook(
      ({ product }: { product: Product }) => useProductImage(product, shipped),
      { initialProps: { product: { ...brownie, image: photo() } as Product } },
    )
    expect(result.current.src).toBe('blob:photo-1')

    rerender({ product: brownie })
    expect(revoked).toEqual(['blob:photo-1'])
    expect(result.current.src).toBe('/products/p-brownie-9.webp')
  })

  it('skips a corrupt stored photo, logs it once, and falls back to the shipped picture', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const corrupt = { ...brownie, image: { blob: 'not a blob' } as unknown as ProductImage }
    const { result, rerender } = renderHook(() => useProductImage(corrupt, shipped))

    expect(result.current.src).toBe('/products/p-brownie-9.webp')
    expect(created).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('p-brownie-9')

    rerender()
    rerender()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('falls all the way back to no picture when the photo is corrupt and nothing is shipped', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const corrupt = { ...brownie, image: { width: 1 } as unknown as ProductImage }
    const { result } = renderHook(() => useProductImage(corrupt, {}))
    expect(result.current.src).toBeNull()
  })

  it('says nothing at all about a product that simply has no picture', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useProductImage(brownie, {}))
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('drops to the shipped picture, then to nothing, as each source fails to decode', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const product = { ...brownie, image: photo() }
    const { result } = renderHook(() => useProductImage(product, shipped))
    expect(result.current.src).toBe('blob:photo-1')

    act(() => result.current.onError())
    expect(result.current.src).toBe('/products/p-brownie-9.webp')

    act(() => result.current.onError())
    expect(result.current.src).toBeNull()
    // A decode failure is a normal thing for a browser to report; the grid
    // quietly shows text instead of filling the console.
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('makes no request for an id that could not safely go in a URL', () => {
    const { result } = renderHook(() =>
      useProductImage({ ...brownie, id: '../p-brownie-9' }, { '../p-brownie-9': 'x.webp' }),
    )
    expect(result.current.src).toBeNull()
  })

  it('shows no picture, rather than failing, when object URLs are unavailable', () => {
    URL.createObjectURL = () => {
      throw new Error('not supported')
    }
    const product = { ...brownie, image: photo() }
    const { result } = renderHook(() => useProductImage(product, shipped))
    expect(result.current.src).toBe('/products/p-brownie-9.webp')
  })
})
