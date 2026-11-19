"use client";

/**
 * Seen for v3 (docs/plan/v3/SEEN.md, S1; behind SEEN_V3): the Watchlist's rows
 * (poster, title, year · length · ★, your reaction where the Watchlist shows the
 * match), chips Loved · Liked · Disliked · Hidden from For you with no All
 * (opens on Loved), and today's two dropdowns under them (DEC-1, 2, 3, 9).
 * Approved screens: docs/prototypes/seen-v3/7-icons.jpg (the chips, the
 * dropdowns), 2-filter.jpg left (a row's reaction), 6-empty.jpg.
 *
 * Not yet: the reaction icons on a row (S2), the card page on a tap (S3),
 * Restore on Hidden (S4).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, Star } from "lucide-react";
import type { Reaction } from "@/types/dna";
import type { ContentKind, Recommendation } from "@/types/recommendation";
import type { AppUser } from "@/modules/session/types";
import type { RatingsSummary, RatingItem, RemovedItem } from "@/app/api/recommendations/ratings/route";
import { HeaderSearch } from "@/app/components/HeaderSearch";
import { TAB_SCROLL } from "@/app/components/TabBar";
import { FingerprintLoader } from "../components/FingerprintLoader";
import { PosterTile } from "../recommendations/RecommendationsView";
import { SEEN_LABEL } from "../recommendations/watchlist-order";
import rv from "../recommendations/RecommendationsView.module.css";
import rs from "./RatingsView.module.css";
import styles from "./SeenView.module.css";

export type SeenChip = Reaction | "hidden";
type SortKey = "newest" | "oldest" | "title";
type KindFilter = "all" | "movie" | "tv";

const CHIPS: { chip: SeenChip; label: string }[] = [
  { chip: "loved", label: "Loved" },
  { chip: "liked", label: "Liked" },
  { chip: "disliked", label: "Disliked" },
  { chip: "hidden", label: "Hidden from For you" },
];
// Today's dropdowns, today's words (DEC-3).
const SORT_LABELS: Record<SortKey, string> = { newest: "Date Added", oldest: "Oldest First", title: "Title A–Z" };
const KIND_LABELS: Record<KindFilter, string> = { all: "All", movie: "Movies", tv: "Series" };
const EMPTY_CHIP: Record<SeenChip, string> = {
  loved: "Nothing loved yet.",
  liked: "Nothing liked yet.",
  disliked: "Nothing disliked yet.",
  hidden: "Nothing hidden yet.",
};
/** Rows shown at first and added per scroll: Seen grows to hundreds, and each row is a poster. */
const PAGE = 20;

/** One Seen row, whichever list it comes from. */
export interface SeenRow {
  key: string;
  title: string | null;
  type: ContentKind | null;
  poster_url: string | null;
  year: number | null;
  meta: string | null;
  star: number | null;
  reaction: Reaction | null;
  at: string;
}

const fromRating = (i: RatingItem): SeenRow => ({
  key: i.id,
  title: i.title,
  type: i.media_type,
  poster_url: i.poster_url,
  year: i.year,
  meta: i.meta,
  star: i.star,
  reaction: i.rating,
  at: i.created_at,
});
const fromHidden = (r: RemovedItem): SeenRow => ({
  key: `${r.media_type}:${r.tmdb_id}`,
  title: r.title,
  type: r.media_type,
  poster_url: r.poster_url,
  year: r.year,
  meta: r.meta,
  star: r.star,
  reaction: null,
  at: r.removed_at,
});

/** The rows a chip shows, after the type filter and the sort (DEC-2, DEC-3). Legacy rows with no type show under All only. */
export function seenRows(data: RatingsSummary, chip: SeenChip, kind: KindFilter, sort: SortKey): SeenRow[] {
  const rows = chip === "hidden" ? data.removed.map(fromHidden) : data.items.filter((i) => i.rating === chip).map(fromRating);
  const kept = rows.filter((r) => kind === "all" || r.type === kind);
  if (sort === "title") return kept.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" }));
  const dir = sort === "newest" ? -1 : 1;
  return kept.sort((a, b) => dir * (Date.parse(a.at) - Date.parse(b.at)));
}

