import { describe, it, expect } from 'vitest'
import { budgetReport, SUPABASE_FREE_DB_BYTES } from '@/lib/budget'

// PLAN §6 (soft launch): budgets have a daily check.

const MB = 1024 * 1024
const ok = { dbBytes: 387 * MB, modelsOut: [], jevFailures24h: 0, redisKeys: 378 }

describe('budgetReport', () => {
  it('all clear at 77% of the database tier, nothing out, no Jev failures', () => {
    expect(budgetReport(ok)).toEqual({ ok: true, warnings: [], db: { mb: 387, share: 0.774 } })
  })

  it('warns from 80% of the 500 MB free tier', () => {
    const r = budgetReport({ ...ok, dbBytes: 0.8 * SUPABASE_FREE_DB_BYTES })
    expect(r.ok).toBe(false)
    expect(r.warnings[0]).toMatch(/400 MB = 80% of the free tier's 500 MB/)
    expect(budgetReport({ ...ok, dbBytes: 0.79 * SUPABASE_FREE_DB_BYTES }).ok).toBe(true)
  })

  it('warns when the Why writer has marked a Groq model out of budget', () => {
    const r = budgetReport({ ...ok, modelsOut: [{ model: 'openai/gpt-oss-120b', ttlSeconds: 610 }] })
    expect(r.warnings).toEqual(['Groq model openai/gpt-oss-120b is out of budget for 11 more min (the Why writer skips it)'])
  })

  it('warns on Jev failures, and when the database could not be read', () => {
    expect(budgetReport({ ...ok, jevFailures24h: 3 }).warnings).toEqual(['Jev failed 3× in 24 h'])
    expect(budgetReport({ ...ok, dbBytes: null }).warnings).toEqual(['database size not read (no SUPABASE_DB_URL)'])
  })
})
