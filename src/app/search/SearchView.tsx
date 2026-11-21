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

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bookmark, ChevronLeft, History, Play, Star, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { navTabsEnabled, searchV3Enabled } from "@/lib/flags";
import { clearRecentSearches, rememberSearch, useRecentSearches } from "./recent";
import SearchCard, { applyHidden, myRatings } from "./SearchCard";
import { AppMenu, VOICES, type Voice } from "@/modules/session/components/AppMenu";
import type { AppUser } from "@/modules/session/types";
import { LEAVE_TIMEOUT_MS, RouteLoading } from "@/app/components/RouteLoading";
import { ProviderIcon } from "@/app/components/ProviderIcon";
import ShareIcon from "@/app/components/ShareIcon";
import { canonicalProvider } from "@/lib/watch-providers";
import { shareTitle } from "@/lib/share";
import { fetchMatches } from "@/lib/explain-cache";
import { addToWatchlist, getWatchlist, hydrateWatchlist, isInWatchlist, removeFromWatchlist, type WatchlistRating } from "@/lib/watchlist";
import { HIDDEN_EVENT, RATED_EVENT, type HiddenDetail, type RatedDetail } from "@/modules/session/recommendations/rate";
import { safeFrom, searchUrl, type SearchScope } from "@/app/search/url";
import type { PersonPage, PersonSearchHit, PersonTitle, SearchHit, TitleSearchHit } from "@/lib/tmdb";
import type { Recommendation } from "@/types/recommendation";
import rv from "@/modules/session/recommendations/RecommendationsView.module.css";
import styles from "./search.module.css";

/** Same key WTWApp persists the Gemini Live voice under. */
const VOICE_KEY = "wtw:voice";
/** How long typing must pause before TMDB is asked. */
const PAUSE_MS = 250;
/** Keys /api/search/cast answers in one call (its MAX_KEYS). */
const CAST_KEYS = 8;
const IMG = "https://image.tmdb.org/t/p/";

