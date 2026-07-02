import { describe, it, expect } from 'vitest'
import { safeNextPath } from '@/lib/safe-redirect'

// Guards the OAuth open-redirect defense (verified clean in the code review).
// This locks that behavior in so a future refactor can't quietly reopen it.
describe('safeNextPath', () => {
  it('passes through a plain same-origin path', () => {
    expect(safeNextPath('/profile/dna')).toBe('/profile/dna')
    expect(safeNextPath('/')).toBe('/')
  })

  it('collapses empty / nullish input to "/"', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
    expect(safeNextPath('')).toBe('/')
  })

  it.each([
    ['//evil.com', 'protocol-relative'],
    ['/\\evil.com', 'backslash-slash variant'],
    ['https://evil.com', 'absolute URL'],
    ['@evil.com', 'userinfo injection'],
    ['.evil.com', 'no leading slash'],
    ['/path\\with\\backslash', 'embedded backslash'],
  ])('blocks %s (%s) → "/"', (input) => {
    expect(safeNextPath(input)).toBe('/')
  })
})
