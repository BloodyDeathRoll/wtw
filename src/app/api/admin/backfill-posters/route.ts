/**
 * POST /api/admin/backfill-posters
 *
 * One-time / idempotent backfill: fills titles.poster_path for rows seeded
 * before the poster column existed (migration 0007). Selects titles with a
 * null poster_path, re-fetches each from TMDB, and updates only poster_path.
 *
 * Independent of narrative enrichment — touches a disjoint column — so it is
 * safe to run at any time. Protected by CRON_SECRET.
 *
 * Body (optional): { limit?: number }  // max rows to process (default 1000)
 *
 * Response: { updated, no_poster, failed, remaining }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMovie, getTV } from '@/lib/tmdb'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const limit: number = body.limit ?? 1000

  const db = createServiceClient()
  const { data: pending, error } = await db
    .from('titles')
    .select('tmdb_id, type')
    .is('poster_path', null)
    .limit(limit)

  if (error) {
    // Most likely cause: migration 0007 not yet applied (column missing).
    return NextResponse.json(
      { error: `Cannot read titles.poster_path — did migration 0007 run? (${error.message})` },
      { status: 500 },
    )
  }

  const rows = pending ?? []
  let updated = 0
  let no_poster = 0
  let failed = 0

  for (const row of rows) {
    try {
      const detail =
        row.type === 'movie'
          ? await getMovie(row.tmdb_id as string)
          : await getTV(row.tmdb_id as string)

      if (!detail || !detail.poster_path) {
        no_poster++            // TMDB has no poster asset for this title
      } else {
        const { error: upErr } = await db
          .from('titles')
          .update({ poster_path: detail.poster_path })
          .eq('tmdb_id', row.tmdb_id)
        if (upErr) failed++
        else updated++
      }
    } catch (err) {
      failed++
      console.error(`[backfill-posters] ${row.tmdb_id}:`, err)
    }
    await new Promise((r) => setTimeout(r, 150)) // TMDB rate-limit courtesy
  }

  // How many still lack a poster_path after this pass
  const { count: remaining } = await db
    .from('titles')
    .select('tmdb_id', { count: 'exact', head: true })
    .is('poster_path', null)

  return NextResponse.json({ updated, no_poster, failed, remaining: remaining ?? null })
}
