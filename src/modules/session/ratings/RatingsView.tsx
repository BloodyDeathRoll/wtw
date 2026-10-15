"use client";

/**
 * RatingsView — "Ratings" screen (Figma redesign 2026-10: nodes 33:896 /
 * 33:1158 / 35:1347).
 *
 * Shows the signed-in user their rated titles, one reaction bucket at a time
 * (Loved / Liked / Disliked / Removed — default Loved). Tapping a row expands
 * it in place:
 *   - rated buckets → Loved / Liked / Disliked, current one highlighted
 *     (POST feedback)
 *   - Removed bucket → Restore, so the title is eligible for recs again
 *     (DELETE removed)
 *
 * Background: one random poster from the user's titles, dimmed, picked once
 * per data load. List order is client-side (newest / oldest / title).
 *
 * Data comes from GET /api/recommendations/ratings (their own rows, RLS-scoped).
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, RotateCcw, X } from "lucide-react";
import type { Reaction } from "@/types/dna";
import type { ContentType } from "@/lib/content-type";
import type {
  RatingsSummary,
  RatingItem,
  RemovedItem,
} from "@/app/api/recommendations/ratings/route";
import { setWatchlistRating } from "@/lib/watchlist";
import { FingerprintLoader } from "../components/FingerprintLoader";
import styles from "./RatingsView.module.css";

type Tab = Reaction | "removed";
type SortKey = "newest" | "oldest" | "title";

const REACTION_META: Record<Reaction, { label: string; icon: ReactNode }> = {
  loved: { label: "Loved", icon: "❤️" },
  liked: { label: "Liked", icon: "👍" },
  disliked: { label: "Disliked", icon: "👎" },
};
const REMOVED_META = { label: "Removed", icon: <X size={16} strokeWidth={2} /> };
const TABS: Tab[] = ["loved", "liked", "disliked", "removed"];
const tabMeta = (t: Tab) => (t === "removed" ? REMOVED_META : REACTION_META[t]);

const REACTION_ORDER: Reaction[] = ["loved", "liked", "disliked"];

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Date Added",
  oldest: "Oldest First",
  title: "Title A–Z",
};

/** Sort a bucket client-side. `date` is created_at / removed_at (ISO). */
function sortBy<T>(rows: T[], key: SortKey, date: (r: T) => string, title: (r: T) => string | null): T[] {
  const out = [...rows];
  if (key === "title") {
    out.sort((a, b) => (title(a) ?? "").localeCompare(title(b) ?? "", undefined, { sensitivity: "base" }));
  } else {
    const dir = key === "newest" ? -1 : 1;
    out.sort((a, b) => dir * (Date.parse(date(a)) - Date.parse(date(b))));
  }
  return out;
}

