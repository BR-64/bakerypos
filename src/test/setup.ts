// Runs before every test file (see vite.config.ts `test.setupFiles`).
import 'fake-indexeddb/auto' // gives Dexie a real IndexedDB implementation in jsdom
import '@testing-library/jest-dom/vitest'
