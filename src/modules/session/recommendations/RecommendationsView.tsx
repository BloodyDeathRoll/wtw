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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import type {
  FeedbackRating,
  MotifKind,
  Recommendation,
} from "@/types/recommendation";
import type { RecommendationResult } from "@/types/dna";
import {
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
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
  getCachedExplain,
  setCachedExplain,
  type ExplainData,
} from "@/lib/explain-cache";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  setWatchlistRating,
  WATCHLIST_HYDRATED_EVENT,
  type WatchlistEntry,
  type WatchlistRating,
} from "@/lib/watchlist";
import { addToRegretQueue, removeFromRegretQueue } from "@/lib/regret-queue";
import { shareTitle } from "@/lib/share";
import ShareIcon from "@/app/components/ShareIcon";
import { HeaderSearch } from "@/app/components/HeaderSearch";
import type { ContentType } from "@/lib/content-type";

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
   *                     of the API. Identical layout. Rating a card feeds the
   *                     fingerprint through the same call the feed uses but
   *                     LEAVES it here, tagged with the outcome; only the card's
   *                     own "Remove from watchlist" button takes it off.
   */
  mode?: Mode;
  /** The signed-in user's name: its first word rides in shared links, so the
   *  friend's page can say who sent it (src/lib/share.ts). */
  sharerName?: string | null;
  /**
   * When provided, a "Find more" CTA renders at the end of the list. It runs
   * this callback (session-end: fingerprint rebuild + fresh rec generation —
   * every like/dislike feeds the fingerprint, so the new batch reflects them),
   * then clears and refetches the list.
   */
  onFindMore?: () => Promise<void>;
  /** Watchlist mode only — action on the empty state that opens the rec feed. */
  onBrowse?: () => void;
  /**
   * Rendered at the far right of the header.
   * The app menu goes here so it sits in the same spot on every screen
   * (decided 2026-08-29).
   */
  headerRight?: ReactNode;
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
const WATCHLIST_PAGE_SIZE = 6; // matches the API's page size so scrolling feels the same

const HEADER_TITLE: Record<Mode, string> = {
  recommendations: "For You",
  learning: "Fast Learning",
  watchlist: "Watchlist",
};

/** rec.id is "type:tmdb_id" for engine recs (a bare slug only in legacy saved entries). */
function tmdbIdOf(id: string): string {
  return id.includes(":") ? id.split(":")[1] : id;
}

/**
 * Watchlist sort (Figma 29:4262). Client-side over the saved entries — every
 * key is already on the stored card. "Rating" is the external ★ score shown on
 * the card, not the user's own reaction. Ties keep storage order (newest
 * first) because Array.prototype.sort is stable.
 */
type SortKey = "year" | "added" | "rating" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "year", label: "Year" },
  { key: "added", label: "Date Added" },
  { key: "rating", label: "Rating" },
  { key: "name", label: "Name" },
];