export default function RatingsView({
  onBack,
  contentType,
  headerRight,
}: {
  onBack: () => void;
  /** The Movies/Series list the user is on — the batch a re-rate rebuilds. */
  contentType: ContentType;
  /** App menu — same slot on every screen (2026-08-29). */
  headerRight?: ReactNode;
}) {
  const [data, setData] = useState<RatingsSummary | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("loved");
  const [sort, setSort] = useState<SortKey>("newest");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  // Re-rate a title. Writes through the same feedback endpoint the rec cards
  // use, then moves the row to its new bucket locally (optimistic-ish; on a
  // failed write we surface nothing louder than leaving it as-is).
  async function reRate(item: RatingItem, next: Reaction) {
    if (busy) return;
    if (next === item.rating) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/recommendations/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "watched",
          reaction: next,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type ?? undefined,
          title: item.title ?? undefined,
          // Without it the route builds (and every 5th rating promotes) an
          // 'all' batch, leaving the user's list with nothing cached.
          content_type: contentType,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Keep a re-rated title on the watchlist but re-tag it, so the two screens
      // agree. The watchlist keys on the composite `type:tmdb_id` (engine recs)
      // or a bare id (mocks) — try both; a miss is a no-op.
      if (item.media_type) setWatchlistRating(`${item.media_type}:${item.tmdb_id}`, next);
      setWatchlistRating(item.tmdb_id, next);
      setData((d) => {
        if (!d) return d;
        const prev = item.rating;
        return {
          ...d,
          counts: { ...d.counts, [prev]: d.counts[prev] - 1, [next]: d.counts[next] + 1 },
          items: d.items.map((it) => (it.id === item.id ? { ...it, rating: next } : it)),
        };
      });
      setEditing(null);
    } catch {
      /* leave the row unchanged on failure */
    } finally {
      setBusy(false);
    }
  }

  // Restore a removed title so it can surface in recommendations again.
  async function restore(rem: RemovedItem) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/recommendations/removed", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdb_id: rem.tmdb_id, media_type: rem.media_type }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setData((d) => {
        if (!d) return d;
        return {
          ...d,
          counts: { ...d.counts, removed: d.counts.removed - 1 },
          removed: d.removed.filter(
            (r) => !(r.tmdb_id === rem.tmdb_id && r.media_type === rem.media_type),
          ),
        };
      });
      setEditing(null);
    } catch {
      /* leave the row on failure */
    } finally {
      setBusy(false);
    }
  }

  const rated = useMemo(
    () =>
      sortBy(
        data?.items.filter((i) => i.rating === tab) ?? [],
        sort,
        (i) => i.created_at,
        (i) => i.title,
      ),
    [data, tab, sort],
  );
  const removed = useMemo(
    () => sortBy(data?.removed ?? [], sort, (r) => r.removed_at, (r) => r.title),
    [data, sort],
  );
  const reviewedTotal = data
    ? data.counts.loved + data.counts.liked + data.counts.disliked + data.counts.removed
    : 0;

  // One random poster from the whole list for the screen background — picked
  // once, when the first load lands (not on re-rate / restore / tab switch,
  // so it doesn't flicker). No posters resolved → no image.
  const [bgPoster, setBgPoster] = useState<string | null>(null);
  const [bgPicked, setBgPicked] = useState(false);
  if (data && !bgPicked) {
    const urls = [...data.items.map((i) => i.poster_url), ...data.removed.map((r) => r.poster_url)].filter(
      (u): u is string => !!u,
    );
    setBgPicked(true);
    setBgPoster(urls.length ? urls[Math.floor(Math.random() * urls.length)] : null);
  }
  const viewStyle: CSSProperties | undefined = bgPoster
    ? ({ "--rv-poster": `url("${bgPoster}")` } as CSSProperties)
    : undefined;

  const sectionLabel = `${tabMeta(tab).label} titles`;

  return (
    <div className={`${styles.view} ${bgPoster ? styles.viewPoster : ""}`} style={viewStyle}>
      <div className={styles.header}>
        <button className={styles.headerBtn} onClick={onBack} aria-label="back">
          <ChevronLeft size={30} strokeWidth={1.5} />
        </button>
        <span className={styles.headerTitle}>Ratings</span>
        <div className={styles.headerRight}>
          {headerRight}
        </div>
      </div>

      {status === "loading" && (
        <div className={styles.loading}>
          <span className={styles.loadingText}>Loading your ratings</span>
          <FingerprintLoader size={66} />
        </div>
      )}
      {status === "error" && (
        <div className={styles.loading}>
          <span className={styles.note}>Couldn&rsquo;t load your ratings. Try again in a moment.</span>
        </div>
      )}

      {status === "ready" && data && (
        <div className={styles.scroll}>
          <div className={styles.reviewed}>
            <span className={styles.reviewedNum}>{reviewedTotal}</span>
            <span className={styles.reviewedLabel}>
              {reviewedTotal === 1 ? "title reviewed" : "titles reviewed"}
            </span>
          </div>

          <div className={styles.tabs} role="tablist">
            {TABS.map((t) => {
              const m = tabMeta(t);
              const active = t === tab;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={active}
                  className={`${styles.tab} ${active ? styles.tabActive : ""}`}
                  onClick={() => {
                    setTab(t);
                    setEditing(null);
                  }}
                >
                  <span className={styles.tabTop}>
                    <span className={styles.tabIcon} aria-hidden>
                      {m.icon}
                    </span>
                    <span className={styles.tabCount}>{data.counts[t]}</span>
                  </span>
                  <span className={styles.tabLabel}>{m.label}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.sectionBar}>
            <span className={styles.sectionLabel}>{sectionLabel}</span>
            <label className={styles.sortPill}>
              <select
                className={styles.sortSelect}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="sort by"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} strokeWidth={2} aria-hidden />
            </label>
          </div>

          {tab !== "removed" &&
            (rated.length === 0 ? (
              <div className={styles.empty}>Nothing in {tabMeta(tab).label} yet.</div>
            ) : (
              <ul className={styles.list}>
                {rated.map((item) => {
                  const open = editing === item.id;
                  return (
                    <li key={item.id} className={styles.row}>
                      <button
                        className={styles.rowMain}
                        onClick={() => setEditing((e) => (e === item.id ? null : item.id))}
                        aria-label={`edit ${item.title ?? "title"}`}
                        aria-expanded={open}
                      >
                        <span className={styles.rowTitle}>{item.title ?? "Untitled"}</span>
                        <span className={styles.chevron} aria-hidden>
                          {open ? <ChevronUp size={30} strokeWidth={1.5} /> : <ChevronDown size={30} strokeWidth={1.5} />}
                        </span>
                      </button>
                      {open && (
                        <div className={styles.editorPicks}>
                          {REACTION_ORDER.map((r) => {
                            const m = REACTION_META[r];
                            const isCurrent = r === item.rating;
                            return (
                              <button
                                key={r}
                                className={`${styles.pick} ${isCurrent ? styles.pickCurrent : ""}`}
                                aria-pressed={isCurrent}
                                disabled={busy}
                                onClick={() => reRate(item, r)}
                              >
                                <span className={styles.pickIcon} aria-hidden>
                                  {m.icon}
                                </span>
                                <span>{m.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}

          {tab === "removed" &&
            (removed.length === 0 ? (
              <div className={styles.empty}>You haven&rsquo;t removed any titles.</div>
            ) : (
              <ul className={styles.list}>
                {removed.map((rem) => {
                  const key = `${rem.media_type}:${rem.tmdb_id}`;
                  const open = editing === key;
                  return (
                    <li key={key} className={styles.row}>
                      <button
                        className={styles.rowMain}
                        onClick={() => setEditing((e) => (e === key ? null : key))}
                        aria-label={`edit ${rem.title ?? "title"}`}
                        aria-expanded={open}
                      >
                        <span className={styles.rowTitle}>{rem.title ?? "Untitled"}</span>
                        <span className={styles.chevron} aria-hidden>
                          {open ? <ChevronUp size={30} strokeWidth={1.5} /> : <ChevronDown size={30} strokeWidth={1.5} />}
                        </span>
                      </button>
                      {open && (
                        <div className={styles.restoreRow}>
                          <span className={styles.editorHint}>
                            Restore so it can show up in recommendations again.
                          </span>
                          <button
                            className={styles.restoreBtn}
                            disabled={busy}
                            onClick={() => restore(rem)}
                          >
                            <RotateCcw size={16} strokeWidth={1.8} aria-hidden />
                            <span>Restore</span>
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      )}
    </div>
  );
}
