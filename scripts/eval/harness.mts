/**
 * Eval harness (docs/plan/PLAN.md P1-D5): the deck's checks, run on one
 * tester's own answers, so every ranking change comes with numbers.
 *
 *   npm run eval -- --user <uuid> --sheet .eval-data/<name>.json --mode live
 *   npm run eval -- --user <uuid> --sheet … --shuffle [--shuffles 20]   # control: model on shuffled labels, mean over shuffles (~50)
 *   npm run eval -- --user <uuid> --sheet … --dna-version 157           # score against a stored snapshot (dna_snapshots), e.g. the DNA a past measurement saw
 *   npm run eval -- --user <uuid> --sheet … --mode jev [--jev-calls 2]
 *   npm run eval -- --user <uuid> --sheet … --mode new [--cards 30] [--picks 12] [--draws 200] [--control] [--seed 1]
 *   npm run eval -- --user <uuid> --sheet … [--mode new] --lean 0.5      # try a genre lean g (P1-D4b); 0 = none; default = the app's GENRE_LEAN
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
 *   jev  — live, then step 4's question ("would this viewer dislike it?") for
 *          the top half of the v1 and the v2 ranking, one Jev request each
 *          (TYPESAFE_API_KEY; --jev-calls caps the requests, default 2). At
 *          0.7 / 0.8 / 0.9: the disliked titles it would drop, and the loved
 *          and liked ones it would lose. Feeds P1-E7 (keep, fix or off).
 */
import { readFile } from 'node:fs/promises'

