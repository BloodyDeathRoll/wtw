"use client";

// Search from any header (2026-11-07). The icon sits beside the app menu;
// tapping it sweeps /search's own field in from the right over the rest of
// the header row (the menu stays), focused in the tap's own gesture so the
// keyboard comes up, and pushes /search (prefetched), which renders with its
// field in its header. No loader: the sweep is the transition.
//
// `scope` is the screen's own titles, listed first on /search (?in=): the
// rated ones from Ratings, the saved ones from Watchlist; the home, Picks,
// Games and Taste DNA search all titles.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { LEAVE_TIMEOUT_MS } from "./RouteLoading";
import sx from "@/app/search/search.module.css";
import styles from "./HeaderSearch.module.css";

export type SearchScope = "ratings" | "watchlist";

/** /search, with the screen's group first and whatever was typed so far. */
export function searchUrl(scope: SearchScope | undefined, typed = ""): string {
  const parts = [scope && `in=${scope}`, typed && `q=${encodeURIComponent(typed)}`].filter(Boolean);
  return parts.length ? `/search?${parts.join("&")}` : "/search";
}

export function HeaderSearch({
  btnClass,
  scope,
  padLeft,
}: {
  /** The host header's icon-button class, so Back in the overlay matches its back button. */
  btnClass: string;
  scope?: SearchScope;
  /** Where the host's back button starts, when it isn't the row's own padding. */
  padLeft?: number;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<CSSProperties | null>(null);

  useEffect(() => {
    router.prefetch("/search");
  }, [router]);
  // If the route never lands (offline, a server error), give the header back.
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
    setBox({
      top: r.top,
      left: r.left,
      width: btn.getBoundingClientRect().right - r.left,
      height: r.height,
      paddingLeft: padLeft ?? getComputedStyle(row).paddingLeft,
    });
    router.push(searchUrl(scope));
  }

  return (
    <>
      <button ref={btnRef} type="button" className={btnClass} onClick={open} aria-label="search">
        <Search size={30} strokeWidth={1.5} aria-hidden />
      </button>
      {box && (
        <div className={styles.overlay} style={box}>
          <button
            type="button"
            className={btnClass}
            onClick={() => {
              setBox(null);
              router.back();
            }}
            aria-label="back"
          >
            <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
          </button>
          <form className={sx.field} role="search" onSubmit={(e) => e.preventDefault()}>
            <input
              className={sx.headerInput}
              type="search"
              enterKeyHint="search"
              autoFocus
              placeholder="Search titles and people"
              aria-label="Search titles and people"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              // One history entry: later letters only replace the URL /search
              // reads ?q= from when it mounts.
              onChange={(e) => router.replace(searchUrl(scope, e.target.value))}
            />
          </form>
        </div>
      )}
    </>
  );
}
