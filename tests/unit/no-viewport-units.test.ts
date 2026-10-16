import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
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
// A number followed by vh / dvh / svh / lvh, not part of an identifier.
const VIEWPORT_UNIT = /(?<![\w-])\d*\.?\d+(?:d|s|l)?vh\b/

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return cssFiles(p)
    return p.endsWith('.css') ? [p] : []
  })
}

/** CSS with comments removed, so the history notes don't trip the check. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('no viewport units in CSS', () => {
  it('finds the stylesheets it is meant to scan', () => {
    expect(cssFiles(ROOT).length).toBeGreaterThan(5)
  })

  it('no stylesheet sizes anything in vh / dvh / svh / lvh', () => {
    const hits = cssFiles(ROOT).flatMap((file) =>
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => VIEWPORT_UNIT.test(line))
        .map(({ line, n }) => `${file.replace(process.cwd() + '/', '')}:${n}  ${line}`),
    )
    expect(hits, `use % of a fixed/inset-0 box instead:\n${hits.join('\n')}`).toEqual([])
  })

  it('the app shell is pinned to the viewport box', () => {
    const css = stripComments(
      readFileSync(join(ROOT, 'modules/session/components/WTWApp.module.css'), 'utf8'),
    )
    const page = /\.page\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(page).toMatch(/position:\s*fixed/)
    expect(page).toMatch(/inset:\s*0/)
  })
})
