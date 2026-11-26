/**
 * Gemini (Google AI Studio, free tier) — the provider for every call that was
 * on Mistral until 2026-11-26: Mistral's Free mode stopped including API
 * access (every call answers 402 "You need a subscription to access this
 * API", any key, since some time after 2026-11-23). Model IDs stay in
 * ./ai-models.ts; this file only builds the client.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export function gemini() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  return createGoogleGenerativeAI({ apiKey })
}

/** Embeddings sized to the vector(1024) columns in the Supabase migrations. */
export const EMBED_OPTIONS = { google: { outputDimensionality: 1024 } }
