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

// 300s is the platform max on the Hobby/personal plan this project runs on
// (800 was rejected at deploy). The per-run batch in runNightlyEnrichment is
// sized to finish comfortably inside 300s; it's idempotent, and the Dream
// nightly automation is the primary bulk-enrichment driver, so this cron is a
// backup that just drains a small slice each night.
export const maxDuration = 300

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
