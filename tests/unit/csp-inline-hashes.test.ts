import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// The CSP in src/middleware.ts allows layout.tsx's two inline scripts by hash.
// Editing a script without re-hashing it would get it reported now and
// blocked once the policy is enforced, so this pins the hashes to the source.

const layout = readFileSync('src/app/layout.tsx', 'utf8')
const middleware = readFileSync('src/middleware.ts', 'utf8')
const scripts = [...layout.matchAll(/__html:\s*`([^`]*)`/g)].map(m => m[1])

describe('CSP hashes match the inline scripts in layout.tsx', () => {
  it('finds both inline scripts', () => {
    expect(scripts).toHaveLength(2)
  })

  it.each(scripts.map(s => [s.slice(0, 40), s]))('%s… is allowed by hash', (_, script) => {
    const hash = createHash('sha256').update(script).digest('base64')
    expect(middleware).toContain(`'sha256-${hash}'`)
  })
})
