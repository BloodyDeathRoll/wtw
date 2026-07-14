"use client";

/**
 * RatingsView — "Your ratings" screen.
 *
 * Shows the signed-in user their rated titles, one reaction bucket at a time
 * (Loved / Liked / Disliked / Removed — default Loved). Each row has an edit
 * action that reopens the title's card so they can change their pick:
 *   - rated buckets → re-rate loved / liked / disliked (POST feedback)
 *   - Removed bucket → Restore, so the title is eligible for recs again
 *     (DELETE removed)
 *
 * Data comes from GET /api/recommendations/ratings (their own rows, RLS-scoped).
 */

import { useEffect, useMemo, useState } from "react";
import type { Reaction } from "@/types/dna";
import type {
  RatingsSummary,
  RatingItem,
  RemovedItem,
} from "@/app/api/recommendations/ratings/route";
import styles from "./RatingsView.module.css";
import React from "react";

// ─── Icons ───────────────────────────────────────────────────
const I = {
  back: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  restore: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  thumbUp: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h3V11H4a2 2 0 0 0-2 2Zm5-2V8a3 3 0 0 1 3-3l1 5h6.5a2 2 0 0 1 2 2.3l-1.5 7a2 2 0 0 1-2 1.7H7" />
    </svg>
  ),
  thumbDown: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2v11M22 11V4a2 2 0 0 0-2-2h-3v11h3a2 2 0 0 0 2-2Zm-5 2v3a3 3 0 0 1-3 3l-1-5H5.5a2 2 0 0 1-2-2.3l1.5-7A2 2 0 0 1 7 3h10" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
};

type Tab = Reaction | "removed";

const REACTION_META: Record<Reaction, { label: string; icon: React.ReactNode; color: string }> = {
  loved: { label: "Loved", icon: I.heart, color: "#D49B3A" },
  liked: { label: "Liked", icon: I.thumbUp, color: "#C7B8FF" },
  disliked: { label: "Disliked", icon: I.thumbDown, color: "#E07C5A" },
};
const REMOVED_META = { label: "Removed", icon: I.x, color: "#8FA0B8" };
const TABS: Tab[] = ["loved", "liked", "disliked", "removed"];
const tabMeta = (t: Tab) => (t === "removed" ? REMOVED_META : REACTION_META[t]);

const REACTION_ORDER: Reaction[] = ["loved", "liked", "disliked"];

