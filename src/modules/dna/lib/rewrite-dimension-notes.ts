import { generateText } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { MODELS } from '@/lib/ai-models'
import type { DNASchema, DNASignal, StrandB } from '@/types/dna'

// Only rewrite notes for a dimension when confidence changed by this much
const REWRITE_THRESHOLD = 0.15

function getGroq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

/**
 * For any strand_b dimension whose confidence changed significantly this session,
 * ask Groq to write a fresh plain-English note describing the user's preference.
 * Updates the notes field in-place; caller must saveDNA.
 */
export async function rewriteChangedDimensionNotes(
  dna: DNASchema,
  freshSignals: DNASignal[],
): Promise<void> {
  const strand_b = dna.strand_b_narrative_dimensions

  // Determine which dimensions changed meaningfully this session
  const reinforcedCounts: Partial<Record<keyof StrandB, number>> = {}
  const contradictedCounts: Partial<Record<keyof StrandB, number>> = {}
  for (const signal of freshSignals) {
    for (const dim of signal.dimensions_reinforced) {
      const k = dim as keyof StrandB
      reinforcedCounts[k] = (reinforcedCounts[k] ?? 0) + 1
    }
    for (const dim of signal.dimensions_contradicted) {
      const k = dim as keyof StrandB
      contradictedCounts[k] = (contradictedCounts[k] ?? 0) + 1
    }
  }

  const dimsToRewrite = (Object.keys(strand_b) as (keyof StrandB)[]).filter(dim => {
    const reinforced   = reinforcedCounts[dim] ?? 0
    const contradicted = contradictedCounts[dim] ?? 0
    const totalSignals = reinforced + contradicted
    // Rewrite if there was meaningful activity AND confidence is above a floor
    return totalSignals >= 2 && strand_b[dim].confidence >= REWRITE_THRESHOLD
  })

  if (dimsToRewrite.length === 0) return

  // Batch all dimensions into one Groq call to minimise API round-trips
  const dimensionDescriptions = dimsToRewrite.map(dim => {
    const d = strand_b[dim]
    const r = reinforcedCounts[dim] ?? 0
    const c = contradictedCounts[dim] ?? 0
    return `${dim}: value="${d.value}", confidence=${d.confidence.toFixed(2)}, reinforced_this_session=${r}, contradicted=${c}`
  }).join('\n')

  const systemPrompt = `You write terse, specific taste-profile notes for a film recommendation engine.
Each note is one sentence (max 20 words), plain English, no hedging, no filler.
Example: "Strongly prefers morally complex stories where no character is purely good or evil."`

  const userPrompt = `For each dimension below, write one sentence describing what the user's preference actually is.
Return ONLY a JSON object with dimension names as keys and note strings as values.

${dimensionDescriptions}`

  const { text } = await generateText({
    model: getGroq()(MODELS.text),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.3,
    maxTokens: 400,
  })

  // Parse and apply — malformed JSON is silently ignored
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return
    const notes = JSON.parse(jsonMatch[0]) as Record<string, string>
    for (const [dim, note] of Object.entries(notes)) {
      const key = dim as keyof StrandB
      if (key in strand_b && typeof note === 'string' && note.trim()) {
        strand_b[key].notes = note.trim()
      }
    }
  } catch {
    // Non-fatal — notes are a nice-to-have, not critical
  }
}
