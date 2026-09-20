import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

  it('catches a NEW call site added anywhere in src/', () => {
    // Scans the tree rather than re-checking the list above — otherwise this
    // only re-states CALL_SITES and cannot see a fifth site appear.
    const found: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name)
        if (e.isDirectory()) walk(path)
        else if (/\.tsx?$/.test(e.name) && readFileSync(path, 'utf8').includes('MODELS.text')) {
          found.push(path)
        }
      }
    }
    walk('src')

    // ai-models.ts declares it; everything else must be a known call site.
    const callers = found.filter(f => !f.endsWith('ai-models.ts'))
    expect(callers.sort()).toEqual([...CALL_SITES].sort())
  })
})
