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

// ── The quick picks (P2-U0 Flow, the pick's stack-and-exit; timings from docs/prototypes/first-run/play.py) ──

/** The pair's titles: the poster button (poster, name, year) with its + and share. */
export const PAIR_PARTS: Part[] = [{ sel: '.duel .side :is(.pick, .rib, .shc)' }]
/** One side swapped ("Haven't seen"): only that side moves; the line under the question fades in with it. */
export const sideParts = (k: 0 | 1): Part[] => [
  { sel: `.duel .side:nth-child(${k + 1}) :is(.pick, .rib, .shc)` }, { sel: '.prompt p', fade: true },
]
/** After a pick the next pair arrives at 760 ms; after the last pick the next screen waits for the pile to leave. */
export const PEEK = 12, SLIDE = 600, EXIT_AT = 450, EXIT = 390, STACK = EXIT_AT + EXIT, NEXT_AT = 760
export const afterPick = (parts: Part[], lastPick: boolean): Part[] =>
  parts.map(p => ({ ...p, lag: (p.lag ?? 0) + (lastPick ? STACK : NEXT_AT) - IN_DELAY }))

/**
 * A pick. The picked poster has its 4px gold ring. The other poster slides across (600 ms, easing out), under the
 * picked one when the left is picked and over it when the right is picked, stopping 12px short. At 450 ms the pile
 * leaves to the left (390 ms, speeding up), fading over its last fifth; the names and years fade in the first
 * ~0.2 s. On the last pick everything else on the screen waits for the pile, then goes too.
 */
export function pickOut(screen: HTMLElement | null, pk: 0 | 1, lastPick: boolean): void {
  if (!screen?.parentElement || typeof screen.animate !== 'function') return
  const real = [...screen.querySelectorAll<HTMLElement>('.duel .side')]
  if (real.length !== 2) return
  real[pk].querySelector('.pick')?.classList.add('chosen')
  const L = real[0].getBoundingClientRect(), R = real[1].getBoundingClientRect()
  const ghost = screen.cloneNode(true) as HTMLElement
  ghost.classList.add('ob-ghost')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.visibility = 'hidden'
  screen.after(ghost)
  ghost.scrollTop = screen.scrollTop
  const still = reduceMotion()
  const sides = [...ghost.querySelectorAll<HTMLElement>('.duel .side')]
  const gap = R.left - L.left - PEEK, exit = L.right + 24
  sides.forEach((side, i) => {
    side.style.position = 'relative'
    side.style.zIndex = i === pk ? '3' : '1'
    for (const e of side.querySelectorAll<HTMLElement>('.pick, .rib, .shc')) {
      e.style.visibility = 'visible'
      if (still) { e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT_MS, easing: OUT_EASE, fill: 'forwards' }); continue }
      if (i === 1) e.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-gap}px)` }], { duration: SLIDE, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })
      e.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-exit}px)` }],
        { duration: EXIT, delay: EXIT_AT, easing: 'cubic-bezier(.45,0,.75,.4)', fill: 'both', composite: 'add' })
      // the fade is its own animation: added to the moves, a fade would do nothing (and the posters flashed)
      e.animate([{ opacity: 1 }, { offset: 0.8, opacity: 1 }, { opacity: 0 }], { duration: STACK, fill: 'forwards' })
    }
    const names = side.querySelector<HTMLElement>('.pick')?.children[1] as HTMLElement | undefined
    if (names && !still) names.animate([{ opacity: 1 }, { offset: 0.22, opacity: 0 }, { opacity: 0 }], { duration: STACK, fill: 'forwards' })
  })
  // The "Haven't seen" buttons go with the titles; on the last pick, so does everything under the top bar.
  const rest = lastPick
    ? [...ghost.querySelectorAll<HTMLElement>(':scope > :not(.apptop):not(.duel), .duel .unseen')]
    : [...ghost.querySelectorAll<HTMLElement>('.duel .unseen')]
  const wait = lastPick ? STACK - 120 : 0
  for (const e of rest) {
    e.style.visibility = 'visible'
    e.animate(still ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-48px)', opacity: 0 }],
      { duration: OUT_MS, delay: wait, easing: OUT_EASE, fill: 'both' })
  }
  setTimeout(() => ghost.remove(), Math.max(STACK, wait + OUT_MS) + 40)
}
