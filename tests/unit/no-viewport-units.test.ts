import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * The app must never size anything with a viewport unit (vh, dvh, svh, lvh).
 *
 * 2026-10-16, measured on an Android phone in the installed app (Chrome 155,
 * standalone): innerHeight was 750 but the shell, laid out with 100dvh at
 * launch, was 806.8 tall. Chrome resolved the unit before the navigation bar
 * appeared and never re-laid the shell out, so the input bar sat under the
 * nav bar. This had been "fixed" twice before (100vh → 100dvh, then
 * safe-area padding) and came back both times, because both kept a viewport
 * unit. The shell is now `position: fixed; inset: 0`, sized by the layout
 * viewport, which Chrome keeps current. See WTWApp.module.css `.page`.
 */

const ROOT = join(process.cwd(), 'src')
// A number followed by any viewport unit — vh/vw/vmin/vmax and their
// d/s/l variants — not part of an identifier.
const VIEWPORT_UNIT = /(?<![\w-])\d*\.?\d+(?:[dsl]?(?:vh|vw|vmin|vmax))\b/

// The on-device diagnostic measures the units on purpose. Remove this entry
// when ViewportDebug.tsx is deleted (tracked in docs/INTEGRATION.md).
const ALLOWED = new Set(['src/modules/session/components/ViewportDebug.tsx'])

/** Stylesheets, plus TS/TSX for inline styles and style strings. */
function styleSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return styleSources(p)
    return /\.(css|tsx?)$/.test(p) ? [p] : []
  })
}

const rel = (file: string) => file.replace(process.cwd() + '/', '')

/** Source with comments removed, so the history notes don't trip the check. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('no viewport units', () => {
  it('finds the sources it is meant to scan', () => {
    const files = styleSources(ROOT)
    expect(files.filter((f) => f.endsWith('.css')).length).toBeGreaterThan(5)
    expect(files.filter((f) => f.endsWith('.tsx')).length).toBeGreaterThan(5)
  })

  it('every allow-listed file still exists (drop the entry when it goes)', () => {
    for (const f of ALLOWED) expect(existsSync(join(process.cwd(), f)), f).toBe(true)
  })

  it('nothing is sized in vh / vw / vmin / vmax (or the d/s/l variants)', () => {
    const files = styleSources(ROOT).filter((f) => !ALLOWED.has(rel(f)))
    const hits = files.flatMap((file) =>
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => VIEWPORT_UNIT.test(line))
        .map(({ line, n }) => `${rel(file)}:${n}  ${line}`),
    )
    expect(hits, `use % of a fixed/inset-0 box instead:\n${hits.join('\n')}`).toEqual([])
  })

  it('the app shell is pinned to the viewport box', () => {
    const css = stripComments(
      readFileSync(join(ROOT, 'modules/session/components/WTWApp.module.css'), 'utf8'),
    )
    // The top-level rule (at line start), not one nested in a media query.
    const page = /^\.page\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(page).toMatch(/position:\s*fixed/)
    expect(page).toMatch(/inset:\s*0/)
  })
})
