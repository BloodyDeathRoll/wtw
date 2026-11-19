"use client";

// Recommendations surface — opens when the user taps the "Recommendations
// Ready" pill. One vertical feed of full-screen cards, infinite-scroll,
// descending match%.
//
// Every card carries two feedback actions ("Seen & Liked" / "Don't Like")
// that POST to /api/recommendations/feedback. That feedback stream is the
// fingerprint signal source for the DNA Writer (Assignment 3) when it lands.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";
import type {
  FeedbackRating,
  MotifKind,
  Recommendation,
  RecPage,
} from "@/types/recommendation";
import type { RecommendationResult } from "@/types/dna";
import {
  Bookmark,
  BookmarkX,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Play,
  Star,
  X,
} from "lucide-react";
import styles from "./RecommendationsView.module.css";
import { FingerprintLoader } from "../components/FingerprintLoader";
import { WhyPanel, WhyTextOnly } from "@/app/components/RecCard";
import { Emphasis } from "@/app/components/Emphasis";
import { ProviderIcon } from "@/app/components/ProviderIcon";
import { canonicalProvider } from "@/lib/watch-providers";
import {
  fetchFreshExplain,
  freshKey,
  getCachedExplain,
  setCachedExplain,
  withoutGuessedBars,
  type ExplainData,
} from "@/lib/explain-cache";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  restoreToWatchlist,
  setWatchlistRating,
  setWatchlistStarred,
  WATCHLIST_CHANGED_EVENT,
  WATCHLIST_HYDRATED_EVENT,
  type WatchlistEntry,
  type WatchlistRating,
} from "@/lib/watchlist";
import {
  emptyFilterText,
  filterWatchlist,
  isSeen,
  orderWatchlist,
  SEEN_LABEL,
  watchlistChips,
  type WatchlistChip,
  type WatchlistFilter,
} from "./watchlist-order";
import { addToRegretQueue, removeFromRegretQueue } from "@/lib/regret-queue";
import { shareTitle } from "@/lib/share";
import { deleteRating, postRating } from "./rate";
import ShareIcon from "@/app/components/ShareIcon";
import { HeaderSearch } from "@/app/components/HeaderSearch";
import { TAB_SCROLL } from "@/app/components/TabBar";
import type { ContentType } from "@/lib/content-type";
import type { AppUser } from "@/modules/session/types";

type Mode = "recommendations" | "learning" | "watchlist";

interface Props {
  onBack: () => void;
  contentType: ContentType;
  /** When provided, the header title becomes the Movies/Series/Both picker. */
  setContentType?: (c: ContentType) => void;
  /**
   * "recommendations" = curated for-you feed (default).
   * "learning"        = rapid taste-training stream; identical UI but the
   *                     header label changes and the user is encouraged to
   *                     skip-without-rating.
   * "watchlist"       = the user's saved cards, read from localStorage instead
   *                     of the API, as rows (docs/plan/v3/WATCHLIST.md, DEC-1
   *                     to DEC-13, 2026-11-18): tap a row for the card as a
   *                     page with the why breakdown on it. Rating a card feeds
   *                     the fingerprint through the same call the feed uses but
   *                     LEAVES it here, under a "Seen" line; only "Remove from
   *                     watchlist" (or a swipe) takes it off.
   */
  mode?: Mode;
  /** The signed-in user's name: its first word rides in shared links, so the
   *  friend's page can say who sent it (src/lib/share.ts). */
  sharerName?: string | null;
  /**
   * When provided, a "Find more" CTA renders at the end of the list. It runs
   * this callback (session-end: fingerprint rebuild + fresh rec generation —
   * every like/dislike feeds the fingerprint, so the new batch reflects them),
   * then clears and refetches the list. A page it resolves with is the new
   * batch's first page and is shown as is, with no fetch.
   */
  onFindMore?: () => Promise<RecPage | null | void>;
  /** Watchlist mode only — action on the empty state that opens the rec feed. */
  onBrowse?: () => void;
  /**
   * Rendered at the far right of the header.
   * The app menu goes here so it sits in the same spot on every screen
   * (decided 2026-08-29).
   */
  headerRight?: ReactNode;
  /** For the header's search; without it (the component tests) there is none. */
  user?: AppUser;
  /**
   * With the tab bar (NAV_TABS) a tab is a starting point, so there is no back arrow: this takes its place
   * (the chat bubble, or nothing). Unset: the back arrow, as before.
   */
  headerLeft?: ReactNode;
  /**
   * The player skipped the taste games part-way: every NUDGE_EVERY cards the
   * list shows a card asking them to finish (2026-10-20). Tapping it opens the games.
   */
  onCalibrate?: () => void;
  /** The recs are still being built (Picks tapped): show the loader under the
   *  header and hold the first fetch until the build lands. */
  building?: boolean;
}

/** One calibration nudge per this many recommendations (feed). */
const NUDGE_EVERY = 15;

const PAGE_FETCH_LIMIT = 50; // hard cap — one engine batch
/** Watchlist rows a page (DEC-1); more as you scroll. The old cards paged 6 too. */
const WATCHLIST_PAGE_SIZE = 6;
/** A removed title's place on the list while its "Removed … Undo" note shows (DEC-8). */
interface Ghost { entry: WatchlistEntry; phase: "note" | "leaving" }
/** How long the note stays before it folds away. */
const NOTE_MS = 5000;
/** The row's star just lit: the length of its scale (CSS .starPop). */
const STAR_POP_MS = 320;
/** The Remove panel's width (DEC-8) and the air between it and the row's star (Eran, 2026-11-18). */
const SWIPE_PANEL_W = 104;
const SWIPE_GAP = 14;
/** How far a row slides to reveal Remove. */
const SWIPE_W = SWIPE_PANEL_W + SWIPE_GAP;
/** Past this the swipe settles open; short of it the row springs back. */
const SWIPE_OPEN_PX = 52;
/** Finger travel before a touch counts as a swipe, or as a scroll. */
const SWIPE_SLOP = 12;
/** The row ↔ note fold (height), in ms. */
const FOLD_MS = 280;
/** A row sliding to its new place after a star or a rating, in ms. */
const REORDER_MS = 320;

const HEADER_TITLE: Record<Mode, string> = {
  recommendations: "For You",
  learning: "Fast Learning",
  watchlist: "Watchlist",
};

/** rec.id is "type:tmdb_id" for engine recs (a bare slug only in legacy saved entries). */
function tmdbIdOf(id: string): string {
  return id.includes(":") ? id.split(":")[1] : id;
}

// "Both" ('all') mixes movies and series in one batch — the word the taste
// games use for the same choice.
const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  movies: "Movies",
  series: "Series",
  all: "Both",
};

/**
 * The header title is the Movies/Series/Both picker, same as the home screen's
 * (2026-08-29). The trigger shows the CURRENT type rather than the screen
 * name, so the list you are on is visible without opening the menu — the
 * screen name would leave Movies and Series looking identical.
 *
 * Switching refetches: a batch is GENERATED for one type, so the other list
 * is a different batch entirely. Not offered in watchlist mode — the
 * watchlist deliberately ignores the toggle (docs/watchlist-plan.md #3).
 */
