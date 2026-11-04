"use client";

// Menu → Search (MVP, 2026-11-04; mocks in docs/prototypes/search).
//
// Type a title → a list from all of TMDB, best-known first → tap one → the
// feed's card for it (no match score yet), with Share and Add to Watchlist.
// There is no "go" button: the list comes on its own once typing pauses, and
// "Searching…" shows meanwhile, so nobody types "shtisel" and stares at
// nothing. The keyboard's search key searches at once. Each result carries its
// two lead actors, so two films called "Traffic" can be told apart.
//
// The header, list and card reuse the feed's styles (RecommendationsView.module.css)
// so the card looks exactly like a recommendation; search.module.css holds the rest.

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bookmark, ChevronLeft, Play, Star, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AppMenu, VOICES, type Voice } from "@/modules/session/components/AppMenu";
import type { AppUser } from "@/modules/session/types";
import { LEAVE_TIMEOUT_MS, RouteLoading } from "@/app/components/RouteLoading";
import { ProviderIcon } from "@/app/components/ProviderIcon";
import ShareIcon from "@/app/components/ShareIcon";
import { canonicalProvider } from "@/lib/watch-providers";
import { shareTitle } from "@/lib/share";
import { addToWatchlist, hydrateWatchlist, isInWatchlist, removeFromWatchlist } from "@/lib/watchlist";
import type { TitleSearchHit } from "@/lib/tmdb";
import type { Recommendation } from "@/types/recommendation";
import rv from "@/modules/session/recommendations/RecommendationsView.module.css";
import styles from "./search.module.css";

/** Same key WTWApp persists the Gemini Live voice under. */
const VOICE_KEY = "wtw:voice";
/** How long typing must pause before TMDB is asked. */
const PAUSE_MS = 250;
const IMG = "https://image.tmdb.org/t/p/";

