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
import styles from "./RecommendationsView.module.css";
import { FingerprintLoader } from "../components/FingerprintLoader";

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
            // disliked = "not for me" (skip); loved/liked/mixed imply they
            // watched it and are post-watch reactions.
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
  onFindMore?: () => void;
  refreshing?: boolean;
}) {
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

  return (
    <div className={styles.list}>
      {recs.map((rec) => (
        <CompactCard
          key={rec.id}
          rec={rec}
          rated={feedbackGiven[rec.id]}
          onFeedback={onFeedback}
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
}: {
  rec: Recommendation;
  rated: FeedbackRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
}) {
  return (
    <article className={styles.card}>
      <PosterTile rec={rec} size="md" />
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>{rec.title}</h3>
          <div className={styles.cardMatch}>
            <span className={styles.matchDot} />
            {Math.round(rec.match * 100)}% match
          </div>
        </div>
        <div className={styles.cardMeta}>
          <span>{rec.year}</span>
          <span className={styles.dot} />
          <span>{rec.meta}</span>
          <span className={styles.dot} />
          <span>★ {rec.rating.toFixed(1)}</span>
        </div>
        <div className={styles.cardReason}>
          <span className={styles.reasonEyebrow}>FINGERPRINT</span>
          <span>{rec.reason}</span>
        </div>
        <FeedbackRow rec={rec} rated={rated} onFeedback={onFeedback} compact />
      </div>
    </article>
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
}: {
  recs: Recommendation[];
  index: number;
  setIndex: (i: number | ((p: number) => number)) => void;
  loading: boolean;
  hasMore: boolean;
  feedbackGiven: Record<string, FeedbackRating>;
  onLoadMore: () => void;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
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
  compact,
}: {
  rec: Recommendation;
  rated: FeedbackRating | undefined;
  onFeedback: (rec: Recommendation, rating: FeedbackRating) => void;
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
    </div>
  );
}

// The four levels map 1:1 onto the DNA Reaction enum — richer signal than the
// old binary buttons at the same one-tap cost.
const REACTIONS: {
  value: FeedbackRating;
  emoji: string;
  label: string;
  aria: string;
}[] = [
  { value: "loved", emoji: "❤️", label: "Loved", aria: "Loved it" },
  { value: "liked", emoji: "👍", label: "Liked", aria: "Liked it" },
  { value: "mixed", emoji: "😐", label: "Mixed", aria: "Mixed feelings" },
  { value: "disliked", emoji: "👎", label: "Pass", aria: "Not for me" },
];

const RATED_MESSAGE: Record<FeedbackRating, string> = {
  loved: "Loved — weighted strongly into your taste",
  liked: "Saved to your taste",
  mixed: "Noted — mixed feelings",
  disliked: "Won't show this kind",
};



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
