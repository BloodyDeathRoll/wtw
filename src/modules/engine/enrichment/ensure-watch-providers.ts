/**
 * ensureWatchProviders — on-demand streaming availability for a batch.
 *
 * The nightly job (grow-catalog.mts §3c) checks 150 titles a night, so most
 * of a 17,700-title catalog has never been asked — and a card only shows
 * a service name when its row has been. Decided 2026-08-28: check providers for
 * every title the moment it's about to be served, so the line shows whenever
 * TMDB lists one. Rows already checked within RECHECK_DAYS are left alone.
 *
 * Same write shape as the nightly job: `watch_providers` (`{}` when the title
 * streams nowhere in the region — checked, not missing) + `last_provider_check`.
 * A thrown TMDB/DB error leaves the row unstamped so a later pass retries.
 *
 * TMDB free tier is 40 req / 10 s. CONCURRENCY × (1000 / GAP_MS) stays under
 * that with headroom for the nightly job running at the same time.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getWatchProviders, type WatchProviderMap } from '@/lib/tmdb'
import { titleKey, type MediaType } from '@/lib/title-key'

export const WATCH_REGIONS = ['US']
const RECHECK_DAYS = 45
const CONCURRENCY = 4
const GAP_MS = 350

export interface TitleRef { tmdb_id: string; type: MediaType }

interface Row {
  tmdb_id: string
  type: MediaType
  watch_providers: WatchProviderMap | null
  last_provider_check: string | null
}

/**
 * Check (and store) providers for any of `refs` that need it. Returns the
 * providers now on file for every ref — fresh or existing — keyed
 * `type:tmdb_id`. `maxChecks` caps how many TMDB calls this invocation may
 * make (a request path passes a small number; the background batch pass
 * passes none).
 */
export async function ensureWatchProviders(
  refs: readonly TitleRef[],
  opts: { maxChecks?: number } = {},
): Promise<Map<string, WatchProviderMap | null>> {
  const out = new Map<string, WatchProviderMap | null>()
  if (refs.length === 0) return out

  const db = createServiceClient()
  const { data, error } = await db
    .from('titles')
    .select('tmdb_id, type, watch_providers, last_provider_check')
    .in('tmdb_id', [...new Set(refs.map(r => r.tmdb_id))])
  if (error) throw new Error(`ensureWatchProviders read: ${error.message}`)

  const wanted = new Set(refs.map(r => titleKey(r.type, r.tmdb_id)))
  const rows = ((data ?? []) as Row[]).filter(r => wanted.has(titleKey(r.type, r.tmdb_id)))
  for (const r of rows) out.set(titleKey(r.type, r.tmdb_id), r.watch_providers)

  const staleBefore = Date.now() - RECHECK_DAYS * 86_400_000
  let toCheck = rows.filter(
    r => !r.last_provider_check || Date.parse(r.last_provider_check) < staleBefore,
  )
  if (opts.maxChecks != null) toCheck = toCheck.slice(0, opts.maxChecks)
  if (toCheck.length === 0) return out

  const checkedAt = new Date().toISOString()
  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    const slice = toCheck.slice(i, i + CONCURRENCY)
    await Promise.all(slice.map(async r => {
      try {
        const providers = await getWatchProviders(r.type, r.tmdb_id, WATCH_REGIONS)
        // A 404 (null) still counts as checked — re-asking buys nothing.
        const stored = providers ?? {}
        const { error: upErr } = await db
          .from('titles')
          .update({ watch_providers: stored, last_provider_check: checkedAt })
          .eq('tmdb_id', r.tmdb_id)
          .eq('type', r.type) // composite key (0008)
        if (upErr) throw new Error(upErr.message)
        out.set(titleKey(r.type, r.tmdb_id), stored)
      } catch (err) {
        console.warn('[watch-providers] check failed (row left for retry):', r.type, r.tmdb_id, err instanceof Error ? err.message : err)
      }
    }))
    if (i + CONCURRENCY < toCheck.length) await new Promise(res => setTimeout(res, GAP_MS))
  }
  return out
}
