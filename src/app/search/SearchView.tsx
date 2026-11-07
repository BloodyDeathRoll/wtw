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
// People (2026-11-05; mocks in docs/prototypes/search/people): directors and
// actors come up in the same list, with a round photo → tap → their titles,
// newest first → tap one → the same card.
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
import { addToWatchlist, getWatchlist, hydrateWatchlist, isInWatchlist, removeFromWatchlist } from "@/lib/watchlist";
import { safeFrom, searchUrl, type SearchScope } from "@/app/components/HeaderSearch";
import type { PersonPage, PersonSearchHit, PersonTitle, SearchHit, TitleSearchHit } from "@/lib/tmdb";
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
  // ?q=: letters typed into a header's search field before it handed over to
  // this route (HeaderSearch, 2026-11-07) — and still arriving, by
  // router.replace, until this field is typed into; then this field's own
  // text wins. The URL keeps q (nothing strips it) so that stays true.
  const params = useSearchParams();
  const [typedHere, setTypedHere] = useState<string | null>(null);
  const q = typedHere ?? params.get("q") ?? "";
  const setQ = setTypedHere;
  // TMDB's last answer, and for which query (hits null = it failed).
  const [answer, setAnswer] = useState<{ q: string; hits: SearchHit[] | null }>({ q: "", hits: [] });
  // The last good list, kept on screen while the next query is in flight so it doesn't blink per letter.
  const [hits, setHits] = useState<SearchHit[]>([]);
  // "Michael Douglas, Benicio del Toro" per result, filled in just after the list shows.
  const [cast, setCast] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0); // bumps to search without waiting for the pause

  // The open card lives in the URL (/search?t=movie-1900): opening one pushes a
  // history entry, so Back (the arrow, or Android's back gesture) closes the
  // card and shows the list again instead of leaving Search (Eran, 2026-11-04).
  // A person's page the same way (/search?p=525), and a card opened from it
  // (/search?p=525&t=movie-27205): Back walks card → person → list.
  const openKey = params.get("t");
  const openPerson = params.get("p");
  const [picked, setPicked] = useState<{ key: string; rec: Recommendation } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const card = openKey && picked?.key === openKey ? picked.rec : null;
  const [who, setWho] = useState<{ id: string; name: string; page: PersonPage | null; failed: boolean } | null>(null);
  const shownWho = openPerson && who?.id === openPerson ? who : null;
  const person = !openKey ? shownWho : null;

  const query = q.trim();

  // The screen's own titles first (?in=, from HeaderSearch): the saved ones
  // from Watchlist, the rated ones from Ratings — matched here by title,
  // listed above the TMDB results, which then leave them out (2026-11-07).
  const inParam = params.get("in");
  const scope: SearchScope | null = inParam === "ratings" || inParam === "watchlist" ? inParam : null;
  // Where Back returns (?from=, set by HeaderSearch; only known screens).
  const from = safeFrom(params.get("from"));
  const base = searchUrl(scope ?? undefined, "", from ?? undefined);
  const url = (extra: string) => `${base}${base.includes("?") ? "&" : "?"}${extra}`;
  const [mine, setMine] = useState<LocalHit[]>([]);
  useEffect(() => {
    if (!scope) return;
    let on = true;
    (async () => {
      if (scope === "watchlist") {
        await hydrateWatchlist(user.id);
        if (!on) return;
        setMine(
          getWatchlist().map((e) => ({
            tmdb_id: e.rec.id.split(":").pop() ?? e.rec.id,
            type: e.rec.type,
            title: e.rec.title,
            year: e.rec.year,
            poster_path: null,
            poster_url: e.rec.poster_url,
            rec: e.rec,
          })),
        );
      } else {
        const res = await fetch("/api/recommendations/ratings");
        if (!res.ok || !on) return;
        const { items } = (await res.json()) as {
          items: { title: string | null; tmdb_id: string; media_type: "movie" | "tv" | null; poster_url: string | null }[];
        };
        if (!on) return;
        setMine(
          items.flatMap((i) =>
            i.title && i.media_type
              ? [{ tmdb_id: i.tmdb_id, type: i.media_type, title: i.title, year: null, poster_path: null, poster_url: i.poster_url }]
              : [],
          ),
        );
      }
    })();
    return () => {
      on = false;
    };
  }, [scope, user.id]);
  const mineHits = query.length >= 2 ? mine.filter((t) => t.title.toLowerCase().includes(query.toLowerCase())) : [];
  const mineKeys = new Set(mineHits.map(keyOf));

  // The account's watchlist first, as the app does on start, so "saved" is right.
  useEffect(() => {
    void hydrateWatchlist(user.id);
  }, [user.id]);

  // A reload on /search?t=… or ?p=… has no list behind it to go back to: start clean.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("t") || sp.has("p")) window.history.replaceState(null, "", base);
  }, [base]);

  useEffect(() => {
    if (query.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const { results } = (await res.json()) as { results: SearchHit[] };
        setHits(results);
        setAnswer({ q: query, hits: results });
        // Then the actors, without holding the list up for them.
        const keys = results.filter(isTitle).map(keyOf);
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
    window.history.pushState(null, "", url(openPerson ? `p=${openPerson}&t=${key}` : `t=${key}`));
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

  /** One of the screen's own titles: the saved card is already here, no fetch. */
  function pickMine(h: LocalHit) {
    if (!h.rec) return pick(h);
    const key = keyOf(h);
    inputRef.current?.blur();
    window.history.pushState(null, "", url(`t=${key}`));
    setPicked({ key, rec: h.rec });
    setSaved(isInWatchlist(h.rec.id));
  }

  async function pickPerson(h: PersonSearchHit) {
    const id = h.tmdb_id;
    inputRef.current?.blur();
    window.history.pushState(null, "", url(`p=${id}`));
    if (who?.id === id && who.page) return; // the same person again: already loaded
    setWho({ id, name: h.name, page: null, failed: false });
    try {
      const res = await fetch(`/api/search/person?id=${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const { person: page } = (await res.json()) as { person: PersonPage };
      setWho((w) => (w?.id === id ? { ...w, page } : w));
      // A director's films show their lead actors, as the list does; fetched
      // after the page shows, eight at a time (the cast route's limit), top first.
      if (page.role === "Director") {
        const keys = page.titles.map(keyOf).filter((k) => !(k in cast));
        for (let i = 0; i < keys.length; i += 8) {
          const r = await fetch(`/api/search/cast?keys=${keys.slice(i, i + 8).join(",")}`);
          if (!r.ok) break;
          const { cast: got } = (await r.json()) as { cast: Record<string, string> };
          setCast((c) => ({ ...c, ...got }));
        }
      }
    } catch {
      setWho((w) => (w?.id === id && !w.page ? { ...w, failed: true } : w));
    }
  }

  /** Back to the list from a card or a person's page (or both): like pressing Back that often. */
  function closeCard() {
    const steps = (openKey ? 1 : 0) + (openPerson ? 1 : 0);
    if (steps) window.history.go(-steps);
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
  // Back returns to the screen the search was opened from: a home stage
  // ("watchlist", "ratings"…) or a route ("/play"). Replace, not push, so
  // the phone's own Back doesn't come through /search again.
  function back() {
    if (openKey || openPerson) window.history.back();
    else if (from) {
      setLeaving(true);
      router.replace(from.startsWith("/") ? from : `/?stage=${encodeURIComponent(from)}`);
    } else if (window.history.length > 1) router.back();
    else leave("/");
  }

  const status = answer.q !== query ? "searching" : answer.hits ? "done" : "error";
  const shown = hits.filter((h) => !mineKeys.has(keyOf(h)));
  const showMine = !openKey && !openPerson && mineHits.length > 0;
  const showHits = !openKey && !openPerson && query.length >= 2 && status !== "error" && shown.length > 0;
  let note: string | null = null;
  if (openKey) {
    if (loadingKey === openKey) note = "Loading…";
    else if (failedKey === openKey) note = "Couldn’t open that one. Try again in a moment.";
  } else if (openPerson) {
    if (person?.failed) note = "Couldn’t open that one. Try again in a moment.";
    else if (!person?.page) note = "Loading…";
    else if (person.page.titles.length === 0) note = "Nothing of theirs to show yet.";
  } else if (query.length >= 2 && !showMine) {
    if (status === "error") note = "Search isn’t working right now. Try again in a moment.";
    else if (status === "searching" && !showHits) note = "Searching…";
    else if (status === "done" && answer.hits?.length === 0) note = "Nothing like that. Check the spelling?";
  }

  return (
    <div className={styles.shell}>
      <div className={rv.view}>
        {/* The field sits in the header, between Back and the menu — the same
            geometry as the home header with its search swept in (WTWApp
            TopBar), so arriving from there doesn't move a pixel (2026-11-07). */}
        <div className={styles.header}>
          <button type="button" className={styles.headerBtn} onClick={back} aria-label="back">
            <ChevronLeft size={30} strokeWidth={1.5} aria-hidden />
          </button>
          <form
            className={styles.field}
            role="search"
            onSubmit={(e) => {
              // The keyboard's search key: search now, and put the keyboard away.
              e.preventDefault();
              setNow((n) => n + 1);
              inputRef.current?.blur();
            }}
          >
            <input
              ref={inputRef}
              className={styles.headerInput}
              type="search"
              enterKeyHint="search"
              // On a card the field shows the title, on a person's page their
              // name; tapping it brings the list back.
              value={card ? card.title : shownWho ? shownWho.name : q}
              onFocus={closeCard}
              onChange={(e) => edit(e.target.value)}
              placeholder="Search titles and people"
              aria-label="Search titles and people"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {q && (
              <button
                type="button"
                className={`${styles.clear} ${styles.headerClear}`}
                onClick={clear}
                aria-label="Clear search"
              >
                <X size={22} strokeWidth={2} aria-hidden />
              </button>
            )}
          </form>
          <div className={rv.headerRight}>
            <AppMenu
              onRecommend={go("recommendations")}
              onWatchlist={go("watchlist")}
              onFastLearning={() => leave("/play?tab=games")}
              onRatings={go("ratings")}
              onProfile={() => leave("/profile/dna")}
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

        <div className={styles.box}>
          {showMine && (
            <>
              <p className={styles.groupLabel}>{scope === "watchlist" ? "In your watchlist" : "In your ratings"}</p>
              <div className={styles.list} role="listbox" aria-label={scope === "watchlist" ? "Your watchlist" : "Your ratings"}>
                {mineHits.map((h) => (
                  <TitleRow key={keyOf(h)} h={h} line={h.year ? String(h.year) : undefined} onPick={() => void pickMine(h)} />
                ))}
              </div>
              {showHits && <p className={styles.groupLabel}>All titles</p>}
            </>
          )}
          {showHits && (
            <div className={styles.list} role="listbox" aria-label="Results">
              {shown.map((h) =>
                h.type === "person" ? (
                  <button
                    key={keyOf(h)}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className={styles.row}
                    onClick={() => void pickPerson(h)}
                  >
                    {h.profile_path ? (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP
                      <img className={styles.face} src={`${IMG}w185${h.profile_path}`} alt="" loading="lazy" />
                    ) : (
                      <span className={styles.face} />
                    )}
                    <span className={styles.rowText}>
                      <b>{h.name}</b>
                      <small>{h.role}</small>
                      <small className={styles.cast}>{h.known_for.join(", ") || "\u00a0"}</small>
                    </span>
                  </button>
                ) : (
                  // Held open until the actors arrive, so nothing moves under a finger.
                  <TitleRow key={keyOf(h)} h={h} line={cast[keyOf(h)]} onPick={() => void pick(h)} />
                ),
              )}
            </div>
          )}
          {note && <p className={styles.note} role="status">{note}</p>}
        </div>

        {person?.page && person.page.titles.length > 0 && (
          <div className={rv.content}>
            <div className={`${rv.list} ${styles.personPage}`}>
              <div className={styles.who}>
                {person.page.profile_path ? (
                  // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP
                  <img src={`${IMG}w185${person.page.profile_path}`} alt="" />
                ) : (
                  <span className={styles.whoBlank} />
                )}
                <span>
                  <b>{person.page.name}</b>
                  <small>
                    {person.page.role} · {countOf(person.page.titles)}
                  </small>
                </span>
              </div>
              <div className={styles.list} role="listbox" aria-label={`${person.page.name}’s titles`}>
                {person.page.titles.map((t) => (
                  <TitleRow
                    key={keyOf(t)}
                    h={t}
                    line={person.page!.role === "Actor" ? (t.character ? `as ${t.character}` : "") : cast[keyOf(t)]}
                    onPick={() => void pick(t)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

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

const keyOf = (h: SearchHit) => `${h.type}-${h.tmdb_id}`;
/** A title of the screen's own group: a full poster URL, and the saved card itself when we have it. */
type LocalHit = TitleSearchHit & { poster_url?: string | null; rec?: Recommendation };
const isTitle = (h: SearchHit): h is TitleSearchHit => h.type !== "person";

/** "15 films", or "54 titles" once there's a series among them. */
function countOf(titles: PersonTitle[]) {
  const n = titles.length;
  const word = titles.every((t) => t.type === "movie") ? (n === 1 ? "film" : "films") : n === 1 ? "title" : "titles";
  return `${n} ${word}`;
}

/** One title in a list: poster, name, year (· series), and a third line —
 *  the lead actors, or who a person played. The line's space is held while
 *  it's still on its way, so rows don't move. */
function TitleRow({ h, line, onPick }: { h: LocalHit; line: string | undefined; onPick: () => void }) {
  const poster = h.poster_url ?? (h.poster_path ? `${IMG}w154${h.poster_path}` : null);
  return (
    <button type="button" role="option" aria-selected="false" className={styles.row} onClick={onPick}>
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, already allowed by the CSP
        <img className={styles.thumb} src={poster} alt="" loading="lazy" />
      ) : (
        <span className={styles.thumb} />
      )}
      <span className={styles.rowText}>
        <b>{h.title}</b>
        <small>
          {h.year ?? ""}
          {h.type === "tv" ? `${h.year ? " · " : ""}series` : ""}
        </small>
        <small className={styles.cast}>{line || "\u00a0"}</small>
      </span>
    </button>
  );
}

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
