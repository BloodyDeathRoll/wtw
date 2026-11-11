/**
 * Eval harness (docs/plan/PLAN.md P1-D5): the deck's checks, run on one
 * tester's own answers, so every ranking change comes with numbers.
 *
 *   npm run eval -- --user <uuid> --sheet .eval-data/<name>.json --mode live
 *   npm run eval -- --user <uuid> --sheet … --mode live --shuffle      # control: model trained on shuffled labels (~50)
 *   npm run eval -- --user <uuid> --sheet … --mode new [--cards 30] [--picks 12] [--draws 200] [--control] [--seed 1]
 *
 * The sheet is one tester's answers, `{ "movie:603": "loved" | "liked" |
 * "disliked" | "unseen", … }`. It lives in .eval-data/ (gitignored): the repo
 * is public, so answers, user ids next to ratings and emails never go in it.
 * The user id is an argument; nothing here prints an email.
 *
 * Modes (EVIDENCE.md §M):
 *   live — the real step 2 (v1) on the tester's live DNA, part by part, plus
 *          formula v2 (creators 30 + crowd 20 + taste model 50, the model
 *          trained on My ratings and picks, as the app would), over fair
 *          titles: seen on the sheet and not already in My ratings.
 *          Trust check: v1 should land within ±3 of the deck (57 / 47 / 47).
 *   new  — a new user: a blank fingerprint, N cards drawn from everything
 *          else the tester rated, plus their first K `duel` picks (pairs
 *          touching a test title dropped); 20 hidden fair titles, scored by
 *          formula v2; averaged over the draws. --control answers the cards at
 *          random. Reproduces "howmany", "thisorthat" and "firstuser".
 *   (jev, step 4 at 0.7 / 0.8 / 0.9, follows once PR #260 exports step 4's
 *    viewer summary.)
 */
import { readFile } from 'node:fs/promises'

import { createServiceClient } from '@/lib/supabase/service'
import { titleKey, parseTitleKey, type MediaType } from '@/lib/title-key'
import { TASTE_FEATURE_VERSION } from '@/lib/taste-scales/features'
import { scoreCandidates } from '@/modules/engine/pipeline/step2-composite-score'
import { computeCrewAffinity } from '@/modules/engine/scoring/crew-affinity'
import type { TitleRow } from '@/modules/engine/types'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { applyCrewAffinityUpdate } from '@/modules/dna/lib/update-crew'
import { buildTraining, predict, trainTasteModel, type DuelPick, type TastePair } from '@/modules/dna/taste-model'
import { loadTasteTraining } from '@/modules/dna/load-taste-training'
import type { DNASchema, DNASignal } from '@/types/dna'
import { concordance, formulaV2, rng, shuffle, topShare, type Level, type Scored } from './metrics'

const args = process.argv.slice(2)
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const num = (name: string, def: number) => Number(opt(name) ?? def)
const USER = opt('--user')
const SHEET = opt('--sheet')
const MODE = opt('--mode') ?? 'live'
if (!USER || !SHEET) throw new Error('usage: --user <uuid> --sheet <path> [--mode live|new]')

const db = createServiceClient()
const COLS = 'id, tmdb_id, title, type, synopsis, genres, release_year, runtime_minutes, tmdb_rating, tmdb_vote_count, omdb_rating, crew, pacing_tag, tone_tags, original_language, keywords, narrative_metadata, enriched_at, created_at, taste_vec, taste_version'
type Row = TitleRow & { taste_vec: string | number[] | null; taste_version: number | null }

/** Same as step 2's crowd score (`externalRatingScore`): 0.6·tmdb/10 + 0.4·omdb, a missing half rescaled. */
function crowd(t: Pick<TitleRow, 'tmdb_rating' | 'omdb_rating'>): number {
  const tmdb = t.tmdb_rating != null ? (t.tmdb_rating / 10) * 0.6 : null
  const omdb = t.omdb_rating != null ? t.omdb_rating * 0.4 : null
  if (tmdb === null && omdb === null) return 0.5
  if (tmdb === null) return (omdb! / 0.4) * 0.5
  if (omdb === null) return (tmdb / 0.6) * 0.5
  return tmdb + omdb
}

const vecOf = (r: Row): number[] | null =>
  r.taste_vec == null || r.taste_version !== TASTE_FEATURE_VERSION ? null : typeof r.taste_vec === 'string' ? JSON.parse(r.taste_vec) : r.taste_vec

