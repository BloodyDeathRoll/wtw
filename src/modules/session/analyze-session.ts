/**
 * analyzeSession
 *
 * Turns a raw conversation transcript into a SessionSummary the DNA Writer
 * can merge. This is the Session Brain's extraction step:
 *
 *   1. Groq reads the transcript and pulls out every film/show the user
 *      reacted to, with a reaction, reason, and which narrative dimensions
 *      it reinforced or contradicted.
 *   2. Each mentioned title is resolved to a real tmdb_id via TMDB search
 *      and cached locally (so its crew feeds Strand A affinity).
 *   3. The result is assembled into a SessionSummary (new_signals + the
 *      open-question bookkeeping).
 *
 * Titles that TMDB can't resolve are dropped — a signal needs a tmdb_id to
 * be scoreable. A transcript with no concrete titles yields zero signals
 * (still a valid summary; the version bump reflects the session happened).
 */

import { generateObject } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { z } from 'zod'
import { MODELS } from '@/lib/ai-models'
import { searchTitle, searchPerson } from '@/lib/tmdb'
import { fetchAndCacheTitle } from '@/modules/engine/enrichment/fetch-and-cache-title'
import type { SessionSummary, SessionDirective, DNASignal, StrandB } from '@/types/dna'

// The seven Strand B dimension keys — used to validate LLM output.
const STRAND_B_KEYS: (keyof StrandB)[] = [
  'moral_ambiguity',
  'narrative_complexity',
  'emotional_demand',
  'originality_weight',
  'humor_style',
  'protagonist_type',
  'ensemble_vs_solo',
]
const STRAND_B_SET = new Set<string>(STRAND_B_KEYS)

/** Used when the model classifies a hedge but gives no strength. */
const DEFAULT_SOFT_WEIGHT = 0.5

const extractionSchema = z.object({
  mentioned_titles: z.array(
    z.object({
      title: z.string().describe('The film or show title as the user referred to it'),
      media_type: z.enum(['movie', 'tv']),
      reaction: z.enum(['loved', 'liked', 'disliked']),
      reason: z.string().describe('One short phrase: why they felt that way'),
      quick_rating: z.number().min(1).max(5).nullable(),
      dimensions_reinforced: z.array(z.string()),
      dimensions_contradicted: z.array(z.string()),
      confidence: z.number().min(0).max(1),
    }),
  ),
  new_open_questions: z.array(z.string()),
  resolved_open_questions: z.array(z.string()),
  directives: z.array(
    z.object({
      kind: z.enum(['exclusion', 'soft_preference']),
      target_type: z.enum(['person', 'genre', 'keyword', 'franchise']),
      name: z.string().describe('The thing to exclude, as few words as possible'),
      raw: z.string().describe("The user's own words"),
      reason: z.string().describe('One short phrase: why'),
      weight_modifier: z.number().min(0).max(1).nullable(),
    }),
  ),
})

const SYSTEM_PROMPT = `You extract structured taste signals from a conversation between a user and a film/TV recommendation assistant.

Return ONLY titles the USER expressed a real reaction to (loved / liked / disliked). Map anything lukewarm or ambivalent to "disliked". Do not invent titles, and do not include titles the assistant merely suggested unless the user reacted to them.

For each title, judge which narrative dimensions it reinforced or contradicted, choosing ONLY from this exact list:
moral_ambiguity, narrative_complexity, emotional_demand, originality_weight, humor_style, protagonist_type, ensemble_vs_solo

- reason: one short phrase in the user's spirit ("loved the slow dread", "hated the flat characters").
- quick_rating: 1-5 only if the user gave an explicit numeric or star rating, else null.
- confidence: how sure you are this reflects durable taste (0.4 = offhand, 0.9 = emphatic).
- new_open_questions: things about their taste still worth asking next session.
- resolved_open_questions: questions this conversation answered (empty if none known).

SEPARATELY, extract standing instructions — rules the user wants applied to
every future recommendation, not a reaction to one title. These go in
"directives".

- kind: "exclusion" when the user is absolute ("never", "don't ever", "no X",
  "I hate X", "stop showing me X"). "soft_preference" when they are hedging
  ("less X", "fewer X", "not really in the mood for X").
- target_type: "person" for a named human (actor, director, writer);
  "genre" for a real genre (horror, romance, documentary); "franchise" for a
  named series or universe (Marvel, Star Wars, Fast & Furious); "keyword" for
  anything else, including categories like anime, Bollywood, k-drama,
  reality TV, found footage.
- name: the bare thing, no verbs and no negation — "anime", not "no anime";
  "Adam Sandler", not "Adam Sandler movies".
- raw: quote the user's own words.
- weight_modifier: for soft_preference only, 0.1 = almost never through
  0.9 = slightly less. null for exclusions.
- An instruction the user gave in an EARLIER turn still counts if they
  repeated or reaffirmed it.
- Do NOT invent a rule from a single disliked title. "I hated Barbie" is a
  title reaction, not a rule. "I never want to see another Barbie-style film"
  is a rule.

If the user named no concrete titles and gave no instructions, return empty
arrays.`

