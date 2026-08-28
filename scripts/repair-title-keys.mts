/**
 * repair-title-keys — one-off data repair for the movie/TV id collision bug.
 *
 *   node --env-file=.env.local --import tsx scripts/repair-title-keys.mts          # dry run
 *   node --env-file=.env.local --import tsx scripts/repair-title-keys.mts --apply  # write
 *
 * Before 2026-08-28, recommendation_history stored a bare tmdb_id and the
 * rating → signal merge looked the title up by that bare id. TMDB movie and TV
 * ids collide, so when both existed in the catalog the TV row won and the
 * signal was written against the wrong title (type 'tv', wrong title text) —
 * which the `${type}:${tmdb_id}` exclusions then never matched, so the rated
 * movie kept being recommended. See src/lib/title-key.ts.
 *
 * Per user this script:
 *   1. Resolves each rated/saved tmdb_id's real type from
 *      recommendation_feedback.recommendation_id (the client has sent
 *      "type:tmdb_id" there since media_type was added), falling back to the
 *      catalog when the id is unambiguous there. Ids it can't resolve are left
 *      alone and reported — never guessed.
 *   2. Rewrites `recommended` on legacy history rows to the composite key.
 *   3. Fixes `type` + `title` on 'recommendation_accepted' signals that point at
 *      the wrong title.
 *   4. Bumps taste_version + last_updated (standing rule after any DNA write),
 *      saves, and drops the user's DNA read-cache so the next request sees it.
 *
 * NOT repaired: Strand A/C weights that were nudged by the wrong title's crew.
 * They can't be reversed without replaying every rating; they'll wash out as
 * new ratings land (and temporal decay applies to signals, not strands).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { getRedis } from '@/lib/redis'
import { parseTitleKey, recordType, titleKey, type MediaType } from '@/lib/title-key'
import type { DNASchema } from '@/types/dna'

const APPLY = process.argv.includes('--apply')

type TitleRow = { tmdb_id: string; type: MediaType; title: string }

async function main() {
  const db = createServiceClient()
  const { data: users, error } = await db.from('users').select('id, dna')
  if (error) throw new Error(error.message)

  let usersChanged = 0
  for (const u of users ?? []) {
    const dna = u.dna as DNASchema | null
    if (!dna) continue

    const history = dna.learning_loop.recommendation_history
    const ids = new Set<string>([
      ...history.map(h => h.tmdb_id),
      ...dna.signals.filter(s => s.source === 'recommendation_accepted').map(s => s.tmdb_id),
    ])
    if (ids.size === 0) continue

    // ── Resolve types ──────────────────────────────────────────
    const [{ data: fb }, { data: titleRows }] = await Promise.all([
      db.from('recommendation_feedback').select('recommendation_id').eq('user_id', u.id),
      db.from('titles').select('tmdb_id, type, title').in('tmdb_id', [...ids]),
    ])
    const fbTypes = new Map<string, Set<MediaType>>()
    for (const row of fb ?? []) {
      const { type, tmdb_id } = parseTitleKey(row.recommendation_id as string)
      if (!type) continue
      if (!fbTypes.has(tmdb_id)) fbTypes.set(tmdb_id, new Set())
      fbTypes.get(tmdb_id)!.add(type)
    }
    const catalog = new Map<string, TitleRow[]>()
    for (const t of (titleRows ?? []) as TitleRow[]) {
      if (!catalog.has(t.tmdb_id)) catalog.set(t.tmdb_id, [])
      catalog.get(t.tmdb_id)!.push(t)
    }
    const resolve = (tmdb_id: string): MediaType | null => {
      const fromFb = fbTypes.get(tmdb_id)
      if (fromFb?.size === 1) return [...fromFb][0]
      if (fromFb && fromFb.size > 1) return null // rated both — ambiguous
      const rows = catalog.get(tmdb_id) ?? []
      return rows.length === 1 ? rows[0].type : null
    }

    // ── History: legacy bare `recommended` → composite ─────────
    let historyFixed = 0
    const unresolved = new Set<string>()
    for (const h of history) {
      if (recordType(h)) continue
      if (!catalog.has(h.tmdb_id)) continue // mock slug (tt-…) — not a catalog title, leave it
      const type = resolve(h.tmdb_id)
      if (!type) { unresolved.add(h.tmdb_id); continue }
      h.recommended = titleKey(type, h.tmdb_id)
      historyFixed++
    }

    // ── Signals: wrong-type 'recommendation_accepted' rows ─────
    const signalsFixed: string[] = []
    for (const s of dna.signals) {
      if (s.source !== 'recommendation_accepted') continue
      const fromFb = fbTypes.get(s.tmdb_id)
      if (fromFb?.size !== 1) continue // no evidence, or ambiguous — leave it
      const type = [...fromFb][0]
      if (s.type === type) continue
      const right = (catalog.get(s.tmdb_id) ?? []).find(t => t.type === type)
      if (!right) continue
      signalsFixed.push(`${s.type}:${s.tmdb_id} "${s.title}" → ${type} "${right.title}"`)
      s.type = type
      s.title = right.title
    }

    const changed = historyFixed > 0 || signalsFixed.length > 0
    console.log(
      `user ${u.id}: history ${history.length} (fixed ${historyFixed}, unresolved ${unresolved.size}), ` +
      `signals fixed ${signalsFixed.length}${changed ? '' : ' — nothing to do'}`,
    )
    for (const line of signalsFixed) console.log('   ', line)
    if (unresolved.size) console.log('    unresolved ids:', [...unresolved].join(' '))
    if (!changed || !APPLY) continue

    dna.metadata.taste_version += 1
    dna.metadata.last_updated = new Date().toISOString()
    const { error: saveErr } = await db
      .from('users')
      .update({ dna, updated_at: new Date().toISOString() })
      .eq('id', u.id)
    if (saveErr) { console.error('    SAVE FAILED:', saveErr.message); continue }
    try { await getRedis().del(`dna:${u.id}`) } catch (e) { console.warn('    cache del failed (non-fatal):', e) }
    usersChanged++
    console.log(`    saved → taste_version ${dna.metadata.taste_version}`)
  }

  console.log(APPLY ? `\ndone: ${usersChanged} user(s) written` : '\ndry run — re-run with --apply to write')
}

main().catch(err => { console.error(err); process.exit(1) })
