// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// One-sentence plots for cards whose own plot won't fit (2026-11-06): once
// per title, checked against the plot, fact-checked by a second model.

const generateText = vi.fn()
const store = new Map<string, string>()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@ai-sdk/mistral', () => ({ createMistral: () => (model: string) => ({ model }) }))
vi.mock('@ai-sdk/groq', () => ({ createGroq: () => (model: string) => ({ model }) }))
vi.mock('@/lib/redis', () => ({ getRedis: () => ({
  mget: async (...keys: string[]) => keys.map(k => store.get(k) ?? null),
  set: async (k: string, v: string) => { store.set(k, v); return 'OK' },
}) }))
process.env.MISTRAL_API_KEY = 'test'
process.env.GROQ_API_KEY = 'test'
const { cardPlots, plotLineOk } = await import('@/modules/engine/pipeline/card-plot')
const { MODELS } = await import('@/lib/ai-models')

const LONG = 'Fired from his band and hard up for cash guitarist and vocalist Dewey Finn finagles his way into a job as a fifth-grade substitute teacher at a private school and secretly begins teaching his straight-A students the finer points of rock.'
const item = (id: string, synopsis: string) => ({ title: { tmdb_id: id, type: 'movie' as const, title: 'The School of Rock', synopsis } })

describe('plotLineOk', () => {
  it('takes a sentence that keeps to the plot', () => {
    expect(plotLineOk('Dewey Finn talks his way into a substitute teaching job and turns his class into a rock band.', LONG, 'The School of Rock')).toBe(true)
  })
  it.each([
    ['a name the plot lacks', 'Dewey Finn and Ned Schneebly start a band at a private school.'],
    ['a number the plot lacks', 'Dewey Finn teaches 12 students at a private school to play rock.'],
    ['an opinion', 'Dewey Finn leads a hilarious rock band of fifth-graders at a private school.'],
    ['talk to the viewer', 'You will watch Dewey Finn turn a class of fifth-graders into a rock band.'],
    ['too long for the card', 'Dewey Finn ' + 'rocks '.repeat(30) + 'on.'],
  ])('refuses %s', (_, line) => {
    expect(plotLineOk(line, LONG, 'The School of Rock')).toBe(false)
  })
})

describe('cardPlots', () => {
  beforeEach(() => { generateText.mockReset(); store.clear() })
  const models = () => generateText.mock.calls.map(c => (c[0] as { model: { model: string } }).model.model)

  it('asks only for plots that don\'t fit, keeps what the fact-check passes, and caches it per title', async () => {
    generateText
      .mockResolvedValueOnce({ text: '1 | Dewey Finn talks his way into a substitute teaching job and turns his class into a rock band.\n2 | Dewey Finn hires Jack Black.' })
      .mockResolvedValueOnce({ text: '1 | OK' })
    const out = await cardPlots([item('1', LONG), item('2', LONG + ' Again.'), item('3', 'A short plot that fits the card on its own just fine, thank you.')])
    expect([...out.keys()]).toEqual(['movie:1'])
    expect(models()).toEqual([MODELS.cardPlot, MODELS.whyJudge])
    expect(store.get('card_plot:v2:movie:1')).toMatch(/^Dewey Finn/)

    generateText.mockReset()
    const again = await cardPlots([item('1', LONG)])
    expect(again.get('movie:1')).toMatch(/^Dewey Finn/)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('uses nothing when the fact-check is down — never an unchecked summary', async () => {
    generateText
      .mockResolvedValueOnce({ text: '1 | Dewey Finn talks his way into a substitute teaching job and turns his class into a rock band.' })
      .mockRejectedValueOnce(new Error('rate limited'))
    expect((await cardPlots([item('1', LONG)])).size).toBe(0)
    expect(store.size).toBe(0)
  })

  it('never holds a batch up: a slow model is finished in the background and cached for next time', async () => {
    let release!: () => void
    generateText
      .mockImplementationOnce(() => new Promise(r => { release = () => r({ text: '1 | Dewey Finn talks his way into a substitute teaching job and turns his class into a rock band.' }) }))
      .mockResolvedValueOnce({ text: '1 | OK' })
    const out = await cardPlots([item('1', LONG)], 20)
    expect(out.size).toBe(0)
    release()
    await new Promise(r => setTimeout(r, 20))
    expect(store.get('card_plot:v2:movie:1')).toMatch(/^Dewey Finn/)
  })

  it('never uses the chat\'s model', async () => {
    expect([MODELS.cardPlot, MODELS.whyJudge]).not.toContain(MODELS.text)
  })
})
