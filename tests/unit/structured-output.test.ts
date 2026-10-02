// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockLanguageModelV4, MockEmbeddingModelV4 } from 'ai/test'

// AI SDK v7 (2026-10-01): structured output moved from the deprecated
// generateObject to generateText + Output.object. Two behaviours the app
// relies on are driven here through the real modules with a mock model:
//   1. a valid reply is parsed and returned as `output`;
//   2. a reply that fails the schema throws an error that still carries the
//      raw `text` — enrich-title-narrative repairs off-vocabulary tone_tags
//      from it, and without `text` every such title would fail forever.

const level = (value: string) => ({ value, confidence: 0.8 })
const narrative = (tone_tags: string[]) => JSON.stringify({
  pacing_tag: 'slow_burn',
  tone_tags,
  narrative_metadata: {
    moral_ambiguity: level('high'), narrative_complexity: level('medium'),
    emotional_demand: level('medium_high'), originality_weight: { value: 0.7, confidence: 0.8 },
    humor_style: level('dry'), protagonist_type: level('everyman'), ensemble_vs_solo: level('slight_solo'),
  },
})

let replyText = ''
const textModel = () => new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: 'text', text: replyText }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  }),
})
const embedModel = new MockEmbeddingModelV4({
  doEmbed: async () => ({ embeddings: [Array(1024).fill(0.1)], warnings: [] }),
})
vi.mock('@ai-sdk/mistral', () => ({
  createMistral: () => Object.assign(() => textModel(), { embeddingModel: () => embedModel }),
}))

const updates: Record<string, unknown>[] = []
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q,
        single: async () => ({
          data: { tmdb_id: '1', title: 'Cléo from 5 to 7', type: 'movie', synopsis: 's',
                  genres: [{ name: 'Drama' }], crew: { directors: [], writers: [] } },
          error: null,
        }),
        update: (row: Record<string, unknown>) => { updates.push(row); return { eq: () => ({ eq: async () => ({ error: null }) }) } },
      }
      return q
    },
  }),
}))

vi.stubEnv('MISTRAL_API_KEY', 'test-key') // read by batchMistralApiKey(); the model is mocked
const { enrichTitleWithNarrative } = await import('@/modules/engine/enrichment/enrich-title-narrative')

describe('structured output on generateText + Output.object', () => {
  beforeEach(() => { updates.length = 0 })

  it('parses a valid reply into the title row', async () => {
    replyText = narrative(['warm'])
    await expect(enrichTitleWithNarrative('1', 'movie')).resolves.toBe(true)
    expect(updates[0]).toMatchObject({ pacing_tag: 'slow_burn', tone_tags: ['warm'] })
  })

  it('repairs an off-vocabulary tone from the error text instead of failing the title', async () => {
    replyText = narrative(['mysterious', 'dark', 'warm', 'hopeful'])
    await expect(enrichTitleWithNarrative('1', 'movie')).resolves.toBe(true)
    expect(updates[0]).toMatchObject({ tone_tags: ['dark', 'warm'] })
  })

  it('still fails a reply that cannot be repaired', async () => {
    replyText = 'not json'
    await expect(enrichTitleWithNarrative('1', 'movie')).rejects.toThrow()
    expect(updates).toHaveLength(0)
  })
})
