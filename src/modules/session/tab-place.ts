/**
 * v3 N2 (docs/plan/v3/YOU.md DEC-2; behind NAV_HISTORY): every tab remembers where you were. Leave a tab and come
 * back, and its screen opens scrolled to the same place, for this session. Tapping the tab you're on still goes to
 * the top (TabBar), and that top is then what's remembered.
 *
 * The seam with F1 (Eran on #357): F1 owns *what* For you shows, N2 owns *where you were*; the screen's main scroller,
 * marked `data-tab-scroll` (TAB_SCROLL), is all they share. For you keeps its place only once FOR_YOU_V3 is on, when
 * its list stays the same until Refresh; until then it opens at the top, as today.
 */
import { useEffect } from "react";

const PREFIX = "wtw:place:";
/** Long enough for a list that pages in as you scroll (Seen, the Watchlist) to reach a deep place, a page at a time. */
const RESTORE_MS = 4000;

let current: string | null = null;
let restoring = false;
let listening = false;
/** The last position a restore set: its own scroll event is not a place to remember (it may land after the restore). */
let placed: { el: HTMLElement; top: number } | null = null;

function read(key: string): number {
  try {
    return Number(window.sessionStorage.getItem(PREFIX + key)) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, top: number): void {
  try {
    window.sessionStorage.setItem(PREFIX + key, String(Math.round(top)));
  } catch {
    // Storage off: nothing remembered, nothing breaks.
  }
}

/** The screen's main scroller: the last one marked and on screen (a leaving screen may still be in the page). */
export function tabScroller(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-tab-scroll]")].filter((el) => el.isConnected && el.getClientRects().length > 0);
  return all[all.length - 1] ?? null;
}

function onScroll(e: Event): void {
  const el = e.target;
  if (!current || restoring || !(el instanceof HTMLElement) || !el.hasAttribute("data-tab-scroll")) return;
  if (placed && placed.el === el && Math.round(el.scrollTop) === Math.round(placed.top)) return;
  placed = null;
  write(current, el.scrollTop);
}

/**
 * Keep the place of the tab screen named `key` (null: keep nothing, e.g. For you before FOR_YOU_V3). Scrolls are
 * saved as they happen; when `key` changes to a screen with a saved place, its scroller is brought back to it, page by
 * page if its list loads as it scrolls, until it gets there, the user touches the screen, or RESTORE_MS passes.
 */
export function useTabPlace(key: string | null): void {
  useEffect(() => {
    if (!listening) {
      document.addEventListener("scroll", onScroll, { capture: true, passive: true });
      listening = true;
    }
    // No key (For you before FOR_YOU_V3, the copy over a loading screen): leave whatever the real bar keeps alone.
    if (!key) return;
    current = key;
    const forget = () => {
      if (current === key) current = null;
    };
    const target = read(key);
    if (target <= 0) return forget;

    let frame = 0;
    const until = Date.now() + RESTORE_MS;
    const stop = () => {
      restoring = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("touchstart", stop, true);
      window.removeEventListener("wheel", stop, true);
      window.removeEventListener("keydown", stop, true);
    };
    // Your own touch wins: a restore never fights the finger.
    window.addEventListener("touchstart", stop, true);
    window.addEventListener("wheel", stop, true);
    window.addEventListener("keydown", stop, true);
    restoring = true;
    const step = () => {
      const el = tabScroller();
      if (el) {
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(target, max);
        placed = { el, top: el.scrollTop };
        if (max >= target) return stop();
      }
      if (Date.now() > until) return stop();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      stop();
      forget();
    };
  }, [key]);
}
