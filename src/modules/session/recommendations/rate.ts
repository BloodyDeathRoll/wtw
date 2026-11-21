import type { Recommendation } from "@/types/recommendation";
import type { ContentType } from "@/lib/content-type";

export type Reaction = "loved" | "liked" | "disliked";

/** Fired on `window` once a rating has landed (or been cleared: `rating` null), wherever it was made. */
export const RATED_EVENT = "wtw:rated";
export type RatedDetail = { id: string; rating: Reaction | null };

/** A write that hangs gives up, so the one-at-a-time queue behind it moves on (the caller puts the chip back). */
const TIMEOUT_MS = 20_000;
const timeout = () => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined);

/** Fired on `window` once a title is hidden from For you (`hidden` true) or restored (false), wherever it was done. */
export const HIDDEN_EVENT = "wtw:hidden";
export type HiddenDetail = { id: string; hidden: boolean };
export function announceHidden(id: string, hidden: boolean) {
  window.dispatchEvent(new CustomEvent<HiddenDetail>(HIDDEN_EVENT, { detail: { id, hidden } }));
}

function landed(id: string, rating: Reaction | null) {
  window.dispatchEvent(new CustomEvent<RatedDetail>(RATED_EVENT, { detail: { id, rating } }));
}

/** "type:tmdb_id" → tmdb_id (a bare slug only in legacy saved entries). */
const tmdbIdOf = (id: string) => (id.includes(":") ? id.split(":")[1] : id);

/**
 * Rate a title through the feedback route, as a card does anywhere in WTW: it lands in Seen and the fingerprint.
 * The route's contract is { tmdb_id, action, reaction, … }; disliked = watched it and didn't like it (a negative
 * signal, sent as "skipped"). `contentType` is the list the next batch is precomputed for. True when it landed.
 */
export async function postRating(rec: Recommendation, rating: Reaction, contentType: ContentType): Promise<boolean> {
  const res = await fetch("/api/recommendations/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tmdb_id: tmdbIdOf(rec.id),
      media_type: rec.type,
      title: rec.title,
      action: rating === "disliked" ? "skipped" : "watched",
      reaction: rating,
      content_type: contentType,
      is_stretch_pick: rec.is_stretch_pick ?? false,
    }),
    signal: timeout(),
  });
  if (!res.ok) console.error(`[recs] feedback HTTP ${res.status}`, await res.text().catch(() => ""));
  else landed(rec.id, rating);
  return res.ok;
}

/** Clear a title's rating (the lit chip tapped again). `saved`: on the Watchlist, its history entry goes back to "saved". */
export async function deleteRating(rec: Recommendation, contentType: ContentType, saved: boolean): Promise<boolean> {
  const res = await fetch("/api/recommendations/feedback", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tmdb_id: tmdbIdOf(rec.id), media_type: rec.type, content_type: contentType, saved }),
    signal: timeout(),
  });
  if (!res.ok) console.error(`[recs] un-rate HTTP ${res.status}`, await res.text().catch(() => ""));
  else landed(rec.id, null);
  return res.ok;
}
