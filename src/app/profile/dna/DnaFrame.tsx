'use client'
/**
 * My taste's frame: the header over a scrolling page, with a quick-return header (Eran, 2026-11-14). At the top
 * the header is always there; scrolling down slides it away so the page gets the whole screen; scrolling up even a
 * little brings it back. It never hides while something in it has focus (the search box).
 */
import { useEffect, useRef, useState } from 'react'
import styles from './dna.module.css'

/** Pixels of scrolling, in one direction, before the header hides / comes back. */
const HIDE_AFTER = 12
const SHOW_AFTER = 8
/** Ignore scroll events while the header moves: the page's height changes under the scroll position then. */
const SETTLE_MS = 320

export function DnaFrame({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  const slot = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const el = slot.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let last = el.scrollTop, run = 0, settleUntil = 0, isHidden = false
    const set = (h: boolean) => {
      if (h === isHidden) return
      isHidden = h
      setHidden(h)
      settleUntil = performance.now() + SETTLE_MS
      run = 0
    }
    const onScroll = () => {
      const y = el.scrollTop
      if (performance.now() < settleUntil) { last = y; return }
      const dy = y - last
      last = y
      if (y <= (slot.current?.offsetHeight ?? 0)) { set(false); return }
      if (slot.current?.contains(document.activeElement)) return
      if (dy === 0) return
      run = Math.sign(dy) === Math.sign(run) ? run + dy : dy
      if (run > HIDE_AFTER) set(true)
      else if (run < -SHOW_AFTER) set(false)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <div ref={slot} className={`${styles.headerSlot} ${hidden ? styles.headerHidden : ''}`} style={{ marginTop: hidden ? -height : 0 }} aria-hidden={hidden || undefined}>
        {header}
      </div>
      <div ref={scroller} className={styles.scroller}>{children}</div>
    </>
  )
}
