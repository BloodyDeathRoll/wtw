/**
 * remove-dislikes-from-people — one-off: take every past dislike back out of
 * the people it pushed down.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/remove-dislikes-from-people.mts          # dry run
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/remove-dislikes-from-people.mts --apply  # write
 *
 * Why (Eran, 2026-11-07): "disliked has no effect on any of the people, at
 * all." From now on a dislike leaves people alone (movesPeople in
 * update-crew.ts); this removes what dislikes did before that.
 *
 * Per user, per disliked signal (one per title) whose title is in the catalog:
 * each of its people (directors, writers, cinematographers, top 3 cast) gets
 * the dislike's -0.20 taken back out of their running average and one title
 * off their count — the exact inverse of what applyCrewAffinityUpdate did.
 * A person known only from that dislike (1 title, score -0.20) is dropped.
 * A 1-title person whose score is anything else was not made by the dislike
 * (a game or a check-in nudge, say), so they are left alone and counted.
 *
 * Nothing else changes: not genres, mood & pace or story traits (a dislike
 * still teaches those), not the signals, not the games' or check-in's own
 * touches. Bumps taste_version + last_updated (CAS on updated_at), drops the
 * DNA read-cache. Not idempotent: run --apply once.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { titleKey } from '@/lib/title-key'
import { fetchTitleCrew } from '@/modules/dna/lib/load-save'
import { REACTION_SCORE, clamp, lineageBoost } from '@/modules/dna/lib/reaction-score'
import type { DNASchema, StrandA } from '@/types/dna'

const APPLY = process.argv.includes('--apply')
const DISLIKE = REACTION_SCORE.disliked // -0.20
const MAX_CAST = 3 // same as update-crew.ts

async function main() {
  const db = createServiceClient()
  const { data: users, error } = await db.from('users').select('id, dna, updated_at')
  if (error) throw new Error(error.message)

  let written = 0
  for (const u of users ?? []) {
    const dna = u.dna as DNASchema | null
    if (!dna) continue

    const seen = new Set<string>()
    const disliked = dna.signals.filter((s) => {
      const k = titleKey(s.type, s.tmdb_id)
      if (seen.has(k)) return false
      seen.add(k)
      return s.reaction === 'disliked'
    })
    if (disliked.length === 0) continue

    const titles = await fetchTitleCrew(disliked.map((s) => s.tmdb_id))
    const a: StrandA = dna.strand_a_creative_affinity
    let titlesDone = 0, notInCatalog = 0, adjusted = 0, dropped = 0, leftAlone = 0
    const negativeBefore = countNegative(a)

    for (const s of disliked) {
      const t = titles.get(titleKey(s.type, s.tmdb_id))
      if (!t) { notInCatalog++; continue }
      titlesDone++
      const groups: [keyof StrandA, { tmdb_person_id: string }[]][] = [
        ['directors', t.crew.directors ?? []],
        ['writers', t.crew.writers ?? []],
        ['cinematographers', t.crew.cinematographers ?? []],
        ['actors', (t.crew.cast ?? []).slice(0, MAX_CAST)],
      ]
      for (const [bucket, pool] of groups) {
        const once = new Set<string>()
        for (const m of pool) {
          if (once.has(m.tmdb_person_id)) continue
          once.add(m.tmdb_person_id)
          const e = a[bucket][m.tmdb_person_id]
          if (!e) continue
          if (e.sample_size <= 1) {
            if (Math.abs(e.score - DISLIKE) < 1e-6) { delete a[bucket][m.tmdb_person_id]; dropped++ }
            else leftAlone++
            continue
          }
          const n = e.sample_size
          e.score = clamp((e.score * n - DISLIKE) / (n - 1), -1, 1)
          e.sample_size = n - 1
          e.lineage_boost = lineageBoost(e.score)
          adjusted++
        }
      }
    }

    console.log(`user ${u.id}: ${disliked.length} disliked (${notInCatalog} not in catalog) → people adjusted ${adjusted}, dropped ${dropped}, left alone ${leftAlone}; people below 0: ${negativeBefore} → ${countNegative(a)}`)
    if (!APPLY || titlesDone === 0) continue

    dna.metadata.taste_version += 1
    dna.metadata.last_updated = new Date().toISOString()
    const { data: saved, error: saveErr } = await db
      .from('users')
      .update({ dna, updated_at: new Date().toISOString() })
      .eq('id', u.id)
      .eq('updated_at', u.updated_at as string)
      .select('id')
    if (saveErr) { console.error('  SAVE FAILED:', saveErr.message); continue }
    if ((saved?.length ?? 0) === 0) { console.warn('  SKIPPED: row changed underneath (re-run for this user)'); continue }
    try { await getRedis().del(`dna:${u.id}`) } catch { /* non-fatal */ }
    written++
    console.log(`  saved → taste_version ${dna.metadata.taste_version}`)
  }
  console.log(APPLY ? `\ndone: ${written} user(s) written` : '\ndry run — re-run with --apply to write')
}

function countNegative(a: StrandA): number {
  return (['directors', 'writers', 'cinematographers', 'actors'] as const)
    .reduce((n, b) => n + Object.values(a[b]).filter((e) => e.score < 0).length, 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
