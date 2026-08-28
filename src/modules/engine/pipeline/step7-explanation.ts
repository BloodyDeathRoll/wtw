/**
 * Step 7 — Plain-language Explanation Generation
 *
 * For each title, generates a 2–3 sentence "Why this?" explanation in warm,
 * conversational language. Batched into Groq calls of up to 25 titles.
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

import { generateObject } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { MODELS } from '@/lib/ai-models'
import { z } from 'zod'
import type { RecommendationResult, ReasonPayload } from '@/types/dna'
import type { ScoredTitleWithPayload } from './step6-reason-payload'

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

function payloadSummary(item: ExplainItem): string {
  const p = item.reason_payload
  const parts: string[] = []

  if (p.crew_matches.length > 0) {
    const top = p.crew_matches
      .sort((a, b) => b.affinity_score - a.affinity_score)
      .slice(0, 2)
      .map(m => `${m.name} (${m.role}, affinity ${m.affinity_score.toFixed(2)})`)
      .join(', ')
    parts.push(`Strong crew matches: ${top}`)
  }

  if (p.lineage_connections.length > 0) {
    const conn = p.lineage_connections[0]
    parts.push(`Lineage connection: ${conn.from} → ${conn.to} (${conn.relationship})`)
  }

  if (p.dimension_matches.length > 0) {
    const match = p.dimension_matches[0]
    parts.push(`Narrative match: ${match.dimension} — user prefers ${match.user_value}, title is ${match.title_value}`)
  }

  if (p.groq_rationale) {
    parts.push(`Ranking rationale: ${p.groq_rationale}`)
  }

  if (p.negative_signals.length > 0) {
    parts.push(`Honest caveat: ${p.negative_signals[0]}`)
  }

  if (p.is_stretch_pick) {
    parts.push('This is a stretch pick — intentional mismatch.')
  }

  return parts.join('. ')
}

// One LLM call can't reliably return 50 valid explanations — chunk it.
const EXPLAIN_CHUNK_SIZE = 25

/**
 * One-line "Why this?" built from the reason payload alone — no LLM. This is
 * what a card shows until the background explanation lands (and permanently
 * if it never does). Positive signal first, honest caveat second, so it
 * satisfies the explainability rule (positive AND negative) on its own.
 */
export function templateExplanation(item: ScoredTitleWithPayload): string {
  const p = item.reason_payload
  const parts: string[] = []

  const crew = [...p.crew_matches].sort((a, b) => b.affinity_score - a.affinity_score)[0]
  if (crew) {
    parts.push(`${crew.name} (${crew.role}) is one of your strongest matches.`)
  } else if (p.lineage_connections[0]) {
    const c = p.lineage_connections[0]
    parts.push(`Connected to ${c.from} through ${c.to} (${c.relationship}).`)
  } else if (p.dimension_matches[0]) {
    const d = p.dimension_matches[0]
    parts.push(`Its ${d.dimension.replace(/_/g, ' ')} (${d.title_value}) lines up with what you rate highly.`)
  } else {
    parts.push('Matched on narrative and tone fit with your fingerprint.')
  }

  if (p.is_stretch_pick && p.stretch_rationale) {
    parts.push(p.stretch_rationale)
  } else if (p.negative_signals[0]) {
    parts.push(`One reservation: ${p.negative_signals[0].replace(/\.$/, '').replace(/^./, ch => ch.toLowerCase())}.`)
  }

  return parts.join(' ')
}

/**
 * Adapt scored+payload items to RecommendationResult without any LLM call —
 * explanations from the map when present (keyed `${type}:${tmdb_id}`), else
 * the template. Used to serve titles immediately while their real
 * explanations are still generating.
 */
export function toResultsWithFallback(
  items: ScoredTitleWithPayload[],
  explanationMap: Map<string, string> = new Map()
): RecommendationResult[] {
  const now = new Date().toISOString()
  return items.map(item => ({
    title:              item.title.title,
    tmdb_id:            item.title.tmdb_id,
    type:               item.title.type,
    composite_score:    item.composite_score,
    reason_payload:     item.reason_payload,
    explanation:        explanationMap.get(`${item.title.type}:${item.title.tmdb_id}`)
                          ?? explanationMap.get(item.title.tmdb_id)
                          ?? templateExplanation(item),
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
    const { object } = await generateObject({
      model: mistral()(MODELS.structured),
      schema: explanationSchema,
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
    for (const e of object.explanations) {
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

export async function generateExplanations(
  items: ScoredTitleWithPayload[]
): Promise<RecommendationResult[]> {
  if (items.length === 0) return []
  return toResultsWithFallback(items, await explainMany(items.map(toExplainItem)))
}
