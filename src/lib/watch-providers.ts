/**
 * watch-providers — turn TMDB's provider names into one brand per title.
 *
 * TMDB (via JustWatch) lists a title under every storefront variant it can
 * find: "Netflix", "Netflix Standard with Ads", "Amazon Prime Video with Ads",
 * "HBO Max Amazon Channel", "Paramount Plus Premium", "Paramount+ Roku Premium
 * Channel", … — and ranks live-TV bundles (fuboTV, Philo, YouTube TV) first
 * for network shows. Measured 2026-08-28 on the 300 checked titles: fuboTV
 * was the #1 entry more often than Netflix. Naming fuboTV on the card with a
 * Netflix subscription sitting second is wrong for almost everyone.
 *
 * So: every raw name maps to a canonical brand (`key` for the icon, `label`
 * for the text), and the pick prefers the brand a viewer most likely has.
 * Unknown names are kept as-is with a generic icon, never dropped.
 */

export interface WatchProvider {
  /** Stable id for the icon — lowercase, no spaces. */
  key: string
  /** Display name. */
  label: string
}

/**
 * Canonical brands. ⚠️ Order does TWO jobs at once:
 *   1. match priority — the first pattern a raw name hits wins, which is how
 *      "Paramount+ Amazon Channel" becomes paramount and not prime;
 *   2. display preference — pickWatchProvider shows the highest entry a
 *      title has, which is how Netflix beats fuboTV.
 * Moving a row for one reason changes the other. Patterns are tested against
 * the lower-cased raw name. Every `label` must also match its own pattern —
 * the UI re-derives the icon key from the label (locked by a test).
 */
export const BRANDS: readonly { key: string; label: string; match: RegExp }[] = [
  { key: 'netflix',     label: 'Netflix',        match: /netflix/ },
  { key: 'disney',      label: 'Disney+',        match: /disney/ },
  { key: 'max',         label: 'HBO Max',        match: /hbo|\bmax\b/ },
  { key: 'hulu',        label: 'Hulu',           match: /hulu/ },
  { key: 'paramount',   label: 'Paramount+',     match: /paramount/ },
  { key: 'peacock',     label: 'Peacock',        match: /peacock/ },
  // Anchored: "Starz Apple TV channel" is Starz sold through Apple, not Apple TV+.
  { key: 'appletv',     label: 'Apple TV+',      match: /^apple tv/ },
  { key: 'crunchyroll', label: 'Crunchyroll',    match: /crunchyroll/ },
  { key: 'starz',       label: 'Starz',          match: /starz/ },
  { key: 'mgm',         label: 'MGM+',           match: /mgm/ },
  { key: 'amc',         label: 'AMC+',           match: /\bamc/ },
  { key: 'shudder',     label: 'Shudder',        match: /shudder/ },
  { key: 'criterion',   label: 'Criterion',      match: /criterion/ },
  { key: 'mubi',        label: 'MUBI',           match: /mubi/ },
  { key: 'britbox',     label: 'BritBox',        match: /britbox/ },
  { key: 'acorn',       label: 'Acorn TV',       match: /acorn/ },
  { key: 'discovery',   label: 'Discovery+',     match: /discovery/ },
  { key: 'hidive',      label: 'HIDIVE',         match: /hidive/ },
  { key: 'youtube',     label: 'YouTube TV',     match: /youtube/ },
  { key: 'cinemax',     label: 'Cinemax',        match: /cinemax/ },
  { key: 'lionsgate',   label: 'Lionsgate+',     match: /lionsgate/ },
  { key: 'sundance',    label: 'Sundance Now',   match: /sundance/ },
  { key: 'pbs',         label: 'PBS',            match: /\bpbs\b/ },
  // "Prime" last among the majors: many variants above are "… Amazon Channel"
  // add-ons whose brand is the channel, not Prime.
  { key: 'prime',       label: 'Prime Video',    match: /prime video|amazon/ },
  // Live-TV bundles — real, but the last resort.
  { key: 'fubo',        label: 'fuboTV',         match: /fubo/ },
  { key: 'philo',       label: 'Philo',          match: /philo/ },
  { key: 'sling',       label: 'Sling TV',       match: /sling/ },
]

/** Raw TMDB name → canonical brand (unknown names pass through). */
export function canonicalProvider(raw: string): WatchProvider {
  const name = raw.trim()
  const lower = name.toLowerCase()
  for (const b of BRANDS) if (b.match.test(lower)) return { key: b.key, label: b.label }
  return { key: 'other', label: name }
}

/**
 * The one brand to show for a title. Highest-preference canonical brand among
 * the raw list; unknown names rank after every known brand but are still
 * shown when they're all there is.
 */
export function pickWatchProvider(raw: readonly string[] | null | undefined): WatchProvider | null {
  if (!raw?.length) return null
  let best: { provider: WatchProvider; rank: number } | null = null
  for (const name of raw) {
    const provider = canonicalProvider(name)
    const rank = provider.key === 'other' ? BRANDS.length : BRANDS.findIndex(b => b.key === provider.key)
    if (!best || rank < best.rank) best = { provider, rank }
  }
  return best?.provider ?? null
}

/**
 * Where to watch, Israel (docs/plan/v3/WATCHLIST.md DEC-11). The Watchlist
 * names one of these four, from TMDB's Israeli flatrate list, in this order
 * of preference (the same order as BRANDS); a title on none of them names
 * nothing. The label is the service's name in Israel: "Apple TV", not the
 * US card's "Apple TV+". yes, HOT, Cellcom, Partner and Disney+ are unknown
 * to TMDB for Israel, so they can't be offered.
 */
export const ISRAEL_SERVICES: readonly { key: string; label: string }[] = [
  { key: 'netflix', label: 'Netflix' },
  { key: 'max',     label: 'HBO Max' },
  { key: 'appletv', label: 'Apple TV' },
  { key: 'prime',   label: 'Prime Video' },
]

/**
 * A saved card as shown: its service is Israel's (DEC-11). A saved card keeps
 * the US `where` from the day it was saved; `where_il` is filled in for it
 * later (/api/watchlist), and with none the card names no service.
 */
export function withIsraelService<T extends { where: string | null; where_il?: string | null }>(rec: T): T {
  return { ...rec, where: rec.where_il ?? null }
}

/** TMDB's raw Israeli flatrate names → the one service to show, or null. */
export function pickIsraelProvider(raw: readonly string[] | null | undefined): string | null {
  if (!raw?.length) return null
  const keys = new Set(raw.map(name => canonicalProvider(name).key))
  return ISRAEL_SERVICES.find(s => keys.has(s.key))?.label ?? null
}
