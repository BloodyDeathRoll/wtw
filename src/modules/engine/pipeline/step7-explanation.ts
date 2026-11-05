/**
 * Step 7 — Plain-language Explanation Generation
 *
 * For each title, generates a 2–3 sentence "Why this?" explanation in warm,
 * conversational language. Batched into Groq calls of up to 25 titles.
 *
 * Since 2026-11-05 this paragraph is for the "Why it's a match" sheet only.
 * The feed card's short line is built from facts, never by a model
 * (step7-card-reason.ts), and this text is stored beside the batch rather
 * than over it (step8-cache.ts, `cacheSheetExplanations`).
 *
 * Each explanation must:
 *   - Reference at least one positive signal specific to THIS user
 *   - Include one honest negative signal or caveat
 *   - Sound like a knowledgeable friend, not a data printout
 *
 * Example output:
 *   "Recommended because you consistently rate Denis Villeneuve near the top
 *   of your list, and this shares his cinematographer. Your one likely
 *   reservation: you tend to rate slow second acts lower, and this has one."
 */

import { generateText, Output } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { MODELS } from '@/lib/ai-models'
import { z } from 'zod'
import { CONTENT_DIMENSIONS } from '../scoring/content-affinity'
import type { RecommendationResult, ReasonPayload } from '@/types/dna'
import type { ScoredTitleWithPayload } from './step6-reason-payload'
import { cardReason, STRONG_CREW_AFFINITY, type RatedByPerson } from './step7-card-reason'

/**
 * Step 6 adds this when no crew member the user has rated is in the title.
 * True of most titles, so it is not a reservation: it never goes to the
 * model as a caveat (the sheet already hides it, RecCard.tsx).
 */
export const NO_CREW_FILLER = /^No crew members from your watch history/

function mistral() {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey: key })
}

const explanationSchema = z.object({
  explanations: z.array(
    z.object({
      tmdb_id:     z.string(),
      explanation: z.string()
        .describe('2-3 warm, conversational sentences. Start with why it fits. End with one honest caveat.'),
    })
  ),
})

/**
 * The minimum the explanation prompt needs. Both a pipeline item
 * (ScoredTitleWithPayload) and a cached RecommendationResult reduce to it, so
 * explanations can be generated for a batch that was cached without them
 * (precompute.ts).
 */
export interface ExplainItem {
  tmdb_id: string
  type: 'movie' | 'tv'
  title: string
  reason_payload: ReasonPayload
}

export function toExplainItem(i: ScoredTitleWithPayload): ExplainItem {
  return { tmdb_id: i.title.tmdb_id, type: i.title.type, title: i.title.title, reason_payload: i.reason_payload }
}

export function resultToExplainItem(r: RecommendationResult): ExplainItem {
  return { tmdb_id: r.tmdb_id, type: r.type, title: r.title, reason_payload: r.reason_payload }
}

/** Defined with the card line, which uses the same floor (step7-card-reason.ts). */
export { STRONG_CREW_AFFINITY }

/** Crew the user has rated positively, strongest first. */
function likedCrew(p: ReasonPayload): ReasonPayload['crew_matches'] {
  return p.crew_matches
    .filter(m => m.affinity_score > 0)
    .sort((a, b) => b.affinity_score - a.affinity_score)
}

/** Liked crew strong enough to be called a strong match. */
function strongCrew(p: ReasonPayload): ReasonPayload['crew_matches'] {
  return likedCrew(p).filter(m => m.affinity_score >= STRONG_CREW_AFFINITY)
}

export function payloadSummary(item: ExplainItem): string {
  const p = item.reason_payload
  const parts: string[] = []

  // crew_matches holds every crew member the fingerprint KNOWS, with a signed
  // score (crew-affinity.ts) — including the ones the user has rated down.
  // Only a positive affinity is a reason to watch; a negative one is a caveat.
  // Only crew above STRONG_CREW_AFFINITY are called strong; a weaker positive
  // is still a reason, said as what it is.
  const crewList = (ms: ReasonPayload['crew_matches']) => ms
    .slice(0, 2)
    .map(m => `${m.name} (${m.role}, affinity ${m.affinity_score.toFixed(2)})`)
    .join(', ')
  const strong = strongCrew(p)
  const weak = likedCrew(p).filter(m => m.affinity_score < STRONG_CREW_AFFINITY)
  if (strong.length > 0) parts.push(`Strong crew matches: ${crewList(strong)}`)
  else if (weak.length > 0) parts.push(`Crew the user has liked before (weak signal): ${crewList(weak)}`)
  const ratedDown = p.crew_matches
    .filter(m => m.affinity_score < 0)
    .sort((a, b) => a.affinity_score - b.affinity_score)[0]
  if (ratedDown) {
    parts.push(`Crew the user has rated down before: ${ratedDown.name} (${ratedDown.role})`)
  }

  if (p.lineage_connections.length > 0) {
    const conn = p.lineage_connections[0]
    parts.push(`Lineage connection: ${conn.from} → ${conn.to} (${conn.relationship})`)
  }

  if (p.dimension_matches.length > 0) {
    // Prefer a content dimension, and for a good reason: this
    // is what the LLM is told about the title. Pacing is on nearly every
    // enriched title and is pushed first, so reading [0] meant a genre the
    // user actively rates highly never reached the prompt — leaving the
    // explanation unable to name the one signal that put the card there, in
    // exactly the genre-only, no-crew-match case this dimension was added for.
    const match = p.dimension_matches.find(m => CONTENT_DIMENSIONS.has(m.dimension)) ?? p.dimension_matches[0]
    parts.push(`Narrative match: ${match.dimension} — user prefers ${match.user_value}, title is ${match.title_value}`)
  }

  if (p.groq_rationale) {
    parts.push(`Ranking rationale: ${p.groq_rationale}`)
  }

  const caveat = p.negative_signals.find(n => !NO_CREW_FILLER.test(n))
  if (caveat) {
    parts.push(`Honest caveat: ${caveat}`)
  }

  if (p.is_stretch_pick) {
    parts.push('This is a stretch pick — intentional mismatch.')
  }

  return parts.join('. ')
}

