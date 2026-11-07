"use client";

// Search from any header (2026-11-07). The icon sits beside the app menu;
// tapping it sweeps /search's own field in from the right over the rest of
// the header row (the menu stays), focused in the tap's own gesture so the
// keyboard comes up. When the sweep has played, /search (prefetched) is
// pushed with whatever was typed so far, and renders with its field in its
// header. No loader: the sweep is the transition.
//
// `scope` is the screen's own titles, listed first on /search (?in=): the
// rated ones from Ratings, the saved ones from Watchlist; the home, Picks,
// Games and Taste DNA search all titles.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search, X } from "lucide-react";
import { LEAVE_TIMEOUT_MS } from "./RouteLoading";
import sx from "@/app/search/search.module.css";
import styles from "./HeaderSearch.module.css";

export type SearchScope = "ratings" | "watchlist";

/**
 * Where /search's Back may return (?from=): the home stages WTWApp deep-links
 * (its DEEP_LINK_STAGES) and the routes with a header search. Anything else
 * — including a crafted "//host" — is ignored and Back goes home.
 */
export const SEARCH_FROM = ["recommendations", "watchlist", "learning", "ratings", "/play", "/profile/dna"] as const;
export type SearchFrom = (typeof SEARCH_FROM)[number];
export function safeFrom(v: string | null | undefined): SearchFrom | null {
  return (SEARCH_FROM as readonly string[]).includes(v ?? "") ? (v as SearchFrom) : null;
}

/** How long the sweep plays before /search is pushed (HeaderSearch.module.css). */
export const SWEEP_MS = 280;

/**
 * /search, with the screen's group first, where Back should return
 * (?from=: a home stage like "watchlist", or a route like "/play") and
 * whatever was typed so far.
 */
export function searchUrl(scope: SearchScope | undefined, typed = "", from?: SearchFrom): string {
  const parts = [
    scope && `in=${scope}`,
    from && `from=${encodeURIComponent(from)}`,
    typed && `q=${encodeURIComponent(typed)}`,
  ].filter(Boolean);
  return parts.length ? `/search?${parts.join("&")}` : "/search";
}

export function HeaderSearch({
  btnClass,
  scope,
  padLeft,
  from,
}: {
  /** The host header's icon-button class, so Back in the overlay matches its back button. */
  btnClass: string;
  scope?: SearchScope;
  /** Where the host's back button starts, when it isn't the row's own padding. */
  padLeft?: number;
  /** Where /search's Back returns: a home stage ("watchlist") or a route ("/play"); the home when unset. */
  from?: SearchFrom;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const [typed, setTyped] = useState("");
  // Back during the sweep cancels the push; after it, /search is on its way.
  const pushed = useRef(false);

  useEffect(() => {
    router.prefetch("/search");
  }, [router]);
  // The push happens once the sweep has played, with everything typed by
  // then; letters after that only replace the URL (one history entry).
  useEffect(() => {
    if (!box) return;
    pushed.current = false;
    const t = setTimeout(() => {
      pushed.current = true;
      router.push(searchUrl(scope, typedRef.current, from));
    }, SWEEP_MS);
    return () => clearTimeout(t);
  }, [box, router, scope, from]);
  // What's typed, for the timer above — it must not re-arm per letter.
  const typedRef = useRef("");
  // If the route never lands (offline, a server error), give the header
  // back — the push itself can't be taken back, as with the other route hops.
  useEffect(() => {
    if (!box) return;
    const t = setTimeout(() => setBox(null), LEAVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [box]);

  function open() {
    const btn = btnRef.current;
    if (box || !btn) return;
    // The row is the header element (data-header-row); the overlay covers it
    // from its left edge to the search icon's right edge, i.e. up to the gap
    // before the menu, which is exactly where /search's field ends.
    const row = btn.closest<HTMLElement>("[data-header-row]") ?? btn.parentElement!;
    const r = row.getBoundingClientRect();
    setTyped("");
    typedRef.current = "";
    setBox({
      top: r.top,
      left: r.left,
      width: btn.getBoundingClientRect().right - r.left,
      height: r.height,
      paddingLeft: padLeft ?? getComputedStyle(row).paddingLeft,
    });
  }
  function edit(v: string) {
    setTyped(v);
    typedRef.current = v;
    if (pushed.current) router.replace(searchUrl(scope, v, from));
  }
  // Back during the sweep cancels the push; once pushed, /search is landing
  // and will take over (its own Back returns here) — a router.back() now
  // could step past this screen.
  function back() {
    if (pushed.current) return;
    setBox(null);
  }

  return (
    <>
      <button ref={btnRef} type="button" className={btnClass} onClick={open} aria-label="search">
        <Search size={30} strokeWidth={1.5} aria-hidden />
      </button>
      {box && (
        <div className={styles.overlay} style={box}>
          <button type="button" className={btnClass} onClick={back} aria-label="back">
            <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
          </button>
          <form className={sx.field} role="search" onSubmit={(e) => e.preventDefault()}>
            <input
              className={sx.headerInput}
              type="search"
              enterKeyHint="search"
              autoFocus
              value={typed}
              onChange={(e) => edit(e.target.value)}
              placeholder="Search titles and people"
              aria-label="Search titles and people"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {typed && (
              <button
                type="button"
                className={`${sx.clear} ${sx.headerClear}`}
                onClick={() => edit("")}
                aria-label="Clear search"
              >
                <X size={22} strokeWidth={2} aria-hidden />
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
}