function TypePicker({
  contentType,
  setContentType,
}: {
  contentType: ContentType;
  setContentType: (c: ContentType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className={styles.typePicker} ref={ref}>
      <button
        type="button"
        className={styles.typePickerBtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`content type: ${CONTENT_TYPE_LABEL[contentType]}`}
      >
        <span>{CONTENT_TYPE_LABEL[contentType]}</span>
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden />
      </button>
      {open && (
        <div className={styles.typeMenu} role="menu">
          {(["movies", "series", "all"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={contentType === c}
              className={`${styles.typeMenuItem} ${contentType === c ? styles.typeMenuItemActive : ""}`}
              onClick={() => {
                setContentType(c);
                setOpen(false);
              }}
            >
              {CONTENT_TYPE_LABEL[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RecommendationsView({
  onBack,
  headerLeft,
  contentType,
  setContentType,
  mode = "recommendations",
  sharerName,
  onFindMore,
  onBrowse,
  headerRight,
  user,
  onCalibrate,
  building = false,
}: Props) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The card whose "Why this?" detail overlay is open (null = closed).
  const [detail, setDetail] = useState<Recommendation | null>(null);
  // Once a card has been judged we swap its buttons for the outcome tag.
  // Seeded from the watchlist so a saved card's tag survives leaving and
  // re-opening the view.
  const [feedbackGiven, setFeedbackGiven] = useState<
    Record<string, WatchlistRating>
  >({});
  // Watchlist membership by rec.id, seeded from localStorage on mount so the
  // CTA renders in the right state without re-reading storage per card.
  const [saved, setSaved] = useState<Set<string>>(new Set());
  // Cards the X is sliding off the feed (CARD_LEAVE_MS), by rec.id.
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  // When the server's watchlist lands after mount (hydrateWatchlist): the
  // watchlist view re-pages from it; the feed only refreshes its saved marks,
  // since re-paging there would throw away the cards on screen.
  const [hydratedAt, setHydratedAt] = useState(0);
  useEffect(() => {
    const onHydrated = () => {
      if (mode === "watchlist") setHydratedAt(Date.now());
      else setSaved(new Set(getWatchlist().map((e) => e.rec.id)));
    };
    window.addEventListener(WATCHLIST_HYDRATED_EVENT, onHydrated);
    return () => window.removeEventListener(WATCHLIST_HYDRATED_EVENT, onHydrated);
  }, [mode]);
  // Watchlist mode only: a saved card stores the "why" line it had when saved,
  // and before 2026-11-06 that could be an AI paragraph with invented facts.
  // The Watchlist shows fresh lines built from facts instead
  // (/api/recommendations/why-lines); "keep" = a brand-new user, whose saved
  // lines are the popularity line and true.
  const [lines, setLines] = useState<{ state: "loading" | "done" | "keep" | "failed"; byId: Record<string, string> }>(
    { state: "loading", byId: {} },
  );
  useEffect(() => {
    if (mode !== "watchlist") return;
    const ids = getWatchlist().map((e) => e.rec.id).filter((id) => /^(movie|tv):\d+$/.test(id));
    let cancelled = false;
    (async () => {
      if (ids.length === 0) {
        setLines({ state: "done", byId: {} });
        return;
      }
      try {
        const res = await fetch("/api/recommendations/why-lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error(`why-lines ${res.status}`);
        const { lines: byId } = (await res.json()) as { lines: Record<string, string> | null };
        if (!cancelled) setLines(byId ? { state: "done", byId } : { state: "keep", byId: {} });
      } catch (e) {
        console.error("[recs] watchlist lines failed", e);
        if (!cancelled) setLines({ state: "failed", byId: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, hydratedAt]);

  // ── Watchlist mode (docs/plan/v3/WATCHLIST.md) ──
  // The saved entries, read again on every write to the cache (a save, a
  // rating, a star, a removal, the server's list landing): the rows, the chip
  // counts and the header count all come from here, so they can't drift.
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  useEffect(() => {
    if (mode !== "watchlist") return;
    const read = () => setEntries(getWatchlist());
    read();
    window.addEventListener(WATCHLIST_CHANGED_EVENT, read);
    window.addEventListener(WATCHLIST_HYDRATED_EVENT, read);
    return () => {
      window.removeEventListener(WATCHLIST_CHANGED_EVENT, read);
      window.removeEventListener(WATCHLIST_HYDRATED_EVENT, read);
    };
  }, [mode]);
  // The lit filter chip (DEC-3). Back to All when its chip is gone (the last
  // title on that service was removed).
  const [pickedFilter, setFilter] = useState<WatchlistFilter>("all");
  const chips = useMemo(() => (mode === "watchlist" ? watchlistChips(entries) : []), [mode, entries]);
  const filter: WatchlistFilter = chips.some((c) => c.filter === pickedFilter) ? pickedFilter : "all";
  // Removed titles whose "Removed … Undo" note is still on the list (DEC-8),
  // in the place their row had. Gone from storage already (the counts drop at
  // once); Undo puts the entry back as it was.
  const [ghosts, setGhosts] = useState<Record<string, Ghost>>({});
  const ghostTimers = useRef<Record<string, number>>({});
  useEffect(() => {
    const timers = ghostTimers.current;
    return () => Object.values(timers).forEach((t) => window.clearTimeout(t));
  }, []);
  // The row's star was just lit: a short scale (DEC-12).
  const [starPop, setStarPop] = useState<string | null>(null);
  // The card page (DEC-2): the saved title whose card is open, or null for the
  // list. Opening adds a history entry, so the phone's back button returns to
  // the list; the Back chevron steps back over that same entry.
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "watchlist") return;
    const onPop = () => {
      if (!window.history.state?.wtwCard) setPage(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [mode]);
  const openPage = useCallback((id: string) => {
    if (!window.history.state?.wtwCard) {
      window.history.pushState({ ...window.history.state, wtwCard: id }, "", window.location.href);
    }
    setPage(id);
  }, []);
  const closePage = useCallback(() => {
    if (window.history.state?.wtwCard) window.history.back();
    else setPage(null);
  }, []);

  // Refs mirror loading/offset/hasMore so loadMore doesn't depend on
  // those changing via setState (which would create stale closures and
  // a double-fire race between the initial-load effect and the
  // IntersectionObserver firing on the empty sentinel).
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  // The taste_version offsetRef belongs to. Sent with each page so the server
  // restarts the walk when the live batch was replaced underneath (a rating
  // refresh); otherwise the offset lands in the tail of a batch whose top was
  // never shown.
  const versionRef = useRef<number | null>(null);
  const hasMoreRef = useRef(true);
  // Serializes feedback POSTs: each click's server-side fingerprint merge is a
  // read-modify-write on the DNA, so requests must not overlap. Find More
  // awaits this chain so every rating is merged before regeneration.
  const feedbackQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Append a page of cards and move the pager on. Shared by loadMore and by
  // "Find more", whose first page arrives with the session/end response.
  const applyPage = useCallback((data: Omit<RecPage, "source">) => {
    if (data.taste_version != null) versionRef.current = data.taste_version;
    // Dedup by id — in case the same page slips through twice we don't
    // create duplicate React keys. Also drop titles already on the watchlist:
    // the server excludes them once the save has been reported (session/end),
    // but a save made in this session hasn't reached it yet, and a saved
    // title resurfacing as "new" reads as a repeat. Read storage directly —
    // `saved` state would be a stale closure here.
    const onWatchlist = new Set(getWatchlist().map((e) => e.rec.id));
    setRecs((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const incoming = data.recommendations.filter(
        (r) => !seen.has(r.id) && !onWatchlist.has(r.id),
      );
      return incoming.length ? [...prev, ...incoming] : prev;
    });
    offsetRef.current = data.next_offset;
    const more = data.has_more && data.next_offset < PAGE_FETCH_LIMIT;
    hasMoreRef.current = more;
    setHasMore(more);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const v = versionRef.current == null ? "" : `&v=${versionRef.current}`;
      const res = await fetch(
        `/api/recommendations/generate?type=${contentType}&offset=${offsetRef.current}${v}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      applyPage((await res.json()) as Omit<RecPage, "source">);
    } catch (e) {
      console.error("[recs] load failed", e);
      // Stop paginating on failure: leaving hasMore true kept the sentinel
      // visible, and the observer re-fired loadMore the instant loading
      // flipped back — a tight retry loop with no backoff, where each retry
      // can trigger a full engine regeneration server-side. The "Find more"
      // button that renders when hasMore is false doubles as manual retry.
      hasMoreRef.current = false;
      setHasMore(false);
      setError("Couldn't load more right now");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [contentType, applyPage]);

  // Initial load + reload when content type changes.
  useEffect(() => {
    setRecs([]);
    setHasMore(true);
    offsetRef.current = 0;
    versionRef.current = null;
    hasMoreRef.current = true;
    loadingRef.current = false;
    // Seed the membership set (all modes — the feed shows saved state too) and
    // the stored outcome tags before the first page is read. The Watchlist
    // itself pages over `entries` (WatchlistList), not over this fetch.
    const saved0 = getWatchlist();
    setSaved(new Set(saved0.map((e) => e.rec.id)));
    setFeedbackGiven(
      Object.fromEntries(
        saved0
          .filter((e) => e.rating != null)
          .map((e) => [e.rec.id, e.rating as WatchlistRating]),
      ),
    );
    if (mode !== "watchlist" && !building) void loadMore();
    // hydratedAt bumps when the server's watchlist lands after mount.
    // building: a Picks tap empties the list now and fetches once the build
    // lands; re-seeding alongside is redundant but cheap.
  }, [contentType, mode, loadMore, hydratedAt, building]);

  // "Find more": rebuild the fingerprint (feedback so far included) and
  // regenerate recs server-side, then APPEND the fresh batch — existing cards
  // (rated or not) stay in place; loadMore's id-dedup keeps only new titles.
  async function handleFindMore() {
    if (!onFindMore || refreshing) return;
    setRefreshing(true);
    try {
      // Let any in-flight rating merges land first so they're in the rebuild.
      await feedbackQueueRef.current;
      const page = await onFindMore();
      offsetRef.current = 0; // re-page through the NEW cache from the top
      hasMoreRef.current = true;
      setHasMore(true);
      // The first page comes back with the rebuild; fetch it only if it didn't.
      if (page) applyPage(page);
      else await loadMore();
    } catch (e) {
      console.error("[recs] find-more failed", e);
      setError("Couldn't refresh right now");
    } finally {
      setRefreshing(false);
    }
  }

  // Add / remove the card in the local watchlist. The card is stored whole, so
  // the watchlist view renders it without a refetch. We also snapshot the "Why
  // this pick?" payload: /api/recommendations/explain reads the Redis rec cache,
  // which expires, so without a snapshot the Why button 404s on old saves.
  async function toggleWatchlist(rec: Recommendation) {
    if (saved.has(rec.id)) {
      if (mode === "watchlist") {
        // "Remove from watchlist" on the card page: back to the list at once,
        // where the row folds into the same "Removed … Undo" note a swipe
        // leaves (DEC-8, one mechanism).
        const entry = entries.find((e) => e.rec.id === rec.id);
        if (entry) removeEntry(entry);
        if (page === rec.id) {
          // The list at once (the entry is gone from it either way), and the
          // history entry the page added goes too.
          setPage(null);
          if (window.history.state?.wtwCard) window.history.back();
        }
        return;
      }
      removeFromWatchlist(rec.id);
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(rec.id);
        return next;
      });
      // Drop the stored tag too, so re-saving the title later offers the
      // reactions again instead of the old outcome.
      setFeedbackGiven((prev) => {
        if (!(rec.id in prev)) return prev;
        const next = { ...prev };
        delete next[rec.id];
        return next;
      });
      return;
    }

    const cached = getCachedExplain(rec.id);
    addToWatchlist(rec, cached); // save first — never block the click on a fetch
    setSaved((prev) => new Set(prev).add(rec.id));
    if (cached) return;

    // No breakdown cached yet: fetch it once, now, while the title is still in
    // the engine's cache. addToWatchlist backfills the snapshot idempotently.
    try {
      const res = await fetch(
        `/api/recommendations/explain?tmdb_id=${encodeURIComponent(tmdbIdOf(rec.id))}&type=${rec.type}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as ExplainData;
      setCachedExplain(rec.id, data);
      addToWatchlist(rec, data);
    } catch (e) {
      // Best-effort — the entry is already saved, just without a breakdown.
      console.error("[recs] watchlist explain snapshot failed", e);
    }
  }

  // Pull a card out of the rendered list — used when a title genuinely leaves
  // the feed (the X).
  function dropCard(rec: Recommendation) {
    setRecs((prev) => prev.filter((r) => r.id !== rec.id));
  }

  // ── Watchlist rows: star, remove, undo (DEC-4, DEC-8) ──
  function toggleStar(entry: WatchlistEntry) {
    const next = !entry.starred;
    setWatchlistStarred(entry.rec.id, next);
    if (next) {
      setStarPop(entry.rec.id);
      window.setTimeout(() => setStarPop((cur) => (cur === entry.rec.id ? null : cur)), STAR_POP_MS);
    }
  }

  function setGhostPhase(id: string, phase: Ghost["phase"]) {
    setGhosts((prev) => (prev[id] && prev[id].phase !== phase ? { ...prev, [id]: { ...prev[id], phase } } : prev));
  }

  // Take the title off the list. The same path as the card's "Remove from
  // watchlist" always took (removeFromWatchlist: the cache, the server, and
  // the fingerprint's unsave on session end), so the header count, the All
  // chip and the tab badge drop at once; the row folds into a note with Undo
  // that stays NOTE_MS, then folds away. A second removal closes the first
  // note at once.
  function removeEntry(entry: WatchlistEntry) {
    const id = entry.rec.id;
    removeFromWatchlist(id);
    setSaved((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setFeedbackGiven((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setGhosts((prev) => {
      const next: Record<string, Ghost> = {};
      for (const [k, g] of Object.entries(prev)) next[k] = g.phase === "note" ? { ...g, phase: "leaving" } : g;
      next[id] = { entry, phase: "note" };
      return next;
    });
    window.clearTimeout(ghostTimers.current[id]);
    ghostTimers.current[id] = window.setTimeout(() => setGhostPhase(id, "leaving"), NOTE_MS);
  }

  function undoRemove(entry: WatchlistEntry) {
    const id = entry.rec.id;
    window.clearTimeout(ghostTimers.current[id]);
    delete ghostTimers.current[id];
    restoreToWatchlist(entry);
    setSaved((prev) => new Set(prev).add(id));
    if (entry.rating) setFeedbackGiven((prev) => ({ ...prev, [id]: entry.rating as WatchlistRating }));
    setGhosts((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  // A new swipe closes every note still showing, at once (DEC-8).
  function dismissNotes() {
    setGhosts((prev) => {
      if (!Object.values(prev).some((g) => g.phase === "note")) return prev;
      const next: Record<string, Ghost> = {};
      for (const [k, g] of Object.entries(prev)) next[k] = g.phase === "note" ? { ...g, phase: "leaving" } : g;
      return next;
    });
  }

  // The note has folded away: forget it.
  function ghostGone(id: string) {
    delete ghostTimers.current[id];
    setGhosts((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const pageEntry = page ? entries.find((e) => e.rec.id === page) ?? null : null;
  // The card page's short "why" line, as the old cards had it (fresh lines
  // built from facts); the saved AI line only for a brand-new user ("keep").
  // Its service badge is the Israeli one (DEC-11); the saved card's `where` was the US.
  const pageRec: Recommendation | null = pageEntry
    ? {
        ...pageEntry.rec,
        where: pageEntry.rec.where_il ?? null,
        reason: lines.state === "keep" ? pageEntry.rec.reason : lines.byId[pageEntry.rec.id] ?? "",
      }
    : null;

  async function handleFeedback(rec: Recommendation, rating: FeedbackRating) {
    // Rating does NOT take a title off the watchlist — it stays, tagged with the
    // outcome, and only its own "Remove from watchlist" button removes it. The
    // tag is persisted so it survives leaving and re-opening the view.
    setWatchlistRating(rec.id, rating);
    if (mode === "watchlist") {
      // Rating something off the watchlist means the user actually watched it —
      // the one place in this view where that's unambiguous (a feed rating can
      // be a reaction to a title they saw long ago). Queue the 48-hour
      // glad/neutral/regret check-in, same as RecCard does on "watched".
      // Not for "disliked": they've already told us how it landed.
      if (rating === "loved" || rating === "liked") {
        addToRegretQueue(tmdbIdOf(rec.id), rec.title, rec.type);
      }
    }

    setFeedbackGiven((prev) => ({ ...prev, [rec.id]: rating }));
    // Queue the POST (don't block the UI on it): the route folds each rating
    // into the fingerprint incrementally, and those merges must run one at a
    // time. The UI card state was already flipped above.
    feedbackQueueRef.current = feedbackQueueRef.current.then(async () => {
      try {
        // The route's contract and its body live in rate.ts (Search rates through it too, v3 Q1).
        if (!(await postRating(rec, rating, contentType))) {
          // The card was flipped optimistically before this ran, so a failure
          // leaves the user believing a rating landed that did not. Nothing
          // else records it — session end folds from the history row this
          // very request failed to write — so put the card back and say so.
          setFeedbackGiven((prev) => {
            const next = { ...prev };
            delete next[rec.id];
            return next;
          });
          setError("That rating didn't save — try again.");
        }
      } catch (e) {
        console.error("[recs] feedback failed", e);
        setFeedbackGiven((prev) => {
          const next = { ...prev };
          delete next[rec.id];
          return next;
        });
        setError("That rating didn't save — try again.");
      }
    });
  }

  // Un-rate — the user tapped the lit chip again. Optimistic like a rating: the
  // chip goes dark at once, the Watchlist tag and a queued 48-hour check-in are
  // cleared, and the DELETE joins the same one-at-a-time queue as ratings so a
  // quick Loved → clear → Liked lands in order. On failure everything is put
  // back and the user is told.
  function handleUnrate(rec: Recommendation) {
    const previous = feedbackGiven[rec.id];
    if (!previous || previous === "removed") return;
    const tmdb_id = tmdbIdOf(rec.id);
    setFeedbackGiven((prev) => {
      const next = { ...prev };
      delete next[rec.id];
      return next;
    });
    setWatchlistRating(rec.id, null);
    removeFromRegretQueue(tmdb_id, rec.type);
    const restore = () => {
      setFeedbackGiven((prev) => ({ ...prev, [rec.id]: previous }));
      setWatchlistRating(rec.id, previous);
      if (mode === "watchlist" && (previous === "loved" || previous === "liked")) {
        addToRegretQueue(tmdb_id, rec.title, rec.type);
      }
      setError("That rating didn't clear — try again.");
    };
    feedbackQueueRef.current = feedbackQueueRef.current.then(async () => {
      try {
        // On the Watchlist the history entry goes back to "saved".
        if (!(await deleteRating(rec, contentType, saved.has(rec.id)))) restore();
      } catch (e) {
        console.error("[recs] un-rate failed", e);
        restore();
      }
    });
  }

  // "Remove" — suppress this title so it's never recommended again. Optimistic:
  // drop the card immediately, then persist to the removed list server-side.
  // Tracked in Supabase so a future "Removed" screen can restore it.
  function handleRemove(rec: Recommendation) {
    // The feed's X ("not for me"): the card slides away, then leaves the list.
    // The Watchlist has no X (2026-11-06) — "Remove from watchlist" is how a
    // title leaves a list you made yourself.
    if (leaving.has(rec.id)) return;
    setLeaving((prev) => new Set(prev).add(rec.id));
    const reduce = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      dropCard(rec);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(rec.id);
        return next;
      });
    }, reduce ? 0 : CARD_LEAVE_MS);
    const tmdb_id = rec.id.includes(":") ? rec.id.split(":")[1] : rec.id;
    // Queued with the ratings, not fire-and-forget: "Find more" awaits this
    // chain before regenerating, so the removal is on the server before the
    // new batch is built. Unqueued, a quick Remove → Find more could regenerate
    // first and re-serve the title.
    feedbackQueueRef.current = feedbackQueueRef.current.then(async () => {
      try {
        const res = await fetch("/api/recommendations/removed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdb_id, media_type: rec.type, title: rec.title }),
        });
        if (!res.ok) {
          console.error(`[recs] remove HTTP ${res.status}`, await res.text().catch(() => ""));
        }
      } catch (e) {
        console.error("[recs] remove failed", e);
      }
    });
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        {pageEntry ? (
          // The card page: Back where the chat bubble was (DEC-2).
          <button type="button" className={styles.headerBtn} onClick={closePage} aria-label="back">
            <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
          </button>
        ) : headerLeft !== undefined ? (
          <div className={styles.headerLeft}>{headerLeft}</div>
        ) : (
          <button
            type="button"
            className={styles.headerBtn}
            onClick={onBack}
            aria-label="back"
          >
            <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        {setContentType && mode !== "watchlist" ? (
          <TypePicker contentType={contentType} setContentType={setContentType} />
        ) : (
          <span className={styles.headerTitle}>
            {pageEntry ? "" : mode === "watchlist" ? `${HEADER_TITLE[mode]} (${entries.length})` : HEADER_TITLE[mode]}
          </span>
        )}
        <div className={styles.headerRight}>
          {/* Search travels with the app menu (both are the app's, not the
              view's): on the watchlist it lists the saved titles first, and
              its Back returns to this screen (2026-11-07). */}
          {user && (
            <HeaderSearch
              btnClass={styles.headerBtn}
              user={user}
              menu={headerRight}
              scope={mode === "watchlist" ? "watchlist" : undefined}
              from={mode}
            />
          )}
          {headerRight}
        </div>
      </div>

      {mode === "watchlist" && !pageEntry && entries.length > 0 && (
        <WatchlistChips chips={chips} active={filter} onPick={setFilter} />
      )}

      <div className={styles.content}>
        {mode === "watchlist" && pageEntry && pageRec ? (
          <WatchlistCardPage
            key={pageEntry.rec.id}
            entry={pageEntry}
            rec={pageRec}
            reasonPending={lines.state === "loading"}
            rated={feedbackGiven[pageEntry.rec.id]}
            onFeedback={handleFeedback}
            onUnrate={handleUnrate}
            onShare={(r) => void shareTitle(r, sharerName)}
            onToggleWatchlist={toggleWatchlist}
            onStar={() => toggleStar(pageEntry)}
          />
        ) : mode === "watchlist" ? (
          <WatchlistList
            entries={entries}
            ghosts={ghosts}
            filter={filter}
            starPop={starPop}
            onOpen={(e) => openPage(e.rec.id)}
            onStar={toggleStar}
            onRemove={removeEntry}
            onUndo={undoRemove}
            onGone={ghostGone}
            onDismissNotes={dismissNotes}
            onBrowse={onBrowse}
          />
        ) : (
        <Feed
          recs={recs}
          loading={loading || building}
          hasMore={hasMore}
          error={error}
          feedbackGiven={feedbackGiven}
          onLoadMore={loadMore}
          onFeedback={handleFeedback}
          onUnrate={handleUnrate}
          onRemove={handleRemove}
          leaving={leaving}
          onWhy={setDetail}
          onShare={(r) => void shareTitle(r, sharerName)}
          onFindMore={onFindMore ? handleFindMore : undefined}
          refreshing={refreshing}
          saved={saved}
          onToggleWatchlist={toggleWatchlist}
          onCalibrate={mode === "recommendations" ? onCalibrate : undefined}
        />
        )}
      </div>

      {detail && (
        <WhyDetailOverlay key={detail.id} rec={detail} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Feed
// ─────────────────────────────────────────────────────────────

function Feed({
  recs,
  loading,
  hasMore,
  error,
  feedbackGiven,
  onLoadMore,
  onFeedback,
  onUnrate,
  onRemove,
  leaving,
  onWhy,
  onShare,
  onFindMore,
  refreshing = false,
  saved,
  onToggleWatchlist,
  onCalibrate,
}: {
  recs: Recommendation[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  feedbackGiven: Record<string, WatchlistRating>;
  onLoadMore: () => void;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onUnrate: (rec: Recommendation) => void;
  /** The X beside "Add to Watchlist" — the feed only; absent on the Watchlist. */
  onRemove?: (rec: Recommendation) => void;
  leaving: Set<string>;
  onWhy: (rec: Recommendation) => void;
  onShare: (rec: Recommendation) => void;
  onFindMore?: () => void;
  refreshing?: boolean;
  saved: Set<string>;
  onToggleWatchlist: (rec: Recommendation) => void;
  onCalibrate?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onLoadMore]);

  // When "Find more" kicks off a refresh, scroll the list all the way to the
  // bottom so the "Updating your fingerprint…" loader + label are fully in
  // view (not cut off under the frame edge). Deferred to the next frame so the
  // taller loader has been laid out before we measure scrollHeight.
  useEffect(() => {
    if (!refreshing) return;
    const list = listRef.current;
    if (!list) return;
    const id = requestAnimationFrame(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [refreshing]);

  // First page still loading (or the recs still being built) — a centred
  // state, not a bare "Loading more…".
  if (recs.length === 0 && loading && !refreshing) {
    return (
      <div className={styles.initialLoading}>
        <span className={styles.loadingEyebrow}>Reading your fingerprint</span>
        <span className={styles.loadingTitle}>Finding matches</span>
        <FingerprintLoader size={66} />
      </div>
    );
  }

  return (
    <div ref={listRef} className={styles.list} {...TAB_SCROLL}>
      {recs.map((rec, i) => (
        <Fragment key={rec.id}>
          <FeedCard
            rec={rec}
            rated={feedbackGiven[rec.id]}
            onFeedback={onFeedback}
            onUnrate={onUnrate}
            onRemove={onRemove}
            leaving={leaving.has(rec.id)}
            onWhy={onWhy}
            onShare={onShare}
            saved={saved.has(rec.id)}
            onToggleWatchlist={onToggleWatchlist}
          />
          {onCalibrate && (i + 1) % NUDGE_EVERY === 0 && <CalibrateNudge onClick={onCalibrate} />}
        </Fragment>
      ))}
      <div ref={sentinelRef} className={styles.sentinel}>
        {refreshing && (
          // Just the fingerprint: the user asked for more and knows why
          // they're waiting, so the captions were noise.
          <div className={styles.findMoreLoading}>
            <FingerprintLoader size={66} />
          </div>
        )}
        {!refreshing && loading && <span className={styles.muted}>Loading more…</span>}
        {!refreshing && !loading && !hasMore && recs.length > 0 && (
          onFindMore ? (
            // Every like/dislike above fed the fingerprint — this rebuilds it
            // and generates a fresh batch that reflects those choices.
            <button className={styles.findMoreBtn} onClick={onFindMore}>
              Find more
            </button>
          ) : (
            <span className={styles.muted}>That&rsquo;s everything we found.</span>
          )
        )}
        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  );
}

// Shown to players who skipped the taste games: the picks get better once
// the calibration is done.
function CalibrateNudge({ onClick }: { onClick: () => void }) {
  return (
    <div className={`${styles.card} ${styles.nudge}`}>
      <span className={styles.nudgeEyebrow}>Sharper picks</span>
      <p className={styles.nudgeText}>
        Finish your taste calibration so I get to know you better. Your recommendations get more accurate with every game.
      </p>
      <button type="button" className={styles.browseBtn} onClick={onClick}>
        Finish calibration
      </button>
    </div>
  );
}

function FeedCard({
  rec,
  rated,
  onFeedback,
  onUnrate,
  onRemove,
  leaving = false,
  onWhy,
  onShare,
  saved,
  onToggleWatchlist,
  reasonPending = false,
  starred,
  onStar,
  whyInline,
}: {
  rec: Recommendation;
  reasonPending?: boolean;
  rated: WatchlistRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onUnrate: (rec: Recommendation) => void;
  onRemove?: (rec: Recommendation) => void;
  /** The X was tapped: slide away, then close the gap (CARD_LEAVE_MS). */
  leaving?: boolean;
  onWhy: (rec: Recommendation) => void;
  onShare: (rec: Recommendation) => void;
  saved: boolean;
  onToggleWatchlist: (rec: Recommendation) => void;
  /** The Watchlist's card page (DEC-4): a star circle above share. Absent on the feed. */
  starred?: boolean;
  onStar?: () => void;
  /**
   * The Watchlist's card page (DEC-2): the why breakdown rendered on the card
   * under Seen it?, in place of the "Why it's a match" link. Absent on the feed.
   */
  whyInline?: ReactNode;
}) {
  const cardRef = useRef<HTMLElement>(null);
  // The gap can only close from a measured height: pin it before the collapse
  // class animates max-height to 0.
  useEffect(() => {
    const el = cardRef.current;
    if (!leaving || !el) return;
    el.style.maxHeight = `${el.offsetHeight}px`;
    void el.offsetHeight; // commit the measured height so the change below animates
    el.style.maxHeight = "0px";
    el.style.marginBottom = "-16px"; // the list's gap, so the next card closes right up
  }, [leaving]);
  // "Want it?" — the X sits beside Add to Watchlist on the feed. Once the
  // title is saved there is nothing to turn down, so the X goes (2026-11-06).
  const showX = !!onRemove && !saved;

  return (
    <article
      ref={cardRef}
      className={`${styles.card} ${styles.heroCard} ${leaving ? styles.cardLeaving : ""}`}
      aria-hidden={leaving || undefined}
    >
      {/* The poster is the card's top half (2026-10-26, Eran picked layout C,
          docs/prototypes/rec-card/g-final-*.jpg): where to watch and the
          match on top, title + trailer over the poster's fade. */}
      <div className={styles.hero}>
        <PosterTile rec={rec} size="hero" />
        <div className={styles.heroShade} aria-hidden />
        <WhereBadge where={rec.where} />
        <MatchRing match={rec.match} className={styles.heroRing} />
        <div className={styles.heroFoot}>
          <div className={styles.cardTitleBlock}>
            <h3 className={styles.heroTitle}>{rec.title}</h3>
            <MetaRow rec={rec} />
          </div>
          {/* Share stacks on the trailer, far from "Add to Watchlist" so the
              two are never mis-tapped (docs/prototypes/share/v3). */}
          <div className={styles.heroCircles}>
            {onStar && (
              <button
                type="button"
                className={`${styles.trailerCircle} ${styles.starCircle} ${starred ? styles.starCircleOn : ""}`}
                onClick={onStar}
                aria-pressed={starred}
                aria-label={starred ? `Starred: ${rec.title} (tap to un-star)` : `Star ${rec.title}`}
                title={starred ? "Starred" : "Star"}
              >
                <Star size={22} strokeWidth={1.7} aria-hidden />
              </button>
            )}
            <button
              type="button"
              className={styles.trailerCircle}
              onClick={() => onShare(rec)}
              aria-label={`Share ${rec.title}`}
              title="Share"
            >
              <ShareIcon size={22} strokeWidth={1.7} />
            </button>
            <TrailerCircle rec={rec} />
          </div>
        </div>
      </div>

      <div className={styles.heroBody}>
        {/* The text is the teaser; the Why page is the full answer. The text
            opens it too — the link is the control a keyboard reaches. */}
        {rec.reason ? (
          <p className={styles.heroReason} onClick={() => onWhy(rec)}>
            <Emphasis text={rec.reason} />
          </p>
        ) : reasonPending ? (
          <div className={styles.heroReasonPending} aria-hidden>
            <span /><span />
          </div>
        ) : null}
        {whyInline ? (
          // The breakdown is on the page: no link, and the button keeps the
          // room under the why line the link used to give (DEC-13).
          <div className={styles.whyGap} aria-hidden />
        ) : (
          <button
            type="button"
            className={styles.whyLink}
            onClick={() => onWhy(rec)}
            aria-label={`Why ${rec.title} is a match`}
          >
            {/* No score, no "match" claim (taste-game saves, cold start). */}
            <span>{rec.match > 0 ? "Why it\u2019s a match" : "Why this pick"}</span>
            <ChevronRight size={18} strokeWidth={2.2} aria-hidden />
          </button>
        )}
        {showX ? (
          <div className={styles.wantRow}>
            <WatchlistButton rec={rec} saved={saved} onToggle={onToggleWatchlist} primary />
            <button
              type="button"
              className={styles.wantX}
              onClick={() => onRemove?.(rec)}
              aria-label={`Not for me: never recommend ${rec.title} again`}
              title="Not for me"
            >
              <X size={20} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
        ) : (
          <WatchlistButton rec={rec} saved={saved} onToggle={onToggleWatchlist} primary />
        )}
        <FeedbackRow rec={rec} rated={rated} onFeedback={onFeedback} onUnrate={onUnrate} />
        {whyInline}
      </div>
    </article>
  );
}

/**
 * Streaming service as a glass pill on the poster. Hidden when unknown.
 *
 * ⚠️ The "via JustWatch" eyebrow was removed 2026-08-29 at the user's request.
 * TMDB sources this data from JustWatch and its terms require the attribution
 * to be visible wherever availability is shown — it needs to reappear
 * somewhere (a footer or an about/legal line) before this ships publicly.
 */
function WhereBadge({ where }: { where: string | null }) {
  if (!where) return null;
  // The name as the region knows it ("Apple TV" in Israel, DEC-11); only the
  // icon comes from the brand table.
  const { key } = canonicalProvider(where);
  return (
    <div className={styles.whereBadge}>
      <ProviderIcon providerKey={key} className={styles.whereIcon} />
      <span>{where}</span>
    </div>
  );
}

/** Round glass play button on the poster. Absent when there is no trailer. */
function TrailerCircle({ rec }: { rec: Recommendation }) {
  if (!rec.trailer_url) return null;
  return (
    <button
      type="button"
      className={styles.trailerCircle}
      onClick={() => window.open(rec.trailer_url!, "_blank", "noopener,noreferrer")}
      aria-label={`Play ${rec.title} trailer`}
      title="Play trailer"
    >
      <Play size={20} fill="currentColor" strokeWidth={0} aria-hidden />
    </button>
  );
}

/** Year · runtime · ★ rating — shared by every card variant. */
function MetaRow({ rec }: { rec: Recommendation }) {
  return (
    <div className={styles.cardMeta}>
      <span>{rec.year}</span>
      <span>{rec.meta}</span>
      <span className={styles.metaRating}>
        <Star size={16} className={styles.metaStar} aria-hidden />
        {rec.rating.toFixed(1)}
      </span>
    </div>
  );
}

/**
 * Fingerprint match as a gold ring badge (Figma "Card" 33:427). Replaces the
 * old "97% match" text; the % is kept in the accessible name.
 */
function MatchRing({ match, className }: { match: number; className?: string }) {
  // No score, no figure: titles saved from the taste games (/play) carry none,
  // and must never read "0%" (Eran, 2026-10-19).
  if (!(match > 0)) return null;
  const pct = Math.round(match * 100);
  return (
    <div
      className={`${styles.matchRing} ${className ?? ""}`}
      role="img"
      aria-label={`${pct}% match`}
    >
      <div className={styles.matchRingInner} aria-hidden>
        <span>
          <span className={styles.matchRingPct}>{pct}</span>
          <span className={styles.matchRingSign}>%</span>
        </span>
      </div>
    </div>
  );
}

// The card's primary CTA — yellow-tinted pill, heavier than the "Why ?" pill
// it sits across from. Toggles: saved cards offer removal instead.
function WatchlistButton({
  rec,
  saved,
  onToggle,
  primary = false,
}: {
  rec: Recommendation;
  saved: boolean;
  onToggle: (rec: Recommendation) => void;
  /** The feed card's look: full width, the app's orange gradient. */
  primary?: boolean;
}) {
  const label = saved ? "Remove from Watchlist" : "Add to Watchlist";
  return (
    <button
      type="button"
      className={`${styles.watchlistBtn} ${primary ? styles.watchlistBtnPrimary : ""} ${saved ? styles.watchlistBtnSaved : ""}`}
      onClick={() => onToggle(rec)}
      aria-pressed={saved}
      aria-label={`${label}: ${rec.title}`}
      title={label}
    >
      <Bookmark
        size={16}
        strokeWidth={1.8}
        fill={saved ? "currentColor" : "none"}
        aria-hidden
      />
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared bits — poster (img with motif fallback), feedback row
// ─────────────────────────────────────────────────────────────

/**
 * "Seen it?" — Loved / Liked / Disliked. Rating lights the chip and keeps the
 * card where it is; tapping the lit chip again clears the rating (2026-11-06).
 * Only the X or "Remove from watchlist" takes a card off a list.
 */
function FeedbackRow({
  rec,
  rated,
  onFeedback,
  onUnrate,
}: {
  rec: Recommendation;
  rated: WatchlistRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onUnrate: (rec: Recommendation) => void;
}) {
  // "removed" is a tag from the Watchlist's old X, not a rating.
  const current = rated && rated !== "removed" ? rated : null;
  return (
    <div className={styles.seenIt}>
      {current ? (
        <span className={`${styles.seenItPrompt} ${styles.seenItSaved}`} role="status">
          <Check size={14} strokeWidth={2.6} aria-hidden />
          {SAVED_NOTE}
        </span>
      ) : (
        <span className={styles.seenItPrompt}>{SEEN_PROMPT}</span>
      )}
      <div className={styles.seenItRow}>
        {REACTIONS.map((r) => {
          const on = current === r.value;
          return (
            <button
              key={r.value}
              type="button"
              className={`${styles.seenChip} ${on ? styles.seenChipOn : ""}`}
              onClick={() => (on ? onUnrate(rec) : onFeedback(rec, r.value))}
              aria-pressed={on}
              aria-label={on ? `${r.aria} (tap to clear)` : r.aria}
              title={on ? "Tap to clear" : r.aria}
            >
              <span className={styles.chipEmoji} aria-hidden>{r.emoji}</span>
              <span>{r.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The prompt over the chips — says what a rating is for (Eran, 2026-11-06). */
const SEEN_PROMPT = "Seen it? Tell me, and your picks get sharper";
/** Replaces the prompt once rated. "Seen" when that page ships. */
const SAVED_NOTE = "Saved to Ratings";
/** X: the slide away plus the gap closing, in ms (Eran, 2026-11-06). Matches .cardLeaving. */
const CARD_LEAVE_MS = 750;

// Three taste reactions (Mixed was dropped — it carries no useful signal).
// "Remove" and "Why" are separate controls in the same row (see FeedbackRow).
const REACTIONS: {
  value: FeedbackRating;
  emoji: string;
  label: string;
  aria: string;
}[] = [
  { value: "loved", emoji: "❤️", label: "Loved", aria: "Loved it" },
  { value: "liked", emoji: "👍", label: "Liked", aria: "Liked it" },
  { value: "disliked", emoji: "👎", label: "Disliked", aria: "Watched it, didn't like it" },
];


// Build a complete RecommendationResult from an explain payload + the card
// metadata we already have on hand.
function toResult(data: ExplainData, rec: Recommendation): RecommendationResult {
  return {
    title: data.title || rec.title,
    tmdb_id: data.tmdb_id,
    type: rec.type,
    composite_score: rec.match,
    reason_payload: data.reason_payload,
    explanation: data.explanation || rec.reason,
    is_stretch_pick: data.is_stretch_pick ?? rec.is_stretch_pick ?? false,
    generated_at: "",
    fingerprint_version: 0,
  };
}

// "Why it's a match" — a sheet that slides up over the card (backlog
// 2026-11-04, mocks in docs/prototypes/why-match). Only the title, a little
// metadata and the why: the card's buttons, match ring and streaming service
// stay on the card underneath. Closes with the X, a swipe down, a tap on the
// dark layer, Escape or the phone's back button. Serves the reason_payload
// from the on-device cache, or fetches it from the engine cache.
const SHEET_EXIT_MS = 220;
const SWIPE_CLOSE_PX = 90;

// The sheet's "Why", written from facts (/api/recommendations/why). Kept for
// the rest of the session so reopening a card is instant; the server keeps it
// for 3 days.
const whyTextCache = new Map<string, string | null>();

function useWhyText(rec: Recommendation): string | null | "pending" | "failed" {
  // rec.id is "type:tmdb_id"; a legacy bare slug has nothing to look up. The
  // sheet is keyed by rec.id, so this starts fresh for every title.
  const [type, tmdb_id] = rec.id.split(":");
  const [why, setWhy] = useState<string | null | "pending" | "failed">(() =>
    whyTextCache.has(rec.id) ? whyTextCache.get(rec.id)! : tmdb_id ? "pending" : null,
  );
  useEffect(() => {
    if (whyTextCache.has(rec.id) || !tmdb_id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/recommendations/why?tmdb_id=${encodeURIComponent(tmdb_id)}&type=${encodeURIComponent(type)}`,
        );
        if (!res.ok) throw new Error(`why ${res.status}`);
        const { text } = (await res.json()) as { text: string | null };
        whyTextCache.set(rec.id, text);
        if (!cancelled) setWhy(text);
      } catch (e) {
        console.error("[recs] why text failed", e);
        if (!cancelled) setWhy("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rec.id, type, tmdb_id]);
  return why;
}

function WhyDetailOverlay({
  rec,
  onClose,
}: {
  rec: Recommendation;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const why = useWhyText(rec);

  useEffect(() => {
    let cancelled = false;
    // rec.id is "type:tmdb_id" for engine recs (a bare slug only in legacy saved entries).
    const tmdb_id = rec.id.includes(":") ? rec.id.split(":")[1] : rec.id;

    // Serve from this session's cache if we've opened this "Why" before.
    const cached = getCachedExplain(rec.id);
    if (cached) {
      setResult(toResult(cached, rec));
      setStatus("ready");
      return;
    }

    // Then the snapshot taken when the card was saved. The engine's rec cache
    // expires, so for a watchlisted title this is often the ONLY copy left —
    // without it the network call below 404s.
    const snapshot = getWatchlist().find((e) => e.rec.id === rec.id)?.explain;
    if (snapshot) {
      setCachedExplain(rec.id, snapshot);
      setResult(toResult(snapshot, rec));
      setStatus("ready");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          // `type` disambiguates a colliding movie/TV tmdb_id — without it the
          // route can only take the first bare-id match in the cached batch.
          `/api/recommendations/explain?tmdb_id=${encodeURIComponent(tmdb_id)}&type=${rec.type}`,
        );
        if (cancelled) return;
        if (!res.ok) {
          setErrMsg(
            res.status === 404
              ? "The full breakdown isn't ready for this pick yet — try after generating fresh recommendations."
              : "Couldn't load the breakdown right now.",
          );
          setStatus("error");
          return;
        }
        const data = (await res.json()) as ExplainData;
        if (cancelled) return;
        setCachedExplain(rec.id, data); // cache for the rest of this session
        setResult(toResult(data, rec));
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        console.error("[recs] explain failed", e);
        setErrMsg("Couldn't load the breakdown right now.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rec]);

  // Slide down, then unmount. Every way out ends here.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const dismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), SHEET_EXIT_MS);
  }, []);

  // The phone's back button closes the sheet, not the page: opening adds a
  // history entry for the same address, and going back from it closes.
  useEffect(() => {
    if (!window.history.state?.wtwWhy) {
      window.history.pushState({ ...window.history.state, wtwWhy: true }, "", window.location.href);
    }
    const onPop = () => dismiss();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dismiss]);

  // The X, the dark layer, Escape and a swipe: step back over our own history
  // entry (that fires popstate → dismiss), or just close if it's gone.
  const close = useCallback(() => {
    if (window.history.state?.wtwWhy) window.history.back();
    else dismiss();
  }, [dismiss]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Swipe down to close: from the top of the sheet always, from the content
  // only once it's scrolled to the top (otherwise the swipe scrolls it).
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; dy: number } | null>(null);
  // Once the content scrolls, a hairline under the title keeps it from
  // running straight into the year/length line.
  const [scrolled, setScrolled] = useState(false);
  const setOffset = (dy: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? "" : "none";
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };
  const onTouchStart = (e: ReactTouchEvent) => {
    const fromBody = bodyRef.current?.contains(e.target as Node);
    if (fromBody && (bodyRef.current?.scrollTop ?? 0) > 0) return;
    drag.current = { y0: e.touches[0].clientY, dy: 0 };
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    if (!drag.current) return;
    const dy = e.touches[0].clientY - drag.current.y0;
    // Pulling up hands the gesture back to the content's own scroll.
    if (dy < 0 && drag.current.dy === 0) {
      drag.current = null;
      return;
    }
    drag.current.dy = Math.max(0, dy);
    setOffset(drag.current.dy, false);
  };
  const onTouchEnd = () => {
    if (!drag.current) return;
    const { dy } = drag.current;
    drag.current = null;
    setOffset(0, true);
    if (dy > SWIPE_CLOSE_PX) close();
  };

  return (
    <div className={`${styles.whyLayer} ${closing ? styles.whyClosing : ""}`}>
      <div className={styles.whyScrim} onClick={close} aria-hidden />
      <div
        ref={sheetRef}
        className={styles.whySheet}
        role="dialog"
        aria-modal="true"
        aria-label={`Why ${rec.title} is a match`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className={styles.whyGrab} aria-hidden />
        <div className={`${styles.whySheetHead} ${scrolled ? styles.whySheetHeadScrolled : ""}`}>
          <div className={styles.cardTitleBlock}>
            <h2 className={styles.heroTitle}>{rec.title}</h2>
            <MetaRow rec={rec} />
          </div>
          <button type="button" className={styles.headerBtn} onClick={close} aria-label="Close">
            <X size={26} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        <div
          ref={bodyRef}
          className={styles.whySheetBody}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        >
          {status === "loading" && (
            <div className={styles.whyLoading}>
              <span className={styles.loadingEyebrow}>Reading your taste</span>
              <FingerprintLoader size={66} />
            </div>
          )}
          {status === "error" && typeof why === "string" && why !== "pending" && why !== "failed" ? (
            <WhyTextOnly text={why} />
          ) : status === "error" && why === "pending" ? (
            <div className={styles.whyLoading}>
              <span className={styles.loadingEyebrow}>Reading your taste</span>
              <FingerprintLoader size={66} />
            </div>
          ) : status === "error" ? (
            <div className={styles.whyError}>
              <span className={styles.error}>{errMsg}</span>
            </div>
          ) : null}
          {status === "ready" && result && <WhyPanel result={result} why={why} />}
        </div>
      </div>
    </div>
  );
}

function PosterTile({
  rec,
  size,
}: {
  rec: Recommendation;
  /** hero: the card's top half. row: the Watchlist row's 82×123 (DEC-1). */
  size: "hero" | "row";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // Fade the poster in once it has actually loaded, rather than letting it
  // paint in top-down over the motif colour. Tracked per URL, so a tile reused
  // for another title fades its new poster in too.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgLoaded = loadedSrc === rec.poster_url;
  // An image that finished loading before React attached onLoad (cache hit
  // during hydration) never fires it; catch that here or it stays invisible.
  const checkComplete = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) setLoadedSrc(rec.poster_url);
    },
    [rec.poster_url],
  );
  const showImg = rec.poster_url && !imgFailed;
  const [bg, fg] = rec.palette;

  const style: CSSProperties = {
    background: bg,
  };

  return (
    <div className={`${styles.poster} ${styles[`poster_${size}`]}`} style={style}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={rec.poster_url!}
          alt=""
          className={`${styles.posterImg} ${imgLoaded ? styles.posterImgLoaded : ""}`}
          ref={checkComplete}
          onLoad={() => setLoadedSrc(rec.poster_url)}
          onError={() => setImgFailed(true)}
        />
      ) : (
        // Both views print the title over the poster's fade, so the motif
        // carries no title of its own.
        <Motif kind={rec.motif} fg={fg} />
      )}
    </div>
  );
}

function Motif({ kind, fg }: { kind: MotifKind; fg: string }) {
  const props = {
    className: styles.posterMotif,
    style: { color: fg } as CSSProperties,
    viewBox: "0 0 100 150",
    // Crop rather than stretch so the motif keeps its shape even when the
    // poster container deviates from a 2:3 aspect ratio (card height grows
    // with content; poster fills that height + the fixed width).
    preserveAspectRatio: "xMidYMid slice" as const,
  };
  if (kind === "spades") {
    return (
      <svg {...props}>
        <path
          d="M50 30 C 30 60, 20 75, 35 90 C 42 97, 50 90, 50 80 C 50 90, 58 97, 65 90 C 80 75, 70 60, 50 30 Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (kind === "circle") {
    return (
      <svg {...props}>
        <circle cx="50" cy="68" r="40" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="50" cy="68" r="28" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="50" cy="68" r="16" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (kind === "star") {
    return (
      <svg {...props}>
        <path
          d="M50 25 L58 55 L88 55 L64 73 L72 103 L50 85 L28 103 L36 73 L12 55 L42 55 Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (kind === "cross") {
    return (
      <svg {...props}>
        <path d="M20 20 L80 80 M80 20 L20 80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M50 30 L50 100" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    );
  }
  if (kind === "dot") {
    return (
      <svg {...props}>
        <circle cx="50" cy="55" r="22" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M0 70 Q 25 55, 50 70 T 100 70" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 85 Q 25 70, 50 85 T 100 85" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 100 Q 25 85, 50 100 T 100 100" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}


// ─────────────────────────────────────────────────────────────
// Watchlist v3 (docs/plan/v3/WATCHLIST.md, 2026-11-18): the filter chips,
// the rows with a star and a swipe to remove, and the card as a page.
// Mocks: docs/prototypes/watchlist-v3 (4-air, 5-tap, 6-filter, 7-seen,
// 8-remove, 9-empty, 11-why-on-card, 13-seen).
// ─────────────────────────────────────────────────────────────

/** One row of chips in the card's own Seen-it chip style; one lit at a time (DEC-3). */
function WatchlistChips({
  chips,
  active,
  onPick,
}: {
  chips: WatchlistChip[];
  active: WatchlistFilter;
  onPick: (f: WatchlistFilter) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The row scrolls sideways: keep the lit chip in view.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <div ref={ref} className={styles.chips} role="group" aria-label="Show">
      {chips.map((c) => {
        const on = c.filter === active;
        return (
          <button
            key={c.filter}
            type="button"
            className={`${styles.seenChip} ${styles.filterChip} ${on ? styles.seenChipOn : ""}`}
            aria-pressed={on}
            // Tapping the lit chip again returns to All.
            onClick={() => onPick(on && c.filter !== "all" ? "all" : c.filter)}
          >
            {c.label}
            {c.count > 0 && <b>{c.count}</b>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The list: starred, then the rest newest-saved first, then a "Seen" line and
 * the rated titles (DEC-5, DEC-7), paged WATCHLIST_PAGE_SIZE at a time as you
 * scroll. A removed title keeps its place while its note shows.
 */
function WatchlistList({
  entries,
  ghosts,
  filter,
  starPop,
  onOpen,
  onStar,
  onRemove,
  onUndo,
  onGone,
  onDismissNotes,
  onBrowse,
}: {
  entries: WatchlistEntry[];
  ghosts: Record<string, Ghost>;
  filter: WatchlistFilter;
  starPop: string | null;
  onOpen: (entry: WatchlistEntry) => void;
  onStar: (entry: WatchlistEntry) => void;
  onRemove: (entry: WatchlistEntry) => void;
  onUndo: (entry: WatchlistEntry) => void;
  onGone: (id: string) => void;
  onDismissNotes: () => void;
  onBrowse?: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  // How many rows are shown, for the filter they were paged under: a filter
  // change starts over at the first page.
  const [paged, setPaged] = useState({ filter, n: WATCHLIST_PAGE_SIZE });
  const shownN = paged.filter === filter ? paged.n : WATCHLIST_PAGE_SIZE;
  const showMore = () => setPaged((p) => ({ filter, n: (p.filter === filter ? p.n : WATCHLIST_PAGE_SIZE) + WATCHLIST_PAGE_SIZE }));
  // The row whose Remove panel is open, if any: a swipe on another closes it.
  const [swiped, setSwiped] = useState<string | null>(null);
  // A filter change shows the filtered list from its first row. The rows
  // remount (keyed below) but this scroll container would keep its old
  // offset, clamped to the shorter list, and open on its end.
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filter]);

  // A star or a rating re-orders the list: each row slides from where it was
  // to where it is now (DEC-12), instead of jumping. Only for a pure
  // re-order (the same titles in a new order); a removal, an Undo or a new
  // page fold or fade on their own.
  const flipRef = useRef<HTMLDivElement>(null);
  const lastTops = useRef<{ ids: string; tops: Map<string, number> }>({ ids: "", tops: new Map() });
  useLayoutEffect(() => {
    const el = flipRef.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>("[data-row-id]")];
    const tops = new Map(nodes.map((n) => [n.dataset.rowId!, n.getBoundingClientRect().top]));
    const prev = lastTops.current;
    const ids = [...tops.keys()];
    const sameSet = ids.length === prev.tops.size && ids.every((id) => prev.tops.has(id));
    lastTops.current = { ids: ids.join("|"), tops };
    if (!sameSet || ids.join("|") === prev.ids) return;
    const moved = nodes
      .map((node) => ({ node, dy: (prev.tops.get(node.dataset.rowId!) ?? 0) - tops.get(node.dataset.rowId!)! }))
      .filter(({ dy }) => Math.abs(dy) > 1);
    if (moved.length === 0) return;
    for (const { node, dy } of moved) {
      node.style.transition = "none";
      node.style.transform = `translateY(${dy}px)`;
    }
    void el.offsetHeight;
    for (const { node } of moved) {
      node.style.transition = `transform ${REORDER_MS}ms var(--ease-out)`;
      node.style.transform = "";
    }
    const t = window.setTimeout(() => moved.forEach(({ node }) => { node.style.transition = ""; }), REORDER_MS + 40);
    return () => window.clearTimeout(t);
  });

  const { rows, seenFrom } = useMemo(() => {
    const live = new Set(entries.map((e) => e.rec.id));
    const all = [
      ...entries,
      ...Object.values(ghosts).map((g) => g.entry).filter((e) => !live.has(e.rec.id)),
    ];
    const { unseen, seen } = orderWatchlist(filterWatchlist(all, filter));
    return { rows: [...unseen, ...seen], seenFrom: unseen.length };
  }, [entries, ghosts, filter]);
  const visible = rows.slice(0, shownN);
  const hasMore = shownN < rows.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (hits) => {
        if (hits[0]?.isIntersecting) showMore();
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // showMore reads the current filter; re-observing per page is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, visible.length, filter]);

  if (entries.length === 0 && Object.keys(ghosts).length === 0) {
    // Nothing saved: today's text, the app's orange primary (DEC-10).
    return (
      <div className={styles.list}>
        <div className={styles.emptyState}>
          <span className={styles.muted}>{emptyFilterText("all")}</span>
          {onBrowse && (
            <button
              type="button"
              className={`${styles.watchlistBtn} ${styles.watchlistBtnPrimary} ${styles.emptyBtn}`}
              onClick={onBrowse}
            >
              Go to For you
            </button>
          )}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    // A filter with nothing behind it says so; the chip stays lit (DEC-3).
    return (
      <div className={styles.list}>
        <div className={styles.emptyState}>
          <span className={styles.muted}>{emptyFilterText(filter)}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef} className={`${styles.list} ${styles.listRows}`} {...TAB_SCROLL}>
      {/* Keyed by the filter: a change re-orders with a short fade, not a cut (DEC-12). */}
      <div key={filter} ref={flipRef} className={styles.listFade}>
        {visible.map((e, i) => (
          <Fragment key={e.rec.id}>
            {i === seenFrom && filter !== "seen" && (
              <div className={styles.seenDivider} role="separator" aria-label={`Seen, ${rows.length - seenFrom}`}>
                Seen <b>{rows.length - seenFrom}</b>
              </div>
            )}
            <WatchlistRow
              entry={e}
              ghost={ghosts[e.rec.id]}
              swiped={swiped === e.rec.id}
              starPop={starPop === e.rec.id}
              onSwipeStart={() => {
                setSwiped(e.rec.id);
                onDismissNotes();
              }}
              onSettle={(open) => setSwiped((cur) => (open ? e.rec.id : cur === e.rec.id ? null : cur))}
              onOpen={onOpen}
              onStar={onStar}
              onRemove={onRemove}
              onUndo={onUndo}
              onGone={onGone}
            />
          </Fragment>
        ))}
      </div>
      <div ref={sentinelRef} className={styles.sentinel}>
        {!hasMore && <span className={styles.muted}>That&rsquo;s everything we found.</span>}
      </div>
    </div>
  );
}

/**
 * One title: poster, name, year · length · ★, where it streams in Israel and
 * the match (DEC-1, DEC-11); a star to prioritise (DEC-4). A rated title sits
 * under the Seen line, dimmed, with the reaction in place of the match (DEC-5).
 * Swipe left to reveal Remove; the row then folds into a note with Undo
 * (DEC-8). Pointer events, so it works on Android Chrome; `touch-action:
 * pan-y` leaves a vertical scroll to the browser.
 */
function WatchlistRow({
  entry,
  ghost,
  swiped,
  starPop,
  onSwipeStart,
  onSettle,
  onOpen,
  onStar,
  onRemove,
  onUndo,
  onGone,
}: {
  entry: WatchlistEntry;
  ghost: Ghost | undefined;
  swiped: boolean;
  starPop: boolean;
  onSwipeStart: () => void;
  onSettle: (open: boolean) => void;
  onOpen: (entry: WatchlistEntry) => void;
  onStar: (entry: WatchlistEntry) => void;
  onRemove: (entry: WatchlistEntry) => void;
  onUndo: (entry: WatchlistEntry) => void;
  onGone: (id: string) => void;
}) {
  const { rec } = entry;
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const actRef = useRef<HTMLButtonElement>(null);
  const lastH = useRef<number | null>(null);
  // `base` is where the row stood at touch-down (0, or open): the prop
  // `swiped` flips to true as soon as the swipe starts, so measuring from
  // it mid-drag would throw the row to fully open on the first pixel.
  const drag = useRef<{ x0: number; y0: number; axis: "none" | "x"; base: number; x: number } | null>(null);
  // A swipe ends in a click on the same element: that click opens nothing.
  const moved = useRef(false);
  const content = ghost ? "note" : "row";

  // Row → note (Remove) and note → row (Undo): the wrapper's height goes from
  // the one to the other, so the list never jumps (DEC-12). `lastH` is the
  // height before this render (recorded by the effect below it).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const from = lastH.current;
    if (!el || from == null) return;
    el.style.transition = "none";
    el.style.height = "";
    const to = el.offsetHeight;
    if (from === to) {
      el.style.transition = "";
      return;
    }
    el.style.height = `${from}px`;
    void el.offsetHeight;
    el.style.transition = `height ${FOLD_MS}ms var(--ease-out)`;
    el.style.height = `${to}px`;
    const t = window.setTimeout(() => {
      el.style.height = "";
      el.style.transition = "";
    }, FOLD_MS + 40);
    return () => window.clearTimeout(t);
  }, [content]);
  useLayoutEffect(() => {
    lastH.current = wrapRef.current?.offsetHeight ?? null;
  });

  // The note's time is up (or another title was removed): fold away and
  // close the gap.
  useEffect(() => {
    if (ghost?.phase !== "leaving") return;
    const el = wrapRef.current;
    if (!el) return;
    el.style.height = `${el.offsetHeight}px`;
    void el.offsetHeight;
    el.style.transition = `height ${FOLD_MS}ms var(--ease-out), opacity 200ms var(--ease-out)`;
    el.style.height = "0px";
    el.style.opacity = "0";
    const t = window.setTimeout(() => onGone(rec.id), FOLD_MS + 20);
    return () => window.clearTimeout(t);
    // onGone is stable enough: it only forgets the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost?.phase, rec.id]);

  // The row and its Remove panel move together; the panel waits past the
  // right edge (the wrapper clips it).
  const setX = (x: number, animate: boolean) => {
    for (const el of [rowRef.current, actRef.current]) {
      if (!el) continue;
      el.style.transition = animate ? "transform 240ms var(--ease-out)" : "none";
      el.style.transform = x ? `translateX(${x}px)` : "";
    }
  };
  // Closed from outside: another row was swiped.
  useEffect(() => {
    if (!swiped) setX(0, true);
  }, [swiped]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const base = swiped ? -SWIPE_W : 0;
    drag.current = { x0: e.clientX, y0: e.clientY, axis: "none", base, x: base };
    moved.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.axis === "none") {
      // Mostly vertical: a scroll, the browser's.
      if (Math.abs(dy) > SWIPE_SLOP && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dx) <= SWIPE_SLOP) return;
      d.axis = "x";
      moved.current = true;
      // Capture keeps the moves coming when the finger leaves the row. It
      // throws for a pointer the browser no longer tracks; then the swipe
      // just follows while the finger stays on the row.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no capture */
      }
      onSwipeStart();
    }
    let x = Math.min(0, d.base + dx);
    // Past the panel the row resists.
    if (x < -SWIPE_W) x = -SWIPE_W - (-SWIPE_W - x) * 0.25;
    d.x = x;
    setX(x, false);
  };
  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== "x") return;
    const open = d.x < -SWIPE_OPEN_PX;
    setX(open ? -SWIPE_W : 0, true);
    onSettle(open);
  };
  const onRowClick = () => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    // A tap on a swiped-open row closes it; the next tap opens the card.
    if (swiped) {
      onSettle(false);
      return;
    }
    onOpen(entry);
  };

  const seen = isSeen(entry);
  const pct = rec.match > 0 ? Math.round(rec.match * 100) : 0;

  return (
    <div ref={wrapRef} className={styles.rowWrap} data-row-id={rec.id}>
      {/* Keyed: the note must not inherit the swiped row's element (and its transform). */}
      {ghost ? (
        <div key="note" className={styles.noteWrap}>
          <div className={styles.note} role="status">
            <p>
              Removed. <b>{rec.title}</b> is off your Watchlist.
            </p>
            <button type="button" onClick={() => onUndo(entry)}>Undo</button>
          </div>
        </div>
      ) : (
        <div key="row" className={styles.swipe}>
          <div
            ref={rowRef}
            className={`${styles.row} ${seen ? styles.rowSeen : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${rec.title}: open`}
            onClick={onRowClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(entry);
              }
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <PosterTile rec={rec} size="row" />
            <div className={styles.rowBody}>
              <h3 className={styles.rowTitle}>{rec.title}</h3>
              <MetaRow rec={rec} />
              <span className={styles.rowLine}>
                {seen ? (
                  <span className={styles.rowReaction}>{SEEN_LABEL[entry.rating as keyof typeof SEEN_LABEL]}</span>
                ) : (
                  <>
                    {rec.where_il && (
                      <>
                        <span>{rec.where_il}</span>
                        {pct > 0 && <span className={styles.rowDot} aria-hidden>·</span>}
                      </>
                    )}
                    {pct > 0 && <span className={styles.rowMatch}>{pct}% match</span>}
                  </>
                )}
              </span>
            </div>
            <button
              type="button"
              className={`${styles.rowStar} ${entry.starred ? styles.rowStarOn : ""} ${starPop ? styles.starPop : ""}`}
              aria-pressed={entry.starred}
              aria-label={entry.starred ? `Starred: ${rec.title} (tap to un-star)` : `Star ${rec.title}`}
              title={entry.starred ? "Starred" : "Star"}
              onClick={(e) => {
                e.stopPropagation();
                if (moved.current) {
                  moved.current = false;
                  return;
                }
                onStar(entry);
              }}
            >
              <Star size={24} strokeWidth={1.6} aria-hidden />
            </button>
          </div>
          <button
            ref={actRef}
            type="button"
            className={styles.swipeAct}
            onClick={() => onRemove(entry)}
            tabIndex={swiped ? 0 : -1}
            aria-hidden={!swiped}
            aria-label={`Remove ${rec.title} from watchlist`}
          >
            <BookmarkX size={24} strokeWidth={1.7} aria-hidden />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Tap a row: the card you know from For you, as its own page, with the why
 * breakdown on it under Seen it? (DEC-2) and a star above share (DEC-4).
 */
function WatchlistCardPage({
  entry,
  ...rest
}: {
  entry: WatchlistEntry;
  rec: Recommendation;
  reasonPending: boolean;
  rated: WatchlistRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onUnrate: (rec: Recommendation) => void;
  onShare: (rec: Recommendation) => void;
  onToggleWatchlist: (rec: Recommendation) => void;
  onStar: () => void;
}) {
  return <TitleCardPage {...rest} saved starred={entry.starred} snapshot={entry.explain} />;
}

/**
 * A title's card as its own page, in that title's state for you (WATCHLIST.md DEC-2): the Watchlist's, and every title
 * tapped in Search (SEARCH.md DEC-2, v3 Q1). The star only on a saved title (DEC-4); the breakdown under Seen it?.
 */
export function TitleCardPage({
  rec,
  saved,
  starred,
  onStar,
  snapshot,
  reasonPending,
  rated,
  onFeedback,
  onUnrate,
  onShare,
  onToggleWatchlist,
}: {
  rec: Recommendation;
  saved: boolean;
  starred?: boolean;
  onStar?: () => void;
  /** The breakdown saved with the title, shown when today's can't be had. */
  snapshot?: ExplainData | null;
  reasonPending: boolean;
  rated: WatchlistRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onUnrate: (rec: Recommendation) => void;
  onShare: (rec: Recommendation) => void;
  onToggleWatchlist: (rec: Recommendation) => void;
}) {
  const whyRef = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.list} {...TAB_SCROLL}>
      <FeedCard
        rec={rec}
        rated={rated}
        onFeedback={onFeedback}
        onUnrate={onUnrate}
        // The short why line is the teaser; the breakdown is further down this page.
        onWhy={() => whyRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
        onShare={onShare}
        saved={saved}
        onToggleWatchlist={onToggleWatchlist}
        reasonPending={reasonPending}
        starred={saved ? starred : undefined}
        onStar={saved ? onStar : undefined}
        whyInline={<InlineWhy snapshot={snapshot ?? null} rec={rec} innerRef={whyRef} />}
      />
    </div>
  );
}

/**
 * The sheet's content on the card page (Why, Score breakdown, What it's like,
 * Crew), in the sheet's own styles. The written why takes 1–3 s: three quiet
 * lines hold its place. A saved title with no breakdown (a third of today's)
 * shows the Why alone: no bars, no error line (DEC-2).
 *
 * The breakdown is today's (v3 M2, FOR-YOU.md DEC-9): the engine scores the
 * title now (M1, /api/recommendations/score) instead of showing the one
 * frozen on the day it was saved. If that can't be had, the saved snapshot,
 * without the old guessed bars a pre-v2 one would draw; then the Why alone.
 */
function InlineWhy({
  snapshot,
  rec,
  innerRef,
}: {
  snapshot: ExplainData | null;
  rec: Recommendation;
  innerRef: RefObject<HTMLDivElement | null>;
}) {
  const why = useWhyText(rec);
  // Today's breakdown scored earlier this session, else ask the engine now.
  const [data, setData] = useState<ExplainData | null | "loading">(
    () => getCachedExplain(freshKey(rec.id)) ?? "loading",
  );
  useEffect(() => {
    if (data !== "loading") return;
    let cancelled = false;
    (async () => {
      const fresh = await fetchFreshExplain(rec.type, tmdbIdOf(rec.id));
      if (cancelled) return;
      if (fresh) {
        setCachedExplain(freshKey(rec.id), fresh);
        setData(fresh);
        return;
      }
      // Not scored today (not in the catalogue, a cold-start profile, an
      // error): the snapshot from the day it was saved, never its guessed
      // bars; with none, the Why alone.
      setData(snapshot ? withoutGuessedBars(snapshot) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [data, rec.id, rec.type, snapshot]);

  let body: ReactNode = null;
  if (data && data !== "loading") body = <WhyPanel result={toResult(data, rec)} why={why} />;
  else if (data === "loading" || why === "pending") body = <WhyTextOnly text="" pending />;
  else if (typeof why === "string" && why !== "failed") body = <WhyTextOnly text={why} />;
  if (!body) return null;
  return (
    <div ref={innerRef} className={styles.cardWhy}>
      {body}
    </div>
  );
}
