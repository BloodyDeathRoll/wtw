"use client";

// Search from any header (2026-11-07). The icon sits beside the app menu;
// tapping it sweeps the search screen in from the right — the same
// SearchView the /search route renders, with its field focused in the tap's
// own gesture so the keyboard comes up. The URL becomes /search?… by
// pushState (Next syncs the router's path and params; no navigation), so the
// host screen stays mounted underneath and the field never re-mounts: a
// route swap dropped the keyboard and brought it back (reported 2026-11-07).
// Back — the arrow, or the phone's — pops that entry, which closes it. A
// reload lands on the real /search route, which renders the same view.
//
// `scope` is the screen's own titles, listed first (?in=): the rated ones
// from Ratings, the saved ones from Watchlist; the home, Picks, Games and
// Taste DNA search all titles.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import AppShell from "@/modules/session/components/AppShell";
import type { AppUser } from "@/modules/session/types";
import SearchView from "@/app/search/SearchView";
import { searchUrl, type SearchFrom, type SearchScope } from "@/app/search/url";
import styles from "./HeaderSearch.module.css";

export function HeaderSearch({
  btnClass,
  user,
  scope,
  from,
}: {
  /** The host header's icon-button class. */
  btnClass: string;
  user: AppUser;
  scope?: SearchScope;
  /** Where /search's Back returns after a reload: a home stage ("watchlist") or a route ("/play"); the home when unset. */
  from?: SearchFrom;
}) {
  const [open, setOpen] = useState(false);

  // Back pops the /search entry (SearchView's own Back, or the phone's):
  // the URL is the host's again, so the screen is.
  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      if (window.location.pathname !== "/search") setOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  function show() {
    if (open) return;
    window.history.pushState(null, "", searchUrl(scope, "", from));
    setOpen(true);
  }

  return (
    <>
      <button type="button" className={btnClass} onClick={show} aria-label="search">
        <Search size={30} strokeWidth={1.5} aria-hidden />
      </button>
      {/* Portalled to body like RouteLoading's overlay: inside a header, an
          ancestor with a backdrop-filter would clip it. */}
      {open &&
        createPortal(
          <div className={styles.overlay}>
            <AppShell>
              <SearchView user={user} inPlace />
            </AppShell>
          </div>,
          document.body,
        )}
    </>
  );
}
