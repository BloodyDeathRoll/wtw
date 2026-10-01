/**
 * CSP violation sink for the report-only policy in src/middleware.ts.
 * Logs a capped summary so violations show in the function logs; stores
 * nothing. Unauthenticated by necessity — browsers send reports without
 * credentials — so the body is size-capped and only logged.
 */
import { NextResponse } from 'next/server'

const MAX_BODY = 8 * 1024

export async function POST(req: Request) {
  const text = (await req.text().catch(() => '')).slice(0, MAX_BODY)
  let report: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(text)
    report = (parsed?.['csp-report'] ?? parsed ?? {}) as Record<string, unknown>
  } catch {
    // Not JSON — nothing useful to log.
  }
  console.warn(
    '[csp-report]',
    JSON.stringify({
      directive: report['violated-directive'] ?? report['effective-directive'],
      blocked: report['blocked-uri'],
      page: report['document-uri'],
    }).slice(0, 500),
  )
  return new NextResponse(null, { status: 204 })
}
