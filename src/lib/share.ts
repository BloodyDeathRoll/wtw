/** Hands the app's URL to the OS share sheet, falling back to the clipboard
 *  on desktop browsers that don't implement Web Share.
 *  No caller since 2026-11-07: Search took its icon in the home header
 *  (Shahar). Kept for the day share gets a place in the menu. */
export async function shareApp() {
  const url = window.location.origin;
  const data = {
    title: "WTW — What To Watch",
    text: "Find something worth watching.",
    url,
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
    await navigator.clipboard.writeText(url);
  } catch {
    // Cancelled from the sheet, or clipboard denied — nothing to recover.
  }
}

/** What a share button needs to know about a title: the app's `type:tmdb_id` id. */
export interface ShareableTitle {
  id: string;
  title: string;
  year?: number | null;
}

/** "shared" = the OS sheet took it; "copied" = no sheet, the link went to the
 *  clipboard (say so); "cancelled" = closed the sheet or clipboard denied. */
export type ShareOutcome = "shared" | "copied" | "cancelled";

/** The friend's page for a title: "movie:9909" → "/t/movie-9909"; null for an id without a type. */
export function titleSharePath(id: string): string | null {
  const m = /^(movie|tv):(\d+)$/.exec(id);
  return m ? `/t/${m[1]}-${m[2]}` : null;
}

/**
 * Shares one title's page (docs/prototypes/share/v3): the OS sheet gets the
 * title, a short line and the link, which WhatsApp and the rest turn into a
 * preview card. `by` is the sharer's name; its first word rides in the link so
 * the friend's page can say who sent it.
 */
export async function shareTitle(t: ShareableTitle, by?: string | null): Promise<ShareOutcome> {
  const path = titleSharePath(t.id);
  if (!path) return "cancelled";
  const first = by?.trim().split(/\s+/)[0];
  const url = `${window.location.origin}${path}${first ? `?by=${encodeURIComponent(first)}` : ""}`;
  try {
    if (navigator.share) {
      await navigator.share({
        title: t.year ? `${t.title} (${t.year})` : t.title,
        text: "You'd like this one 🎬",
        url,
      });
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "cancelled";
  }
}