export default function SearchView({
  user,
  menu,
  chatReady = false,
}: {
  user: AppUser;
  /** The onboarding is done: this screen's own menu offers the chat (Q5). */
  chatReady?: boolean;
  /**
   * Opened over another screen by HeaderSearch (a pushState, not a route):
   * that screen's own menu, shown in place of this one's, and Back pops back
   * to it.
   */
  menu?: ReactNode;
}) {
  const inPlace = menu !== undefined;
  const v3 = searchV3Enabled();
  // SEARCH_V3: your recent searches wait in the empty box (DEC-7); they live on this phone only.
  const recent = useRecentSearches(v3);
  /** A search made (a result opened, or the keyboard's search key): it joins the recent ones. */
  const remember = () => {
    if (v3) rememberSearch(q);
  };
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const params = useSearchParams();
  const [q, setQ] = useState("");
  // TMDB's last answer, and for which query (hits null = it failed).
  const [answer, setAnswer] = useState<{ q: string; hits: SearchHit[] | null }>({ q: "", hits: [] });
  // The last good list, kept on screen while the next query is in flight so it doesn't blink per letter.
  const [hits, setHits] = useState<SearchHit[]>([]);
  // "Michael Douglas, Benicio del Toro" per result, filled in just after the list shows.
  const [cast, setCast] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0); // bumps to search without waiting for the pause
  // SEARCH_V3: your rating of each title, and what you hid from For you, to mark the rows (SEARCH.md DEC-5).
  const [marks, setMarks] = useState<Record<string, WatchlistRating>>({});
  // SEARCH_V3: your match on each title row, by "type:tmdb_id" (v3 Q7); each title asked once a visit.
  const [matches, setMatches] = useState<Record<string, number>>({});
  const askedMatch = useRef(new Set<string>());

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
  const base = searchUrl(scope ?? undefined, from ?? undefined);
  const url = (extra: string) => `${base}${base.includes("?") ? "&" : "?"}${extra}`;
  const [mine, setMine] = useState<LocalHit[]>([]);
  const mineRef = useRef(mine);
  mineRef.current = mine;
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
          items: { title: string | null; tmdb_id: string; media_type: "movie" | "tv" | null; poster_url: string | null; year: number | null }[];
        };
        if (!on) return;
        setMine(
          items.flatMap((i) =>
            i.title && i.media_type
              ? [{ tmdb_id: i.tmdb_id, type: i.media_type, title: i.title, year: i.year, poster_path: null, poster_url: i.poster_url }]
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

  // SEARCH_V3: Seen's list once, then each rating as it lands (a card opened from here, or anywhere else).
  useEffect(() => {
    if (!v3) return;
    let on = true;
    // A copy: the list is SearchCard's shared cache, which its own listeners keep current.
    void myRatings().then((m) => on && setMarks({ ...m }));
    const onRated = (e: Event) => {
      const { id, rating } = (e as CustomEvent<RatedDetail>).detail;
      setMarks((m) => {
        const next = { ...m };
        if (rating) next[id] = rating;
        else delete next[id];
        return next;
      });
    };
    // A title hidden from For you, or restored, anywhere: its mark follows.
    const onHidden = (e: Event) => {
      const { id, hidden } = (e as CustomEvent<HiddenDetail>).detail;
      setMarks((m) => {
        const next = { ...m };
        applyHidden(next, id, hidden);
        return next;
      });
    };
    window.addEventListener(RATED_EVENT, onRated);
    window.addEventListener(HIDDEN_EVENT, onHidden);
    return () => {
      on = false;
      window.removeEventListener(RATED_EVENT, onRated);
      window.removeEventListener(HIDDEN_EVENT, onHidden);
    };
  }, [v3]);
  // Read each render, like the card's own "saved": a title added or removed on its card shows on the way back.
  const savedIds = v3 ? new Set(getWatchlist().map((e) => e.rec.id)) : null;
  const markOf = (h: TitleSearchHit) => (savedIds ? markFor(marks[`${h.type}:${h.tmdb_id}`], savedIds.has(`${h.type}:${h.tmdb_id}`)) : undefined);

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
        // Then the actors, without holding the list up for them. Your own group's titles get theirs in a call of
        // their own (the route takes 8 keys), so their rows read like the others: the year line, then the actors.
        const q = query.toLowerCase();
        const fromResults = results.filter(isTitle).map(keyOf);
        const asked = new Set(fromResults);
        const own = mineRef.current.filter((t) => t.title.toLowerCase().includes(q)).map(keyOf).filter((k) => !asked.has(k));
        const batches = [fromResults];
        for (let i = 0; i < own.length; i += CAST_KEYS) batches.push(own.slice(i, i + CAST_KEYS));
        await Promise.all(
          batches.map(async (keys) => {
            if (!keys.length) return;
            const r = await fetch(`/api/search/cast?keys=${keys.join(",")}`, { signal: ctl.signal });
            if (r.ok) {
              const { cast: got } = (await r.json()) as { cast: Record<string, string> };
              setCast((c) => ({ ...c, ...got }));
            }
          }),
        );
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
    remember();
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
    remember();
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
  // Back returns to the screen the search was opened from. Opened in place,
  // that screen is still mounted under this one: pop to it. After a reload
  // it's gone: a home stage ("watchlist", "ratings"…) or a route ("/play")
  // by replace, not push, so the phone's own Back doesn't come through
  // /search again.
  function back() {
    if (openKey || openPerson || inPlace) window.history.back();
    else if (from) {
      setLeaving(true);
      router.replace(from.startsWith("/") ? from : `/?stage=${encodeURIComponent(from)}`);
    } else if (window.history.length > 1) router.back();
    else leave("/");
  }

  const status = answer.q !== query ? "searching" : answer.hits ? "done" : "error";
  const shown = hits.filter((h) => !mineKeys.has(keyOf(h)));
  const showMine = !openKey && !openPerson && mineHits.length > 0;
  // Nothing typed and nothing open: your recent searches, or the box alone as today when there are none (DEC-7).
  const showRecent = v3 && query.length === 0 && !openKey && !openPerson && recent.length > 0;
  const showHits = !openKey && !openPerson && query.length >= 2 && status !== "error" && shown.length > 0;
  // SEARCH_V3: the match on every title row we can score honestly (v3 Q7, SEARCH.md DEC-3). A title
  // outside the catalogue gets none, and nothing takes its place; the row shows at once either way.
  const rowKeys = v3
    ? [...mineHits, ...shown.filter(isTitle), ...(person?.page?.titles ?? [])].map((h) => `${h.type}:${h.tmdb_id}`).join(",")
    : "";
  useEffect(() => {
    const ks = rowKeys ? [...new Set(rowKeys.split(","))].filter((k) => !askedMatch.current.has(k)) : [];
    ks.forEach((k) => askedMatch.current.add(k));
    for (let i = 0; i < ks.length; i += 60) {
      const chunk = ks.slice(i, i + 60);
      void fetchMatches(chunk.map((k) => ({ type: k.split(":")[0] as "movie" | "tv", tmdb_id: k.split(":")[1] }))).then((m) => {
        if (!m) chunk.forEach((k) => askedMatch.current.delete(k)); // failed: asked again with the next list
        else if (Object.keys(m).length) setMatches((cur) => ({ ...cur, ...m }));
      });
    }
  }, [rowKeys]);
  const matchOf = (h: TitleSearchHit) => matches[`${h.type}:${h.tmdb_id}`];
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
        {/* The field sits in the header, between Back and the menu — the home
            header's geometry (WTWApp TopBar), so sweeping in over it keeps the
            menu where it was (2026-11-07). */}
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
              remember();
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
            {/* With the tab bar (NAV_TABS) there is no menu: the bar is the way around. */}
            {navTabsEnabled() ? null : menu ?? (
              <AppMenu
                onRecommend={go("recommendations")}
                onWatchlist={go("watchlist")}
                onFastLearning={() => leave("/play?tab=games")}
                onRatings={go("ratings")}
                onProfile={() => leave("/profile/dna")}
                onChat={chatReady ? go("conversation") : undefined}
                user={user}
                onSignOut={async () => {
                  await createClient().auth.signOut();
                  router.replace("/login");
                  router.refresh();
                }}
                voice={voice}
                setVoice={chooseVoice}
              />
            )}
          </div>
        </div>

        <div className={styles.box}>
          {showRecent && (
            <>
              <div className={styles.recentHead}>
                <p className={styles.groupLabel}>Recent searches</p>
                <button
                  type="button"
                  className={styles.recentClear}
                  onClick={() => {
                    clearRecentSearches();
                    inputRef.current?.focus();
                  }}
                >
                  Clear
                </button>
              </div>
              <div className={styles.list} role="listbox" aria-label="Recent searches">
                {recent.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className={styles.row}
                    onClick={() => {
                      // Search it again, at once.
                      edit(s);
                      setNow((n) => n + 1);
                    }}
                  >
                    <span className={styles.recentIcon} aria-hidden>
                      <History size={20} strokeWidth={1.75} />
                    </span>
                    <span className={styles.recentText}>{s}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {showMine && (
            <>
              {/* SEARCH_V3: the page is called Seen now (SEARCH.md DEC-8). */}
              <p className={styles.groupLabel}>{scope === "watchlist" ? "In your Watchlist" : v3 ? "In Seen" : "In your ratings"}</p>
              <div className={styles.list} role="listbox" aria-label={scope === "watchlist" ? "Your watchlist" : v3 ? "Seen" : "Your ratings"}>
                {mineHits.map((h) => (
                  <TitleRow key={keyOf(h)} h={h} mark={markOf(h)} match={matchOf(h)} line={cast[keyOf(h)]} onPick={() => void pickMine(h)} />
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
                  <TitleRow key={keyOf(h)} h={h} mark={markOf(h)} match={matchOf(h)} line={cast[keyOf(h)]} onPick={() => void pick(h)} />
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
                    mark={markOf(t)}
                    match={matchOf(t)}
                    line={person.page!.role === "Actor" ? (t.character ? `as ${t.character}` : "") : cast[keyOf(t)]}
                    onPick={() => void pick(t)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {card && v3 && (
          // Every title opens the same card page as the Watchlist and Seen (SEARCH.md DEC-2, v3 Q1).
          <div className={rv.content}>
            <SearchCard key={card.id} rec={card} user={user} />
          </div>
        )}
        {card && !v3 && (
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

/** Where a title stands with you (SEARCH_V3, SEARCH.md DEC-5): your rating first, then saved, then hidden from For you. */
const MARKS: Record<WatchlistRating, string> = {
  loved: "❤️ Loved",
  liked: "👍 Liked",
  disliked: "👎 Disliked",
  removed: "Hidden from For you",
};
export function markFor(rating: WatchlistRating | undefined, saved: boolean): string | undefined {
  if (rating && rating !== "removed") return MARKS[rating];
  if (saved) return "In your Watchlist";
  return rating && MARKS[rating];
}

/** One title in a list: poster, name, year (· series · your mark in white ·
 *  your match, SEARCH_V3), and a third line — the lead actors, or who a person
 *  played. That line's space is held while it's still on its way, so rows
 *  don't move. */
export function TitleRow({
  h,
  mark,
  match,
  line,
  onPick,
}: {
  h: LocalHit;
  mark?: string;
  match?: number;
  line: string | undefined;
  onPick: () => void;
}) {
  const poster = h.poster_url ?? (h.poster_path ? `${IMG}w154${h.poster_path}` : null);
  // A year line too long for one line (a rated or saved series with a match) drops the word "match" rather than
  // wrapping it onto a line of its own: "97%" alone (Eran, #365). Measured after layout, and again on a resize.
  const yearRef = useRef<HTMLElement>(null);
  const [short, setShort] = useState(false);
  // Bumped when the row's width changes (a rotation, a resize) or a late font lands: measure again from the long form.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = yearRef.current;
    if (!el || !match || short) return;
    const style = getComputedStyle(el);
    // "normal" line-height reads as NaN: take the usual 1.2 × the font size.
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    if (line > 0 && el.getBoundingClientRect().height > line * 1.5) setShort(true);
  }, [match, mark, h.year, h.type, short, width]);
  useEffect(() => {
    // The row itself: the line and its text box are as wide as their words, so they don't widen with the screen.
    const el = yearRef.current?.closest<HTMLElement>('[role="option"]');
    if (!el || !match) return;
    const again = () => {
      setShort(false);
      setWidth((n) => n + 1);
    };
    // A web font landing late changes the words' width, not the row's: measure once more then.
    let live = true;
    void document.fonts?.ready.then(() => live && again());
    if (typeof ResizeObserver === "undefined") {
      // An old browser: the window's resize, as before.
      window.addEventListener("resize", again);
      return () => {
        live = false;
        window.removeEventListener("resize", again);
      };
    }
    // Width only: dropping the word changes the height, and that must not start it over.
    let last = el.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (Math.abs(w - last) < 1) return;
      last = w;
      again();
    });
    ro.observe(el);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [match]);
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
        <small ref={yearRef}>
          {h.year ?? ""}
          {h.type === "tv" ? `${h.year ? " · " : ""}series` : ""}
          {mark ? (
            <>
              {h.year || h.type === "tv" ? " · " : ""}
              <span className={styles.mark}>{mark}</span>
            </>
          ) : null}
          {match ? (
            <>
              {h.year || h.type === "tv" || mark ? " · " : ""}
              <span className={rv.rowMatch}>
                {Math.round(match * 100)}%{short ? null : <span className={styles.matchWord}> match</span>}
              </span>
            </>
          ) : null}
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
  const label = saved ? "Remove from Watchlist" : "Add to Watchlist";
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