/** Each chip's count under the type filter: the part. The header's count is the whole of Seen. */
export function seenCounts(data: RatingsSummary, kind: KindFilter): Record<SeenChip, number> {
  const keep = (t: string | null) => kind === "all" || t === kind;
  const c: Record<SeenChip, number> = { loved: 0, liked: 0, disliked: 0, hidden: 0 };
  for (const i of data.items) if (keep(i.media_type)) c[i.rating] += 1;
  for (const r of data.removed) if (keep(r.media_type)) c.hidden += 1;
  return c;
}

/**
 * year · length · ★, in the Watchlist row's look (its MetaRow), with only the parts we know: a title missing from
 * `titles` has none, and one with no year or score still shows the rest. Never "0" or "★ 0.0".
 */
function FactsLine({ row }: { row: SeenRow }) {
  if (!row.year && !row.meta && !row.star) return null;
  return (
    <div className={rv.cardMeta}>
      {row.year ? <span>{row.year}</span> : null}
      {row.meta ? <span>{row.meta}</span> : null}
      {row.star ? (
        <span className={rv.metaRating}>
          <Star size={16} className={rv.metaStar} aria-hidden />
          {row.star.toFixed(1)}
        </span>
      ) : null}
    </div>
  );
}

/** A row in the shape the Watchlist's poster takes. Only the poster's fallback reads the palette. */
function asRec(r: SeenRow): Recommendation {
  return {
    id: r.key,
    title: r.title ?? "Untitled",
    type: r.type ?? "movie",
    year: r.year ?? 0,
    poster_url: r.poster_url,
    meta: r.meta ?? "",
    rating: r.star ?? 0,
    match: 0,
    reason: "",
    where: null,
    motif: "dot",
    palette: ["#16242E", "#F5C9A6"],
  };
}

