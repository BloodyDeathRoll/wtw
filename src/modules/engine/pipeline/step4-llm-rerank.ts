/**
 * Step 4 — LLM Re-ranking
 *
 * Takes the top 50 scored candidates and asks Groq to re-rank them based
 * on nuanced tonal and thematic resonance that numeric scoring can't capture.
 *
 * One structured call (Mistral small — see src/lib/ai-models.ts) returns the
 * re-ranked list of ids. Since 2026-08-28 it returns ids ONLY: per-title
 * rationales made it the slowest step of "Find more" and step 7 builds the
 * interim card text from the reason payload instead. groq_rationale is kept
 * on the type (ReasonPayload contract) and is always ''.
 *
 * Returns all 50 in the model's order; composite order on any failure.
 */

import { generateObject } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { MODELS } from '@/lib/ai-models'
import { z } from 'zod'
import type { DNASchema } from '@/types/dna'
import type { ScoredTitle } from '../types'

function mistral() {
  const key = process.env.MISTRAL_API_KEY
  if (!key) throw new Error('MISTRAL_API_KEY is not set')
  return createMistral({ apiKey: key })
}

// ─────────────────────────────────────────────
// Profile → natural language (for the prompt)
// ─────────────────────────────────────────────

function profileSummary(dna: DNASchema): string {
  const b = dna.strand_b_narrative_dimensions
  const c = dna.strand_c_visceral_specs

  // Top crew affinities (score > 0.3, sorted by score × confidence)
  const topCrew = [
    ...Object.values(dna.strand_a_creative_affinity.directors).map(e => ({ ...e, role: 'director' })),
    ...Object.values(dna.strand_a_creative_affinity.writers).map(e => ({ ...e, role: 'writer' })),
    ...Object.values(dna.strand_a_creative_affinity.cinematographers).map(e => ({ ...e, role: 'cinematographer' })),
  ]
    .filter(e => e.score > 0.3)
    .sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence))
    .slice(0, 5)
    .map(e => `${e.name} (${e.role}, affinity ${(e.score * e.confidence).toFixed(2)})`)
    .join(', ')

  const dominantPacing = Object.entries(c.pacing_weights)
    .sort(([, a], [, b]) => b - a)[0]?.[0]?.replace('_', ' ') ?? 'unknown'

  const dominantTones = Object.entries(c.tone_weights)
    .filter(([, w]) => w > 0.3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([t]) => t)
    .join(', ')

  return [
    topCrew ? `Favorite crew: ${topCrew}.` : '',
    `Prefers ${b.moral_ambiguity.value} moral ambiguity, ${b.narrative_complexity.value} narrative complexity.`,
    `Emotional demand preference: ${b.emotional_demand.value}.`,
    `Protagonist type: ${b.protagonist_type.value}.`,
    `Ensemble vs solo: ${b.ensemble_vs_solo.value}.`,
    `Pacing: favors ${dominantPacing}.`,
    dominantTones ? `Tone: gravitates toward ${dominantTones}.` : '',
  ].filter(Boolean).join(' ')
}

// ─────────────────────────────────────────────
// Re-ranking schema
// ─────────────────────────────────────────────

// Ids only. This call used to return a rationale per title too — ~4K output
// tokens for 50 titles, the single largest cost of a "Find more" (est. 5-20s,
// 2026-08-28). The rationales only fed the explanation prompt and the interim
// card text, both of which step 7 now covers from the reason payload.
const rerankSchema = z.object({
  ranked: z.array(
    z.string().describe('The bracketed id exactly as shown, e.g. "movie:603"'),
  ).min(1),
})

// ─────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────

export async function llmRerank(
  scored: ScoredTitle[],
  dna: DNASchema
): Promise<ScoredTitle[]> {
  const top50 = scored.slice(0, 50)
  if (top50.length === 0) return []

  const candidateList = top50
    .map((s, i) => {
      const t = s.title
      const director = t.crew.directors[0]?.name ?? 'unknown director'
      const genres   = t.genres.map(g => g.name).join(', ')
      const tones    = t.tone_tags.join(', ') || 'unknown'
      // The bracketed id is the composite key: the model echoes it back and a
      // bare tmdb_id would collide for a movie/TV pair sharing an id.
      return `${i + 1}. [${t.type}:${t.tmdb_id}] "${t.title}" (${t.type}, ${t.release_year ?? '?'}) — Dir: ${director} — Genres: ${genres} — Tone: ${tones} — Score: ${s.composite_score.toFixed(3)}`
    })
    .join('\n')

  const prompt = `You are a film expert re-ranking recommendations for a specific viewer.

VIEWER PROFILE:
${profileSummary(dna)}

CANDIDATES (currently ranked by numeric score):
${candidateList}

Re-rank these titles from best to worst fit for THIS viewer. You may dramatically reorder them — the numeric score misses nuance.
Return ALL ${top50.length} bracketed ids in your preferred order. Ids only — no titles, no commentary.`

  // GRACEFUL DEGRADATION: a rerank failure must never kill the pipeline.
  // Composite scoring (step 2) already produced a good order — the LLM pass
  // only refines it. On any LLM/validation error, fall back to that order.
  let ranked: string[]
  try {
    const { object } = await generateObject({
      model: mistral()(MODELS.structured),
      schema: rerankSchema,
      prompt,
    })
    ranked = object.ranked
  } catch (err) {
    console.warn('[rerank] LLM rerank failed — falling back to composite order:', err instanceof Error ? err.message : err)
    return top50.map(item => ({ ...item, groq_rationale: '' }))
  }

  // Keyed on whatever the model echoed — the composite key we showed it, or a
  // bare id if it trimmed the prefix; the lookup tries the composite first.
  const rankMap = new Map<string, number>(
    ranked.map((id, i) => [id.trim().replace(/^\[|\]$/g, ''), i])
  )
  const rankOf = (s: ScoredTitle) =>
    rankMap.get(`${s.title.type}:${s.title.tmdb_id}`) ?? rankMap.get(s.title.tmdb_id)

  // Apply the LLM's ordering, preserving original numeric order for unranked titles
  const matched = top50.filter(s => rankOf(s) !== undefined).length
  console.log(`[rerank] ${matched}/${top50.length} ids matched (${ranked.length} returned)`)
  if (matched === 0) {
    // The model returned something we can't map (titles instead of ids?) —
    // say so loudly rather than silently serving composite order as "reranked".
    console.warn('[rerank] no ids matched — composite order kept; sample:', ranked.slice(0, 3))
  }
  const reranked = [...top50].sort((a, b) => (rankOf(a) ?? 999) - (rankOf(b) ?? 999))

  return reranked.map(item => ({ ...item, groq_rationale: '' }))
}