// One LLM call can't reliably return 50 valid explanations — chunk it.
const EXPLAIN_CHUNK_SIZE = 25

/**
 * Adapt scored+payload items to RecommendationResult without any LLM call.
 * `explanation` is the card's short "why" (step7-card-reason.ts) and is final:
 * the AI paragraph never replaces it.
 */
export function toResults(
  items: ScoredTitleWithPayload[],
  rated: RatedByPerson = new Map(),
): RecommendationResult[] {
  const now = new Date().toISOString()
  return items.map(item => ({
    title:              item.title.title,
    tmdb_id:            item.title.tmdb_id,
    type:               item.title.type,
    composite_score:    item.composite_score,
    reason_payload:     item.reason_payload,
    explanation:        cardReason(item, rated),
    is_stretch_pick:    item.is_stretch_pick,
    generated_at:       now,
    fingerprint_version: 0,   // set by generate.ts from dna.metadata.taste_version
  }))
}

async function explainChunk(
  items: ExplainItem[]
): Promise<Map<string, string>> {
  // Bracketed id is the composite key — the model echoes it back, and a bare
  // tmdb_id collides for a movie/TV pair sharing an id.
  const titlesList = items
    .map(item =>
      `[${item.type}:${item.tmdb_id}] "${item.title}" (${item.type})\n` +
      `  Signals: ${payloadSummary(item)}`
    )
    .join('\n\n')

  const prompt = `You are a film-savvy concierge writing personalized recommendation explanations.

For each title below, write a 2–3 sentence explanation for why it's recommended.
- Start with the strongest positive signal (crew, narrative fit, tone)
- Be specific — reference actual crew names or dimension matches, not generic praise
- End with one honest caveat ("Your one likely reservation is...")
- Warm, conversational tone — like a knowledgeable friend, not a review

${titlesList}

Return explanations for all ${items.length} titles.`

  // GRACEFUL DEGRADATION: explanation failure must never kill the pipeline.
  // Every item already has a fallback (reason_payload.groq_rationale), so on
  // any LLM/validation error we just ship this chunk without LLM blurbs.
  try {
    const { output } = await generateText({
      model: mistral()(MODELS.structured),
      output: Output.object({ schema: explanationSchema }),
      prompt,
    })
    // Normalise whatever the model echoed to the composite key. It often
    // drops the "movie:" prefix (seen live 2026-08-28: 50/50 came back bare
    // and the cache merge matched none of them). A bare id resolves through
    // this chunk's items; if two items share it (movie/TV collision) it's
    // ambiguous and dropped rather than guessed.
    const bareToKey = new Map<string, string | null>()
    for (const item of items) {
      bareToKey.set(item.tmdb_id, bareToKey.has(item.tmdb_id) ? null : `${item.type}:${item.tmdb_id}`)
    }
    const out = new Map<string, string>()
    for (const e of output.explanations) {
      const echoed = e.tmdb_id.trim().replace(/^\[|\]$/g, '')
      const key = /^(movie|tv):/.test(echoed) ? echoed : bareToKey.get(echoed) ?? null
      if (key) out.set(key, e.explanation)
    }
    return out
  } catch (err) {
    console.warn('[explanation] LLM explanations failed — using payload fallbacks:', err instanceof Error ? err.message : err)
    return new Map()
  }
}

/**
 * LLM explanations for any list of ExplainItems → Map<`${type}:${tmdb_id}`, text>.
 * Items the model skipped (or a failed chunk) are simply absent.
 */
export async function explainMany(items: ExplainItem[]): Promise<Map<string, string>> {
  // Sequential chunks, not parallel — the Mistral free tier rate-limits, and a
  // failed chunk degrades to fallbacks without affecting the others.
  const explanationMap = new Map<string, string>()
  for (let i = 0; i < items.length; i += EXPLAIN_CHUNK_SIZE) {
    const chunkMap = await explainChunk(items.slice(i, i + EXPLAIN_CHUNK_SIZE))
    for (const [id, text] of chunkMap) explanationMap.set(id, text)
  }
  return explanationMap
}
