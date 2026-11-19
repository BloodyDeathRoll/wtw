/**
 * Q3 (#366): your recent searches, kept on this phone (src/app/search/recent.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { clearRecentSearches, recentSearches, rememberSearch, useRecentSearches, RECENT_MAX } from '@/app/search/recent'

const KEY = 'wtw:recent-searches'

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('recent searches', () => {
  it('puts a search on top, kept as typed (trimmed)', () => {
    rememberSearch('memento')
    rememberSearch('  Christopher Nolan ')
    expect(recentSearches()).toEqual(['Christopher Nolan', 'memento'])
  })

  it('a search made again moves to the top once, whatever its case', () => {
    rememberSearch('memento')
    rememberSearch('heat')
    rememberSearch('MEMENTO')
    expect(recentSearches()).toEqual(['MEMENTO', 'heat'])
  })

  it('keeps the newest RECENT_MAX', () => {
    for (let i = 1; i <= RECENT_MAX + 2; i++) rememberSearch(`search ${i}`)
    const list = recentSearches()
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0]).toBe(`search ${RECENT_MAX + 2}`)
    expect(list).not.toContain('search 1')
  })

  it('ignores a search shorter than two letters', () => {
    rememberSearch('a')
    rememberSearch('   ')
    expect(recentSearches()).toEqual([])
  })

  it('Clear empties the list', () => {
    rememberSearch('memento')
    clearRecentSearches()
    expect(recentSearches()).toEqual([])
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('a broken stored value reads as no list', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(recentSearches()).toEqual([])
    window.localStorage.setItem(KEY, JSON.stringify(['ok', 3, '', null]))
    expect(recentSearches()).toEqual(['ok'])
  })

  it('storage that throws: no list, nothing breaks', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => rememberSearch('memento')).not.toThrow()
    expect(() => clearRecentSearches()).not.toThrow()
    expect(recentSearches()).toEqual([])
  })

  it('the hook follows changes, and shows nothing with the flag off', () => {
    const on = renderHook(() => useRecentSearches(true))
    const off = renderHook(() => useRecentSearches(false))
    expect(on.result.current).toEqual([])
    act(() => rememberSearch('memento'))
    expect(on.result.current).toEqual(['memento'])
    expect(off.result.current).toEqual([])
    act(() => clearRecentSearches())
    expect(on.result.current).toEqual([])
  })
})