export default function SearchView({ user }: { user: AppUser }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  // TMDB's last answer, and for which query (hits null = it failed).
  const [answer, setAnswer] = useState<{ q: string; hits: TitleSearchHit[] | null }>({ q: "", hits: [] });
  // The last good list, kept on screen while the next query is in flight so it doesn't blink per letter.
  const [hits, setHits] = useState<TitleSearchHit[]>([]);
  // "Michael Douglas, Benicio del Toro" per result, filled in just after the list shows.
  const [cast, setCast] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0); // bumps to search without waiting for the pause

  // The open card lives in the URL (/search?t=movie-1900): opening one pushes a
  // history entry, so Back (the arrow, or Android's back gesture) closes the
  // card and shows the list again instead of leaving Search (Eran, 2026-11-04).
  const openKey = useSearchParams().get("t");
  const [picked, setPicked] = useState<{ key: string; rec: Recommendation } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const card = openKey && picked?.key === openKey ? picked.rec : null;

  const query = q.trim();

  // The account's watchlist first, as the app does on start, so "saved" is right.
  useEffect(() => {
    void hydrateWatchlist(user.id);
  }, [user.id]);

  // A reload on /search?t=… has no list behind it to go back to: start clean.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("t")) window.history.replaceState(null, "", "/search");
  }, []);

  useEffect(() => {
    if (query.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const { results } = (await res.json()) as { results: TitleSearchHit[] };
        setHits(results);
        setAnswer({ q: query, hits: results });
        // Then the actors, without holding the list up for them.
        const keys = results.map(keyOf);
        if (keys.length) {
          const r = await fetch(`/api/search/cast?keys=${keys.join(",")}`, { signal: ctl.signal });
          if (r.ok) {
            const { cast: got } = (await r.json()) as { cast: Record<string, string> };
            setCast((c) => ({ ...c, ...got }));
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setAnswer((a) => (a.q === query ? a : { q: query, hits: null }));
      }
    }, now ? 0 : PAUSE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, now]);

  async function pick(h: TitleSearchHit) {
    const key = keyOf(h);
    inputRef.current?.blur();
    window.history.pushState(null, "", `/search?t=${key}`);
    if (picked?.key === key) return; // the same card again: it's already loaded
    setLoadingKey(key);
    setFailedKey(null);
    try {
      const res = await fetch(`/api/search/title?key=${key}`);
      if (!res.ok) throw new Error(String(res.status));
      const shared = (await res.json()) as { rec: Recommendation; synopsis: string };
      // The watchlist card says what it is (the feed's cards carry their reason here).
      const rec = { ...shared.rec, reason: shared.synopsis || "Found in Search" };
      setPicked({ key, rec });
      setSaved(isInWatchlist(rec.id));
    } catch {
      setFailedKey(key);
    } finally {
      setLoadingKey((k) => (k === key ? null : k));
    }
  }

  /** Back from a card to the list: the same as the Back button. */
  function closeCard() {
    if (openKey) window.history.back();
  }

  function edit(v: string) {
    setQ(v);
    setNow(0);
  }

  function clear() {
    closeCard();
    edit("");
    setHits([]);
    setAnswer({ q: "", hits: [] });
    inputRef.current?.focus();
  }

  function toggleSave() {
    if (!card) return;
    if (saved) removeFromWatchlist(card.id);
    else addToWatchlist(card);
    setSaved(!saved);
  }

  // ── menu + leaving (as on the Taste DNA page, which also lives outside WTWApp) ──
  // Read once on the client, as the games' header does; the voice only shows
  // inside the open menu, so the server's default never reaches the screen.
  const [voice, setVoice] = useState<Voice>(() => {
    try {
      const v = typeof window === "undefined" ? null : window.localStorage.getItem(VOICE_KEY);
      if (v && VOICES.some((o) => o.id === v)) return v as Voice;
    } catch {
      // Storage off.
    }
    return VOICES[0].id;
  });
  function chooseVoice(v: Voice) {
    setVoice(v);
    try {
      window.localStorage.setItem(VOICE_KEY, v);
    } catch {
      // Storage disabled — the choice just won't outlive the page.
    }
  }
  const [leaving, setLeaving] = useState(false);
  const leave = (href: string) => {
    setLeaving(true);
    router.push(href);
  };
  const go = (stage: string) => () => leave(`/?stage=${stage}`);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), LEAVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  function back() {
    if (openKey) closeCard();
    else if (window.history.length > 1) router.back();
    else leave("/");
  }

  const status = answer.q !== query ? "searching" : answer.hits ? "done" : "error";
  const showHits = !openKey && query.length >= 2 && status !== "error" && hits.length > 0;
  let note: string | null = null;
  if (openKey) {
    if (loadingKey === openKey) note = "Loading…";
    else if (failedKey === openKey) note = "Couldn’t open that one. Try again in a moment.";
  } else if (query.length >= 2) {
    if (status === "error") note = "Search isn’t working right now. Try again in a moment.";
    else if (status === "searching" && !showHits) note = "Searching…";
    else if (status === "done" && answer.hits?.length === 0) note = "No title like that. Check the spelling?";
  }

  return (
    <div className={styles.shell}>
      <div className={rv.view}>
        <div className={rv.header}>
          <button type="button" className={rv.headerBtn} onClick={back} aria-label="back">
            <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
          </button>
          <span className={rv.headerTitle}>Search</span>
          <div className={rv.headerRight}>
            <AppMenu
              onRecommend={go("recommendations")}
              onWatchlist={go("watchlist")}
              onFastLearning={() => leave("/play?tab=games")}
              onRatings={go("ratings")}
              onProfile={() => leave("/profile/dna")}
              // Already here: AppMenu closes the drawer itself.
              onSearch={() => {}}
              user={user}
              onSignOut={async () => {
                await createClient().auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
              voice={voice}
              setVoice={chooseVoice}
            />
          </div>
        </div>

        <form
          className={styles.box}
          role="search"
          onSubmit={(e) => {
            // The keyboard's search key: search now, and put the keyboard away.
            e.preventDefault();
            setNow((n) => n + 1);
            inputRef.current?.blur();
          }}
        >
          <div className={styles.field}>
            <input
              ref={inputRef}
              className={styles.input}
              type="search"
              enterKeyHint="search"
              // On a card the field shows the title; tapping it brings the list back.
              value={card ? card.title : q}
              onFocus={closeCard}
              onChange={(e) => edit(e.target.value)}
              placeholder="Search movies and series"
              aria-label="Search movies and series"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {q && (
              <button type="button" className={styles.clear} onClick={clear} aria-label="Clear search">
                <X size={22} strokeWidth={2} aria-hidden />
              </button>
            )}
          </div>
          {showHits && (
            <div className={styles.list} role="listbox" aria-label="Results">
              {hits.map((h) => {
                const key = keyOf(h);
                return (
                  <button
                    key={key}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className={styles.row}
                    onClick={() => void pick(h)}
                  >
                    {h.poster_path ? (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP
                      <img className={styles.thumb} src={`${IMG}w154${h.poster_path}`} alt="" loading="lazy" />
                    ) : (
                      <span className={styles.thumb} />
                    )}
                    <span className={styles.rowText}>
                      <b>{h.title}</b>
                      <small>
                        {h.year ?? ""}
                        {h.type === "tv" ? `${h.year ? " · " : ""}series` : ""}
                      </small>
                      {/* Held open until the actors arrive, so nothing moves under a finger. */}
                      <small className={styles.cast}>{cast[key] || " "}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {note && <p className={styles.note} role="status">{note}</p>}
        </form>

        {card && (
          <div className={rv.content}>
            <div className={`${rv.list} ${styles.cardList}`}>
              <TitleCard
                rec={card}
                saved={saved}
                onToggle={toggleSave}
                onShare={() => void shareTitle(card, user.name)}
              />
            </div>
          </div>
        )}
      </div>
      {leaving && <RouteLoading label="Loading" overlay />}
    </div>
  );
}

const keyOf = (h: TitleSearchHit) => `${h.type}-${h.tmdb_id}`;

/**
 * The feed's card (FeedCard in RecommendationsView.tsx), minus what a title we
 * haven't scored can't have yet: the match ring, "Why it's a match" and the
 * "Seen it?" row. Same classes, so it stays pixel-identical to the feed.
 */
function TitleCard({
  rec,
  saved,
  onToggle,
  onShare,
}: {
  rec: Recommendation;
  saved: boolean;
  onToggle: () => void;
  onShare: () => void;
}) {
  const where = rec.where ? canonicalProvider(rec.where) : null;
  const label = saved ? "Remove from watchlist" : "Add to Watchlist";
  return (
    <article className={`${rv.card} ${rv.heroCard}`}>
      <div className={rv.hero}>
        <div className={`${rv.poster} ${rv.poster_hero}`} style={{ background: rec.palette[0] }}>
          {rec.poster_url && (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP
            <img src={rec.poster_url} alt="" className={`${rv.posterImg} ${rv.posterImgLoaded}`} />
          )}
        </div>
        <div className={rv.heroShade} aria-hidden />
        {where && (
          <div className={rv.whereBadge}>
            <ProviderIcon providerKey={where.key} className={rv.whereIcon} />
            <span>{where.label}</span>
          </div>
        )}
        <div className={rv.heroFoot}>
          <div className={rv.cardTitleBlock}>
            <h3 className={rv.heroTitle}>{rec.title}</h3>
            <div className={rv.cardMeta}>
              {rec.year > 0 && <span>{rec.year}</span>}
              <span>{rec.meta}</span>
              {rec.rating > 0 && (
                <span className={rv.metaRating}>
                  <Star size={16} className={rv.metaStar} aria-hidden />
                  {rec.rating.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          <div className={rv.heroCircles}>
            <button type="button" className={rv.trailerCircle} onClick={onShare} aria-label={`Share ${rec.title}`} title="Share">
              <ShareIcon size={22} strokeWidth={1.7} />
            </button>
            {rec.trailer_url && (
              <button
                type="button"
                className={rv.trailerCircle}
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
      <div className={rv.heroBody}>
        <p className={`${rv.heroReason} ${styles.reasonGap}`}>{rec.reason}</p>
        <button
          type="button"
          className={`${rv.watchlistBtn} ${rv.watchlistBtnPrimary} ${saved ? rv.watchlistBtnSaved : ""}`}
          onClick={onToggle}
          aria-pressed={saved}
          aria-label={`${label}: ${rec.title}`}
          title={label}
        >
          <Bookmark size={16} strokeWidth={1.8} fill={saved ? "currentColor" : "none"} aria-hidden />
          <span>{label}</span>
        </button>
      </div>
    </article>
  );
}