export default function SeenView({
  onBack,
  onBrowse,
  headerRight,
  user,
}: {
  onBack: () => void;
  /** The empty state's "Go to For you" (DEC-9). */
  onBrowse?: () => void;
  headerRight?: ReactNode;
  user?: AppUser;
}) {
  const [data, setData] = useState<RatingsSummary | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [chip, setChip] = useState<SeenChip>("loved");
  const [sort, setSort] = useState<SortKey>("newest");
  const [kind, setKind] = useState<KindFilter>("all");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/recommendations/ratings");
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as RatingsSummary;
        if (alive) {
          setData(json);
          setStatus("ready");
        }
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => (data ? seenRows(data, chip, kind, sort) : []), [data, chip, kind, sort]);
  const counts = useMemo(() => (data ? seenCounts(data, kind) : null), [data, kind]);
  const visible = rows.slice(0, shown);
  const hasMore = shown < rows.length;

  // A chip, type or sort change starts at the top, with the first page.
  const listRef = useRef<HTMLDivElement>(null);
  function pick(next: () => void) {
    next();
    setShown(PAGE);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((hits) => {
      if (hits[0]?.isIntersecting) setShown((n) => n + PAGE);
    }, { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visible.length]);

  // The lit chip stays in view: Hidden sits off to the right on a phone (DEC-2).
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chipsRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [chip]);

  // The whole of Seen: every rated title. Hidden from For you is a different list (not seen), so the chips' counts
  // don't add up to it (SEEN.md DEC-1, DEC-8).
  const total = data?.items.length ?? 0;
  const nothing = status === "ready" && data && data.items.length === 0 && data.removed.length === 0;

  return (
    <div className={`${rv.view} ${styles.tokens}`}>
      <div className={rv.header}>
        <button type="button" className={rv.headerBtn} onClick={onBack} aria-label="back">
          <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
        </button>
        <span className={rv.headerTitle}>{status === "ready" ? `Seen (${total})` : "Seen"}</span>
        <div className={rv.headerRight}>
          {user && <HeaderSearch btnClass={rv.headerBtn} user={user} menu={headerRight} scope="ratings" from="ratings" />}
          {headerRight}
        </div>
      </div>

      {status === "loading" && (
        <div className={rs.loading}>
          <span className={rs.loadingText}>Loading your ratings</span>
          <FingerprintLoader size={66} />
        </div>
      )}
      {status === "error" && (
        <div className={rs.loading}>
          <span className={rs.note}>Couldn&rsquo;t load your ratings. Try again in a moment.</span>
        </div>
      )}

      {nothing && (
        // Nothing rated: one line and the orange button, no chips (DEC-9, 6-empty).
        <div className={rv.content}>
          <div className={rv.list}>
            <div className={rv.emptyState}>
              <span className={rv.muted}>
                Nothing here yet. Tap Loved, Liked or Disliked on any title you&rsquo;ve seen and it lands here.
              </span>
              {onBrowse && (
                <button
                  type="button"
                  className={`${rv.watchlistBtn} ${rv.watchlistBtnPrimary} ${rv.emptyBtn}`}
                  onClick={onBrowse}
                >
                  Go to For you
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {status === "ready" && data && counts && !nothing && (
        <>
          <div ref={chipsRef} className={rv.chips} role="group" aria-label="Show">
            {CHIPS.map((c) => {
              const on = c.chip === chip;
              return (
                <button
                  key={c.chip}
                  type="button"
                  className={`${rv.seenChip} ${rv.filterChip} ${on ? rv.seenChipOn : ""}`}
                  aria-pressed={on}
                  onClick={() => pick(() => setChip(c.chip))}
                >
                  {c.label}
                  {counts[c.chip] > 0 && <b>{counts[c.chip]}</b>}
                </button>
              );
            })}
          </div>

          <div className={styles.dropdowns}>
            <label className={rs.sortPill}>
              <select
                className={rs.sortSelect}
                value={kind}
                onChange={(e) => pick(() => setKind(e.target.value as KindFilter))}
                aria-label="show movies, series or all"
              >
                {(Object.keys(KIND_LABELS) as KindFilter[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABELS[k]}</option>
                ))}
              </select>
              <ChevronDown size={16} strokeWidth={2} aria-hidden />
            </label>
            <label className={rs.sortPill}>
              <select
                className={rs.sortSelect}
                value={sort}
                onChange={(e) => pick(() => setSort(e.target.value as SortKey))}
                aria-label="sort by"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
              <ChevronDown size={16} strokeWidth={2} aria-hidden />
            </label>
          </div>

          <div className={rv.content}>
            {rows.length === 0 ? (
              // A chip with nothing behind it: one line, the chip still lit (DEC-9, 2-filter right).
              <div className={rv.list}>
                <div className={rv.emptyState}>
                  <span className={rv.muted}>{EMPTY_CHIP[chip]}</span>
                </div>
              </div>
            ) : (
              <div ref={listRef} className={`${rv.list} ${rv.listRows}`} {...TAB_SCROLL}>
                <div key={`${chip}|${kind}|${sort}`} className={rv.listFade}>
                  {visible.map((r) => {
                    const rec = asRec(r);
                    return (
                      <div key={r.key} className={rv.rowWrap}>
                        <div className={`${rv.row} ${styles.row}`} aria-label={rec.title}>
                          <PosterTile rec={rec} size="row" />
                          <div className={rv.rowBody}>
                            <h3 className={rv.rowTitle}>{rec.title}</h3>
                            <FactsLine row={r} />
                            {r.reaction && (
                              <span className={rv.rowLine}>
                                <span className={rv.rowReaction}>{SEEN_LABEL[r.reaction]}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div ref={sentinelRef} className={rv.sentinel} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
