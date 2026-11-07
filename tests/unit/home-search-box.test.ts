import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The home screen's search box (under the circles) is /search's field and
// hands over to /search on focus, carrying anything typed in ?q=.
// Source-level check, like find-more-sends-more.test.ts — WTWApp has no render harness.

const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
const css = readFileSync('src/modules/session/components/WTWApp.module.css', 'utf8')
const search = readFileSync('src/app/search/SearchView.tsx', 'utf8')

describe('home search box', () => {
  it('sits in the home nav bar under the circles', () => {
    expect(app).toMatch(/<HomeNav[\s\S]*?\/>\s*<HomeSearch onOpen=\{openSearch\} \/>/)
  })

  it('is /search’s field: same stylesheet, same placeholder', () => {
    expect(app).toMatch(/import sx from "@\/app\/search\/search\.module\.css"/)
    expect(app).toMatch(/className=\{sx\.input\}/)
    const placeholders = app.match(/placeholder="Search titles and people"/g) ?? []
    expect(placeholders).toHaveLength(1)
    expect(search).toMatch(/placeholder="Search titles and people"/)
  })

  it('focus hands over to /search, with what was typed in ?q=', () => {
    expect(app).toMatch(/onFocus=\{\(e\) => onOpen\(/)
    expect(app).toMatch(/router\.push\(typed \? `\/search\?q=\$\{encodeURIComponent\(typed\)\}` : "\/search"\)/)
    expect(app).toMatch(/router\.prefetch\("\/search"\)/)
  })

  it('slides the box up by --search-dy and fades the rest; the trap timeout clears it', () => {
    expect(css).toMatch(/\.searchOpening \.homeSearch \{\s*transform: translateY\(var\(--search-dy/)
    expect(css).toMatch(/\.searchOpening \.scroll,[\s\S]*?opacity: 0;/)
    expect(app).toMatch(/setTimeout\(\(\) => setSearchDy\(null\), LEAVE_TIMEOUT_MS\)/)
  })

  it('/search starts from ?q= and strips it from the URL', () => {
    expect(search).toMatch(/useState\(\(\) => params\.get\("q"\) \?\? ""\)/)
    expect(search).toMatch(/sp\.has\("t"\) \|\| sp\.has\("p"\) \|\| sp\.has\("q"\)/)
  })
})
