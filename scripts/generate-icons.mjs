/**
 * Regenerate the PWA's PNG icons from `public/icons/icon.svg`.
 *
 *     node scripts/generate-icons.mjs        (or: npm run icons)
 *
 * Why this exists rather than an image library: turning the SVG into PNGs
 * with sharp/resvg/puppeteer would mean a new dependency and a download,
 * and CLAUDE.md asks for neither to be added lightly for a one-off build
 * artifact. The source icon is four flat shapes, so this script draws
 * those same four shapes directly — nothing here is a general SVG
 * renderer, and `SHAPES` below must be kept in step with the SVG by hand
 * (there is a check for that at the bottom: the numbers are read out of
 * the SVG and compared).
 *
 * Only `node:zlib` and `node:fs` are used, both built in.
 *
 * **Maskable.** Android crops a maskable icon to its own shape, keeping
 * only the middle 80% circle. So the background is drawn full-bleed and
 * square (a rounded rect would leave transparent corners showing under a
 * square mask), and the bread is scaled to `ART_SCALE` about the centre so
 * every part of it stays inside that safe circle.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SVG_PATH = join(root, 'public', 'icons', 'icon.svg')
const OUT_DIR = join(root, 'public', 'icons')
/** Icon sizes the manifest asks for (see `vite.config.ts`). */
const SIZES = [192, 512]
/** Samples per pixel, per axis: 16 samples a pixel, which is plenty here. */
const SUPERSAMPLE = 4
/** The SVG's own coordinate system. */
const VIEWBOX = 512
/** How much of the icon the bread may take up, so a mask can't clip it. */
const ART_SCALE = 0.8

/** The shapes of `icon.svg`, in its 512×512 user units, in painting order. */
const SHAPES = {
  background: '#7c4a1e',
  backEllipse: { cx: 256, cy: 290, rx: 170, ry: 110, fill: '#f3c98b' },
  frontEllipse: { cx: 256, cy: 250, rx: 170, ry: 110, fill: '#e8a95a' },
  scallop: {
    stroke: '#7c4a1e',
    width: 14,
    // "M150 230q30-40 60 0t60 0 60 0 60 0" expanded: the `t` command's
    // three coordinate pairs are three smooth quadratics, each reflecting
    // the previous control point through the current point.
    start: [150, 230],
    segments: [
      { control: [180, 190], end: [210, 230] },
      { control: [240, 270], end: [270, 230] },
      { control: [300, 190], end: [330, 230] },
      { control: [360, 270], end: [390, 230] },
    ],
  },
}

function parseHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/** Map an SVG user-space point through the maskable-safe scaling. */
function toArtSpace(x, y) {
  const centre = VIEWBOX / 2
  return [centre + (x - centre) * ART_SCALE, centre + (y - centre) * ART_SCALE]
}

function insideEllipse(x, y, ellipse) {
  const [cx, cy] = toArtSpace(ellipse.cx, ellipse.cy)
  const rx = ellipse.rx * ART_SCALE
  const ry = ellipse.ry * ART_SCALE
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}

/**
 * The scalloped stroke, rasterized into a supersample-resolution mask by
 * stamping a disc at every point along the curves — which gives round caps
 * and joins for free, exactly as `stroke-linecap="round"` asks for.
 */
function strokeMask(gridSize) {
  const mask = new Uint8Array(gridSize * gridSize)
  const unitsToGrid = gridSize / VIEWBOX
  const radius = (SHAPES.scallop.width / 2) * ART_SCALE * unitsToGrid
  let [px, py] = SHAPES.scallop.start

  for (const segment of SHAPES.scallop.segments) {
    // ~4 samples per user unit of curve, so consecutive discs overlap
    // heavily and the stroke has no scalloped edge of its own.
    const steps = 400
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      const mt = 1 - t
      const x = mt * mt * px + 2 * mt * t * segment.control[0] + t * t * segment.end[0]
      const y = mt * mt * py + 2 * mt * t * segment.control[1] + t * t * segment.end[1]
      const [ax, ay] = toArtSpace(x, y)
      stampDisc(mask, gridSize, ax * unitsToGrid, ay * unitsToGrid, radius)
    }
    ;[px, py] = segment.end
  }
  return mask
}