function sortEntries(entries: WatchlistEntry[], key: SortKey): WatchlistEntry[] {
  const list = [...entries];
  switch (key) {
    case "added":
      return list.sort((a, b) => b.added_at - a.added_at);
    case "year":
      return list.sort((a, b) => (b.rec.year ?? 0) - (a.rec.year ?? 0));
    case "rating":
      return list.sort((a, b) => (b.rec.rating ?? 0) - (a.rec.rating ?? 0));
    case "name":
      return list.sort((a, b) =>
        a.rec.title.localeCompare(b.rec.title, undefined, { sensitivity: "base" }),
      );
  }
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
  contentType,
  setContentType,
  mode = "recommendations",
  sharerName,
  onFindMore,
  onBrowse,
  headerRight,
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
  const shown = useMemo(() => {
    if (mode !== "watchlist" || lines.state === "keep") return recs;
    return recs.map((r) => ({ ...r, reason: lines.byId[r.id] ?? "" }));
  }, [recs, mode, lines]);

  // Watchlist mode only — the order the saved cards are paged in.
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [sortOpen, setSortOpen] = useState(false);

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
  // Watchlist mode pages over a snapshot taken when the view opens, NOT over
  // live storage: rating a card removes it from storage, which would otherwise
  // shift the cursor and make the pager skip the next entry.
  const watchlistRef = useRef<Recommendation[]>([]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      // Saved cards are stored whole, so this needs no network and no type
      // filter — the watchlist deliberately shows everything the user saved.
      if (mode === "watchlist") {
        const all = watchlistRef.current;
        const items = all.slice(
          offsetRef.current,
          offsetRef.current + WATCHLIST_PAGE_SIZE,
        );
        setRecs((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          const incoming = items.filter((r) => !seen.has(r.id));
          return incoming.length ? [...prev, ...incoming] : prev;
        });
        offsetRef.current += items.length;
        const more = offsetRef.current < all.length;
        hasMoreRef.current = more;
        setHasMore(more);
        return;
      }

      const v = versionRef.current == null ? "" : `&v=${versionRef.current}`;
      const res = await fetch(
        `/api/recommendations/generate?type=${contentType}&offset=${offsetRef.current}${v}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as {
        recommendations: Recommendation[];
        next_offset: number;
        has_more: boolean;
        taste_version?: number | null;
      };
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
  }, [contentType, mode]);

  // Initial load + reload when content type changes.
  useEffect(() => {
    setRecs([]);
    setHasMore(true);
    offsetRef.current = 0;
    versionRef.current = null;
    hasMoreRef.current = true;
    loadingRef.current = false;
    // Seed the membership set (all modes — the feed shows saved state too), the
    // stored outcome tags, and the watchlist pager's snapshot, before the first
    // page is read.
    const entries = getWatchlist();
    setSaved(new Set(entries.map((e) => e.rec.id)));
    setFeedbackGiven(
      Object.fromEntries(
        entries
          .filter((e) => e.rating != null)
          .map((e) => [e.rec.id, e.rating as WatchlistRating]),
      ),
    );
    watchlistRef.current = sortEntries(entries, sortKey).map((e) => e.rec);
    if (!building) void loadMore();
    // sortKey only changes in watchlist mode (the control renders nowhere
    // else); re-running here re-pages the list from the top in the new order.
    // hydratedAt bumps when the server's watchlist lands after mount.
    // building: a Picks tap empties the list now and fetches once the build
    // lands; re-seeding alongside is redundant but cheap.
  }, [contentType, loadMore, sortKey, hydratedAt, building]);

  // "Find more": rebuild the fingerprint (feedback so far included) and
  // regenerate recs server-side, then APPEND the fresh batch — existing cards
  // (rated or not) stay in place; loadMore's id-dedup keeps only new titles.
  async function handleFindMore() {
    if (!onFindMore || refreshing) return;
    setRefreshing(true);
    try {
      // Let any in-flight rating merges land first so they're in the rebuild.
      await feedbackQueueRef.current;
      await onFindMore();
      offsetRef.current = 0; // re-page through the NEW cache from the top
      hasMoreRef.current = true;
      setHasMore(true);
      await loadMore();
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
      if (mode === "watchlist") dropCard(rec);
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
  // this surface: removed from the feed, or unsaved from the watchlist.
  function dropCard(rec: Recommendation) {
    setRecs((prev) => prev.filter((r) => r.id !== rec.id));
  }

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
        // The feedback route's contract is { tmdb_id, action, reaction, ... }.
        // (The UI used to send { recommendation_id, rating } — every click
        // silently 400'd and no rating ever reached the fingerprint.)
        // rec.id is "type:tmdb_id" for engine recs (a bare slug only in legacy saved entries).
        const tmdb_id = rec.id.includes(":") ? rec.id.split(":")[1] : rec.id;
        const res = await fetch("/api/recommendations/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdb_id,
            media_type: rec.type,
            title: rec.title,
            // disliked = "watched it, didn't like it" — a negative taste
            // signal (skipped means not-accepted); loved/liked are positive.
            action: rating === "disliked" ? "skipped" : "watched",
            reaction: rating,
            // The list this rating came from — the server precomputes the
            // next batch for the same one.
            content_type: contentType,
            is_stretch_pick: rec.is_stretch_pick ?? false,
          }),
        });
        if (!res.ok) {
          console.error(`[recs] feedback HTTP ${res.status}`, await res.text().catch(() => ""));
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
        const res = await fetch("/api/recommendations/feedback", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdb_id,
            media_type: rec.type,
            content_type: contentType,
            // On the Watchlist the history entry goes back to "saved".
            saved: saved.has(rec.id),
          }),
        });
        if (!res.ok) {
          console.error(`[recs] un-rate HTTP ${res.status}`, await res.text().catch(() => ""));
          restore();
        }
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
      <div className={styles.header} data-header-row>
        <button
          type="button"
          className={styles.headerBtn}
          onClick={onBack}
          aria-label="back"
        >
          <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
        </button>
        {setContentType && mode !== "watchlist" ? (
          <TypePicker contentType={contentType} setContentType={setContentType} />
        ) : (
          <span className={styles.headerTitle}>
            {mode === "watchlist" ? `${HEADER_TITLE[mode]} (${saved.size})` : HEADER_TITLE[mode]}
          </span>
        )}
        <div className={styles.headerRight}>
          {/* Search travels with the app menu (both are the app's, not the
              view's): on the watchlist it lists the saved titles first, and
              its Back returns to this screen (2026-11-07). */}
          {headerRight && (
            <HeaderSearch btnClass={styles.headerBtn} scope={mode === "watchlist" ? "watchlist" : undefined} from={mode} />
          )}
          {headerRight}
        </div>
      </div>

      {mode === "watchlist" && saved.size > 0 && (
        <div className={styles.sortBar}>
          <span className={styles.sortLabel}>Sort by</span>
          <SortMenu
            value={sortKey}
            onChange={setSortKey}
            open={sortOpen}
            setOpen={setSortOpen}
          />
        </div>
      )}

      <div className={`${styles.content} ${sortOpen ? styles.contentDimmed : ""}`}>
        <Feed
          recs={shown}
          reasonsPending={mode === "watchlist" && lines.state === "loading"}
          loading={loading || building}
          hasMore={hasMore}
          error={error}
          feedbackGiven={feedbackGiven}
          onLoadMore={loadMore}
          onFeedback={handleFeedback}
          onUnrate={handleUnrate}
          onRemove={mode === "watchlist" ? undefined : handleRemove}
          leaving={leaving}
          onWhy={setDetail}
          onShare={(r) => void shareTitle(r, sharerName)}
          onFindMore={onFindMore ? handleFindMore : undefined}
          refreshing={refreshing}
          saved={saved}
          onToggleWatchlist={toggleWatchlist}
          emptyMessage={
            mode === "watchlist"
              ? "Nothing saved yet. Tap “Add to Watchlist” on a recommendation to keep it here."
              : undefined
          }
          onBrowse={mode === "watchlist" ? onBrowse : undefined}
          onCalibrate={mode === "recommendations" ? onCalibrate : undefined}
        />
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
  emptyMessage,
  onBrowse,
  onCalibrate,
  reasonsPending = false,
}: {
  recs: Recommendation[];
  /** The Watchlist's fresh "why" lines are on their way: show a placeholder. */
  reasonsPending?: boolean;
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
  /** Shown instead of the list when there's nothing to render (watchlist). */
  emptyMessage?: string;
  onBrowse?: () => void;
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

  if (emptyMessage && recs.length === 0 && !loading) {
    return (
      <div className={styles.list}>
        <div className={styles.emptyState}>
          <span className={styles.muted}>{emptyMessage}</span>
          {onBrowse && (
            <button type="button" className={styles.browseBtn} onClick={onBrowse}>
              Browse recommendations
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef} className={styles.list}>
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
            reasonPending={reasonsPending}
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
  const { key, label } = canonicalProvider(where);
  return (
    <div className={styles.whereBadge}>
      <ProviderIcon providerKey={key} className={styles.whereIcon} />
      <span>{label}</span>
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
  const label = saved ? "Remove from watchlist" : "Add to Watchlist";
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
  size: "hero";
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
// Watchlist sort dropdown (Figma 29:4262)
// ─────────────────────────────────────────────────────────────

function SortMenu({
  value,
  onChange,
  open,
  setOpen,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const current = SORT_OPTIONS.find((o) => o.key === value)!;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return (
    <div className={styles.sortMenu} ref={ref}>
      <button
        type="button"
        className={styles.sortTrigger}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Sort by: ${current.label}`}
      >
        <span>{current.label}</span>
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden />
      </button>
      {open && (
        <div className={styles.sortPanel}>
          <button
            type="button"
            className={styles.sortPanelHead}
            onClick={() => setOpen(false)}
            aria-label="Close sort menu"
          >
            <span>{current.label}</span>
            <ChevronUp size={16} strokeWidth={1.8} aria-hidden />
          </button>
          <div role="menu" className={styles.sortOptions}>
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                role="menuitemradio"
                aria-checked={o.key === value}
                className={`${styles.sortOption} ${o.key === value ? styles.sortOptionActive : ""}`}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
