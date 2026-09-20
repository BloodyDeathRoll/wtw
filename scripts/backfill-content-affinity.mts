/**
 * backfill-content-affinity — fill strand_c genre / language / format affinity
 * from each user's existing signals.
 *
 *   node --env-file=.env.local --import tsx scripts/backfill-content-affinity.mts          # dry run
 *   node --env-file=.env.local --import tsx scripts/backfill-content-affinity.mts --apply  # write
 *
 * Why (2026-09-20): the three maps were added with the scorer that reads them
 * (src/modules/engine/scoring/content-affinity.ts). They are written going
 * forward by every rating, but a user with 250 ratings and no new ones would
 * wait a long time for "27 disliked anime" to mean anything. Every signal
 * needed is already on file, so replay them.
 *
 * Idempotent, unlike scripts/rebuild-strands.mts: it resets ONLY the three
 * new maps and replays, so re-running lands on the same numbers. It touches
 * nothing else in the fingerprint.
 *
 * Bumps taste_version + last_updated on write (standing rule), compare-and-set
 * on updated_at so a rating landing mid-run is never clobbered, and drops the
 * user's DNA read-cache.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { titleKey } from '@/lib/title-key'
import { fetchTitleCrew } from '@/modules/dna/lib/load-save'
import {
  applyContentAffinityUpdate,
  strongestContentAffinities,
} from '@/modules/dna/lib/update-content-affinity'
import type { DNASchema } from '@/types/dna'

const APPLY = process.argv.includes('--apply')
const VALID_REACTIONS = new Set(['loved', 'liked', 'disliked'])

const top = (dna: DNASchema, bucket: 'genre_affinity' | 'language_affinity' | 'format_affinity') =>
  strongestContentAffinities(dna.strand_c_visceral_specs[bucket])
    .slice(0, 5)
    .map(([k, e]) => `${k} ${e.score >= 0 ? '+' : ''}${e.score.toFixed(2)} (n=${e.sample_size})`)
    .join(', ') || '—'

async function main() {
  const db = createServiceClient()
  const { data: users, error } = await db.from('users').select('id, dna, updated_at')
  if (error) throw new Error(error.message)

  let written = 0
  for (const u of users ?? []) {
    const dna = u.dna as DNASchema | null
    if (!dna?.strand_c_visceral_specs) continue

    const signals = (dna.signals ?? []).filter(s => VALID_REACTIONS.has(s.reaction))
    console.log(`user ${u.id} — ${signals.length} signal(s)`)
    if (signals.length === 0) continue

    // Reset, then replay. Resetting is what makes a re-run land on the same
    // numbers instead of counting every rating twice.
    const c = dna.strand_c_visceral_specs
    c.genre_affinity = {}
    c.language_affinity = {}
    c.format_affinity = {}

    const titleMap = await fetchTitleCrew(signals.map(s => s.tmdb_id))
    let replayed = 0
    for (const s of signals) {
      const title = titleMap.get(titleKey(s.type, s.tmdb_id))
      if (!title) continue // not in the catalog — nothing to attribute it to
      applyContentAffinityUpdate(c, title, s.reaction)
      replayed++
    }

    console.log(`  replayed ${replayed} of ${signals.length} (rest not in catalog)`)
    console.log(`  genres:   ${top(dna, 'genre_affinity')}`)
    console.log(`  language: ${top(dna, 'language_affinity')}`)
    console.log(`  format:   ${top(dna, 'format_affinity')}`)
    if (replayed === 0 || !APPLY) continue

    dna.metadata.taste_version += 1
    dna.metadata.last_updated = new Date().toISOString()
    const { data: saved, error: saveErr } = await db
      .from('users')
      .update({ dna, updated_at: new Date().toISOString() })
      .eq('id', u.id)
      .eq('updated_at', u.updated_at as string)
      .select('id')
    if (!saveErr && (saved?.length ?? 0) === 0) {
      console.warn('  SKIPPED: row changed underneath (re-run for this user)')
      continue
    }
    if (saveErr) { console.error('  SAVE FAILED:', saveErr.message); continue }
    try { await getRedis().del(`dna:${u.id}`) } catch { /* non-fatal */ }
    written++
    console.log(`  saved → taste_version ${dna.metadata.taste_version}`)
  }
  console.log(APPLY ? `\ndone: ${written} user(s) written` : '\ndry run — re-run with --apply to write')
}

main().catch(err => { console.error(err); process.exit(1) })
