"use client";

// Recommendations surface — opens when the user taps the "Recommendations
// Ready" pill. Two view modes:
//
//   • compact (list)     small cards, infinite-scroll, descending match%
//   • full   (one-up)    big card per recommendation, swipe-to-next
//
// Every card carries two feedback actions ("Seen & Liked" / "Don't Like")
// that POST to /api/recommendations/feedback. That feedback stream is the
// fingerprint signal source for the DNA Writer (Assignment 3) when it lands.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  FeedbackRating,
  MotifKind,
  Recommendation,
} from "@/types/recommendation";
import type { RecommendationResult } from "@/types/dna";
import styles from "./RecommendationsView.module.css";
import { FingerprintLoader } from "../components/FingerprintLoader";
import { WhyPanel } from "@/app/components/RecCard";
import {
  getCachedExplain,
  setCachedExplain,
  type ExplainData,
} from "@/lib/explain-cache";

type Mode = "recommendations" | "learning";

interface Props {
  onBack: () => void;
  contentType: "movies" | "series";
  /**
   * "recommendations" = curated for-you feed (default).
   * "learning"        = rapid taste-training stream; identical UI but the
   *                     header label changes and the user is encouraged to
   *                     skip-without-rating (swipe in full view).
   */
  mode?: Mode;
  /**
   * When provided, a "Find more" CTA renders at the end of the list. It runs
   * this callback (session-end: fingerprint rebuild + fresh rec generation —
   * every like/dislike feeds the fingerprint, so the new batch reflects them),
   * then clears and refetches the list.
   */
  onFindMore?: () => Promise<void>;
}

type ViewMode = "compact" | "full";

const PAGE_FETCH_LIMIT = 50; // hard cap; the mock list is short anyway

const HEADER_TITLE: Record<Mode, string> = {
  recommendations: "For You",
  learning: "Fast Learning",
};

