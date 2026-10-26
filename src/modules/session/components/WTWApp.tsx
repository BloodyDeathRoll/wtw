"use client";

// Fingerprint recommendation chat. Amber-on-black, mobile-first.
// Onboard ↔ conversation states. Chat streams from /api/conversation/message
// via useChat. Welcome chips screen is parked until the rec engine lands.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  AudioLines,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  Gamepad2,
  MessageSquare,
  Share2,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { createClient } from "@/lib/supabase/client";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  getUnsyncedIds,
  getUnsyncedRemovals,
  markRemovalsSynced,
  markSynced,
  watchlistCount,
  hydrateWatchlist,
  WATCHLIST_HYDRATED_EVENT,
} from "@/lib/watchlist";
import { getPendingRegretChecks, type RegretEntry } from "@/lib/regret-queue";
import RegretPrompt from "@/app/components/RegretPrompt";
import AppShell from "./AppShell";
import RecommendationsView from "../recommendations/RecommendationsView";
import RatingsView from "../ratings/RatingsView";
import VoiceMode from "../voice/VoiceMode";
import IntroVoice from "../voice/IntroVoice";
import { GAMES_INTRO_AUDIO_SRC, GAMES_INTRO_MESSAGE } from "../voice/intro-copy";
import { FingerprintLoader } from "./FingerprintLoader";
import RecommendPill from "./RecommendPill";
import type { AppUser, Conversation, Welcome } from "../types";
import { AppMenu, VOICES, type Voice } from "./AppMenu";
import { shareApp } from "@/lib/share";
import { isContentType, type ContentType } from "@/lib/content-type";
import { LEAVE_TIMEOUT_MS, RouteLoading } from "@/app/components/RouteLoading";
import styles from "./WTWApp.module.css";

// How many completed AI replies before "See Recommendations" appears.
// Modality-agnostic — every assistant message counts (voice OR text).
const RECOMMEND_AFTER_TURNS = 2;

// Brand-new users skip the onboard shell and land on the voice intro, which
// leads into the taste games (2026-10-20; the words live with the recording
// in voice/intro-copy.ts).

// "Both" is the word the taste games use for the same choice (/play setup).
const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  movies: "Movies",
  series: "Series",
  all: "Both",
};

