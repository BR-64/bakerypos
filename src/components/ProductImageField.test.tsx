import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import type { Product, ProductImage } from '../domain/types'
import type { DecodedImage, ImageCodec } from '../images/resizeImage'
import { ProductImageField } from './ProductImageField'

let database: PosDatabase

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'cookies',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

function photo(bytes = 2048): ProductImage {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/webp' })
  return { blob, type: 'image/webp', width: 512, height: 384 }
}

/** jsdom has no 2D canvas context, so the codec is injected. */
function codecProducing(bytes: number): ImageCodec {
  return {
    decode: async (): Promise<DecodedImage> => ({
      source: {} as unknown as CanvasImageSource,
      width: 4032,
      height: 3024,
      release: () => {},
    }),
    encode: async (_image, _width, _height, type) => new Blob([new Uint8Array(bytes)], { type }),
  }
}

function cameraFile(): File {
  const file = new File([new Uint8Array(16)], 'cake.jpg', { type: 'image/jpeg' })
  // A real phone photo, without allocating one.
  Object.defineProperty(file, 'size', { value: 4 * 1024 * 1024 })
  return file
}

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
  await database.products.add(croissant)
  URL.createObjectURL = () => 'blob:admin-photo'
  URL.revokeObjectURL = () => {}
})

afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.restoreAllMocks()
})

describe('ProductImageField', () => {
  it('offers to add a photo, naming the product, and nothing to remove', () => {
    render(<ProductImageField product={croissant} database={database} />)

    expect(screen.getByLabelText('Add photo for Croissant')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove photo/ })).not.toBeInTheDocument()
  })

  it('takes a camera capture or a gallery pick, not one or the other', () => {
    render(<ProductImageField product={croissant} database={database} />)
    const input = screen.getByLabelText('Add photo for Croissant')

    expect(input).toHaveAttribute('accept', 'image/*')
    // No `capture`: that would jump straight to the camera and take the
    // photo library away.
    expect(input).not.toHaveAttribute('capture')
  })

  it('shrinks the chosen photo and stores it on this phone', async () => {
    render(
      <ProductImageField
        product={croissant}
        database={database}
        codec={codecProducing(60 * 1024)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Add photo for Croissant'), {
      target: { files: [cameraFile()] },
    })

    await waitFor(async () => {
      expect((await database.products.get('p-croissant'))?.image).toBeDefined()
    })
    const stored = (await database.products.get('p-croissant'))?.image
    // The 4 MB camera file is not what was stored.
    expect(stored?.blob.size).toBe(60 * 1024)
    expect(stored?.type).toBe('image/webp')
    expect(stored?.width).toBe(512)
    expect(stored?.height).toBe(384)
  })

  it('explains a photo that cannot be shrunk far enough, and stores nothing', async () => {
    render(
      <ProductImageField
        product={croissant}
        database={database}
        codec={codecProducing(400 * 1024)}
      />,
    )

    fireEvent.change(screen.getByLabelText('Add photo for Croissant'), {
      target: { files: [cameraFile()] },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('400 KB')
    expect((await database.products.get('p-croissant'))?.image).toBeUndefined()
  })

  it('explains a file that is not a picture, and stores nothing', async () => {
    render(<ProductImageField product={croissant} database={database} codec={codecProducing(10)} />)

    const notAPicture = new File([new Uint8Array(16)], 'menu.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Add photo for Croissant'), {
      target: { files: [notAPicture] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('not a picture')
    expect((await database.products.get('p-croissant'))?.image).toBeUndefined()
  })

  it('offers replace and remove once there is a photo, and shows it', async () => {
    const withPhoto = { ...croissant, image: photo() }
    await database.products.update('p-croissant', { image: withPhoto.image })
    const { container } = render(<ProductImageField product={withPhoto} database={database} />)

    expect(screen.getByLabelText('Replace photo for Croissant')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:admin-photo')

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo from Croissant' }))

    await waitFor(async () => {
      expect((await database.products.get('p-croissant'))?.image).toBeUndefined()
    })
    // The product itself is untouched — a photo is never a delete.
    expect((await database.products.get('p-croissant'))?.price).toBe(5500)
  })

  it('shows no picture and no error for a product that simply has none', () => {
    const { container } = render(<ProductImageField product={croissant} database={database} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a failed write instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const missing = { ...croissant, id: 'p-gone' }
    render(
      <ProductImageField product={missing} database={database} codec={codecProducing(10 * 1024)} />,
    )

    fireEvent.change(screen.getByLabelText('Add photo for Croissant'), {
      target: { files: [cameraFile()] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists')
  })
})