import { createServiceClient } from '@/lib/supabase/service'
import { titleKey, parseTitleKey, type MediaType } from '@/lib/title-key'
import { TASTE_FEATURE_VERSION } from '@/lib/taste-scales/features'
import { externalRatingScore as crowd, scoreCandidates } from '@/modules/engine/pipeline/step2-composite-score'
import { dropDisliked, jevState } from '@/modules/engine/pipeline/step4-llm-rerank'
import { jevNoul } from '@/lib/jev'
import { computeCrewAffinity } from '@/modules/engine/scoring/crew-affinity'
import type { TitleRow } from '@/modules/engine/types'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { applyCrewAffinityUpdate } from '@/modules/dna/lib/update-crew'
import { buildTraining, GENRE_LEAN, predict, trainTasteModel, type DuelPick, type TastePair } from '@/modules/dna/taste-model'
import { loadGenreLean, loadTasteTraining } from '@/modules/dna/load-taste-training'
import type { DNASchema, DNASignal } from '@/types/dna'
import { concordance, formulaV2, LEVEL_RANK, rng, shuffle, topShare, type Level, type Scored } from './metrics'

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`)
  return v
}
const num = (name: string, def: number, min = 0) => {
  const v = Number(opt(name) ?? def)
  if (!Number.isInteger(v) || v < min) throw new Error(`${name} needs a whole number ≥ ${min}`)
  return v
}
const USER = opt('--user')
const SHEET = opt('--sheet')
const MODE = opt('--mode') ?? 'live'
if (!USER || !SHEET) throw new Error('usage: --user <uuid> --sheet <path> [--mode live|new|jev]')
if (MODE !== 'live' && MODE !== 'new' && MODE !== 'jev') throw new Error(`--mode must be live, new or jev, not ${MODE}`)
if (MODE === 'new' && args.includes('--shuffle')) throw new Error('--shuffle is the live-mode control; in --mode new use --control')
/** The genre lean g to score with (P1-D4b). */
const LEAN = Number(opt('--lean') ?? GENRE_LEAN)
if (!Number.isFinite(LEAN) || LEAN < 0) throw new Error('--lean needs a number ≥ 0')

const db = createServiceClient()
const COLS = 'id, tmdb_id, title, type, synopsis, genres, release_year, runtime_minutes, tmdb_rating, tmdb_vote_count, omdb_rating, crew, pacing_tag, tone_tags, original_language, keywords, narrative_metadata, enriched_at, created_at, taste_vec, taste_version'
type Row = TitleRow & { taste_vec: string | number[] | null; taste_version: number | null }

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

// One decimal when a lean is being tried: its bar is 1 point.
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(args.includes('--lean') ? 1 : 0) : '—')
const line = (label: string, items: Scored[]) => console.log(`  ${label.padEnd(22)} ${fmt(concordance(items)).padStart(3)} (${fmt(concordance(items, true))})`)

async function main() {
  const sheet = JSON.parse(await readFile(SHEET!, 'utf8')) as Record<string, Level | 'unseen'>
  // A typo ("love", a bare id) would score as a plausible wrong number, so refuse it.
  const bad = Object.entries(sheet).filter(([k, v]) => !parseTitleKey(k).type || !['loved', 'liked', 'disliked', 'unseen'].includes(v))
  if (bad.length) throw new Error(`sheet: ${bad.length} bad entr${bad.length === 1 ? 'y' : 'ies'}, e.g. ${JSON.stringify(bad[0])} — keys are "movie:603" / "tv:1396", values loved | liked | disliked | unseen`)
  const version = opt('--dna-version') === undefined ? undefined : num('--dna-version', 0, 1)
  const { data: u, error } = version
    ? await db.from('dna_snapshots').select('dna:snapshot').eq('user_id', USER).eq('taste_version', Number(version)).limit(1).single<{ dna: DNASchema | null }>()
    : await db.from('users').select('dna').eq('id', USER).single<{ dna: DNASchema | null }>()
  if (error || !u?.dna) throw new Error(`no DNA for that user id${version ? ` at version ${version}` : ''}${error ? `: ${error.message}` : ''}`)
  const dna = u.dna
  if (version) console.log(`[eval] DNA snapshot v${version} — duel picks and titles are read as of today, so only v1 is historical`)
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

  // v2: the model trained as the app would (My ratings minus chat, plus picks), except that
  // picks touching a fair title are held out — the model must not have ranked what it is scored on.
  // --shuffle is the control.
  const training = { ...(await loadTasteTraining(dna, USER!, new Set(fair.map(([k]) => k)))), w0: await loadGenreLean(USER!, LEAN) }
  // The model's scores on the fair titles; a title without a vector gets the mean (z = 0).
  const modelScores = (t: Pick<typeof training, 'rows' | 'pairs'> & { w0?: number[] }) => {
    const w = trainTasteModel(t.rows, t.pairs, t.w0)
    const raw = scored.map(s => { const v = vecOf(s.title as Row); return v ? predict(w, v) : null })
    const known = raw.filter((x): x is number => x != null)
    // No vector anywhere would make the model a constant (z = 0) and v2 silently creators + crowd.
    if (known.length === 0) throw new Error('no fair title has a taste vector — run score-catalog-scales --finalise first')
    const mean = known.reduce((a, b) => a + b, 0) / known.length
    return { raw, model: raw.map(x => x ?? mean) }
  }
  if (args.includes('--shuffle')) {
    // The control: labels and pick sides shuffled. One shuffle of ~50 titles swings ±15, so average many.
    const runs = num('--shuffles', 20, 1), rand = rng(num('--seed', 1))
    const got: number[] = []
    for (let i = 0; i < runs; i++) {
      const levels = shuffle(training.rows.map(r => r.level), rand)
      // No lean in the control: the genre answers are real information, and this must sit near 50.
      const t = { rows: training.rows.map((r, j) => ({ ...r, level: levels[j] })), pairs: training.pairs.map(p => (rand() < 0.5 ? p : { chosen: p.other, other: p.chosen })) }
      const { model } = modelScores(t)
      got.push(concordance(scored.map((s, j) => ({ score: model[j], level: level.get(keyOf(s.title))! }))))
    }
    const m = got.reduce((a, b) => a + b, 0) / runs
    const sd = Math.sqrt(got.reduce((a, b) => a + (b - m) ** 2, 0) / runs)
    console.log(`[eval] shuffled-label control · taste model alone over ${runs} shuffles: mean ${fmt(m)} (sd ${fmt(sd)}, range ${fmt(Math.min(...got))}–${fmt(Math.max(...got))}) — should sit near 50`)
    return
  }
  const { raw, model } = modelScores(training)
  const known = raw.filter((x): x is number => x != null)
  const v2 = formulaV2(scored.map(s => s.crew_affinity_score), scored.map(s => s.external_rating_score), model)

  console.log(`[eval] live · ${scored.length} fair titles scored (${missing} not in catalogue, ${raw.length - known.length} without a taste vector) · model trained on ${training.rows.length} ratings + ${training.pairs.length} picks (fair-title picks held out) · genre lean g = ${LEAN} on ${training.w0.filter(Boolean).length} genres`)
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

  if (MODE === 'jev') {
    const order = (score: (i: number) => number) => scored.map((s, i) => ({ s, score: score(i) })).sort((a, b) => b.score - a.score).map(x => x.s.title)
    await jevCheck(dna, [['v1', order(i => scored[i].composite_score)], ['v2', order(i => v2[i])]], level)
  }
}

// ── jev ──────────────────────────────────────────────────────────

/**
 * Step 4's question for one ranking's top half, the way llmRerank asks it.
 * The state is llmRerank's own; the title line copies llmRerank's (step4-llm-rerank.ts).
 */
async function jevCheck(dna: DNASchema, rankings: [string, TitleRow[]][], level: Map<string, Level>) {
  const CAP = num('--jev-calls', 2)
  const keyOf = (t: TitleRow) => titleKey(t.type, t.tmdb_id)
  const describe = (t: TitleRow) =>
    `"${t.title}" (${t.type}, ${t.release_year ?? '?'}) — Dir: ${t.crew.directors[0]?.name ?? 'unknown director'} — Genres: ${t.genres.map(g => g.name).join(', ')} — Tone: ${t.tone_tags.join(', ') || 'unknown'}`
  const state = jevState(dna)
  let calls = 0
  for (const [name, ranked] of rankings) {
    if (calls >= CAP) { console.log(`[eval] jev: --jev-calls ${CAP} reached, ${name} skipped`); continue }
    const top = ranked.slice(0, Math.ceil(ranked.length / 2))
    const questions = Object.fromEntries(top.map(t => [keyOf(t), `Would this viewer dislike ${describe(t)}? True if it is something they avoid or have rated down; false if it fits their taste.`]))
    calls++
    const answers = await jevNoul(state, questions, 30_000)
    const count = (ts: TitleRow[], l: Level) => ts.filter(t => level.get(keyOf(t)) === l).length
    console.log(`[eval] jev on the ${name} top half: ${top.length} titles (${count(top, 'loved')} loved · ${count(top, 'liked')} liked · ${count(top, 'disliked')} disliked) · answered ${Object.keys(answers).length}, unanswered ${top.length - Object.keys(answers).length} (kept, as step 4 does)`)
    for (const t of [0.7, 0.8, 0.9]) {
      const dropped = top.filter(x => (answers[keyOf(x)] ?? 0) >= t)
      // Step 4 drops nothing when more than half would go (dropDisliked's guard).
      const guarded = dropDisliked(top, answers, keyOf, t).length === top.length && dropped.length > 0
      console.log(`  at ${t}: drops ${dropped.length} — disliked caught ${count(dropped, 'disliked')}/${count(top, 'disliked')} · loved lost ${count(dropped, 'loved')}/${count(top, 'loved')} · liked lost ${count(dropped, 'liked')}/${count(top, 'liked')}${guarded ? ' (step 4 would drop none: over half)' : ''}`)
    }
  }
}

// ── new user ─────────────────────────────────────────────────────

async function newUser(dna: DNASchema, seen: [string, Level][], fair: [string, Level][]) {
  const CARDS = num('--cards', 30), PICKS = num('--picks', 12), DRAWS = num('--draws', 200, 1)
  const rand = rng(num('--seed', 1))
  // Everything the tester rated: the sheet's seen titles, plus My ratings (not chat-named) the sheet doesn't hold.
  const pool = new Map<string, Level>(seen)
  for (const s of dna.signals as DNASignal[]) {
    const k = titleKey(s.type, s.tmdb_id)
    // Legacy 'mixed' ratings (dropped in migration 0013) have no level; leave them out.
    if (!s.source.startsWith('session_') && !pool.has(k) && s.reaction in LEVEL_RANK) pool.set(k, s.reaction)
  }
  // Paged: a request returns at most 1,000 rows.
  const allPicks: DuelPick[] = []
  for (let from = 0; ; from += 1000) {
    const { data: ev, error } = await db.from('play_events').select('payload').eq('user_id', USER).eq('kind', 'duel').not('payload->>chosen', 'is', null).order('id').range(from, from + 999)
    if (error) throw new Error(`play_events: ${error.message}`)
    allPicks.push(...(ev ?? []).map(e => e.payload as DuelPick).filter(p => p.a && p.b && p.chosen))
    if (!ev || ev.length < 1000) break
  }
  const titles = await loadTitles([...new Set([...pool.keys(), ...allPicks.flatMap(p => [p.a, p.b])])])
  const vecs = new Map([...titles].map(([k, r]) => [k, vecOf(r)]).filter((e): e is [string, number[]] => !!e[1]))
  const fairIn = fair.filter(([k]) => titles.has(k))
  // The tester's own genre answers, as a new user would have given them on the genre screen. Not in the control.
  const w0 = args.includes('--control') ? undefined : await loadGenreLean(USER!, LEAN)
  console.log(`[eval] new user · ${CARDS} cards + ${PICKS} picks · ${DRAWS} draws · pool ${pool.size} rated · ${fairIn.length} fair titles in catalogue · ${allPicks.length} duel picks · genre lean g = ${LEAN} on ${(w0 ?? []).filter(Boolean).length} genres${args.includes('--control') ? ' · RANDOM-ANSWER CONTROL (cards and picks)' : ''}`)
  if (fairIn.length < 20) throw new Error('fewer than 20 fair titles in the catalogue')

  const res = { all: [] as number[], ld: [] as number[], loved: [] as number[], disliked: [] as number[] }
  const levels: Level[] = ['loved', 'liked', 'disliked']
  for (let d = 0; d < DRAWS; d++) {
    const test = shuffle(fairIn, rand).slice(0, 20)
    const testKeys = new Set(test.map(([k]) => k))
    let cards = shuffle([...pool].filter(([k]) => !testKeys.has(k) && titles.has(k)), rand).slice(0, CARDS)
    let picks = allPicks.filter(p => !testKeys.has(p.a) && !testKeys.has(p.b)).slice(0, PICKS)
    // The control answers everything at random: the cards, and which side of each pick won.
    if (args.includes('--control')) {
      cards = cards.map(([k]) => [k, levels[Math.floor(rand() * 3)]] as [string, Level])
      picks = picks.map(p => ({ ...p, chosen: rand() < 0.5 ? p.a : p.b }))
    }

    // Creators, rebuilt from the cards as update-crew.ts does (a dislike leaves people alone).
    const strandA = createBlankDNA('eval').strand_a_creative_affinity
    for (const [k, l] of cards) applyCrewAffinityUpdate(strandA, titles.get(k)!.crew, l)
    // The taste model on the cards + picks, as load-taste-training.ts builds them. Cards carry no
    // date (a first run's answers are all fresh), so no 18-month decay here, unlike live training.
    const cardSignals = cards.map(([k, l]) => { const { type, tmdb_id } = parseTitleKey(k); return { type, tmdb_id, reaction: l, source: 'onboarding', watched_at: null } as unknown as DNASignal })
    const { rows, pairs } = buildTraining(cardSignals, picks, vecs)
    const w = trainTasteModel(rows, pairs as TastePair[], w0)

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