export interface TranscriptMessage {
  role: string
  content: string
}

export async function analyzeSession(
  messages: TranscriptMessage[],
  session_number: number,
): Promise<SessionSummary> {
  const emptySummary: SessionSummary = {
    session_number,
    new_signals: [],
    dimension_updates: {},
    open_questions_resolved: [],
    new_open_questions: [],
    recommendation_made: null,
    recommendation_accepted: null,
  }

  const transcript = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
    .join('\n')

  if (!transcript) return emptySummary

  // ── 1. LLM extraction ─────────────────────────────────────
  let extracted: z.infer<typeof extractionSchema>
  try {
    const mistral = createMistral({ apiKey: process.env.MISTRAL_API_KEY })
    const { object } = await generateObject({
      model: mistral(MODELS.structured),
      schema: extractionSchema,
      system: SYSTEM_PROMPT,
      prompt: transcript,
      temperature: 0.2,
    })
    extracted = object
  } catch (err) {
    console.error('[analyze-session] extraction failed:', err)
    return emptySummary // session still valid, just no signals this round
  }

  // ── 2. Resolve each title → tmdb_id, cache it, build a signal ─
  const source = `session_${session_number}` as const
  const signals: DNASignal[] = []

  for (const t of extracted.mentioned_titles) {
    const match = await searchTitle(t.title, t.media_type).catch(() => null)
    if (!match) continue // unresolvable — cannot score without a tmdb_id

    // Cache the title so its crew feeds Strand A on merge (best-effort).
    await fetchAndCacheTitle(match.tmdb_id, match.type).catch(() => null)

    signals.push({
      title: match.title,
      tmdb_id: match.tmdb_id,
      type: match.type,
      reaction: t.reaction,
      quick_rating: t.quick_rating,
      regret_signal: null,
      source,
      reason: t.reason,
      dimensions_reinforced: t.dimensions_reinforced.filter((d) =>
        STRAND_B_SET.has(d),
      ) as (keyof StrandB)[],
      dimensions_contradicted: t.dimensions_contradicted.filter((d) =>
        STRAND_B_SET.has(d),
      ) as (keyof StrandB)[],
      confidence: t.confidence,
      flag: null,
      watched_at: null,
    })
  }

  // ── 3. Resolve directives ─────────────────────────────────
  // A person rule is matched against crew tmdb_person_id, so resolving the
  // name here is what makes "never show me X's films" do anything at all —
  // rules used to be stored with an empty id and silently matched nothing.
  const directives: SessionDirective[] = []
  for (const d of extracted.directives ?? []) {
    const name = d.name?.trim()
    if (!name) continue

    let resolvedName = name
    let id = ''
    if (d.target_type === 'person') {
      const person = await searchPerson(name).catch(() => null)
      if (person) {
        id = person.tmdb_person_id
        resolvedName = person.name
      }
      // No match → keep the rule anyway; exclusion-rules.ts falls back to
      // matching the crew member's name.
    }

    directives.push({
      kind: d.kind,
      target_type: d.target_type,
      name: resolvedName,
      raw: d.raw || name,
      reason: d.reason || '',
      weight_modifier:
        d.kind === 'soft_preference'
          ? (d.weight_modifier ?? DEFAULT_SOFT_WEIGHT)
          : undefined,
      person_id: id,
    })
  }

  return {
    session_number,
    new_signals: signals,
    dimension_updates: {},
    open_questions_resolved: extracted.resolved_open_questions,
    new_open_questions: extracted.new_open_questions,
    recommendation_made: null,
    recommendation_accepted: null,
    directives,
  }
}
