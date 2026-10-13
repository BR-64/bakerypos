import { useId, useState } from 'react'
import { clearProductImage, setProductImage } from '../db/products'
import { db, type PosDatabase } from '../db/db'
import { safeString } from '../domain/log'
import type { Product } from '../domain/types'
import { useProductImage } from '../hooks/useProductImage'
import { resizeImageFile, type ImageCodec } from '../images/resizeImage'

export interface ProductImageFieldProps {
  product: Product
  database?: PosDatabase
  /** Swapped out in tests; the real one needs a canvas 2D context. */
  codec?: ImageCodec
}

/**
 * Admin's picture control for one product: add a photo, replace it, or
 * remove it.
 *
 * The file input accepts `image/*` with **no `capture` attribute** on
 * purpose. `capture="environment"` would jump straight to the camera and
 * take the gallery away; without it both Android and iOS offer the chooser
 * ("Camera" / "Photo Library" / "Files"), which is what someone
 * photographing a tray of brownies at the counter *and* someone picking a
 * shot taken earlier both need.
 *
 * The photo is downscaled and re-encoded before it is stored
 * (`resizeImageFile`) — a 3–5 MB camera file never reaches IndexedDB, and
 * going through a canvas is also what drops the EXIF, including the GPS
 * tag a phone writes by default.
 *
 * Nothing here is on the checkout path, but a failure still has to be
 * readable rather than thrown: every refusal comes back as a sentence in a
 * `role="alert"`.
 */
export function ProductImageField({ product, database = db, codec }: ProductImageFieldProps) {
  const picture = useProductImage(product)
  const inputId = useId()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasOwnPhoto = product.image !== undefined

  async function choose(file: File | undefined): Promise<void> {
    setError(null)
    if (file === undefined) return
    setBusy(true)
    try {
      // Passing `undefined` falls through to `resizeImageFile`'s own
      // default (`domImageCodec`).
      const result = await resizeImageFile(file, codec)
      if (!result.ok) {
        setError(result.error)
        return
      }
      await setProductImage(product.id, result.image, database)
    } catch (thrown) {
      const text = thrown instanceof Error ? thrown.message : safeString(thrown)
      console.error(`ProductImageField: couldn't save the picture for ${product.id} — ${text}`)
      setError(text.length > 0 ? text : "Couldn't save that picture.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      await clearProductImage(product.id, database)
    } catch (thrown) {
      const text = thrown instanceof Error ? thrown.message : safeString(thrown)
      console.error(`ProductImageField: couldn't remove the picture for ${product.id} — ${text}`)
      setError(text.length > 0 ? text : "Couldn't remove that picture.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-image-field">
      {picture.src !== null && (
        <span className="admin-image-thumb">
          <img
            className="admin-image-preview"
            src={picture.src}
            alt=""
            decoding="async"
            onError={picture.onError}
          />
        </span>
      )}

      <div className="admin-image-actions">
        {/* A label, not a button: tapping the label opens the OS picker,
            and the input itself is off-screen rather than `display: none`
            so it stays focusable with a keyboard. The label is sized like
            every other button here, so the tap target is still 48px. */}
        <label className="admin-secondary-button admin-image-button" htmlFor={inputId}>
          {hasOwnPhoto ? `Replace photo for ${product.name}` : `Add photo for ${product.name}`}
        </label>
        <input
          id={inputId}
          type="file"
          className="admin-image-input"
          accept="image/*"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so picking the same file twice fires `change` again.
            event.target.value = ''
            void choose(file)
          }}
        />
        {hasOwnPhoto && (
          <button
            type="button"
            className="admin-secondary-button"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove photo from {product.name}
          </button>
        )}
      </div>

      {busy && <p className="admin-message muted">Shrinking the photo…</p>}

      {error !== null && (
        <p className="checkout-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
