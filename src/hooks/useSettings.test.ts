import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { saveSettings } from '../db/settings'
import { DEFAULT_SETTINGS, SETTINGS_ID, type Settings } from '../domain/settings'
import { useSettings } from './useSettings'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const real: Settings = { id: SETTINGS_ID, shopName: 'Sunrise Bakery', promptPayId: '0812345678' }

describe('useSettings', () => {
  it('starts at null (not loaded yet), never at the defaults', async () => {
    await saveSettings(real, database)

    const { result } = renderHook(() => useSettings(database))

    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toEqual(real))
  })

  it('resolves to the defaults when no row has been saved', async () => {
    const { result } = renderHook(() => useSettings(database))

    await waitFor(() => expect(result.current).toEqual(DEFAULT_SETTINGS))
  })

  it('live-updates when the settings row is saved', async () => {
    const { result } = renderHook(() => useSettings(database))
    await waitFor(() => expect(result.current).toEqual(DEFAULT_SETTINGS))

    await saveSettings(real, database)

    await waitFor(() => expect(result.current).toEqual(real))
  })

  it('resolves to the defaults, rather than throwing, when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(database.settings, 'get').mockRejectedValue(new Error('IndexedDB is gone'))

    const { result } = renderHook(() => useSettings(database))

    await waitFor(() => expect(result.current).toEqual(DEFAULT_SETTINGS))
  })
})