function stampDisc(mask, gridSize, cx, cy, radius) {
  const minX = Math.max(0, Math.floor(cx - radius))
  const maxX = Math.min(gridSize - 1, Math.ceil(cx + radius))
  const minY = Math.max(0, Math.floor(cy - radius))
  const maxY = Math.min(gridSize - 1, Math.ceil(cy + radius))
  const r2 = radius * radius
  for (let y = minY; y <= maxY; y += 1) {
    const dy = y + 0.5 - cy
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx
      if (dx * dx + dy * dy <= r2) mask[y * gridSize + x] = 1
    }
  }
}

/** Render one icon: returns raw RGB rows, `size` × `size`. */
function renderIcon(size) {
  const grid = size * SUPERSAMPLE
  const mask = strokeMask(grid)
  const gridToUnits = VIEWBOX / grid
  const background = parseHex(SHAPES.background)
  const back = parseHex(SHAPES.backEllipse.fill)
  const front = parseHex(SHAPES.frontEllipse.fill)
  const stroke = parseHex(SHAPES.scallop.stroke)

  const pixels = new Uint8Array(size * size * 3)
  const samples = SUPERSAMPLE * SUPERSAMPLE

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const gx = px * SUPERSAMPLE + sx
          const gy = py * SUPERSAMPLE + sy
          const x = (gx + 0.5) * gridToUnits
          const y = (gy + 0.5) * gridToUnits
          // Painting order, resolved back to front.
          let colour = background
          if (insideEllipse(x, y, SHAPES.backEllipse)) colour = back
          if (insideEllipse(x, y, SHAPES.frontEllipse)) colour = front
          if (mask[gy * grid + gx] === 1) colour = stroke
          r += colour[0]
          g += colour[1]
          b += colour[2]
        }
      }
      const i = (py * size + px) * 3
      pixels[i] = Math.round(r / samples)
      pixels[i + 1] = Math.round(g / samples)
      pixels[i + 2] = Math.round(b / samples)
    }
  }
  return pixels
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Minimal 8-bit truecolour PNG: signature, IHDR, one IDAT, IEND. */
function encodePng(size, pixels) {
  const stride = size * 3
  // Filter type 1 ("Sub") on every row: flat colour areas become runs of
  // zeroes, which deflate squashes to nothing.
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const out = y * (stride + 1)
    raw[out] = 1
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? pixels[y * stride + x - 3] : 0
      raw[out + 1 + x] = (pixels[y * stride + x] - left) & 0xff
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour, no alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Guard against the SVG and `SHAPES` drifting apart: every number this
 * script draws with has to appear in the SVG's own path/shape attributes.
 */
function checkAgainstSvg(svg) {
  const required = [
    'viewBox="0 0 512 512"',
    `fill="${SHAPES.background}"`,
    `cx="${SHAPES.backEllipse.cx}" cy="${SHAPES.backEllipse.cy}" rx="${SHAPES.backEllipse.rx}" ry="${SHAPES.backEllipse.ry}" fill="${SHAPES.backEllipse.fill}"`,
    `cx="${SHAPES.frontEllipse.cx}" cy="${SHAPES.frontEllipse.cy}" rx="${SHAPES.frontEllipse.rx}" ry="${SHAPES.frontEllipse.ry}" fill="${SHAPES.frontEllipse.fill}"`,
    'd="M150 230q30-40 60 0t60 0 60 0 60 0"',
    `stroke-width="${SHAPES.scallop.width}"`,
  ]
  const missing = required.filter((fragment) => !svg.includes(fragment))
  if (missing.length > 0) {
    throw new Error(
      `public/icons/icon.svg no longer matches this script. Update SHAPES to match:\n  ${missing.join('\n  ')}`,
    )
  }
}

const svg = readFileSync(SVG_PATH, 'utf8')
checkAgainstSvg(svg)

for (const size of SIZES) {
  const png = encodePng(size, renderIcon(size))
  const path = join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(path, png)
  const digest = createHash('sha256').update(png).digest('hex').slice(0, 12)
  console.log(`wrote ${path} (${png.length} bytes, sha256 ${digest}…)`)
}