export default function RatingsView({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<RatingsSummary | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("loved");
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
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
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

  const rated = data?.items.filter((i) => i.rating === tab) ?? [];
  const removed = data?.removed ?? [];
  const reviewedTotal = data
    ? data.counts.loved + data.counts.liked + data.counts.disliked + data.counts.removed
    : 0;

  // One random poster per bucket for the tile backgrounds — chosen once per
  // data load (not per render, so it doesn't flicker on tab switch / edit).
  // Empty bucket (or no posters resolved) → null → no background.
  const tabPosters = useMemo(() => {
    const pick = (urls: (string | null)[]): string | null => {
      const withPoster = urls.filter((u): u is string => !!u);
      if (withPoster.length === 0) return null;
      return withPoster[Math.floor(Math.random() * withPoster.length)];
    };
    if (!data) return { loved: null, liked: null, disliked: null, removed: null } as Record<Tab, string | null>;
    return {
      loved: pick(data.items.filter((i) => i.rating === "loved").map((i) => i.poster_url)),
      liked: pick(data.items.filter((i) => i.rating === "liked").map((i) => i.poster_url)),
      disliked: pick(data.items.filter((i) => i.rating === "disliked").map((i) => i.poster_url)),
      removed: pick(data.removed.map((r) => r.poster_url)),
    } as Record<Tab, string | null>;
  }, [data]);

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <button className={styles.headerBtn} onClick={onBack} aria-label="back">
          {I.back}
        </button>
        <span className={styles.headerTitle}>Your ratings</span>
        <span className={styles.headerBtn} aria-hidden />
      </div>

      {status === "ready" && data && (
        <div className={styles.reviewed}>
          <span className={styles.reviewedNum}>{reviewedTotal}</span>
          <span className={styles.reviewedLabel}>
            {reviewedTotal === 1 ? "title reviewed" : "titles reviewed"}
          </span>
        </div>
      )}

      {status === "ready" && data && (
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
                style={active ? { borderColor: m.color } : undefined}
                onClick={() => {
                  setTab(t);
                  setEditing(null);
                }}
              >
                {tabPosters[t] && (
                  <span
                    className={styles.tabBg}
                    style={{ backgroundImage: `url(${tabPosters[t]})` }}
                    aria-hidden
                  />
                )}
                <span className={styles.tabTop}>
                  <span className={styles.tabIcon} style={{ color: m.color }}>
                    {m.icon}
                  </span>
                  <span className={styles.tabCount}>{data.counts[t]}</span>
                </span>
                <span className={styles.tabLabel}>{m.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.scroll}>
        {status === "loading" && <div className={styles.note}>Loading your ratings…</div>}
        {status === "error" && (
          <div className={styles.note}>Couldn&rsquo;t load your ratings. Try again in a moment.</div>
        )}

        {status === "ready" && data && tab !== "removed" && (
          rated.length === 0 ? (
            <div className={styles.empty}>Nothing in {tabMeta(tab).label} yet.</div>
          ) : (
            <ul className={styles.list}>
              {rated.map((item) => {
                const rm = REACTION_META[item.rating];
                return (
                <li key={item.id} className={styles.row}>
                  <button
                    className={styles.rowMain}
                    onClick={() => setEditing((e) => (e === item.id ? null : item.id))}
                    aria-label={`edit ${item.title ?? "title"}`}
                    aria-expanded={editing === item.id}
                  >
                    <span className={styles.rowIcon} style={{ color: rm.color }}>
                      {rm.icon}
                    </span>
                    <span className={styles.rowTitle}>{item.title ?? "Untitled"}</span>
                    <span className={styles.editBtn} aria-hidden>
                      {I.edit}
                    </span>
                  </button>
                  {editing === item.id && (
                    <div className={styles.editor}>
                      <span className={styles.editorHint}>Change your rating</span>
                      <div className={styles.editorPicks}>
                        {REACTION_ORDER.map((r) => {
                          const m = REACTION_META[r];
                          const isCurrent = r === item.rating;
                          return (
                            <button
                              key={r}
                              className={`${styles.pick} ${isCurrent ? styles.pickCurrent : ""}`}
                              style={isCurrent ? { color: m.color, borderColor: m.color } : undefined}
                              disabled={busy}
                              onClick={() => reRate(item, r)}
                            >
                              <span style={{ color: m.color }}>{m.icon}</span>
                              <span>{m.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          )
        )}

        {status === "ready" && data && tab === "removed" && (
          removed.length === 0 ? (
            <div className={styles.empty}>You haven&rsquo;t removed any titles.</div>
          ) : (
            <ul className={styles.list}>
              {removed.map((rem) => {
                const key = `${rem.media_type}:${rem.tmdb_id}`;
                return (
                  <li key={key} className={styles.row}>
                    <button
                      className={styles.rowMain}
                      onClick={() => setEditing((e) => (e === key ? null : key))}
                      aria-label={`edit ${rem.title ?? "title"}`}
                      aria-expanded={editing === key}
                    >
                      <span className={styles.rowIcon} style={{ color: REMOVED_META.color }}>
                        {REMOVED_META.icon}
                      </span>
                      <span className={styles.rowTitle}>{rem.title ?? "Untitled"}</span>
                      <span className={styles.editBtn} aria-hidden>
                        {I.edit}
                      </span>
                    </button>
                    {editing === key && (
                      <div className={styles.editor}>
                        <span className={styles.editorHint}>
                          Restore so it can show up in recommendations again.
                        </span>
                        <button
                          className={styles.restoreBtn}
                          disabled={busy}
                          onClick={() => restore(rem)}
                        >
                          {I.restore}
                          <span>Restore</span>
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