export default function RecommendationsView({
  onBack,
  contentType,
  mode = "recommendations",
  onFindMore,
}: Props) {
  const [view, setView] = useState<ViewMode>("compact");
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullIndex, setFullIndex] = useState(0);
  // The card whose "Why this?" detail overlay is open (null = closed).
  const [detail, setDetail] = useState<Recommendation | null>(null);
  // Once a card has been rated we hide its buttons (and in the full view,
  // we auto-advance). Local-only — survives until the view closes.
  const [feedbackGiven, setFeedbackGiven] = useState<
    Record<string, FeedbackRating>
  >({});

  // Refs mirror loading/offset/hasMore so loadMore doesn't depend on
  // those changing via setState (which would create stale closures and
  // a double-fire race between the initial-load effect and the
  // IntersectionObserver firing on the empty sentinel).
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  // Serializes feedback POSTs: each click's server-side fingerprint merge is a
  // read-modify-write on the DNA, so requests must not overlap. Find More
  // awaits this chain so every rating is merged before regeneration.
  const feedbackQueueRef = useRef<Promise<void>>(Promise.resolve());

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/recommendations/generate?type=${contentType}&offset=${offsetRef.current}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as {
        recommendations: Recommendation[];
        next_offset: number;
        has_more: boolean;
      };
      // Dedup by id — in case the same page slips through twice we don't
      // create duplicate React keys.
      setRecs((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const incoming = data.recommendations.filter((r) => !seen.has(r.id));
        return incoming.length ? [...prev, ...incoming] : prev;
      });
      offsetRef.current = data.next_offset;
      const more = data.has_more && data.next_offset < PAGE_FETCH_LIMIT;
      hasMoreRef.current = more;
      setHasMore(more);
    } catch (e) {
      console.error("[recs] load failed", e);
      setError("Couldn't load more right now");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [contentType]);

  // Initial load + reload when content type changes.
  useEffect(() => {
    setRecs([]);
    setHasMore(true);
    setFullIndex(0);
    setFeedbackGiven({});
    offsetRef.current = 0;
    hasMoreRef.current = true;
    loadingRef.current = false;
    void loadMore();
  }, [contentType, loadMore]);

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

  async function handleFeedback(rec: Recommendation, rating: FeedbackRating) {
    setFeedbackGiven((prev) => ({ ...prev, [rec.id]: rating }));
    // Queue the POST (don't block the UI on it): the route folds each rating
    // into the fingerprint incrementally, and those merges must run one at a
    // time. The UI card state was already flipped above.
    feedbackQueueRef.current = feedbackQueueRef.current.then(async () => {
      try {
        // The feedback route's contract is { tmdb_id, action, reaction, ... }.
        // (The UI used to send { recommendation_id, rating } — every click
        // silently 400'd and no rating ever reached the fingerprint.)
        // rec.id is "type:tmdb_id" for engine recs, a slug for mocks.
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
            is_stretch_pick: rec.is_stretch_pick ?? false,
          }),
        });
        if (!res.ok) {
          console.error(`[recs] feedback HTTP ${res.status}`, await res.text().catch(() => ""));
        }
      } catch (e) {
        console.error("[recs] feedback failed", e);
      }
    });
    // In full view, advance to next after feedback.
    if (view === "full") {
      setFullIndex((i) => Math.min(i + 1, recs.length - 1));
    }
  }

  // "Remove" — suppress this title so it's never recommended again. Optimistic:
  // drop the card immediately, then persist to the removed list server-side.
  // Tracked in Supabase so a future "Removed" screen can restore it.
  function handleRemove(rec: Recommendation) {
    setRecs((prev) => prev.filter((r) => r.id !== rec.id));
    setFullIndex((i) => Math.max(0, Math.min(i, recs.length - 2)));
    const tmdb_id = rec.id.includes(":") ? rec.id.split(":")[1] : rec.id;
    void fetch("/api/recommendations/removed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdb_id, media_type: rec.type, title: rec.title }),
    })
      .then(async (res) => {
        if (!res.ok) {
          console.error(
            `[recs] remove HTTP ${res.status}`,
            await res.text().catch(() => ""),
          );
        }
      })
      .catch((e) => console.error("[recs] remove failed", e));
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.headerBtn}
          onClick={onBack}
          aria-label="back"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className={styles.headerTitle}>{HEADER_TITLE[mode]}</span>
        <button
          type="button"
          className={styles.headerBtn}
          onClick={() => setView((v) => (v === "compact" ? "full" : "compact"))}
          aria-label={view === "compact" ? "switch to full view" : "switch to list view"}
        >
          {view === "compact" ? IconCardFull : IconListGrid}
        </button>
      </div>

      {view === "compact" ? (
        <CompactList
          recs={recs}
          loading={loading}
          hasMore={hasMore}
          error={error}
          feedbackGiven={feedbackGiven}
          onLoadMore={loadMore}
          onFeedback={handleFeedback}
          onRemove={handleRemove}
          onWhy={setDetail}
          onFindMore={onFindMore ? handleFindMore : undefined}
          refreshing={refreshing}
        />
      ) : (
        <FullSwiper
          recs={recs}
          index={fullIndex}
          setIndex={setFullIndex}
          loading={loading}
          hasMore={hasMore}
          feedbackGiven={feedbackGiven}
          onLoadMore={loadMore}
          onFeedback={handleFeedback}
          onRemove={handleRemove}
          onWhy={setDetail}
        />
      )}

      {detail && (
        <WhyDetailOverlay
          rec={detail}
          rated={feedbackGiven[detail.id]}
          onFeedback={handleFeedback}
          onRemove={(r) => {
            setDetail(null);
            handleRemove(r);
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Compact (list) view
// ─────────────────────────────────────────────────────────────

function CompactList({
  recs,
  loading,
  hasMore,
  error,
  feedbackGiven,
  onLoadMore,
  onFeedback,
  onRemove,
  onWhy,
  onFindMore,
  refreshing = false,
}: {
  recs: Recommendation[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  feedbackGiven: Record<string, FeedbackRating>;
  onLoadMore: () => void;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onRemove: (rec: Recommendation) => void;
  onWhy: (rec: Recommendation) => void;
  onFindMore?: () => void;
  refreshing?: boolean;
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

  return (
    <div ref={listRef} className={styles.list}>
      {recs.map((rec) => (
        <CompactCard
          key={rec.id}
          rec={rec}
          rated={feedbackGiven[rec.id]}
          onFeedback={onFeedback}
          onRemove={onRemove}
          onWhy={onWhy}
        />
      ))}
      <div ref={sentinelRef} className={styles.sentinel}>
        {refreshing && (
          <div className={styles.findMoreLoading}>
            <FingerprintLoader size={40} />
            <span className={styles.muted}>Updating your fingerprint…</span>
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

function CompactCard({
  rec,
  rated,
  onFeedback,
  onRemove,
  onWhy,
}: {
  rec: Recommendation;
  rated: FeedbackRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onRemove: (rec: Recommendation) => void;
  onWhy: (rec: Recommendation) => void;
}) {
  return (
    <article className={styles.card}>
      {/* Row 1 — title + meta + Why pill | % match | trailer */}
      <div className={styles.cardTop}>
        <div className={styles.cardTitleBlock}>
          <h3 className={styles.cardTitle}>{rec.title}</h3>
          <div className={styles.cardMeta}>
            <span>{rec.year}</span>
            <span className={styles.dot} />
            <span>{rec.meta}</span>
            <span className={styles.dot} />
            <span>★ {rec.rating.toFixed(1)}</span>
          </div>
          <button
            type="button"
            className={styles.whyPill}
            onClick={() => onWhy(rec)}
            aria-label={`Why we picked ${rec.title}`}
          >
            <span aria-hidden>🤔</span>
            <span>Why this pick?</span>
          </button>
        </div>
        <div className={styles.cardMatch}>
          <span className={styles.matchDot} />
          {Math.round(rec.match * 100)}% match
        </div>
        <TrailerButton rec={rec} />
      </div>

      {/* Row 2 — poster | fingerprint text */}
      <div className={styles.cardMid}>
        <PosterTile rec={rec} size="md" />
        <div className={styles.cardReason}>
          <span className={styles.reasonEyebrow}>FINGERPRINT</span>
          <span>{rec.reason}</span>
        </div>
      </div>

      {/* Row 3 — the four reactions */}
      <FeedbackRow
        rec={rec}
        rated={rated}
        onFeedback={onFeedback}
        onRemove={onRemove}
        compact
      />
    </article>
  );
}

// Play button for the title's trailer. Disabled (greyed) when no trailer has
// been ingested for the title.
function TrailerButton({
  rec,
  showLabel,
}: {
  rec: Recommendation;
  /** Render a "Play trailer" text label next to the icon (details page). */
  showLabel?: boolean;
}) {
  const hasTrailer = Boolean(rec.trailer_url);
  return (
    <button
      type="button"
      className={`${styles.playBtn} ${showLabel ? styles.playBtnLabeled : ""}`}
      disabled={!hasTrailer}
      onClick={
        hasTrailer
          ? () => window.open(rec.trailer_url!, "_blank", "noopener,noreferrer")
          : undefined
      }
      aria-label={hasTrailer ? `Play ${rec.title} trailer` : "Trailer unavailable"}
      title={hasTrailer ? "Play trailer" : "Trailer unavailable"}
    >
      {showLabel && (
        <span className={styles.playBtnText}>
          {hasTrailer ? "Play trailer" : "No trailer"}
        </span>
      )}
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden>
        <path d="M8 5v14l11-7z" />
      </svg>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Full-screen card view
// ─────────────────────────────────────────────────────────────

function FullSwiper({
  recs,
  index,
  setIndex,
  loading,
  hasMore,
  feedbackGiven,
  onLoadMore,
  onFeedback,
  onRemove,
  onWhy,
}: {
  recs: Recommendation[];
  index: number;
  setIndex: (i: number | ((p: number) => number)) => void;
  loading: boolean;
  hasMore: boolean;
  feedbackGiven: Record<string, FeedbackRating>;
  onLoadMore: () => void;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onRemove: (rec: Recommendation) => void;
  onWhy: (rec: Recommendation) => void;
}) {
  const startX = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 50;
  // Which side the incoming card slides from. Derived from index changes
  // so it works for swipes AND parent-driven advances (after feedback).
  const [slideDir, setSlideDir] = useState<"left" | "right">("right");
  const lastIndexRef = useRef(index);
  useEffect(() => {
    if (index > lastIndexRef.current) setSlideDir("right");
    else if (index < lastIndexRef.current) setSlideDir("left");
    lastIndexRef.current = index;
  }, [index]);

  // Prefetch the next page when the user is two cards from the end.
  useEffect(() => {
    if (!loading && hasMore && recs.length > 0 && index >= recs.length - 2) {
      onLoadMore();
    }
  }, [index, recs.length, loading, hasMore, onLoadMore]);

  const rec = recs[index];

  // Pointer events handle touch + mouse drag in one path. Buttons inside
  // the card still receive their own clicks first; the pointer-down
  // listener is on the outer container, not the buttons.
  function handlePointerDown(e: React.PointerEvent) {
    // Skip drag-tracking when the gesture starts on an interactive child
    // (so tapping feedback buttons doesn't get interpreted as a swipe).
    if ((e.target as HTMLElement).closest("button")) return;
    startX.current = e.clientX;
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (startX.current == null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0 && index < recs.length - 1) setIndex((i) => i + 1);
    if (dx > 0 && index > 0) setIndex((i) => i - 1);
  }

  if (!rec) {
    return (
      <div className={styles.fullEmpty}>
        {loading ? "Loading…" : "Nothing to recommend yet."}
      </div>
    );
  }

  return (
    <div
      className={styles.full}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => (startX.current = null)}
    >
      <div className={styles.fullProgress}>
        {recs.map((_, i) => (
          <span
            key={i}
            className={`${styles.fullProgressDot} ${
              i === index ? styles.fullProgressDotActive : ""
            }`}
          />
        ))}
      </div>

      <div
        key={rec.id}
        className={`${styles.fullCard} ${
          slideDir === "right" ? styles.slideRight : styles.slideLeft
        }`}
      >
        <PosterTile rec={rec} size="lg" />
        <div className={styles.fullGradient} />
        <div className={styles.fullContent}>
          <div className={styles.cardMatch}>
            <span className={styles.matchDot} />
            {Math.round(rec.match * 100)}% match
          </div>
          <h2 className={styles.fullTitle}>{rec.title}</h2>
          <div className={styles.cardMeta}>
            <span>{rec.year}</span>
            <span className={styles.dot} />
            <span>{rec.meta}</span>
            <span className={styles.dot} />
            <span>★ {rec.rating.toFixed(1)}</span>
          </div>
          {rec.where && (
            <div className={styles.fullWhere}>Watch on {rec.where}</div>
          )}
          <div className={styles.fullReason}>
            <span className={styles.reasonEyebrow}>FINGERPRINT</span>
            <span>{rec.reason}</span>
          </div>
          <FeedbackRow
            rec={rec}
            rated={feedbackGiven[rec.id]}
            onFeedback={onFeedback}
            onRemove={onRemove}
            onWhy={onWhy}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared bits — poster (img with motif fallback), feedback row
// ─────────────────────────────────────────────────────────────

function FeedbackRow({
  rec,
  rated,
  onFeedback,
  onRemove,
  onWhy,
  compact,
}: {
  rec: Recommendation;
  rated: FeedbackRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onRemove: (rec: Recommendation) => void;
  /** When set, a leading "Why" button (same size/style as the reactions) is
   *  rendered first — used where the poster is full-bleed and can't host its
   *  own corner button (the full-swipe view). */
  onWhy?: (rec: Recommendation) => void;
  compact?: boolean;
}) {
  if (rated) {
    return (
      <div className={styles.feedbackAcked}>{RATED_MESSAGE[rated]}</div>
    );
  }
  return (
    <div
      className={`${styles.feedback} ${compact ? styles.feedbackCompact : ""}`}
    >
      {onWhy && (
        <button
          type="button"
          className={styles.reactionBtn}
          onClick={() => onWhy(rec)}
          aria-label={`Why we picked ${rec.title}`}
          title="Why this pick?"
        >
          <span className={styles.reactionEmoji}>🤔</span>
          <span className={styles.reactionLabel}>Why</span>
        </button>
      )}
      {REACTIONS.map((r) => (
        <button
          key={r.value}
          type="button"
          className={styles.reactionBtn}
          onClick={() => onFeedback(rec, r.value)}
          aria-label={r.aria}
          title={r.aria}
        >
          <span className={styles.reactionEmoji}>{r.emoji}</span>
          <span className={styles.reactionLabel}>{r.label}</span>
        </button>
      ))}
      {/* Remove — suppress this title from future recommendations. */}
      <button
        type="button"
        className={`${styles.reactionBtn} ${styles.removeBtn}`}
        onClick={() => onRemove(rec)}
        aria-label="Remove — never recommend this again"
        title="Never recommend this again"
      >
        <span className={styles.reactionEmoji} aria-hidden>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </span>
        <span className={styles.reactionLabel}>Remove</span>
      </button>
    </div>
  );
}

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
  { value: "disliked", emoji: "👎", label: "Dislike", aria: "Watched it, didn't like it" },
];

const RATED_MESSAGE: Record<FeedbackRating, string> = {
  loved: "Loved — weighted strongly into your taste",
  liked: "Saved to your taste",
  disliked: "Noted — not to your taste",
};

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

// Detail overlay — serves the reason_payload from the on-device cache, or
// fetches it from the engine cache (fingerprint loader while it lands) and
// stores it locally. Renders the full breakdown over the poster: data pinned
// to the top, the four reactions, and the always-on WhyPanel.
function WhyDetailOverlay({
  rec,
  rated,
  onFeedback,
  onRemove,
  onClose,
}: {
  rec: Recommendation;
  rated: FeedbackRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
  onRemove: (rec: Recommendation) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    // rec.id is "type:tmdb_id" for engine recs, a slug for pre-session mocks.
    const tmdb_id = rec.id.includes(":") ? rec.id.split(":")[1] : rec.id;

    // Serve from this session's cache if we've opened this "Why" before.
    const cached = getCachedExplain(rec.id);
    if (cached) {
      setResult(toResult(cached, rec));
      setStatus("ready");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/recommendations/explain?tmdb_id=${encodeURIComponent(tmdb_id)}`,
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

  // Escape closes the detail.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={styles.whyOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Why we picked ${rec.title}`}
    >
      {/* Fixed poster background + dark gradient scrim (poster visible up top,
          fading to full black at the bottom where the dense info sits). */}
      {rec.poster_url && (
        <div
          className={styles.heroBg}
          style={{ backgroundImage: `url(${rec.poster_url})` }}
          aria-hidden
        />
      )}
      <div className={styles.heroScrim} aria-hidden />

      {/* Scrollable content column over the fixed background. Clicking the
          empty area (outside the content) closes. */}
      <div className={styles.heroScroll} onClick={onClose}>
        <div className={styles.heroInner} onClick={(e) => e.stopPropagation()}>
          {status === "loading" && (
            <div className={styles.whyLoading}>
              <FingerprintLoader size={56} />
              <span className={styles.muted}>Reading your fingerprint…</span>
            </div>
          )}
          {status === "error" && (
            <div className={styles.whyLoading}>
              <span className={styles.error}>{errMsg}</span>
            </div>
          )}
          {status === "ready" && result && (
            <div className={styles.heroData}>
              <button
                type="button"
                className={styles.heroBack}
                onClick={onClose}
                aria-label="back"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <div className={styles.heroHeader}>
                <div className={styles.heroMatch}>
                  <span className={styles.heroMatchPct}>
                    {Math.round(rec.match * 100)}%
                  </span>
                  <span className={styles.heroMatchLabel}>match</span>
                </div>
                <TrailerButton rec={rec} showLabel />
              </div>
              <h2 className={styles.heroTitle}>{rec.title}</h2>
              <div className={styles.heroMeta}>
                <span>{rec.year}</span>
                <span className={styles.dot} />
                <span>{rec.meta}</span>
                <span className={styles.dot} />
                <span>★ {rec.rating.toFixed(1)}</span>
              </div>
              <div className={styles.heroFingerprint}>
                <span className={styles.reasonEyebrow}>FINGERPRINT</span>
                <span>{result.explanation}</span>
              </div>
              <FeedbackRow
                rec={rec}
                rated={rated}
                onFeedback={onFeedback}
                onRemove={onRemove}
              />
              <WhyPanel result={result} />
            </div>
          )}
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
  size: "md" | "lg";
}) {
  const [imgFailed, setImgFailed] = useState(false);
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
          className={styles.posterImg}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <>
          <Motif kind={rec.motif} fg={fg} />
          {/* Title-on-poster only in the compact view; the full view
              renders the title in the content overlay below. */}
          {size === "md" && (
            <div className={styles.posterTitle} style={{ color: fg }}>
              {rec.title}
            </div>
          )}
        </>
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
// Header icons
// ─────────────────────────────────────────────────────────────

const IconCardFull = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="4" width="14" height="16" rx="2" />
  </svg>
);

const IconListGrid = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <rect x="3" y="13" width="6" height="6" rx="1" />
    <path d="M13 6h8M13 12h8M13 18h8" />
  </svg>
);
