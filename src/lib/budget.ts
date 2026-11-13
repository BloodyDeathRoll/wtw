/**
 * The daily budget check (docs/plan/PLAN.md §6, soft launch: "Budgets have a
 * daily check"). Pure: turns a snapshot into warnings. The snapshot is taken
 * by scripts/budget-check.mts from reads that cost nothing — the database's
 * own size, and the marks the app already leaves in Redis when a free budget
 * runs out (the Why writer's `why_model_out:*`, Jev's `jev:failures`).
 *
 * Mistral's nightly budget and 429s are in grow-catalog's summary already
 * (`mistral_budget_exhausted`, `mistral_rate_limited`); TMDB has no quota and
 * Groq's /models endpoint carries no usage, so neither is read here.
 */

/** Supabase free tier: the project goes read-only past this. */
export const SUPABASE_FREE_DB_BYTES = 500 * 1024 * 1024
/** Warn from this share of the free tier. */
export const DB_WARN_SHARE = 0.8

export interface BudgetSnapshot {
  /** Null when the database couldn't be read (no SUPABASE_DB_URL). */
  dbBytes: number | null
  /** The biggest tables, for context. */
  dbTables?: { name: string; bytes: number }[]
  /** Groq models the Why writer has marked out of budget, with seconds until it tries them again. */
  modelsOut: { model: string; ttlSeconds: number }[]
  /** Jev failures logged in the last 24 hours (Jev is off while JEV_ENABLED=false). */
  jevFailures24h: number
  /** Keys in Redis (the free tier has no per-key cost, but a runaway count would show here). */
  redisKeys: number | null
}

export interface BudgetReport {
  ok: boolean
  warnings: string[]
  db: { mb: number; share: number } | null
}

export function budgetReport(s: BudgetSnapshot): BudgetReport {
  const warnings: string[] = []
  let db: BudgetReport['db'] = null
  if (s.dbBytes != null) {
    const share = s.dbBytes / SUPABASE_FREE_DB_BYTES
    db = { mb: Math.round(s.dbBytes / 1024 / 1024), share: Math.round(share * 1000) / 1000 }
    if (share >= DB_WARN_SHARE) {
      warnings.push(`database ${db.mb} MB = ${Math.round(share * 100)}% of the free tier's 500 MB (read-only at 100%)`)
    }
  } else {
    warnings.push('database size not read (no SUPABASE_DB_URL)')
  }
  for (const m of s.modelsOut) {
    warnings.push(`Groq model ${m.model} is out of budget for ${Math.ceil(m.ttlSeconds / 60)} more min (the Why writer skips it)`)
  }
  if (s.jevFailures24h > 0) warnings.push(`Jev failed ${s.jevFailures24h}× in 24 h`)
  return { ok: warnings.length === 0, warnings, db }
}
