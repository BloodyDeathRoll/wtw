/**
 * POST /api/recommendations/survey
 *
 * Receives a deep-survey submission and persists it as enriched signal data.
 * Assignment 3 (DNA Writer) consumes this to update strand_b dimension
 * confidence values and strand_c aspect weights.
 *
 * Body:
 * {
 *   tmdb_id:            string
 *   dimension_ratings:  Record<string, string>   // e.g. { moral_ambiguity: "Deeply Ambiguous" }
 *   aspect_ratings:     Record<string, "good" | "ok" | "weak">
 * }
 *
 * TODO (Assignment 3): replace the console.log stub with real DNA strand updates.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let tmdb_id: string
  let dimension_ratings: Record<string, string>
  let aspect_ratings: Record<string, "good" | "ok" | "weak">

  try {
    const body = await req.json()
    tmdb_id           = body.tmdb_id
    dimension_ratings = body.dimension_ratings ?? {}
    aspect_ratings    = body.aspect_ratings    ?? {}

    if (!tmdb_id || typeof tmdb_id !== "string") {
      return NextResponse.json({ error: "tmdb_id is required" }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  // ── TODO (Assignment 3) ───────────────────────────────────
  // 1. Load user DNA from Supabase
  // 2. For each dimension_rating:
  //      - Compare film value to user's strand_b preference
  //      - If user liked the film: push key to dimensions_reinforced on the signal
  //      - If user disliked: push to dimensions_contradicted
  //      - Increment/decrement NarrativeDimension.confidence
  // 3. For each aspect_rating:
  //      - "good"  → increase strand_c.aspect_weights[key]
  //      - "weak"  → decrease strand_c.aspect_weights[key]
  // 4. Increment metadata.taste_version + update metadata.last_updated
  // 5. Save back to Supabase
  // ─────────────────────────────────────────────────────────

  console.log("[survey] received for", tmdb_id, {
    dimensions: Object.keys(dimension_ratings).length,
    aspects:    Object.keys(aspect_ratings).length,
  })

  return NextResponse.json({ ok: true })
}
