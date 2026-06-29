import { createServiceClient } from '@/lib/supabase/service'
import type { DNASchema } from '@/types/dna'
import { createBlankDNA } from '../blank-dna'

export type TitleCrewMember = { tmdb_person_id: string; name: string }
export type TitleCrew = {
  directors:        TitleCrewMember[]
  writers:          TitleCrewMember[]
  cinematographers: TitleCrewMember[]
  cast:             (TitleCrewMember & { order: number })[]
}
export type TitleRow = {
  tmdb_id:            string
  crew:               TitleCrew
  pacing_tag:         string | null
  tone_tags:          string[]
  narrative_metadata: Record<string, unknown>
}

export async function loadDNA(user_id: string): Promise<DNASchema> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('users')
    .select('dna')
    .eq('id', user_id)
    .single<{ dna: DNASchema | null }>()

  if (error) throw new Error(`loadDNA: ${error.message}`)
  return data?.dna ?? createBlankDNA(user_id)
}

export async function saveDNA(user_id: string, dna: DNASchema): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('users')
    .update({ dna, updated_at: new Date().toISOString() })
    .eq('id', user_id)

  if (error) throw new Error(`saveDNA: ${error.message}`)
}

export async function fetchTitleCrew(tmdb_ids: string[]): Promise<Map<string, TitleRow>> {
  if (tmdb_ids.length === 0) return new Map()

  const db = createServiceClient()
  const { data, error } = await db
    .from('titles')
    .select('tmdb_id, crew, pacing_tag, tone_tags, narrative_metadata')
    .in('tmdb_id', tmdb_ids)

  if (error) throw new Error(`fetchTitleCrew: ${error.message}`)

  const map = new Map<string, TitleRow>()
  for (const row of data ?? []) {
    map.set(row.tmdb_id, row as TitleRow)
  }
  return map
}

// Increment taste_version and stamp last_updated — call before every saveDNA
export function bumpVersion(dna: DNASchema): void {
  dna.metadata.taste_version += 1
  dna.metadata.last_updated   = new Date().toISOString()
}
