/**
 * buildLineageGraph
 *
 * Given a crew member's TMDB person ID, uses Groq to identify their
 * creative influence relationships (who they were influenced by, who
 * they went on to influence) and stores the result in crew_members.
 *
 * This is knowledge-based extraction: Llama 3.3 70B has strong training
 * data on film/TV lineage for well-known directors, writers, and cinematographers.
 * For obscure crew members, it will return shorter or empty lists — that's fine.
 *
 * The result is used by lineage-boost.ts during scoring (Step 2):
 *   - If a user has high affinity for director X with lineage_boost: "high"
 *   - We traverse X's "influences" list (people X influenced)
 *   - Titles by those people get a fractional boost
 *
 * Lineage traversal is 2 degrees, weight halved per degree.
 */

import { generateObject } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { z } from 'zod'
import { getPerson } from '@/lib/tmdb'
import { createServiceClient } from '@/lib/supabase/service'

const TMDB_BASE = 'https://api.themoviedb.org/3'

function groq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return createGroq({ apiKey: key })
}

// ─────────────────────────────────────────────
// Zod schema for Groq lineage extraction
// ─────────────────────────────────────────────

const lineagePersonSchema = z.object({
  name: z.string().describe('Full name as commonly known'),
  relationship: z.string().describe(
    'Nature of the connection — e.g. "mentored", "frequent collaborator", ' +
    '"stylistic disciple", "cinematographer who defined their visual style", ' +
    '"writer they collaborated with across multiple films"'
  ),
})

const lineageSchema = z.object({
  influenced_by: z.array(lineagePersonSchema).max(5)
    .describe('Filmmakers, writers, or artists who significantly shaped this person\'s work'),
  influences: z.array(lineagePersonSchema).max(5)
    .describe('Filmmakers, writers, or artists who this person went on to influence'),
})

// ─────────────────────────────────────────────
// TMDB person search (local helper)
// ─────────────────────────────────────────────

async function searchPersonId(name: string): Promise<string | null> {
  const key = process.env.TMDB_API_KEY
  if (!key) throw new Error('TMDB_API_KEY is not set')

  const url = new URL(`${TMDB_BASE}/search/person`)
  url.searchParams.set('api_key', key)
  url.searchParams.set('query', name)
  url.searchParams.set('limit', '1')

  const res = await fetch(url.toString(), { next: { revalidate: 0 } })
  if (!res.ok) return null

  const data: { results: { id: number; name: string }[] } = await res.json()
  return data.results[0] ? String(data.results[0].id) : null
}

// ─────────────────────────────────────────────
// Core function
// ─────────────────────────────────────────────

/**
 * Builds and stores the lineage graph for a crew member.
 * No-ops if the person already has lineage data (enriched_at is set).
 *
 * @param tmdb_person_id  TMDB person ID
 * @returns               true if built, false if person not found or already enriched
 */
export async function buildLineageGraph(tmdb_person_id: string): Promise<boolean> {
  const supabase = createServiceClient()

  // ── 1. Check if already enriched ─────────────────────────
  const { data: existing } = await supabase
    .from('crew_members')
    .select('tmdb_person_id, name, primary_role, enriched_at')
    .eq('tmdb_person_id', tmdb_person_id)
    .single()

  if (!existing) return false
  if (existing.enriched_at) return false   // already built — skip

  // ── 2. Fetch person detail from TMDB ─────────────────────
  const person = await getPerson(tmdb_person_id)
  if (!person) return false

  const knownForTitles = person.known_for
    .map(kf => `"${kf.title}" (${kf.type})`)
    .join(', ')

  // ── 3. Extract lineage via Groq ───────────────────────────
  const prompt = `You are a film historian. Identify creative lineage connections for this filmmaker.

Name: ${person.name}
Primary role: ${existing.primary_role ?? person.known_for_department}
Known for: ${knownForTitles || 'various works'}

Return:
1. "influenced_by": up to 5 filmmakers/artists who significantly shaped ${person.name}'s work
2. "influences": up to 5 filmmakers/artists who ${person.name} went on to influence

Only include connections where the influence is well-documented or widely recognized.
If you are uncertain about a connection, omit it rather than speculate.
Focus on directors, writers, and cinematographers — not studios or movements.`

  const { object: lineage } = await generateObject({
    model: groq()('llama-3.3-70b-versatile'),
    schema: lineageSchema,
    prompt,
  })

  // ── 4. Resolve names → TMDB person IDs ───────────────────
  async function resolveEntry(entry: { name: string; relationship: string }) {
    const id = await searchPersonId(entry.name).catch(() => null)
    return {
      id: id ?? '',           // empty string if not resolvable — filtered below
      name: entry.name,
      relationship: entry.relationship,
    }
  }

  const [resolvedInfluencedBy, resolvedInfluences] = await Promise.all([
    Promise.all(lineage.influenced_by.map(resolveEntry)),
    Promise.all(lineage.influences.map(resolveEntry)),
  ])

  // Filter out entries where TMDB ID couldn't be resolved
  // They're still useful as name-only entries for display, but scoring uses IDs
  const influencedBy = resolvedInfluencedBy.filter(e => e.name)
  const influences   = resolvedInfluences.filter(e => e.name)

  // ── 5. Update crew_members row ────────────────────────────
  const { error } = await supabase
    .from('crew_members')
    .update({
      lineage_influences: { influenced_by: influencedBy, influences },
      enriched_at: new Date().toISOString(),
    })
    .eq('tmdb_person_id', tmdb_person_id)

  if (error) {
    throw new Error(`Failed to store lineage for ${tmdb_person_id}: ${error.message}`)
  }

  return true
}
