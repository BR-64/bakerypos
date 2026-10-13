# Product pictures shipped with the app

Drop a picture in here and the Sell grid shows it on that product's tile.

## Naming

One file per product, named after the **product id**, which you can read off
`src/db/seed.ts` for the starter menu (`p-brownie-9`, `p-cake-jar`, …):

```
public/products/p-brownie-9.webp
public/products/p-cake-jar.webp
```

`.webp` is preferred. `.jpg`, `.jpeg` and `.png` also work; if two files
exist for the same id, `.webp` wins, then `.jpg`, `.jpeg`, `.png`.

Ids may only contain letters, digits, `.`, `_` and `-`. Anything else is
skipped with a warning (it would not be safe to put straight into a URL).

## Size

- **512 px on the long edge.** That is what the app itself stores for an
  uploaded photo, and two columns on a large phone at DPR 3 is about 600
  device pixels, so there is nothing to gain above it.
- **Roughly 4:3, landscape.** The tile crops to a 4:3 box (`object-fit:
cover`), so a square or portrait picture loses its top and bottom.
- **Under 150 KB each.** These ship inside the app and are precached by the
  service worker, so every one of them is part of the install size and of
  what has to be downloaded before the till works offline.

Save them without EXIF if your tool offers it — nothing reads it, and a
photo taken on a phone carries the GPS coordinates of wherever it was
taken.

## After adding or removing a file

`npm run dev` and `npm run build` pick up changes on their own (they run
`npm run product-images` first, which rewrites
`src/images/repoImages.ts`). To refresh it without starting either:

```
npm run product-images
```

Commit the regenerated `src/images/repoImages.ts` along with the picture.

## What happens when there is no file

Nothing visible: the tile shows the product name and price, exactly as it
did before pictures existed. **That is the normal state, not an error** —
no placeholder, no broken-image icon, no request for a file that isn't
there, and no console message.

A picture the owner uploads in Admin is stored on the phone and overrides
the file shipped here. Those uploads are **not** included in a backup
export — pictures stay on the device.
