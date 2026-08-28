import { describe, it, expect } from 'vitest'
import { BRANDS, canonicalProvider, pickWatchProvider } from '@/lib/watch-providers'
import { primaryWatchProvider } from '@/lib/tmdb'
import { PROVIDER_ICON_KEYS } from '@/app/components/ProviderIcon'

// Two invariants the UI relies on implicitly (review of PR #50):
//   - WherePill gets only the label (Recommendation.where) and re-derives the
//     icon key by running it back through canonicalProvider, so every label
//     must resolve to its own key;
//   - every brand key must have an icon, or a brand silently renders generic.
describe('BRANDS invariants', () => {
  it('every label round-trips to its own key', () => {
    for (const b of BRANDS) expect(canonicalProvider(b.label).key, b.label).toBe(b.key)
  })

  it('every brand key has an icon', () => {
    for (const b of BRANDS) expect(PROVIDER_ICON_KEYS, b.key).toContain(b.key)
    expect(PROVIDER_ICON_KEYS).toContain('other')
  })

  it('keys are unique', () => {
    expect(new Set(BRANDS.map((b) => b.key)).size).toBe(BRANDS.length)
  })
})

// TMDB lists every storefront variant and ranks live-TV bundles first; the
// "Watch on …" line needs one brand a viewer actually recognises.

describe('canonicalProvider', () => {
  it('collapses storefront variants onto the brand', () => {
    expect(canonicalProvider('Netflix Standard with Ads')).toEqual({ key: 'netflix', label: 'Netflix' })
    expect(canonicalProvider('Amazon Prime Video with Ads')).toEqual({ key: 'prime', label: 'Prime Video' })
    expect(canonicalProvider('Paramount+ Roku Premium Channel')).toEqual({ key: 'paramount', label: 'Paramount+' })
    expect(canonicalProvider('Peacock Premium Plus')).toEqual({ key: 'peacock', label: 'Peacock' })
    expect(canonicalProvider('Disney Plus')).toEqual({ key: 'disney', label: 'Disney+' })
  })

  it('an "Amazon Channel" add-on is the channel, not Prime', () => {
    expect(canonicalProvider('HBO Max Amazon Channel').key).toBe('max')
    expect(canonicalProvider('Crunchyroll Amazon Channel').key).toBe('crunchyroll')
    expect(canonicalProvider('Starz Apple TV channel').key).toBe('starz')
    expect(canonicalProvider('Apple TV Amazon Channel').key).toBe('appletv')
  })

  it('keeps an unknown name, with the generic key', () => {
    expect(canonicalProvider('Night Flight Plus')).toEqual({ key: 'other', label: 'Night Flight Plus' })
  })

  it('does not mistake "Cinemax" for Max', () => {
    expect(canonicalProvider('Cinemax').key).toBe('cinemax')
    expect(canonicalProvider('Max').key).toBe('max')
  })
})

describe('pickWatchProvider', () => {
  it('prefers a subscription brand over a live-TV bundle listed first', () => {
    expect(pickWatchProvider(['fuboTV', 'Philo', 'Netflix Standard with Ads'])?.label).toBe('Netflix')
  })

  it('picks by preference order, not list order', () => {
    expect(pickWatchProvider(['Hulu', 'Disney Plus'])?.key).toBe('disney')
    expect(pickWatchProvider(['Amazon Prime Video', 'Paramount Plus Premium'])?.key).toBe('paramount')
  })

  it('falls back to an unknown name when that is all there is', () => {
    expect(pickWatchProvider(['Night Flight Plus'])?.label).toBe('Night Flight Plus')
  })

  it('is null for nothing', () => {
    expect(pickWatchProvider([])).toBeNull()
    expect(pickWatchProvider(null)).toBeNull()
  })
})

describe('primaryWatchProvider (route entry point)', () => {
  it('returns the canonical label for the region', () => {
    expect(primaryWatchProvider({ US: ['fuboTV', 'HBO Max Amazon Channel'] }, 'US')).toBe('HBO Max')
    expect(primaryWatchProvider({ US: [] }, 'US')).toBeNull()
    expect(primaryWatchProvider(null, 'US')).toBeNull()
  })
})
