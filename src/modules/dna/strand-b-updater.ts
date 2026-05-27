import type { StrandB, NarrativeDimension, DNASignal } from '@/types/dna'

/** Confidence step when a signal reinforces a dimension */
const CONFIDENCE_REINFORCE = 0.07
/** Confidence step when a signal contradicts a dimension */
const CONFIDENCE_CONTRADICT = 0.05
/** Minimum change in value or confidence before we ask Groq to rewrite notes */
const NOTES_REGEN_THRESHOLD = 0.1

/**
 * Updates Strand B (narrative dimensions) from a SessionSummary.
 *
 * Two update paths:
 * 1. `dimensionUpdates` — explicit values set by Assignment 1's LLM during the session.
 *    These take precedence and are merged directly.
 * 2. `signals` — each signal's dimensions_reinforced / dimensions_contradicted adjust
 *    the confidence of the current values without changing the value itself.
 *
 * After merging, any dimension whose value OR confidence shifted by more than
 * NOTES_REGEN_THRESHOLD gets its `notes` field rewritten via Groq.
 *
 * Returns the updated StrandB (does not mutate input).
 */
export async function updateStrandB(
  current: StrandB,
  dimensionUpdates: Partial<StrandB>,
  signals: DNASignal[],
): Promise<StrandB> {
  // Step 1: merge explicit dimension updates from Assignment 1
  let updated = mergeExplicitUpdates(current, dimensionUpdates)

  // Step 2: adjust confidence from signal reinforcement / contradiction
  updated = adjustConfidenceFromSignals(updated, signals)

  // Step 3: regenerate plain-English notes for changed dimensions
  updated = await regenerateNotes(current, updated)

  return updated
}

// ─── step 1: merge explicit updates ──────────────────────────────────────────

function mergeExplicitUpdates(
  current: StrandB,
  updates: Partial<StrandB>,
): StrandB {
  const result = { ...current }

  for (const key of Object.keys(updates) as (keyof StrandB)[]) {
    const incoming = updates[key]
    if (!incoming) continue

    result[key] = {
      ...current[key],
      ...incoming,
      // Never regress confidence below the current level on an explicit update
      confidence: Math.max(current[key].confidence, incoming.confidence ?? 0),
    } as NarrativeDimension
  }

  return result
}

// ─── step 2: confidence adjustment from signals ───────────────────────────────

function adjustConfidenceFromSignals(
  current: StrandB,
  signals: DNASignal[],
): StrandB {
  const result = { ...current }

  for (const signal of signals) {
    for (const dim of signal.dimensions_reinforced) {
      if (!(dim in result)) continue
      const d = result[dim as keyof StrandB]
      result[dim as keyof StrandB] = {
        ...d,
        confidence: clamp(d.confidence + CONFIDENCE_REINFORCE),
      }
    }
    for (const dim of signal.dimensions_contradicted) {
      if (!(dim in result)) continue
      const d = result[dim as keyof StrandB]
      result[dim as keyof StrandB] = {
        ...d,
        confidence: clamp(d.confidence - CONFIDENCE_CONTRADICT),
      }
    }
  }

  return result
}

// ─── step 3: LLM notes regeneration ──────────────────────────────────────────

async function regenerateNotes(
  before: StrandB,
  after: StrandB,
): Promise<StrandB> {
  const result = { ...after }

  for (const key of Object.keys(after) as (keyof StrandB)[]) {
    const prev = before[key]
    const next = after[key]

    const valueDelta =
      typeof prev.value === 'number' && typeof next.value === 'number'
        ? Math.abs(next.value - prev.value)
        : prev.value !== next.value
        ? 1
        : 0

    const confidenceDelta = Math.abs(next.confidence - prev.confidence)

    if (valueDelta >= NOTES_REGEN_THRESHOLD || confidenceDelta >= NOTES_REGEN_THRESHOLD) {
      result[key] = {
        ...next,
        notes: await callGroqForNotes(key, next),
      }
    }
  }

  return result
}

async function callGroqForNotes(
  dimension: keyof StrandB,
  dim: NarrativeDimension,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.warn('[strand-b-updater] GROQ_API_KEY not set — skipping notes regen')
    return dim.notes
  }

  const prompt = `You are building a viewer taste profile for a film recommendation engine.

Dimension: ${dimension}
Current value: ${JSON.stringify(dim.value)}
Confidence: ${dim.confidence.toFixed(2)} (0 = no data, 1 = very confident)

Write 1–2 plain English sentences summarising what we know about this viewer's preference for "${dimension}".
Be specific and concrete. Do not mention confidence scores or technical terms.
If confidence is below 0.2, note that we have limited data.`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.4,
      }),
    })

    if (!res.ok) {
      console.error('[strand-b-updater] Groq API error:', res.status)
      return dim.notes
    }

    const data = await res.json() as {
      choices: { message: { content: string } }[]
    }
    return data.choices[0]?.message?.content?.trim() ?? dim.notes
  } catch (err) {
    console.error('[strand-b-updater] Groq fetch failed:', err)
    return dim.notes
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1): number {
  return Math.min(Math.max(v, min), max)
}
