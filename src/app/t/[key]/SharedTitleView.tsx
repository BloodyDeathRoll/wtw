"use client";

/**
 * The shared-link page (docs/prototypes/share/v3/8a–8d): who sent it, then the
 * title as a feed card without a match ring.
 *   8a signed out      → "Save to my watchlist" signs in with Google and comes
 *                        back here with ?save=1, which saves it.
 *   8b signed in       → "Add to Watchlist" saves on the spot.
 *   8c saved           → the feed's saved button + "See my recommendations".
 *   8d new account     → saved, then "Let's play" into the taste games.
 * Saving goes through the same watchlist as the feed, so it syncs and reaches
 * the fingerprint like any other save.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Play, Star } from "lucide-react";
import AppShell from "@/modules/session/components/AppShell";
import { createClient } from "@/lib/supabase/client";
import { addToWatchlist, hydrateWatchlist, isInWatchlist, removeFromWatchlist } from "@/lib/watchlist";
import { shareTitle } from "@/lib/share";
import ShareIcon from "@/app/components/ShareIcon";
import { RETURN_COOKIE } from "@/lib/safe-redirect";
import type { Recommendation } from "@/types/recommendation";
import styles from "./SharedTitle.module.css";

export default function SharedTitleView({
  shareKey,
  rec,
  synopsis,
  by,
  userId,
  viewerName,
  newUser,
  saveOnLoad,
}: {
  shareKey: string;
  rec: Recommendation;
  synopsis: string;
  by: string | null;
  userId: string | null;
  viewerName: string | null;
  newUser: boolean;
  saveOnLoad: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  // Saved by coming back from sign-up: "Saved. Welcome to WTW." and on to the games.
  const [welcomed, setWelcomed] = useState(false);
  const [busy, setBusy] = useState(false);
  const path = `/t/${shareKey}${by ? `?by=${encodeURIComponent(by)}` : ""}`;
  // Where it came from, on the watchlist card (the games keep theirs in `reason` too).
  const card: Recommendation = { ...rec, reason: by ? `Shared by ${by}` : rec.reason };

  // Signed in: load the account's list first (as the app does on start), then
  // finish a save started before sign-in.
  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      await hydrateWatchlist(userId);
      if (!live) return;
      if (saveOnLoad) {
        if (!isInWatchlist(card.id)) addToWatchlist(card);
        setWelcomed(newUser);
        router.replace(path);
      }
      setSaved(isInWatchlist(card.id));
    })();
    return () => {
      live = false;
    };
    // Once per visit: the props don't change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function signInToSave() {
    setBusy(true);
    // The auth callback sends the tab back here (it reads this cookie when the
    // OAuth redirect carries no `next`), and ?save=1 finishes the save.
    // (A plain path: the name inside is already URL-encoded, and ? = & are fine in a cookie.)
    document.cookie = `${RETURN_COOKIE}=/t/${shareKey}?save=1${by ? `&by=${encodeURIComponent(by)}` : ""}; path=/; max-age=600; samesite=lax`;
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setBusy(false);
      console.error("[share] signInWithOAuth failed", error);
    }
  }

  function toggleSave() {
    if (saved) removeFromWatchlist(card.id);
    else addToWatchlist(card);
    setSaved(!saved);
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark, as small as an icon */}
          <img src="/logo_vector.svg" alt="" width={56} height={56} />
          <span>WTW</span>
        </div>
        {by && (
          <div className={styles.from}>
            <i aria-hidden>{by[0].toUpperCase()}</i>
            <span>
              <b>{by}</b> thinks you&rsquo;d like this
            </span>
          </div>
        )}

        <article className={styles.card}>
          <div className={styles.hero}>
            {rec.poster_url && (
              // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, as on the feed card
              <img src={rec.poster_url.replace("/w500/", "/w780/")} alt="" className={styles.poster} />
            )}
            <div className={styles.shade} aria-hidden />
            <div className={styles.foot}>
              <div className={styles.titleBlock}>
                <h1 className={styles.title}>{rec.title}</h1>
                <div className={styles.meta}>
                  {rec.year > 0 && <span>{rec.year}</span>}
                  <span>{rec.meta}</span>
                  {rec.rating > 0 && (
                    <span className={styles.rating}>
                      <Star size={16} className={styles.star} aria-hidden />
                      {rec.rating.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.circles}>
                <button
                  type="button"
                  className={styles.circle}
                  onClick={() => void shareTitle(rec, viewerName)}
                  aria-label={`Share ${rec.title}`}
                  title="Share"
                >
                  <ShareIcon size={22} strokeWidth={1.7} />
                </button>
                {rec.trailer_url && (
                  <button
                    type="button"
                    className={`${styles.circle} ${styles.play}`}
                    onClick={() => window.open(rec.trailer_url!, "_blank", "noopener,noreferrer")}
                    aria-label={`Play ${rec.title} trailer`}
                    title="Play trailer"
                  >
                    <Play size={20} fill="currentColor" strokeWidth={0} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.body}>
            {welcomed && saved && (
              <p className={styles.done}>
                ✓ <b>Saved.</b> Welcome to WTW.
              </p>
            )}
            <p className={styles.synopsis}>{synopsis}</p>
            {rec.where && <p className={styles.where}>Streaming on {rec.where}.</p>}

            {!userId ? (
              <>
                <button type="button" className={styles.cta} onClick={signInToSave} disabled={busy}>
                  <Bookmark size={16} strokeWidth={1.8} aria-hidden />
                  <span>Save to my watchlist</span>
                </button>
                <p className={styles.sub}>Free. Sign in with Google and it&rsquo;s saved.</p>
              </>
            ) : welcomed && saved ? (
              <>
                <p className={styles.sub}>
                  It&rsquo;s on your watchlist. Now two minutes of games, and I&rsquo;ll find you more like it.
                </p>
                <button type="button" className={styles.cta} onClick={() => router.push("/play")}>
                  Let&rsquo;s play
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`${styles.cta} ${saved ? styles.ctaSaved : ""}`}
                  onClick={toggleSave}
                  aria-pressed={saved}
                >
                  <Bookmark size={16} strokeWidth={1.8} fill={saved ? "currentColor" : "none"} aria-hidden />
                  <span>{saved ? "Remove from watchlist" : "Add to Watchlist"}</span>
                </button>
                {saved && (
                  <button
                    type="button"
                    className={styles.second}
                    onClick={() => router.push(newUser ? "/play" : "/?stage=recommendations&from=play")}
                  >
                    {newUser ? "Let’s play" : "See my recommendations"}
                  </button>
                )}
              </>
            )}
          </div>
        </article>
      </div>
    </AppShell>
  );
}