async function loadTitles(keys: string[]): Promise<Map<string, Row>> {
  const wanted = new Set(keys)
  const ids = [...new Set(keys.map(k => parseTitleKey(k).tmdb_id))]
  const out = new Map<string, Row>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('titles').select(COLS).in('tmdb_id', ids.slice(i, i + 200))
    if (error) throw new Error(`titles: ${error.message}`)
    for (const r of (data ?? []) as unknown as Row[]) {
      const k = titleKey(r.type as MediaType, r.tmdb_id)
      if (wanted.has(k)) out.set(k, r)
    }
  }
  return out
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '—')
const line = (label: string, items: Scored[]) => console.log(`  ${label.padEnd(22)} ${fmt(concordance(items)).padStart(3)} (${fmt(concordance(items, true))})`)

async function main() {
  const sheet = JSON.parse(await readFile(SHEET!, 'utf8')) as Record<string, Level | 'unseen'>
  const { data: u, error } = await db.from('users').select('dna').eq('id', USER).single<{ dna: DNASchema | null }>()
  if (error || !u?.dna) throw new Error(`no DNA for that user id${error ? `: ${error.message}` : ''}`)
  const dna = u.dna
  const rated = new Set(dna.signals.map(s => titleKey(s.type, s.tmdb_id)))
  const seen = Object.entries(sheet).filter((e): e is [string, Level] => e[1] !== 'unseen')
  const fair = seen.filter(([k]) => !rated.has(k))
  console.log(`[eval] sheet ${Object.keys(sheet).length} · seen ${seen.length} · fair ${fair.length} · My ratings ${dna.signals.length}`)
  await (MODE === 'new' ? newUser(dna, seen, fair) : live(dna, fair))
}

// ── live ─────────────────────────────────────────────────────────

async function live(dna: DNASchema, fair: [string, Level][]) {
  const titles = await loadTitles(fair.map(([k]) => k))
  const missing = fair.filter(([k]) => !titles.has(k)).length
  const level = new Map(fair)
  const scored = await scoreCandidates([...titles.values()], dna)
  const keyOf = (t: TitleRow) => titleKey(t.type, t.tmdb_id)
  const parts = (pick: (s: (typeof scored)[number]) => number): Scored[] => scored.map(s => ({ score: pick(s), level: level.get(keyOf(s.title))! }))

  // v2: the model trained as the app would (My ratings minus chat, plus picks); --shuffle is the control.
  let training = await loadTasteTraining(dna, USER!)
  if (args.includes('--shuffle')) {
    const rand = rng(num('--seed', 1))
    const levels = shuffle(training.rows.map(r => r.level), rand)
    training = { rows: training.rows.map((r, i) => ({ ...r, level: levels[i] })), pairs: training.pairs.map(p => (rand() < 0.5 ? p : { chosen: p.other, other: p.chosen })) }
  }
  const w = trainTasteModel(training.rows, training.pairs)
  const raw = scored.map(s => { const v = vecOf(s.title as Row); return v ? predict(w, v) : null })
  const known = raw.filter((x): x is number => x != null)
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0
  const model = raw.map(x => x ?? mean)
  const v2 = formulaV2(scored.map(s => s.crew_affinity_score), scored.map(s => s.external_rating_score), model)

  console.log(`[eval] live · ${scored.length} fair titles scored (${missing} not in catalogue, ${raw.length - known.length} without a taste vector) · model trained on ${training.rows.length} ratings + ${training.pairs.length} picks${args.includes('--shuffle') ? ' (SHUFFLED)' : ''}`)
  console.log('  part                   concordance (L/D)')
  line('creators', parts(s => s.crew_affinity_score))
  line('story match', parts(s => s.narrative_match_score))
  line('pace & tone', parts(s => s.visceral_match_score))
  line('genre habits', parts(s => s.content_affinity_score))
  line('crowd', parts(s => s.external_rating_score))
  line('recency', parts(s => s.recency_boost))
  line('ENGINE v1', parts(s => s.composite_score))
  line('taste model alone', scored.map((s, i) => ({ score: model[i], level: level.get(keyOf(s.title))! })))
  line('FORMULA v2', scored.map((s, i) => ({ score: v2[i], level: level.get(keyOf(s.title))! })))
}

// ── new user ─────────────────────────────────────────────────────

