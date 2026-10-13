/**
 * Regenerate `src/images/repoImages.ts` from the contents of
 * `public/products/`.
 *
 *     node scripts/generate-product-images.mjs      (or: npm run product-images)
 *
 * `npm run dev` and `npm run build` run this first (`predev` / `prebuild`),
 * so dropping a `p-cake-jar.webp` into `public/products/` is all anyone
 * ever has to do — there is no step to forget.
 *
 * Why a generated index rather than letting the app guess the URL: see the
 * comment at the top of the file this writes. Short version: a guessed URL
 * is a request per pictureless tile on the checkout path, and this is a
 * lookup.
 *
 * Only `node:fs` and `node:path` are used, both built in. The file is
 * rewritten only when its contents actually change, so running this on
 * every `npm run dev` doesn't churn the working tree.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PICTURES_DIR = join(root, 'public', 'products')
const OUT_PATH = join(root, 'src', 'images', 'repoImages.ts')

/**
 * Kept in step with `REPO_IMAGE_EXTENSIONS` / `isSafeImageId` in
 * `src/domain/productImage.ts` — a duplicate rather than an import,
 * because this is a plain Node script with no TypeScript loader. The
 * ordering is the preference order: WebP first, since that is what the app
 * itself produces.
 */
const EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png']
const SAFE_ID = /^[A-Za-z0-9._-]+$/

const HEADER = `/**
 * GENERATED FILE — do not edit by hand.
 *
 *     node scripts/generate-product-images.mjs   (or: npm run product-images)
 *
 * \`npm run dev\` and \`npm run build\` regenerate it first (the \`predev\` and
 * \`prebuild\` lifecycle scripts), so it cannot drift from what is actually
 * in \`public/products/\`. It is committed so that \`npm test\` and
 * \`npm run typecheck\` work without running the script.
 *
 * Why an index at all, rather than just pointing an \`<img>\` at
 * \`/products/<id>.webp\` and letting it 404: the Sell grid is the checkout
 * path. A guessed URL means one request per tile per paint for every
 * product that has no shipped picture — a 404 and a console line online,
 * a failed fetch in airplane mode — and that is exactly what "no network
 * call on the checkout path" exists to prevent. Knowing the file names at
 * build time means a product with no picture causes no request at all.
 *
 * Keys are product ids; values are file names inside \`public/products/\`.
 */
`

/** `{ 'p-cake-jar': 'p-cake-jar.webp' }` for everything usable in the folder. */
function indexPictures() {
  if (!existsSync(PICTURES_DIR)) return {}
  const found = {}
  // Sorted so the output is byte-for-byte stable across filesystems, and
  // so a `.webp` and a `.jpg` for the same product resolve the same way
  // every time (first wins, in EXTENSIONS order).
  const names = readdirSync(PICTURES_DIR).sort()
  for (const extension of EXTENSIONS) {
    for (const name of names) {
      const suffix = `.${extension}`
      if (!name.toLowerCase().endsWith(suffix)) continue
      const id = name.slice(0, name.length - suffix.length)
      if (!SAFE_ID.test(id)) {
        console.warn(`generate-product-images: skipping ${name} — not a usable product id`)
        continue
      }
      if (found[id] !== undefined) continue
      found[id] = name
    }
  }
  return found
}

const pictures = indexPictures()
const ids = Object.keys(pictures).sort()
const body =
  ids.length === 0
    ? 'export const REPO_PRODUCT_IMAGE_FILES: Record<string, string> = {}\n'
    : `export const REPO_PRODUCT_IMAGE_FILES: Record<string, string> = {\n${ids
        .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(pictures[id])},\n`)
        .join('')}}\n`

const next = HEADER + body
const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : ''

if (current === next) {
  console.log(`generate-product-images: up to date (${ids.length} picture(s))`)
} else {
  writeFileSync(OUT_PATH, next)
  console.log(`generate-product-images: wrote ${ids.length} picture(s) to src/images/repoImages.ts`)
}