/** A plain text chat message in the AI SDK's parts shape. */
function textMessage(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

/** The text of a chat message (its text parts, joined). */
function textOf(m: UIMessage | undefined): string {
  return m?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
}

const DEFAULT_VOICE: Voice = "Aoede";
const VOICE_IDS = VOICES.map((v) => v.id) as readonly string[];
const isVoice = (s: unknown): s is Voice =>
  typeof s === "string" && VOICE_IDS.includes(s);


// ─────────────────────────────────────────────────────────────
// Icons — lucide-react, named as in the Figma redesign (icon/share-2 etc.).
// Design sizes are phone px at ~2.4x: 72 → 30, 64 → 26.5, 40 → 16.5.
// ─────────────────────────────────────────────────────────────
const ICON_STROKE = 1.5;
const I = {
  chevDown: <ChevronDown size={16.5} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  back: <ChevronLeft size={30} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  message: <MessageSquare size={30} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  // Android's share mark (three nodes, two arms) rather than the iOS
  // box-and-arrow — this ships as a PWA and Android is the target surface.
  share: <Share2 size={30} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  // Home-screen circles. Sparkles = the fingerprint's picks; bookmark matches
  // the "Add to watchlist" CTA on the cards.
  sparkle: <Sparkles size={26.5} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  bookmark: <Bookmark size={26.5} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  games: <Gamepad2 size={26.5} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  // The input's live/send button ("speak" in the design).
  speak: <AudioLines size={25} strokeWidth={2} aria-hidden="true" />,
  replay: <Volume2 size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />,
};

// ─────────────────────────────────────────────────────────────
// Top bar
// ─────────────────────────────────────────────────────────────
function TopBar({
  hasConversation,
  onBack,
  onOpenChat,
  onRecommend,
  onWatchlist,
  onFastLearning,
  onRatings,
  onProfile,
  user,
  onSignOut,
  contentType,
  setContentType,
  voice,
  setVoice,
}: {
  hasConversation: boolean;
  onBack: () => void;
  onOpenChat: () => void;
  onRecommend: () => void;
  onWatchlist: () => void;
  onFastLearning: () => void;
  onRatings: () => void;
  onProfile: () => void;
  user: AppUser;
  onSignOut: () => void;
  contentType: ContentType;
  setContentType: (c: ContentType) => void;
  voice: Voice;
  setVoice: (v: Voice) => void;
}) {
  const [brandOpen, setBrandOpen] = useState(false);
  const brandRef = useRef<HTMLDivElement>(null);


  // Close the content-type dropdown on an outside click. The hamburger drawer
  // owns its own dismissal (see AppMenu).
  useEffect(() => {
    if (!brandOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!brandRef.current?.contains(e.target as Node)) setBrandOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [brandOpen]);


  return (
    <>
    <div className={styles.topbar}>
      <div className={styles.topbarSlot}>
        {hasConversation ? (
          <button
            className={styles.iconbtn}
            onClick={onBack}
            aria-label="back"
            type="button"
          >
            {I.back}
          </button>
        ) : (
          // The chat (text and voice) lives behind this icon since the home
          // screen dropped its input bar (2026-10-20).
          <button
            className={styles.iconbtn}
            onClick={onOpenChat}
            aria-label="open chat"
            type="button"
          >
            {I.message}
          </button>
        )}
      </div>

      <div className={styles.brand} ref={brandRef}>
        <button
          className={styles.brandModel}
          type="button"
          onClick={() => setBrandOpen((v) => !v)}
          aria-expanded={brandOpen}
          aria-haspopup="menu"
        >
          <span>{CONTENT_TYPE_LABEL[contentType]}</span>
          {I.chevDown}
        </button>
        {brandOpen && (
          <div className={styles.brandMenu} role="menu">
            {(Object.keys(CONTENT_TYPE_LABEL) as ContentType[]).map((c) => (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={contentType === c}
                className={`${styles.brandMenuItem} ${
                  contentType === c ? styles.brandMenuItemActive : ""
                }`}
                onClick={() => {
                  setContentType(c);
                  setBrandOpen(false);
                }}
              >
                {CONTENT_TYPE_LABEL[c]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.topbarRight}>
        <button
          className={styles.iconbtn}
          onClick={shareApp}
          aria-label="share WTW"
          type="button"
        >
          {I.share}
        </button>
        <AppMenu
          onRecommend={onRecommend}
          onWatchlist={onWatchlist}
          onFastLearning={onFastLearning}
          onRatings={onRatings}
          onProfile={onProfile}
          user={user}
          onSignOut={onSignOut}
          voice={voice}
          setVoice={setVoice}
        />
      </div>
    </div>

    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Onboard / Welcome
// ─────────────────────────────────────────────────────────────
function Onboard({
  continuePrompt,
  matureGreeting,
  onPlayVoice,
}: {
  continuePrompt?: string;
  matureGreeting?: string;
  onPlayVoice?: (primer: string) => void;
}) {
  // Priority: mature greeting (server-rendered, situational) →
  // continuation of an in-progress chat → cold-start calibration.
  const hint =
    matureGreeting ??
    continuePrompt ??
    "Let's calibrate your taste: name a few of your all time favorite flicks.";
  const spoken =
    matureGreeting ??
    continuePrompt ??
    "Let's start by calibrating your taste. Name a few of your all-time favorite films.";
  return (
    <div className={styles.homeHero}>
      <div className={styles.homeLogoRow}>
        <Image
          src="/logo_vector.svg"
          alt=""
          width={64}
          height={64}
          className={styles.homeLogo}
          priority
        />
        <span className={styles.homeLogoName}>WTW</span>
      </div>
      <p className={styles.homeQuestion}>{hint}</p>
      {/* Not in the redesign, kept on purpose: it re-opens the question in
          voice mode, read aloud — the only way to HEAR the prompt. */}
      {onPlayVoice && (
        <button
          type="button"
          className={styles.onboardPlayBtn}
          onClick={() => onPlayVoice(spoken)}
          aria-label="play message"
        >
          {I.replay}
        </button>
      )}
    </div>
  );
}

function Welcome({
  onSuggest,
  favorites,
}: {
  onSuggest: (s: string) => void;
  favorites: string;
}) {
  const suggestions = [
    "Something twisty like Severance but lighter",
    "A film for a rainy Sunday with my mum",
    "Hidden A24 gems I probably missed",
    "What did my taste say I'd love this week?",
  ];
  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeLogoRow}>
        <Image
          src="/logo_vector.svg"
          alt=""
          width={40}
          height={40}
          className={styles.welcomeLogo}
          priority
        />
        <span className={styles.welcomeLogoName}>WTW</span>
      </div>
      {favorites && (
        <p className={styles.calibratedLine}>
          <span className={styles.calibratedDot} />
          Calibrated from <em>{favorites}</em>
        </p>
      )}
      <div className={styles.chips}>
        {suggestions.map((s, i) => (
          <button
            key={i}
            className={styles.chip}
            onClick={() => onSuggest(s)}
            style={{ animationDelay: `${0.2 + i * 0.07}s` }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────
function UserMessage({ text }: { text: string }) {
  return (
    <div className={`${styles.msgRow} ${styles.msgRowRight}`}>
      <div className={styles.bubbleUser}>{text}</div>
    </div>
  );
}

function AIMessage({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.msgRow} ${styles.msgRowLeft}`}>
      <div className={styles.aiMark}>
        {/* The glyph fills ~half of logo_vector.svg's square canvas, so the
            image is oversized and clipped by the round mark. */}
        <Image src="/logo_vector.svg" alt="wtw" width={35} height={35} />
      </div>
      <div className={styles.aiBody}>{children}</div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className={styles.typing}>
      <span />
      <span />
      <span />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Input bar
// ─────────────────────────────────────────────────────────────
/** Stages a standalone route may link into with ?stage=… (see AppMenu). */
const DEEP_LINK_STAGES: readonly Stage[] = [
  "recommendations",
  "watchlist",
  "learning",
  "ratings",
];

type Stage =
  | "intro"
  | "onboard"
  | "welcome"
  | "conversation"
  | "recommendations"
  | "watchlist"
  | "learning"
  | "ratings";

// The home screen's destinations (2026-10-20): Picks, Watchlist and Games,
// always on screen, each in its own gradient. The chat moved to the header.
function HomeNav({
  onRecommend,
  onWatchlist,
  onGames,
  watchlistN,
}: {
  onRecommend: () => void;
  onWatchlist: () => void;
  onGames: () => void;
  watchlistN: number;
}) {
  return (
    <nav className={styles.circleRow} aria-label="Home">
      <div className={styles.circleItem}>
        <button
          type="button"
          className={`${styles.circleBtn} ${styles.circleBtnRecs}`}
          onClick={onRecommend}
          aria-label="Picks for you"
        >
          {I.sparkle}
        </button>
        <span className={styles.circleLabel}>Picks</span>
      </div>
      <div className={styles.circleItem}>
        <button
          type="button"
          className={`${styles.circleBtn} ${styles.circleBtnWatchlist}`}
          onClick={onWatchlist}
          aria-label={watchlistN > 0 ? `Watchlist, ${watchlistN} saved` : "Watchlist"}
        >
          {I.bookmark}
          {watchlistN > 0 && <span className={styles.circleBadge}>{watchlistN}</span>}
        </button>
        <span className={styles.circleLabel}>Watchlist</span>
      </div>
      <div className={styles.circleItem}>
        <button
          type="button"
          className={`${styles.circleBtn} ${styles.circleBtnGames}`}
          onClick={onGames}
          aria-label="Games"
        >
          {I.games}
        </button>
        <span className={styles.circleLabel}>Games</span>
      </div>
    </nav>
  );
}

function InputBar({
  value,
  setValue,
  onSend,
  onLive,
}: {
  value: string;
  setValue: (s: string) => void;
  onSend: (s: string) => void;
  onLive: () => void;
}) {
  function submit() {
    const v = value.trim();
    if (!v) return;
    onSend(v);
    setValue("");
  }
  function handleLiveBtn() {
    if (value.trim()) submit();
    else onLive();
  }
  return (
    <div className={styles.inputbarWrap}>
      <div className={styles.inputbar}>
        <input
          className={styles.inputfield}
          placeholder="Speak or type"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          className={styles.liveBtn}
          onClick={handleLiveBtn}
          aria-label={value.trim() ? "send" : "start live session"}
        >
          {I.speak}
        </button>
      </div>
      <p className={styles.inputHint}>You can always skip a question</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main app
// ─────────────────────────────────────────────────────────────
export default function WTWApp({
  user,
  conversation,
  welcome,
  calibrationNudge = false,
}: {
  user: AppUser;
  conversation: Conversation;
  welcome: Welcome;
  /** Skipped the taste games part-way: the feed nudges them back now and then. */
  calibrationNudge?: boolean;
}) {
  const router = useRouter();
  // Every login (and every reload) lands on the welcome/continue screen,
  // not directly inside the chat. The chat is still one tap away (via the
  // message icon in the top-left when there's history) and the Onboard
  // component shows the AI's last question as its prompt so the user
  // sees continuity.
  // A brand-new user (nothing said yet, no mature greeting to show) starts
  // inside the chat with the intro already on screen — no onboard shell.
  const isNewUser = conversation.messages.length === 0 && !welcome.greeting;
  const [stage, setStage] = useState<Stage>(isNewUser ? "intro" : "onboard");
  // A standalone route (e.g. /profile/dna) links back into a stage with
  // ?stage=… — the menu there can't call these handlers directly. Read it
  // once on mount and strip it so a refresh doesn't re-enter the stage.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("stage");
    if (s && DEEP_LINK_STAGES.includes(s as Stage)) setStage(s as Stage);
    // ?from=play only tells the server not to send the player back to the games.
    if (s || q.has("from")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const [favorites, setFavorites] = useState(conversation.favorites);
  const [input, setInput] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voicePrimer, setVoicePrimer] = useState<string | null>(null);
  const [contentType, setContentType] = useState<ContentType>("movies");
  const [voice, setVoice] = useState<Voice>(DEFAULT_VOICE);
  // Whether the user has done anything this page-load. Once they have,
  // the greeting yields to "continue: <last AI question>" so we don't
  // re-greet mid-flow. Reset only by a page reload.
  const [hasInteracted, setHasInteracted] = useState(false);
  // While the fingerprint is being built + recs generated (on the way into
  // the recommendations view), we show a brief building state.
  const [buildingRecs, setBuildingRecs] = useState(false);
  // Saved-card count, for the home circle + its badge. Re-read on every stage
  // change so returning from the watchlist reflects what just left it.
  const [watchlistN, setWatchlistN] = useState(0);
  // Titles watched 48hr+ ago that haven't had their check-in yet. Read once per
  // page load; the queue is filled when a title is rated off the watchlist.
  const [regretChecks, setRegretChecks] = useState<RegretEntry[]>([]);

  // Hydrate Movies/Series + voice from localStorage after mount. SSR-safe
  // (window check happens only here). Brief race on first paint is fine.
  useEffect(() => {
    const c = window.localStorage.getItem("wtw:contentType");
    if (isContentType(c)) setContentType(c);
    const v = window.localStorage.getItem("wtw:voice");
    if (isVoice(v)) setVoice(v);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("wtw:contentType", contentType);
  }, [contentType]);

  useEffect(() => {
    window.localStorage.setItem("wtw:voice", voice);
  }, [voice]);

  useEffect(() => {
    setWatchlistN(watchlistCount());
  }, [stage]);

  // Pull the account's watchlist (and upload this device's, the first time) so
  // it matches whatever was saved on other devices.
  useEffect(() => {
    const refresh = () => setWatchlistN(watchlistCount());
    window.addEventListener(WATCHLIST_HYDRATED_EVENT, refresh);
    void hydrateWatchlist(user.id);
    return () => window.removeEventListener(WATCHLIST_HYDRATED_EVENT, refresh);
  }, [user.id]);

  useEffect(() => {
    setRegretChecks(getPendingRegretChecks());
  }, []);

  // Fetch Taste DNA's loading state ahead of time, so opening it shows the
  // loader the instant it's tapped instead of after a round trip.
  useEffect(() => {
    router.prefetch("/profile/dna");
  }, [router]);

  // Warm-up on load: bootstrap the DNA row (idempotent), then pre-generate
  // recommendations in the background. POST /generate returns the cached set
  // when it's still fresh (cheap no-op) and otherwise runs the pipeline and
  // caches — so by the time the user taps the rec pill, results are ready
  // and the tap is instant. handleRecommend awaits warmPromiseRef only when
  // the warm-up hasn't finished yet.
  const warmDoneRef = useRef(false);
  const warmPromiseRef = useRef<Promise<void>>(Promise.resolve());
  // Whether the user added chat/voice content THIS page-load — only then does
  // "Recommend" need the full session-end (transcript analysis) path.
  const chattedThisLoadRef = useRef(false);

  useEffect(() => {
    warmPromiseRef.current = (async () => {
      try {
        await fetchWithTimeout("/api/dna/bootstrap", { method: "POST" });
      } catch {} // idempotent; a failure/timeout just means the old cold path
      try {
        await fetchWithTimeout("/api/recommendations/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Warm the list the user will actually open — batches are cached
          // per content type ('all' is the "Both" list).
          // Read storage directly: this effect runs on mount, before the
          // effect that hydrates `contentType` from the same key.
          body: JSON.stringify({
            content_type: (() => {
              const c = window.localStorage.getItem("wtw:contentType");
              return isContentType(c) ? c : "movies";
            })(),
          }),
        });
      } catch {}
      warmDoneRef.current = true;
    })();
  }, []);

  // Created once: the conversation id and router are fixed for this mount.
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/conversation/message",
        body: { conversation_id: conversation.id },
        // Intercept 401 at the fetch layer (the HTTP status is unambiguous here,
        // whereas useChat's onError only sees the response body text). The
        // server returns 401 when the Supabase session has expired — bounce to
        // /login so the user can re-auth instead of hitting a dead chat.
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          if (res.status === 401) router.replace("/login");
          return res;
        },
      }),
  );
  const { messages, sendMessage, setMessages, status, error, regenerate } = useChat({
    transport,
    messages: conversation.messages.map((m) => textMessage(m.id, m.role, m.content)),
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  // Taste DNA is its own route and renders on the server first; cover the
  // screen with a loader the moment it's tapped so the tap visibly registers.
  const [leaving, setLeaving] = useState<string | null>(null);
  function leaveTo(href: string, label = "Loading") {
    setLeaving(label);
    router.push(href);
  }
  function openProfile() {
    leaveTo("/profile/dna", "Reading your Taste DNA");
  }
  // If the navigation never lands (offline, a server error), don't trap the
  // user under the loader: give the screen back after a while.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), LEAVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function handleSubmit(text: string) {
    // Only the OLD onboard flow persists favorites: there the first thing a
    // user typed was a list of films. New accounts come through the intro
    // instead, where the first reply is "yes" to "Shall we begin?" — not a
    // taste signal, so it is deliberately not written to conversations.favorites.
    const isFirstOnboard = stage === "onboard" && messages.length === 0;
    const nextStage: Stage = "conversation";

    setHasInteracted(true);
    chattedThisLoadRef.current = true; // new transcript content → next Recommend needs session-end
    if (isFirstOnboard) setFavorites(text);
    setStage(nextStage);

    const body = isFirstOnboard
      ? { stage: nextStage, favorites: text }
      : undefined;

    void sendMessage({ text }, body ? { body } : undefined);
  }

  // Asking for recommendations is the end of a "session": build the
  // fingerprint from the conversation so far and generate fresh recs
  // (cached server-side), then open the view — which now reads live recs
  // instead of mocks. If it fails, we still open the view (it falls back
  // to mocks) so the user is never blocked.
  // Runs the session-end pipeline: fingerprint rebuild + fresh rec generation
  // (cached server-side at the new taste_version). Shared by the initial
  // "Recommend" entry and the in-list "Find More" refresh.
  async function endSessionAndGenerate(opts?: { skipTranscript?: boolean }) {
    // Watchlist saves ride along on this request rather than posting their own —
    // saving a card is supposed to cost zero extra calls.
    const savedIds = getUnsyncedIds();
    // Unsaves ride along too: saved titles are excluded from the feed, so the
    // fingerprint has to hear about a removal for the title to come back.
    const unsavedIds = getUnsyncedRemovals();
    try {
      const res = await fetchWithTimeout("/api/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversation.id,
          // "Find more": chat didn't change while rating cards — skip the
          // slow transcript re-analysis; per-click merges did the rest.
          skip_transcript: opts?.skipTranscript ?? false,
          // Which list to regenerate — batches are built per content type.
          content_type: contentType,
          watchlist_added: savedIds,
          watchlist_removed: unsavedIds,
        }),
      });
      // fetch() resolves (doesn't throw) on 4xx/5xx — surface those so a failed
      // fingerprint/rec build is visible in logs rather than silently opening
      // the view to mocks. UX intent is still "never blocked", so we don't
      // interrupt the user; we just log.
      if (!res.ok) {
        console.error(`[session/end] HTTP ${res.status}`, await res.text().catch(() => ""));
      } else {
        // A 200 can still carry a failure: the fingerprint was updated but the
        // transcript was never read (extraction down). Logging it here is the
        // difference between noticing in an hour and noticing in two days.
        const body = await res.json().catch(() => null);
        if (body?.warning) console.error("[session/end]", body.warning);
        // Only clear the pending flags once the server confirms the intent
        // write landed (watchlist_synced: true). A failed call, a 200 whose
        // watchlist write failed, or a 200 with no readable body leaves them
        // queued for the next session end — re-sending a save is idempotent,
        // dropping one was permanent.
        if (body?.watchlist_synced === true) {
          markSynced(savedIds);
          markRemovalsSynced(unsavedIds);
        } else {
          console.error("[session/end] watchlist intent not confirmed; will retry next session end");
        }
      }
    } catch (e) {
      console.error("[session/end] failed", e);
    }
  }

  async function handleRecommend() {
    setVoiceOpen(false);

    // Nothing new said this page-load → nothing to analyze. Serve the
    // warm-up's pre-generated recs: instant when it finished, a short loader
    // if it's still running. Never falls back to mocks.
    if (!chattedThisLoadRef.current) {
      if (warmDoneRef.current) {
        setStage("recommendations");
        return;
      }
      setBuildingRecs(true);
      try {
        await warmPromiseRef.current;
      } finally {
        setBuildingRecs(false);
        setStage("recommendations");
      }
      return;
    }

    // New chat/voice content → full session-end (analyze + merge + generate).
    setBuildingRecs(true);
    try {
      await endSessionAndGenerate();
      chattedThisLoadRef.current = false; // transcript consumed — next tap is instant
    } finally {
      setBuildingRecs(false);
      setStage("recommendations");
    }
  }

  // Leaving the cards behind is the moment to report what got saved. Without
  // this, the most ordinary flow — open Recommendations, save a few, go back,
  // never chat and never tap "Find more" — left every save stuck locally,
  // because endSessionAndGenerate was only reachable from those two paths.
  // Fire-and-forget: the route records the intent before its no-op fast path, so
  // this is a read + write and an early return, and the user isn't waiting on it.
  function leaveCards() {
    if (getUnsyncedIds().length > 0 || getUnsyncedRemovals().length > 0) {
      void endSessionAndGenerate({ skipTranscript: true });
    }
    setStage("onboard");
  }

  function handleWatchlist() {
    setVoiceOpen(false);
    setStage("watchlist");
  }

  // The menu's "Play" and the home screen's Games button both open the games
  // (2026-10-21). The old rating feed ("learning") stays reachable by ?stage=.
  function openGames() {
    setVoiceOpen(false);
    leaveTo("/play?tab=games");
  }
  const handleFastLearning = openGames;

  function handleRatings() {
    setVoiceOpen(false);
    setStage("ratings");
  }

  const assistantTurns = messages.filter((m) => m.role === "assistant").length;
  // Mature users see the rec pill from the start (the server-side signals
  // count says they have enough fingerprint to act on). Cold users still
  // need to get through a couple of turns first.
  const showRecommend =
    !!welcome.greeting || assistantTurns >= RECOMMEND_AFTER_TURNS;
  const matureGreeting =
    welcome.greeting && !hasInteracted ? welcome.greeting : undefined;

  // "Back" keeps the chat — just returns the user to the onboard shell.
  // The onboard prompt swaps to "Let's continue: …" because there are
  // existing messages. Doesn't persist to DB (stage flip is local-only;
  // a reload lands them back in conversation view).
  function backToOnboard() {
    setStage("onboard");
    setInput("");
  }

  function leaveVoiceToHome() {
    setVoiceOpen(false);
    setVoicePrimer(null);
    backToOnboard();
  }

  // Voice mode hands us one completed turn at a time — user's transcribed
  // input + AI's transcribed output. We mirror it into the local chat so
  // it shows up next to text messages, and persist to the same table as
  // text via /api/voice/transcript.
  function handleVoiceTurn(userText: string, assistantText: string) {
    // Functional updater — two voice turns landing back-to-back (primer +
    // first user reply) would otherwise both close over the same stale
    // `messages` snapshot and the second call would clobber the first.
    setMessages((prev) => [
      ...prev,
      ...(userText ? [textMessage(crypto.randomUUID(), "user", userText)] : []),
      ...(assistantText ? [textMessage(crypto.randomUUID(), "assistant", assistantText)] : []),
    ]);

    // First voice turn from onboard flips stage like the text path does.
    const wasOnboard = stage === "onboard";
    if (wasOnboard) setStage("conversation");
    chattedThisLoadRef.current = true; // voice content also feeds the transcript

    void fetch("/api/voice/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversation.id,
        user_content: userText || undefined,
        assistant_content: assistantText || undefined,
        stage: wasOnboard ? "conversation" : undefined,
      }),
    }).catch((e) => {
      console.error("[voice] persist failed", e);
    });
  }

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status, stage]);

  // The app menu, for the stages that render their own header (they place it
  // at the far right of it — see AppMenu). TopBar builds its own.
  const appMenu = (
    <AppMenu
      onRecommend={handleRecommend}
      onWatchlist={handleWatchlist}
      onFastLearning={handleFastLearning}
      onRatings={handleRatings}
      onProfile={openProfile}
      user={user}
      onSignOut={signOut}
      voice={voice}
      setVoice={setVoice}
    />
  );

  return (
    <AppShell>
      {buildingRecs ? (
        <div className={styles.shell}>
          <div className={styles.readingTaste}>
            <p className={styles.readingTasteTitle}>Reading your taste</p>
            <p className={styles.readingTasteBody}>
              Updating your fingerprint and finding matches from what you&rsquo;ve told me
            </p>
            {/* Figma 160 → 66px. */}
            <FingerprintLoader size={66} />
          </div>
        </div>
      ) : stage === "intro" ? (
        <IntroVoice
          text={GAMES_INTRO_MESSAGE}
          src={GAMES_INTRO_AUDIO_SRC}
          // The first thing a new user does is play (2026-10-20), not chat.
          // ?heard=1: the games don't play the intro a second time.
          onPlay={() => leaveTo("/play?heard=1")}
        />
      ) : voiceOpen ? (
        <VoiceMode
          header={
            <TopBar
              hasConversation
              onBack={leaveVoiceToHome}
              onOpenChat={() => {}}
              onRecommend={handleRecommend}
              onWatchlist={handleWatchlist}
              onFastLearning={handleFastLearning}
              onRatings={handleRatings}
              onProfile={openProfile}
              user={user}
              onSignOut={signOut}
              contentType={contentType}
              setContentType={setContentType}
              voice={voice}
              setVoice={setVoice}
            />
          }
          onExit={() => {
            setVoiceOpen(false);
            setVoicePrimer(null);
          }}
          onBack={leaveVoiceToHome}
          onBackToChat={() => {
            // Voice failed/closed → recover into the text chat log so the user
            // can keep going by typing, instead of being dumped on the home
            // screen with no obvious way back into the conversation.
            setVoiceOpen(false);
            setVoicePrimer(null);
            setStage("conversation");
          }}
          onTurnComplete={handleVoiceTurn}
          onRecommend={handleRecommend}
          recommendVisible={showRecommend}
          voice={voice}
          primer={voicePrimer}
        />
      ) : stage === "recommendations" ? (
        <div className={styles.shell}>
          <RecommendationsView
            onBack={leaveCards}
            contentType={contentType}
            mode="recommendations"
            setContentType={setContentType}
            onFindMore={() => endSessionAndGenerate({ skipTranscript: true })}
            headerRight={appMenu}
            onCalibrate={calibrationNudge ? () => leaveTo("/play") : undefined}
          />
        </div>
      ) : stage === "watchlist" ? (
        <div className={styles.shell}>
          <RecommendationsView
            onBack={leaveCards}
            contentType={contentType}
            mode="watchlist"
            onBrowse={handleRecommend}
            headerRight={appMenu}
          />
        </div>
      ) : stage === "learning" ? (
        <div className={styles.shell}>
          <RecommendationsView
            onBack={() => setStage("onboard")}
            contentType={contentType}
            mode="learning"
            setContentType={setContentType}
            headerRight={appMenu}
          />
        </div>
      ) : stage === "ratings" ? (
        <div className={styles.shell}>
          <RatingsView onBack={() => setStage("onboard")} contentType={contentType} headerRight={appMenu} />
        </div>
      ) : (
        <div className={styles.shell}>
          <TopBar
            hasConversation={stage === "conversation"}
            onBack={backToOnboard}
            onOpenChat={() => setStage("conversation")}
            onRecommend={handleRecommend}
            onWatchlist={handleWatchlist}
            onFastLearning={handleFastLearning}
            onRatings={handleRatings}
            onProfile={openProfile}
            user={user}
            onSignOut={signOut}
            contentType={contentType}
            setContentType={setContentType}
            voice={voice}
            setVoice={setVoice}
          />

          <div className={styles.scroll} ref={scrollRef}>
            {stage === "onboard" && (
              <Onboard
                continuePrompt={
                  textOf(messages.findLast((m) => m.role === "assistant"))
                }
                matureGreeting={matureGreeting}
                onPlayVoice={(primer) => {
                  setVoicePrimer(primer);
                  setVoiceOpen(true);
                }}
              />
            )}
            {stage === "welcome" && (
              <Welcome favorites={favorites} onSuggest={(s) => handleSubmit(s)} />
            )}
            {stage === "conversation" && (
              <div className={styles.messages}>
                {messages.map((m) =>
                  m.role === "user" ? (
                    <UserMessage key={m.id} text={textOf(m)} />
                  ) : (
                    <AIMessage key={m.id}>
                      <div className={styles.aiIntro}>{textOf(m)}</div>
                    </AIMessage>
                  ),
                )}
                {status === "submitted" && (
                  <AIMessage>
                    <TypingDots />
                  </AIMessage>
                )}
                {error && !/401|unauthorized/i.test(error.message) && (
                  <div className={styles.chatError} role="alert">
                    <span>Couldn&rsquo;t reach the model.</span>
                    <button
                      type="button"
                      className={styles.chatErrorBtn}
                      onClick={() => void regenerate()}
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 48-hour check-in, one at a time so the home screen never stacks
              cards. Only on the onboard view: it's where every session lands, and
              a time-sensitive prompt buried in a scrolling feed gets missed.
              RegretPrompt marks the queue entry itself; we just drop it from
              state once its confirmation has played. */}
          {stage === "onboard" && regretChecks[0] && (
            <div className={styles.regretBar}>
              <RegretPrompt
                key={`${regretChecks[0].type}:${regretChecks[0].tmdb_id}`}
                entry={regretChecks[0]}
                onDone={(done) =>
                  setRegretChecks((prev) =>
                    prev.filter(
                      (e) => !(e.tmdb_id === done.tmdb_id && e.type === done.type),
                    ),
                  )
                }
              />
            </div>
          )}

          {stage === "conversation" ? (
            <>
              {showRecommend && (
                <div className={styles.recommendBar}>
                  <RecommendPill onClick={handleRecommend} />
                </div>
              )}
              <InputBar
                value={input}
                setValue={setInput}
                onSend={handleSubmit}
                onLive={() => {
                  setVoicePrimer(null);
                  setVoiceOpen(true);
                }}
              />
            </>
          ) : (
            // No input bar here any more: the chat is the header's icon.
            <div className={styles.homeNavBar}>
              <HomeNav
                onRecommend={handleRecommend}
                onWatchlist={handleWatchlist}
                onGames={openGames}
                watchlistN={watchlistN}
              />
            </div>
          )}
        </div>
      )}
      {leaving && <RouteLoading label={leaving} overlay />}
    </AppShell>
  );
}
