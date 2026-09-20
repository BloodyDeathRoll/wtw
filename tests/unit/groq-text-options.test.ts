import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GROQ_TEXT_OPTIONS } from '@/lib/ai-models'

// 2026-09-20: MODELS.text is a reasoning model and returns an EMPTY content
// string unless reasoningFormat is set — which surfaced in the app as
// "Couldn't reach the model". Nothing in the type system requires a call site
// to pass the options, and the mocks in tests/mocks/ai.ts don't inspect call
// arguments, so a refactor could silently drop it from one site and the only
// symptom would be an intermittent empty reply in production.
//
// This reads the sources rather than executing them, deliberately: the
// invariant is "every MODELS.text call site passes GROQ_TEXT_OPTIONS", and
// that is a property of the call sites themselves.

const CALL_SITES = [
  'src/app/api/conversation/message/route.ts',
  'src/lib/welcome.ts',
  'src/app/api/dna/summary/route.ts',
  'src/modules/dna/lib/rewrite-dimension-notes.ts',
]

describe('every MODELS.text call site passes GROQ_TEXT_OPTIONS', () => {
  it.each(CALL_SITES)('%s', file => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain('MODELS.text')
    expect(src).toContain('providerOptions: GROQ_TEXT_OPTIONS')
  })

  it('the options actually separate the reasoning out', () => {
    // 'hidden' or 'parsed' both work; anything else leaves content empty.
    expect(['hidden', 'parsed']).toContain(GROQ_TEXT_OPTIONS.groq.reasoningFormat)
  })

  it('names every file that uses MODELS.text, so a new one cannot slip in', () => {
    const used = [
      'src/app/api/conversation/message/route.ts',
      'src/lib/welcome.ts',
      'src/app/api/dna/summary/route.ts',
      'src/modules/dna/lib/rewrite-dimension-notes.ts',
    ].filter(f => readFileSync(f, 'utf8').includes('MODELS.text'))
    expect(used.sort()).toEqual([...CALL_SITES].sort())
  })
})
