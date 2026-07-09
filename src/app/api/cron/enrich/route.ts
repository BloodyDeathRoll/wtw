/**
 * POST /api/cron/enrich
 *
 * Triggered nightly by Vercel Cron (configured in vercel.json).
 * Protected by CRON_SECRET to prevent unauthorized calls.
 *
 * Add to vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/enrich", "schedule": "0 3 * * *" }]
 * }
 *
 * Add to Vercel environment variables:
 *   CRON_SECRET = <any strong random string>
 * Vercel Cron passes it as Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server'
import { runNightlyEnrichment } from '@/modules/engine/enrichment/nightly-enrichment'

// A full serial run (20 titles + 20 crew at ~13s per LLM call) takes ~8-9 min.
// Vercel's default function timeout is 300s — raise to the Fluid Compute max
// so the nightly run isn't killed mid-batch.
export const maxDuration = 800

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runNightlyEnrichment()
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/enrich] Fatal error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
