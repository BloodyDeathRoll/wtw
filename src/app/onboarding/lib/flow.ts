/**
 * "Motion: Flow" (P2-U0, signed off 2026-11-11): only the title moves.
 *
 *   - Out: the old drifts 48px left and fades (320 ms, cubic-bezier(.4,0,.2,1)).
 *   - In: the new drifts in from 48px right (480 ms, cubic-bezier(.16,1,.3,1)), starting 90 ms in, so the two
 *     overlap and there's never an empty frame. A part can lag (the card's name and year follow by 50 ms).
 *   - Reduce motion: a plain crossfade.
 *
 * How: just before the change, `flowOut` lays a frozen copy of the screen over it with only the moving parts
 * visible and drifts those out; right after React renders the new state (a layout effect, before paint),
 * `flowIn` drifts the same parts of the real screen in. Only transform and opacity move.
 */
export type Part = { sel: string; lag?: number; fade?: boolean }

export const OUT_MS = 320
export const IN_MS = 480
export const IN_DELAY = 90
const OUT_EASE = 'cubic-bezier(.4,0,.2,1)'
const IN_EASE = 'cubic-bezier(.16,1,.3,1)'

export const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const pick = (root: Element, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]

export function flowOut(screen: HTMLElement | null, parts: Part[]): void {
  if (!screen?.parentElement || typeof screen.animate !== 'function') return
  const ghost = screen.cloneNode(true) as HTMLElement
  ghost.classList.add('ob-ghost')
  ghost.removeAttribute('id')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.visibility = 'hidden'
  screen.after(ghost)
  ghost.scrollTop = screen.scrollTop
  const still = reduceMotion()
  let end = 0
  for (const p of parts) {
    for (const el of pick(ghost, p.sel)) {
      el.style.visibility = 'visible'
      const lag = p.lag ?? 0
      end = Math.max(end, lag + OUT_MS)
      el.animate(
        still || p.fade
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-48px)', opacity: 0 }],
        { duration: OUT_MS, delay: lag, easing: OUT_EASE, fill: 'both' },
      )
    }
  }
  setTimeout(() => ghost.remove(), end + 20)
}

export function flowIn(screen: HTMLElement | null, parts: Part[]): void {
  if (!screen || typeof screen.animate !== 'function') return
  const still = reduceMotion()
  for (const p of parts) {
    for (const el of pick(screen, p.sel)) {
      el.animate(
        still || p.fade
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [{ transform: 'translateX(48px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
        { duration: IN_MS, delay: IN_DELAY + (p.lag ?? 0), easing: IN_EASE, fill: 'backwards' },
      )
    }
  }
}

/** The card's moving parts: the poster (with its + and share), then the name and year 50 ms behind. */
export const CARD_PARTS: Part[] = [{ sel: '.learn-poster' }, { sel: '.learn > h2', lag: 50 }, { sel: '.learn > .lmeta', lag: 50 }]
/** A card ↔ a message: the title or the message block moves; the buttons under it crossfade. */
export const MESSAGE_PARTS: Part[] = [
  ...CARD_PARTS, { sel: '.lmsg' },
  { sel: '.ltiles', fade: true }, { sel: '.learn > .unseen', fade: true }, { sel: '.lmsg-btns', fade: true },
]
/** One step to the next (genres → cards, cards → the screen before the picks): everything under the top bar. */
export const STEP_PARTS: Part[] = [
  { sel: ':scope > :not(.apptop):not(.seasonbar):not(.blockbar):not(.save-note)' },
  { sel: ':scope > .seasonbar', fade: true }, { sel: ':scope > .blockbar', fade: true },
]

/** Load posters before they slide in, so a poster never arrives empty. */
export function preload(paths: (string | null | undefined)[], size = 'w500'): void {
  if (typeof window === 'undefined') return
  for (const p of paths) if (p) new Image().src = `https://image.tmdb.org/t/p/${size}${p}`
}
