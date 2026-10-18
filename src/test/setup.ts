// Runs before every test file (see vite.config.ts `test.setupFiles`).
import 'fake-indexeddb/auto' // gives Dexie a real IndexedDB implementation in jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// fake-indexeddb stores records with Node's `structuredClone`, which only
// knows Node's own Blob: jsdom's Blob comes back as an empty `{}` (no size,
// no type), so a product photo would vanish on the round trip. A real
// browser clones Blobs natively, so use Node's Blob/File here to match it.
// File is swapped too, so `file instanceof Blob` still holds.
// Loaded via `getBuiltinModule` rather than `import 'node:buffer'` so the
// app's tsconfig doesn't need Node types (which would hide browser-only
// mistakes in `src`).
const nodeProcess = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }
).process
const { Blob: NodeBlob, File: NodeFile } = nodeProcess.getBuiltinModule('node:buffer') as {
  Blob: typeof Blob
  File: typeof File
}
Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile })

// `test.globals` is off, so Testing Library's automatic afterEach(cleanup)
// (which relies on detecting a global afterEach) never registers. Without
// this, DOM from one `it` in a component test file leaks into the next,
// breaking any query that expects a single match.
afterEach(cleanup)
