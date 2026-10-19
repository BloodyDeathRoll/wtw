/**
 * Checks the Blind Taste Test plot rewrites (src/app/play/data/plot-rewrites.json)
 * against TMDB's own plots. Rule (Eran, 2026-10-18): a rewrite may drop, blur
 * or re-word what TMDB says, never add to it, and must not give the title away.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/check-play-plots.mts [--only id,id]
 *
 * Two passes: names and title words (exact), then an AI reader that lists
 * anything ADDED or a thin GIVEAWAY. Writes docs/prototypes/blind-rewrites/check-report.json
 * and resumes from it, so a rate-limited run can be restarted.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateText } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { MODELS, GROQ_TEXT_OPTIONS } from '@/lib/ai-models'
import type { GameTitle } from '@/app/play/lib/scales'

const ROOT = resolve(import.meta.dirname, '..')
const REPORT = resolve(ROOT, 'docs/prototypes/blind-rewrites/check-report.json')
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const ONLY = arg('--only')?.split(',')
const SPACING_MS = 6000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const CHECK = `You check a rewritten plot summary against the original for a guessing game.
Report two kinds of problem:
ADDED: anything the rewrite states that the original does not (an event, outcome, motive, setting, description). Re-wording, blurring a detail into a vaguer true one ("ticking-time-bomb insomniac" → "disturbed man", "bitten by a spider" → "bitten by an unusual creature"), and leaving things out are fine — that is the point of the rewrite.
GIVEAWAY: a word that is only a thin disguise of a famous detail in the original (a near-synonym, e.g. "sleepless" for "insomniac"), or any proper name.
Be strict about ADDED, but don't report style. Answer "OK" if there are none. Otherwise one line per problem, starting with ADDED: or GIVEAWAY:.`

/**
 * Groq's free tier: 8,000 tokens a minute and 200,000 a rolling day (shared
 * with the app's chat on the same key). On a 429, wait as long as Groq says
 * ("try again in 3m50s"), for up to 12 hours in all, then give up.
 */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  let waited = 0
  for (;;) {
    try { return await fn() } catch (e) {
      const err = e as { statusCode?: number; message?: string; lastError?: { statusCode?: number; message?: string } }
      if ((err.statusCode ?? err.lastError?.statusCode) !== 429) throw e
      const m = /try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/.exec(err.message ?? err.lastError?.message ?? '')
      const ms = m ? ((+(m[1] ?? 0) * 60 + +(m[2] ?? 0)) * 60 + +m[3]) * 1000 + 5000 : 20_000
      if ((waited += ms) > 12 * 3600_000) throw e
      console.log(`rate limited, waiting ${Math.round(ms / 1000)}s`)
      await sleep(ms)
    }
  }
}

async function main() {
  const titles: GameTitle[] = JSON.parse(await readFile(resolve(ROOT, 'src/app/play/data/titles.json'), 'utf8'))
  const rewrites: Record<string, { src: string; text: string }> = JSON.parse(await readFile(resolve(ROOT, 'src/app/play/data/plot-rewrites.json'), 'utf8'))
  const report: Record<string, { text: string; problems: string[] }> = JSON.parse(await readFile(REPORT, 'utf8').catch(() => '{}'))
  for (const id of Object.keys(report)) if (!rewrites[id]) delete report[id]   // rewrite since dropped
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })
  const todo = titles.filter(t => rewrites[t.id] && (!ONLY || ONLY.includes(t.id)) && report[t.id]?.text !== rewrites[t.id].text)
  console.log(`${todo.length} to check`)
  for (const t of todo) {
    const r = rewrites[t.id]
    const res = await call(() => generateText({
      model: groq(MODELS.text), providerOptions: GROQ_TEXT_OPTIONS, maxOutputTokens: 3000, maxRetries: 0, system: CHECK,
      prompt: `Original: ${r.src}\nRewrite: ${r.text}`,
    }))
    const problems = res.text.split('\n').map(l => l.trim()).filter(l => /^(ADDED|GIVEAWAY):/.test(l))
    report[t.id] = { text: r.text, problems }
    if (problems.length) console.log(`${t.title}\n  ${r.text}\n  ${problems.join('\n  ')}`)
    await writeFile(REPORT, JSON.stringify(report, null, 1) + '\n')
    await sleep(SPACING_MS)
  }
  const flagged = Object.entries(report).filter(([, v]) => v.problems.length).length
  console.log(`done: ${Object.keys(report).length} checked, ${flagged} with problems`)
}

main().catch(e => { console.error(e); process.exit(1) })