async function newUser(dna: DNASchema, seen: [string, Level][], fair: [string, Level][]) {
  const CARDS = num('--cards', 30), PICKS = num('--picks', 12), DRAWS = num('--draws', 200)
  const rand = rng(num('--seed', 1))
  // Everything the tester rated: the sheet's seen titles, plus My ratings (not chat-named) the sheet doesn't hold.
  const pool = new Map<string, Level>(seen)
  for (const s of dna.signals as DNASignal[]) {
    const k = titleKey(s.type, s.tmdb_id)
    if (!s.source.startsWith('session_') && !pool.has(k)) pool.set(k, s.reaction)
  }
  const { data: ev, error } = await db.from('play_events').select('payload').eq('user_id', USER).eq('kind', 'duel').not('payload->>chosen', 'is', null).order('id').limit(500)
  if (error) throw new Error(`play_events: ${error.message}`)
  const allPicks = (ev ?? []).map(e => e.payload as DuelPick).filter(p => p.a && p.b && p.chosen)
  const titles = await loadTitles([...new Set([...pool.keys(), ...allPicks.flatMap(p => [p.a, p.b])])])
  const vecs = new Map([...titles].map(([k, r]) => [k, vecOf(r)]).filter((e): e is [string, number[]] => !!e[1]))
  const fairIn = fair.filter(([k]) => titles.has(k))
  console.log(`[eval] new user · ${CARDS} cards + ${PICKS} picks · ${DRAWS} draws · pool ${pool.size} rated · ${fairIn.length} fair titles in catalogue · ${allPicks.length} duel picks${args.includes('--control') ? ' · RANDOM-ANSWER CONTROL' : ''}`)
  if (fairIn.length < 20) throw new Error('fewer than 20 fair titles in the catalogue')

  const res = { all: [] as number[], ld: [] as number[], loved: [] as number[], disliked: [] as number[] }
  const levels: Level[] = ['loved', 'liked', 'disliked']
  for (let d = 0; d < DRAWS; d++) {
    const test = shuffle(fairIn, rand).slice(0, 20)
    const testKeys = new Set(test.map(([k]) => k))
    let cards = shuffle([...pool].filter(([k]) => !testKeys.has(k) && titles.has(k)), rand).slice(0, CARDS)
    if (args.includes('--control')) cards = cards.map(([k]) => [k, levels[Math.floor(rand() * 3)]] as [string, Level])
    const picks = allPicks.filter(p => !testKeys.has(p.a) && !testKeys.has(p.b)).slice(0, PICKS)

    // Creators, rebuilt from the cards as update-crew.ts does (a dislike leaves people alone).
    const strandA = createBlankDNA('eval').strand_a_creative_affinity
    for (const [k, l] of cards) applyCrewAffinityUpdate(strandA, titles.get(k)!.crew, l)
    // The taste model on the cards + picks, as load-taste-training.ts builds them.
    const cardSignals = cards.map(([k, l]) => { const { type, tmdb_id } = parseTitleKey(k); return { type, tmdb_id, reaction: l, source: 'onboarding', watched_at: null } as unknown as DNASignal })
    const { rows, pairs } = buildTraining(cardSignals, picks, vecs)
    const w = trainTasteModel(rows, pairs as TastePair[])

    const t = test.map(([k]) => titles.get(k)!)
    const raw = t.map(r => { const v = vecs.get(titleKey(r.type, r.tmdb_id)); return v ? predict(w, v) : null })
    const known = raw.filter((x): x is number => x != null)
    const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0
    const scores = formulaV2(t.map(r => computeCrewAffinity(r.crew, strandA).score), t.map(crowd), raw.map(x => x ?? mean))
    const items: Scored[] = scores.map((score, i) => ({ score, level: test[i][1] }))
    const c = concordance(items), ld = concordance(items, true), top = topShare(items, 5)
    if (Number.isFinite(c)) res.all.push(c)
    if (Number.isFinite(ld)) res.ld.push(ld)
    res.loved.push(top.loved); res.disliked.push(top.disliked)
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  console.log(`  concordance ${fmt(avg(res.all))} (L/D ${fmt(avg(res.ld))}) · top 5 of 20: loved ${fmt(avg(res.loved))}% / disliked ${fmt(avg(res.disliked))}%`)
}

main().catch(err => { console.error(err); process.exit(1) })
