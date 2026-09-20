import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { saveSettings } from '../db/settings'
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings'
import { useSettings } from './useSettings'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const real: Settings = {
  ...DEFAULT_SETTINGS,
  shopName: 'Sunrise Bakery',
  promptPayId: '0812345678',
}

describe('useSettings', () => {
  it('starts at null (not loaded yet), never at the defaults', async () => {
    await saveSettings(real, database)

    const { result } = renderHook(() => useSettings(database))

    expect(result.current.settings).toBeNull()
    expect(result.current.failed).toBe(false)
    await waitFor(() => expect(result.current.settings).toEqual(real))
  })

  it('resolves to the defaults when no row has been saved', async () => {
    const { result } = renderHook(() => useSettings(database))

    await waitFor(() => expect(result.current.settings).toEqual(DEFAULT_SETTINGS))
    // "No row yet" is the normal state before the first Admin save, not a
    // failure: the PromptPay screen still shows its placeholder QR for it.
    expect(result.current.failed).toBe(false)
  })

  it('live-updates when the settings row is saved', async () => {
    const { result } = renderHook(() => useSettings(database))
    await waitFor(() => expect(result.current.settings).toEqual(DEFAULT_SETTINGS))

    await saveSettings(real, database)

    await waitFor(() => expect(result.current.settings).toEqual(real))
  })

  it('reports a failed read, rather than throwing, and still hands back usable defaults', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(database.settings, 'get').mockRejectedValue(new Error('IndexedDB is gone'))

    const { result } = renderHook(() => useSettings(database))

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS)
  })
})
