/**
 * GENERATED FILE — do not edit by hand.
 *
 *     node scripts/generate-product-images.mjs   (or: npm run product-images)
 *
 * `npm run dev` and `npm run build` regenerate it first (the `predev` and
 * `prebuild` lifecycle scripts), so it cannot drift from what is actually
 * in `public/products/`. It is committed so that `npm test` and
 * `npm run typecheck` work without running the script.
 *
 * Why an index at all, rather than just pointing an `<img>` at
 * `/products/<id>.webp` and letting it 404: the Sell grid is the checkout
 * path. A guessed URL means one request per tile per paint for every
 * product that has no shipped picture — a 404 and a console line online,
 * a failed fetch in airplane mode — and that is exactly what "no network
 * call on the checkout path" exists to prevent. Knowing the file names at
 * build time means a product with no picture causes no request at all.
 *
 * Keys are product ids; values are file names inside `public/products/`.
 */
export const REPO_PRODUCT_IMAGE_FILES: Record<string, string> = {
  "p-amsterdam": "p-amsterdam.png",
  "p-brownie-9": "p-brownie-9.png",
  "p-brownie-brittles": "p-brownie-brittles.png",
  "p-brownie-cups": "p-brownie-cups.png",
  "p-choc-chunk": "p-choc-chunk.PNG",
  "p-cookie-jar": "p-cookie-jar.png",
  "p-macadamia-choc": "p-macadamia-choc.PNG",
  "p-manhattan": "p-manhattan.PNG",
  "p-seasalt-choc-mud": "p-seasalt-choc-mud.PNG",
}
