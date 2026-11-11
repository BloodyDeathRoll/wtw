/**
 * strip-chat-from-dna — one-off: take everything the chat put into each
 * fingerprint back out (DEC-5, docs/plan/PLAN.md P1-C1). The logic is
 * src/modules/dna/lib/strip-chat.ts; this does the reads and the write.
 *
 *   npm run strip-chat-from-dna            # dry run: per user, what would go
 *   npm run strip-chat-from-dna -- --apply # snapshot, then write
 *   npm run strip-chat-from-dna -- --apply --user <id>  # one user only (re-run a skipped row)
 *
 * The dry run lists every rule, soft preference and "tonight" modifier that
 * would be removed, per user, so each person can re-add what they meant
 * (P1-C3). Run it before the testers judge the new formula.
 *
 * When: right after CHAT_MODE=off is live, then --apply straight away. Rules
 * carry no timestamp, so a rule added on the Taste DNA page between the deploy
 * and --apply is removed too.
 *
 * Per user, with --apply: store a snapshot of the current DNA (rollback; not
 * again for a version already snapshotted, so a re-run doesn't push real
 * rollback points out of the keep-last-5), then save under a compare-and-set
 * on updated_at (NOT NULL) — a row that changed since the read is skipped and
 * reported; re-run for it. Not idempotent for strand B (values are kept,
 * confidence reset), like rebuild-strands.mts: run it once, and re-run a
 * skipped row alone with --user.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { fetchTitleCrew, invalidateDNACache } from '@/modules/dna/lib/load-save'
import { storeSnapshot } from '@/modules/dna/lib/snapshot'
import { stripChat, type PlayReapply } from '@/modules/dna/lib/strip-chat'
import { isSyncableState, playInfluence, resolveCreators } from '@/modules/dna/update-from-play'
import { foldRatedHistoryIntoSummary } from '@/modules/session/feedback-signals'
import { seasonDone } from '@/app/play/lib/blocks'
import type { GameTitle } from '@/app/play/lib/scales'
import type { DNASchema, SessionSummary } from '@/types/dna'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const APPLY = process.argv.includes('--apply')
const userAt = process.argv.indexOf('--user')
const ONLY = userAt === -1 ? null : process.argv[userAt + 1]
// A bare --user must not fall through to every user: a second full run would reset strand B again.
if (userAt !== -1 && (!ONLY || ONLY.startsWith('--'))) throw new Error('--user needs a user id')
const list = (xs: string[]) => (xs.length ? xs.join(', ') : '—')

async function main() {
  const db = createServiceClient()
  const gameTitles = JSON.parse(await readFile(resolve(process.cwd(), 'src/app/play/data/titles.json'), 'utf8')) as GameTitle[]
  let q = db.from('users').select('id, dna, updated_at')
  if (ONLY) q = q.eq('id', ONLY)
  const { data: users, error } = await q
  if (error) throw new Error(error.message)
  const { data: authUsers } = await db.auth.admin.listUsers({ perPage: 1000 })
  const emailOf = new Map((authUsers?.users ?? []).map(u => [u.id, u.email ?? '?']))

  let written = 0, skipped = 0
  for (const u of users ?? []) {
    const dna = u.dna as DNASchema | null
    if (!dna) continue
    const before = structuredClone(dna)

    const { data: playRow, error: playErr } = await db.from('play_state').select('state').eq('user_id', u.id).maybeSingle()
    if (playErr) throw new Error(`play_state for ${u.id}: ${playErr.message}`)
    let play: PlayReapply | null = null
    if (playRow && isSyncableState(playRow.state)) {
      const S = playRow.state
      const inf = playInfluence(S)
      play = {
        inf,
        creators: await resolveCreators(inf.creators, S.used, gameTitles),
        state: { sel: S.sel, block: S.block, round: S.round, skipped: S.skipped, done: seasonDone(S) },
      }
    }
    // Card ratings the fold skipped because a chat signal already named the title.
    const pending: SessionSummary = { session_number: 0, new_signals: [], dimension_updates: {}, open_questions_resolved: [], new_open_questions: [], recommendation_made: null, recommendation_accepted: null }
    await foldRatedHistoryIntoSummary({ ...dna, signals: dna.signals.filter(s => !s.source.startsWith('session_')) }, pending)
    const titles = await fetchTitleCrew([...new Set([...dna.signals, ...pending.new_signals].map(s => s.tmdb_id))])

    const r = stripChat(dna, titles, play, pending.new_signals)
    const nothing = !r.rules.length && !r.softPreferences.length && !r.temporalModifiers.length && !r.chatSignals.length
    console.log(`\n${emailOf.get(u.id) ?? '?'} (${u.id})${nothing ? ' — nothing from chat' : ''}`)
    console.log(`  rules removed (re-add with P1-C3): ${list(r.rules)}`)
    console.log(`  soft preferences removed: ${list(r.softPreferences)}`)
    console.log(`  "tonight" modifiers removed: ${list(r.temporalModifiers)}`)
    console.log(`  chat-named titles dropped: ${r.chatSignals.length}`)
    console.log(`  card ratings re-added for chat-named titles: ${pending.new_signals.length}`)
    console.log(`  signals kept ${dna.signals.length} (replayed ${r.replayed}, not in catalogue ${r.notInCatalogue}) · games ${play ? 're-applied' : 'none'}`)
    if (!APPLY) continue

    const { count: snapped } = await db.from('dna_snapshots').select('id', { count: 'exact', head: true })
      .eq('user_id', u.id).eq('taste_version', before.metadata.taste_version)
    if (!snapped) await storeSnapshot(u.id, before)
    const { data: saved, error: saveErr } = await db
      .from('users')
      .update({ dna, updated_at: new Date().toISOString() })
      .eq('id', u.id)
      .eq('updated_at', u.updated_at as string)
      .select('id')
    if (saveErr) { console.error('  SAVE FAILED:', saveErr.message); skipped++; continue }
    if ((saved?.length ?? 0) === 0) { console.warn('  SKIPPED: row changed underneath (re-run for this user)'); skipped++; continue }
    await invalidateDNACache(u.id)
    written++
    console.log(`  saved → taste_version ${dna.metadata.taste_version} (snapshot of v${before.metadata.taste_version} stored)`)
  }
  console.log(APPLY ? `\ndone: ${written} written, ${skipped} skipped` : '\ndry run — re-run with --apply to write')
}

main().catch(err => { console.error(err); process.exit(1) })
