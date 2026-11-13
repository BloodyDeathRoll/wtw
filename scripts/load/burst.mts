/**
 * burst — load-test the feed builds the way fast rating drives them, against
 * the real database (P1-G, #240: "test under load, not one after another").
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/load/burst.mts --users <id>,<id>,…
 *   … --repeat 2          each user id runs as this many virtual users (more load)
 *   … --seconds 45        how long each formula is driven
 *   … --rate-ms 900       one rating per virtual user every N ms
 *   … --debounce on|off   off (default): builds run as precompute.ts runs them; on: each waits for a 1.2 s pause
 *                         (max 4 s) first — tried 2026-11-13 and not adopted: users built in lockstep and the tail got worse
 *   … --formula both|v1|v2
 *
 * Each virtual user "rates" every --rate-ms. Its builds follow precompute.ts:
 * one at a time per user; a rating during a build means one more build after
 * it; with --debounce on, a build first waits for a 1.2 s pause (at most 4 s). A build is steps 1–6 on that user's real DNA (no AI writing, no cache
 * or DB writes: read-only). Every second it samples pg_stat_activity.
 *
 * Reports per formula: builds, build and step-1 p50/p95/max, taste/served pool
 * timeouts, and the DB's busiest moment (active backends, waiting, oldest query).
 */
import pg from 'pg'
import { createServiceClient } from '@/lib/supabase/service'
import { getCandidates } from '@/modules/engine/pipeline/step1-candidate-gen'
import { scoreCandidates } from '@/modules/engine/pipeline/step2-composite-score'
import { applySoftModifiers } from '@/modules/engine/pipeline/step3-soft-modifiers'
import { composeBatch } from '@/modules/engine/pipeline/step3b-compose-batch'
import { capKidsShare, spreadKids } from '@/modules/engine/pipeline/kids-share'
import { llmRerank } from '@/modules/engine/pipeline/step4-llm-rerank'
import { injectStretchPick } from '@/modules/engine/pipeline/step5-stretch-pick'
import { buildReasonPayloads } from '@/modules/engine/pipeline/step6-reason-payload'
import type { DNASchema } from '@/types/dna'

const args = process.argv.slice(2)
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1] }
const USERS = opt('--users', '').split(',').filter(Boolean)
if (!USERS.length) throw new Error('--users <id>,<id>… required')
const REPEAT = Number(opt('--repeat', '1'))
const SECONDS = Number(opt('--seconds', '45'))
const RATE_MS = Number(opt('--rate-ms', '900'))
const DEBOUNCE = opt('--debounce', 'off') === 'on'
const FORMULAS = opt('--formula', 'both') === 'both' ? ['v1', 'v2'] : [opt('--formula', 'both')]
const QUIET_MS = 1200, MAX_SETTLE_MS = 4000

process.env.JEV_ENABLED = 'false'
let poolTimeouts = 0, servedTimeouts = 0
const w = console.warn, e = console.error
console.warn = (...a: unknown[]) => { if (String(a[0]).includes('taste pool unavailable')) poolTimeouts++; else if (!String(a[0]).startsWith('[')) w(...a) }
console.error = (...a: unknown[]) => { if (String(a[0]).includes('served pool unavailable')) servedTimeouts++; else e(...a) }
console.log = ((log) => (...a: unknown[]) => { if (!String(a[0]).startsWith('[')) log(...a) })(console.log)

const db = createServiceClient()
const dnas: DNASchema[] = []
for (const id of USERS) {
  const { data, error } = await db.from('users').select('dna').eq('id', id).single()
  if (error || !data?.dna) throw new Error(`no DNA for ${id.slice(0, 8)}…`)
  dnas.push(data.dna as DNASchema)
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN }

async function build(src: DNASchema) {
  const dna = structuredClone(src)                       // a fresh object per build, like a fresh load
  const t0 = performance.now()
  const cands = await getCandidates(dna)
  const t1 = performance.now()
  const scored = await scoreCandidates(cands, dna)
  const mod = applySoftModifiers(scored, dna)
  buildReasonPayloads(injectStretchPick(spreadKids(await llmRerank(capKidsShare(composeBatch(mod), mod, dna, undefined), dna)), scored, dna))
  return { total: performance.now() - t0, s1: t1 - t0 }
}

const sampler = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await sampler.connect()

for (const f of FORMULAS) {
  if (f === 'v2') process.env.FORMULA_V2 = 'true'; else delete process.env.FORMULA_V2
  poolTimeouts = 0; servedTimeouts = 0
  const builds: { total: number; s1: number }[] = []
  let failed = 0
  const end = Date.now() + SECONDS * 1000
  const peak = { active: 0, waiting: 0, oldestS: 0, oldestQuery: '' }
  const sampling = (async () => {
    while (Date.now() < end) {
      const r = await sampler.query(`select count(*) filter (where state = 'active') active,
          count(*) filter (where state = 'active' and wait_event_type is not null and wait_event_type <> 'Client') waiting,
          coalesce(max(extract(epoch from now() - query_start)) filter (where state = 'active'), 0) oldest,
          (array_agg(left(regexp_replace(query, '\\s+', ' ', 'g'), 70) order by query_start) filter (where state = 'active'))[1] q
        from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`)
      const s = r.rows[0]
      peak.active = Math.max(peak.active, Number(s.active)); peak.waiting = Math.max(peak.waiting, Number(s.waiting))
      if (Number(s.oldest) > peak.oldestS) { peak.oldestS = Number(s.oldest); peak.oldestQuery = s.q ?? '' }
      await sleep(1000)
    }
  })()

  const vusers = Array.from({ length: dnas.length * REPEAT }, (_, i) => dnas[i % dnas.length])
  await Promise.all(vusers.map(async (dna, i) => {
    let lastRating = Date.now(), ratedSinceBuild = true
    const rater = (async () => { await sleep((i * RATE_MS) / vusers.length); while (Date.now() < end) { lastRating = Date.now(); ratedSinceBuild = true; await sleep(RATE_MS) } })()
    const builder = (async () => {
      while (Date.now() < end) {
        if (!ratedSinceBuild) { await sleep(50); continue }
        if (DEBOUNCE) {
          const start = Date.now()
          while (Date.now() - lastRating < QUIET_MS && Date.now() - start < MAX_SETTLE_MS && Date.now() < end) await sleep(50)
        }
        ratedSinceBuild = false
        try { builds.push(await build(dna)) } catch { failed++ }
      }
    })()
    await Promise.all([rater, builder])
  }))
  await sampling
  const t = builds.map(b => b.total), s1 = builds.map(b => b.s1)
  console.info(`${f} (${vusers.length} users, a rating every ${RATE_MS} ms each, debounce ${DEBOUNCE ? 'on' : 'off'}, ${SECONDS}s): ${builds.length} builds (${failed} failed) · build p50 ${q(t, 0.5).toFixed(0)} / p95 ${q(t, 0.95).toFixed(0)} / max ${Math.max(...t).toFixed(0)} ms · step 1 p50 ${q(s1, 0.5).toFixed(0)} / p95 ${q(s1, 0.95).toFixed(0)} ms · taste-pool timeouts ${poolTimeouts}, served-pool timeouts ${servedTimeouts} · DB peak: ${peak.active} active, ${peak.waiting} waiting, oldest query ${peak.oldestS.toFixed(1)} s${peak.oldestQuery ? ` (${peak.oldestQuery})` : ''}`)
}
await sampler.end()
