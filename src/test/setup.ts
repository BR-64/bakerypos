// Runs before every test file (see vite.config.ts `test.setupFiles`).
import 'fake-indexeddb/auto' // gives Dexie a real IndexedDB implementation in jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// `test.globals` is off, so Testing Library's automatic afterEach(cleanup)
// (which relies on detecting a global afterEach) never registers. Without
// this, DOM from one `it` in a component test file leaks into the next,
// breaking any query that expects a single match.
afterEach(cleanup)
