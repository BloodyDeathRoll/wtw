/**
 * A one-sentence plot for feed cards whose catalogue plot won't fit
 * (2026-11-06, Eran: "if you don't [have a link], just give me a full 1-2
 * sentences about its content").
 *
 * The card shows the catalogue's own plot text when a sentence of it fits
 * four lines (`plotLine`, ~63% of titles). For the rest, a model condenses
 * the plot into one sentence — once per TITLE, shared by every user, cached
 * for 90 days. Checked before it's used: every name and number must be in
 * the plot, no opinions, no "you", nothing longer than the card — and then
 * a second model (the "why" fact-check, MODELS.whyJudge) reads each against
 * its plot: the first test swapped who resists whom in Morning Glory. Anything
 * that fails, or a model that is down, leaves the card on its fact-built
 * story line. A batch waits at most WAIT_MS for new ones; the rest are
 * finished in the background and cached for the next batch.
 */

import { createMistral } from '@ai-sdk/mistral'
import { createGroq } from '@ai-sdk/groq'
import { generateText } from 'ai'
import { after } from 'next/server'
import { MODELS, GROQ_TEXT_OPTIONS } from '@/lib/ai-models'
import { getRedis } from '@/lib/redis'
import { CARD_REASON_MAX_CHARS, plotLine } from './step7-card-reason'

export interface PlotSource {
  title: { tmdb_id: string; type: 'movie' | 'tv'; title: string; synopsis?: string | null }
}

const TTL_SECONDS = 90 * 24 * 60 * 60
const key = (type: string, id: string) => `card_plot:v2:${type}:${id}`
/** Titles condensed per call; a batch needs ~15. */
const MAX_PER_CALL = 30
const CALL_TIMEOUT_MS = 12000
/** The longest a batch waits for new summaries (cached ones are instant). */
const WAIT_MS = 2500

const OPINION = /\b(you|your|critic|audience|masterpiece|acclaim|award|oscar|best|greatest|stunning|brilliant|hilarious|heartwarming|must-see|unforgettable|beloved|classic)\b/i

/** True when `line` says only what `synopsis` says: names and numbers from it, no opinions, card-sized. */
export function plotLineOk(line: string, synopsis: string, title: string): boolean {
  if (line.length < 40 || line.length > CARD_REASON_MAX_CHARS) return false
  if (!/[.!]$/.test(line) || /\n/.test(line) || OPINION.test(line)) return false
  const hay = `${synopsis} ${title}`.toLowerCase()
  const words = line.match(/[A-Za-zÀ-ÿ'’.-]+/g) ?? []
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/[’']s$/, '').replace(/[.]$/, '')
    if (/^[A-ZÀ-Ý]/.test(w) && !hay.includes(w.toLowerCase())) return false
  }
  for (const n of line.match(/\d[\d,]*/g) ?? []) if (!hay.includes(n)) return false
  return true
}

const PROMPT = (synopses: string[]) => `Condense each numbered plot below into ONE sentence of at most 140 characters: who the story follows and what sets it going. Use only what the plot says: add no place, event, award or name it doesn't mention. Keep names exactly as written. No opinions, no praise, no "you", no mention of genre or mood.

Reply with one line per plot: its number, a "|", then the sentence. For example:
1 | A retired spy is pulled back for one last job.

${synopses.map((s, i) => `${i + 1} | ${s.replace(/\s+/g, ' ')}`).join('\n')}`

const JUDGE = (pairs: { plot: string; line: string }[]) => `Each numbered item has a PLOT and a SUMMARY. Does the SUMMARY say anything the PLOT doesn't support — a wrong who-did-what, an added event, place, name or detail? Shorter is fine; rephrasing is fine.

Reply with one line per item: its number, "|", then OK or the problem. For example:
1 | OK
2 | says she hires him, but the plot says he hires her

${pairs.map((p, i) => `${i + 1}.\nPLOT: ${p.plot.replace(/\s+/g, ' ')}\nSUMMARY: ${p.line}`).join('\n\n')}`

/** Numbers of the items the fact-check passed. Throws when it can't run: then nothing is used. */
async function judgeLines(pairs: { plot: string; line: string }[]): Promise<Set<number>> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY is not set')
  const { text } = await generateText({
    model: createGroq({ apiKey })(MODELS.whyJudge),
    providerOptions: { groq: { ...GROQ_TEXT_OPTIONS.groq, reasoningEffort: 'low' } },
    maxOutputTokens: 3000,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    prompt: JUDGE(pairs),
  })
  const ok = new Set<number>()
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s*[|.:)]\s*ok\b/i.exec(line)
    if (m) ok.add(Number(m[1]))
  }
  return ok
}

function mistral() {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey })
}

/**
 * Plot sentences for the titles whose own plot text won't fit the card,
 * keyed `${type}:${tmdb_id}`. Best-effort: never throws, and a title it
 * can't do is simply absent.
 */
export async function cardPlots(items: PlotSource[], waitMs = WAIT_MS): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const work = fillPlots(items, out)
  // The batch waits a moment, never longer: what isn't written by then is
  // finished in the background and cached, so the next batch has it.
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = await Promise.race([
    work.then(() => false),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), waitMs) }),
  ])
  clearTimeout(timer)
  if (late) {
    try { after(() => work) } catch { void work }
  }
  return new Map(out)
}

async function fillPlots(items: PlotSource[], out: Map<string, string>): Promise<void> {
  const need = items.filter(i => i.title.synopsis && !plotLine(i.title.synopsis, CARD_REASON_MAX_CHARS))
  if (!need.length) return
  const ids = [...new Set(need.map(i => `${i.title.type}:${i.title.tmdb_id}`))]
  const byId = new Map(need.map(i => [`${i.title.type}:${i.title.tmdb_id}`, i.title]))

  try {
    const cached = await getRedis().mget<(string | null)[]>(...ids.map(id => key(id.split(':')[0], id.split(':')[1])))
    ids.forEach((id, n) => { if (cached[n]) out.set(id, cached[n]!) })
  } catch (err) {
    console.warn('[card-plot] cache read failed:', err instanceof Error ? err.message : err)
  }

  const missing = ids.filter(id => !out.has(id)).slice(0, MAX_PER_CALL)
  if (!missing.length) return
  try {
    const { text } = await generateText({
      model: mistral()(MODELS.cardPlot),
      prompt: PROMPT(missing.map(id => byId.get(id)!.synopsis!)),
      temperature: 0.3,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    const drafts: [string, string][] = []
    for (const line of text.split('\n')) {
      const m = /^\s*(\d+)\s*[|.:)]\s*(.+?)\s*$/.exec(line)
      const id = m ? missing[Number(m[1]) - 1] : undefined
      if (!m || !id || drafts.some(([d]) => d === id)) continue
      const t = byId.get(id)!
      const sentence = m[2].replace(/^["“]|["”]$/g, '')
      if (plotLineOk(sentence, t.synopsis!, t.title)) drafts.push([id, sentence])
    }
    const passed = drafts.length
      ? await judgeLines(drafts.map(([id, line]) => ({ plot: byId.get(id)!.synopsis!, line })))
      : new Set<number>()
    const fresh = drafts.filter((_, i) => passed.has(i + 1))
    for (const [id, sentence] of fresh) out.set(id, sentence)
    if (fresh.length) {
      const redis = getRedis()
      await Promise.all(fresh.map(([id, s]) => redis.set(key(id.split(':')[0], id.split(':')[1]), s, { ex: TTL_SECONDS })))
    }
  } catch (err) {
    console.warn('[card-plot] summaries unavailable (cards keep their story line):', err instanceof Error ? err.message : err)
  }
}
