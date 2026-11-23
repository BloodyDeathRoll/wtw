/**
 * v3 F8 (FAST_TABS; docs/plan/v3/PLAN.md §4 F8, DEC-10): Games and You open at once.
 *
 * - **Kept:** next.config.ts lets the router reuse a page you left a few minutes ago (`staleTimes.dynamic`), so the
 *   way back to a tab renders nothing on the server.
 * - **Fetched ahead:** once the app is idle, each tab screen fetches the other tabs whole (`startFastTabs`), so even a
 *   first visit is in memory when it's tapped. They're fetched again when the router drops them.
 * - **Never wrong:** a write (a rating, a save, a hide, a game's answer) marks every kept page out of date
 *   (`tabsChanged`). The next way out of the screen (a tab, the games' own way out, a link the home route opens)
 *   clears the router's memory first (`refreshIfStale`, which is `router.refresh()`), so the next screen is fetched
 *   new, and the tabs are fetched ahead again from there. Start my taste over and Delete my account load the app
 *   afresh, which forgets everything anyway.
 * - **Not in the background:** a refresh that runs to the end on the home route, with the tabs then fetched ahead
 *   again, left the way back to For you on the loading screen for good (Next 16.4, seen 2026-11-22). Cleared on the
 *   way out, the refresh is overtaken by the navigation and that never happens.
 *
 * For you keeps its 20 itself (src/modules/session/recommendations/held-twenty.ts): it is a stage of the home route,
 * not a page of its own. Flag off: none of this runs, and the tabs are today's.
 */
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { fastTabsEnabled } from "@/lib/flags";
import { HIDDEN_EVENT, RATED_EVENT } from "@/modules/session/recommendations/rate";

/** What this needs of Next's router (useRouter()). */
export interface TabsRouter {
  refresh(): void;
  prefetch(href: string, options?: { kind: PrefetchKind; onInvalidate?: () => void }): void;
}

/** The screen you just opened fetches its own things first; the other tabs wait this long, then for an idle moment. */
export const PREFETCH_AFTER_MS = 1500;

let stale = false;
let listening = false;

/** A write landed somewhere in WTW: what a kept page shows may be out of date. */
export function tabsChanged(): void {
  if (!fastTabsEnabled()) return;
  stale = true;
}

/** Whether a kept page may be out of date (for tests and the checks below). */
export function tabsStale(): boolean {
  return stale;
}

/**
 * Right before leaving a screen (call it, then router.push): if anything was written since the last time, the router
 * forgets every kept page, so the next screen is fetched new. The refresh it starts for the screen you're leaving is
 * overtaken by the navigation.
 */
export function refreshIfStale(r: TabsRouter): void {
  if (!stale || !fastTabsEnabled()) return;
  stale = false;
  r.refresh();
}

function listen(): void {
  if (listening) return;
  listening = true;
  // Ratings and hides announce themselves wherever they're made (rate.ts). Saves and the games' answers call
  // tabsChanged themselves (watchlist.ts, play/components/persist.ts): the Watchlist's change event also fires when
  // the server's list is merged in on every visit, which changes nothing a kept page shows.
  for (const e of [RATED_EVENT, HIDDEN_EVENT]) window.addEventListener(e, tabsChanged);
}

function whenIdle(run: () => void): () => void {
  let idle = 0;
  const t = setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: 3000 });
    else run();
  }, PREFETCH_AFTER_MS);
  return () => {
    clearTimeout(t);
    if (idle && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
  };
}

/**
 * On a tab screen (TabBar's effect): listen for writes, and once the app is idle fetch the other tabs (`hrefs`) whole,
 * so tapping one shows it at once. When the router drops one, it's fetched again at the next idle moment. Returns the
 * cleanup. No hrefs (the copy of the bar drawn over a loading screen): nothing, the real bar stays in charge. Kept free of React so server code that imports watchlist.ts can import this too.
 */
export function startFastTabs(r: TabsRouter, hrefs: readonly string[]): () => void {
  if (!fastTabsEnabled() || hrefs.length === 0) return () => {};
  listen();
  const cancels: (() => void)[] = [];
  // Next keeps an onInvalidate after the screen that asked is gone: only a screen still showing fetches again (one
  // that has closed would fetch its tabs from wherever you are now, the screen you're on included).
  let live = true;
  const fetchAhead = (href: string) => {
    if (!live) return;
    cancels.push(
      whenIdle(() => r.prefetch(href, { kind: "full" as PrefetchKind, onInvalidate: () => fetchAhead(href) })),
    );
  };
  hrefs.forEach(fetchAhead);
  return () => {
    live = false;
    cancels.forEach((c) => c());
  };
}

/** Tests only: forget everything. */
export function resetFastTabsForTests(): void {
  stale = false;
}
