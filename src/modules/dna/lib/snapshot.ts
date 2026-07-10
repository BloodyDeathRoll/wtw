import type { DNASchema } from '@/types/dna'
// Service-role client: snapshot writes are trusted server-side operations and
// dna_snapshots has RLS enabled with a SELECT-only policy (migration 0006 —
// "service role handles all writes"). The cookie-based server client is subject
// to RLS and its INSERT is denied (42501); the service client bypasses RLS.
import { createServiceClient } from '@/lib/supabase/service'

/** Maximum number of snapshots to retain per user */
const MAX_SNAPSHOTS = 5

/**
 * Stores an immutable snapshot of the current DNA after a write.
 * Prunes oldest entries when the total exceeds MAX_SNAPSHOTS.
 *
 * Snapshots live in the `dna_snapshots` table:
 *   id            uuid PK
 *   user_id       uuid FK → users.id
 *   taste_version integer
 *   snapshot      jsonb
 *   created_at    timestamptz
 */
export async function storeSnapshot(
  userId: string,
  dna: DNASchema,
): Promise<void> {
  const supabase = createServiceClient()

  // Insert the new snapshot
  const { error: insertError } = await supabase
    .from('dna_snapshots')
    .insert({
      user_id:       userId,
      taste_version: dna.metadata.taste_version,
      snapshot:      dna,
    })

  if (insertError) {
    console.error('[snapshot] Failed to insert snapshot:', insertError)
    return
  }

  // Prune — keep only the MAX_SNAPSHOTS most recent
  const { data: all, error: fetchError } = await supabase
    .from('dna_snapshots')
    .select('id, taste_version')
    .eq('user_id', userId)
    .order('taste_version', { ascending: false })

  if (fetchError || !all) {
    console.error('[snapshot] Failed to fetch snapshots for pruning:', fetchError)
    return
  }

  if (all.length > MAX_SNAPSHOTS) {
    const toDelete = all.slice(MAX_SNAPSHOTS).map((r) => r.id)
    const { error: deleteError } = await supabase
      .from('dna_snapshots')
      .delete()
      .in('id', toDelete)

    if (deleteError) {
      console.error('[snapshot] Failed to prune old snapshots:', deleteError)
    }
  }
}

/**
 * Returns the last MAX_SNAPSHOTS snapshots for a user, newest first.
 * Used by the rollback UI and the "Why this?" explanation flow.
 */
export async function getSnapshots(userId: string): Promise<DNASchema[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('dna_snapshots')
    .select('snapshot')
    .eq('user_id', userId)
    .order('taste_version', { ascending: false })
    .limit(MAX_SNAPSHOTS)

  if (error || !data) {
    console.error('[snapshot] Failed to fetch snapshots:', error)
    return []
  }

  return data.map((row) => row.snapshot as DNASchema)
}

/**
 * Rolls back the user's live DNA to a previous snapshot version.
 * The rolled-back DNA is written back to users.dna — taste_version is
 * preserved from the snapshot (not incremented) so history is clear.
 */
export async function rollbackToSnapshot(
  userId: string,
  tasteVersion: number,
): Promise<void> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('dna_snapshots')
    .select('snapshot')
    .eq('user_id', userId)
    .eq('taste_version', tasteVersion)
    .single()

  if (error || !data?.snapshot) {
    console.error('[snapshot] Snapshot not found for rollback:', tasteVersion, error)
    return
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ dna: data.snapshot })
    .eq('id', userId)

  if (updateError) {
    console.error('[snapshot] Failed to write rollback to users:', updateError)
  }
}
