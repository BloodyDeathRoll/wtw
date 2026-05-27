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
import { useChat } from "@ai-sdk/react";
import { createClient } from "@/lib/supabase/client";
import AppShell from "./AppShell";
import RecommendPill from "./RecommendPill";
import RecommendationsView from "../recommendations/RecommendationsView";
import VoiceMode from "../voice/VoiceMode";
import type { AppUser, Conversation, Welcome } from "../types";
import styles from "./WTWApp.module.css";

// How many completed AI replies before "See Recommendations" appears.
// Modality-agnostic — every assistant message counts (voice OR text).
const RECOMMEND_AFTER_TURNS = 2;

type ContentType = "movies" | "series";
const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  movies: "Movies",
  series: "Series",
};

// Gemini Live prebuilt voices. Display name === voice ID (constellations
// and mythology). Descriptors come from Google's own catalogue and give the
// user a hint of timbre before they pick.
const VOICES = [
  { id: "Aoede", desc: "Breezy" },
  { id: "Charon", desc: "Informative" },
  { id: "Fenrir", desc: "Excitable" },
  { id: "Kore", desc: "Firm" },
  { id: "Puck", desc: "Upbeat" },
  { id: "Zephyr", desc: "Bright" },
  { id: "Leda", desc: "Youthful" },
  { id: "Orus", desc: "Firm" },
  { id: "Callirrhoe", desc: "Easy-going" },
  { id: "Autonoe", desc: "Bright" },
  { id: "Enceladus", desc: "Breathy" },
  { id: "Iapetus", desc: "Clear" },
  { id: "Umbriel", desc: "Easy-going" },
  { id: "Algieba", desc: "Smooth" },
  { id: "Despina", desc: "Smooth" },
  { id: "Erinome", desc: "Clear" },
  { id: "Algenib", desc: "Gravelly" },
  { id: "Rasalgethi", desc: "Informative" },
  { id: "Laomedeia", desc: "Upbeat" },
  { id: "Achernar", desc: "Soft" },
  { id: "Alnilam", desc: "Firm" },
  { id: "Schedar", desc: "Even" },
  { id: "Gacrux", desc: "Mature" },
  { id: "Pulcherrima", desc: "Forward" },
  { id: "Achird", desc: "Friendly" },
  { id: "Zubenelgenubi", desc: "Casual" },
  { id: "Vindemiatrix", desc: "Gentle" },
  { id: "Sadachbia", desc: "Lively" },
  { id: "Sadaltager", desc: "Knowledgeable" },
  { id: "Sulafat", desc: "Warm" },
] as const;
type Voice = (typeof VOICES)[number]["id"];
const DEFAULT_VOICE: Voice = "Aoede";
const VOICE_IDS = VOICES.map((v) => v.id) as readonly string[];
const isVoice = (s: unknown): s is Voice =>
  typeof s === "string" && VOICE_IDS.includes(s);


// ─────────────────────────────────────────────────────────────
// Icons (Lucide-style, currentColor strokes)
// ─────────────────────────────────────────────────────────────
const I = {
  chevDown: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  liveBars: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <rect x="1.5" y="10.5" width="2" height="3" rx="1" />
      <rect x="4.5" y="7" width="2" height="10" rx="1" />
      <rect x="7.5" y="3.5" width="2" height="17" rx="1" />
      <rect x="10.5" y="9" width="2" height="6" rx="1" />
      <rect x="13.5" y="5" width="2" height="14" rx="1" />
      <rect x="16.5" y="8" width="2" height="8" rx="1" />
      <rect x="19.5" y="10.5" width="2" height="3" rx="1" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  hamburger: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  chevRight: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  message: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 18v3l4-3" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
};

const IconPlay = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7L8 5Z" />
  </svg>
);

const IconPause = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);


// ─────────────────────────────────────────────────────────────
// Top bar
// ─────────────────────────────────────────────────────────────
function TopBar({
  hasConversation,
  hasMessages,
  onBack,
  onOpenChat,
  onFastLearning,
  user,
  onSignOut,
  contentType,
  setContentType,
  voice,
  setVoice,
}: {
  hasConversation: boolean;
  hasMessages: boolean;
  onBack: () => void;
  onOpenChat: () => void;
  onFastLearning: () => void;
  user: AppUser;
  onSignOut: () => void;
  contentType: ContentType;
  setContentType: (c: ContentType) => void;
  voice: Voice;
  setVoice: (v: Voice) => void;
}) {
  const [brandOpen, setBrandOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"root" | "voice">("root");
  const [previewVoice, setPreviewVoice] = useState<string | null>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Static voice samples live in /public/voice-samples/{voice}.wav — see
  // scripts/generate-voice-samples.mjs. The browser caches them after
  // first load. No runtime API call (Gemini's free-tier TTS quota is too
  // tight to allow on-demand previews).
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function playSample(voiceId: string) {
    if (previewVoice === voiceId) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewVoice(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPreviewVoice(voiceId);
    try {
      const audio = new Audio(`/voice-samples/${voiceId}.wav`);
      audio.onended = () => {
        audioRef.current = null;
        setPreviewVoice(null);
      };
      audio.onerror = () => {
        // Sample hasn't been generated yet — fail quietly.
        audioRef.current = null;
        setPreviewVoice(null);
      };
      audioRef.current = audio;
      await audio.play();
    } catch (e) {
      console.error("[voice/sample] play failed", e);
      audioRef.current = null;
      setPreviewVoice(null);
    }
  }

  // Stop any running preview when the menu closes.
  useEffect(() => {
    if (!menuOpen) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewVoice(null);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!brandOpen && !menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (brandOpen && !brandRef.current?.contains(t)) {
        setBrandOpen(false);
      }
      if (
        menuOpen &&
        !hamburgerRef.current?.contains(t) &&
        !panelRef.current?.contains(t)
      ) {
        setMenuOpen(false);
        setMenuView("root");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [brandOpen, menuOpen]);

  const initial =
    (user.name?.trim()[0] || user.email?.trim()[0] || "?").toUpperCase();

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
        ) : hasMessages ? (
          <button
            className={styles.iconbtn}
            onClick={onOpenChat}
            aria-label="open chat"
            type="button"
          >
            {I.message}
          </button>
        ) : null}
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

      <div className={styles.userMenuWrap}>
        <button
          ref={hamburgerRef}
          className={styles.hamburgerBtn}
          onClick={() => {
            setMenuOpen((v) => !v);
            setMenuView("root");
          }}
          aria-label={menuOpen ? "close menu" : "menu"}
          aria-expanded={menuOpen}
          type="button"
        >
          {menuOpen ? I.close : I.hamburger}
        </button>
      </div>

    </div>

    {menuOpen && (
      <div className={styles.userMenuOverlay}>
        <div className={styles.userMenuPanel} ref={panelRef} role="menu">
          {menuView === "root" ? (
            <>
              <div className={styles.userMenuHeader}>
                {user.avatarUrl ? (
                  // <img> + no-referrer is required for Google's
                  // lh3.googleusercontent.com avatar URLs to render —
                  // they reject requests carrying our origin as referer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={styles.userMenuAvatar}
                    src={user.avatarUrl}
                    alt={user.name ?? user.email ?? "account"}
                    referrerPolicy="no-referrer"
                    width={36}
                    height={36}
                  />
                ) : (
                  <span className={styles.userMenuAvatarInitial}>{initial}</span>
                )}
                <div className={styles.userMenuHeaderText}>
                  <div className={styles.userMenuName}>
                    {user.name ?? "Signed in"}
                  </div>
                  {user.email && (
                    <div className={styles.userMenuEmail}>{user.email}</div>
                  )}
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onFastLearning();
                }}
              >
                <span>Fast learning</span>
                <span className={styles.userMenuTrail}>{I.chevRight}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => setMenuView("voice")}
              >
                <span>Set voice</span>
                <span className={styles.userMenuTrail}>
                  {voice}
                  {I.chevRight}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.userMenuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className={styles.userMenuSubHeader}>
                <button
                  type="button"
                  className={styles.userMenuBackBtn}
                  onClick={() => setMenuView("root")}
                  aria-label="back to menu"
                >
                  {I.back}
                </button>
                <span className={styles.userMenuSubTitle}>Voice</span>
              </div>
              {VOICES.map((v) => (
                <div
                  key={v.id}
                  className={`${styles.voiceRow} ${
                    voice === v.id ? styles.voiceRowActive : ""
                  }`}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={voice === v.id}
                    className={styles.voiceSelect}
                    onClick={() => {
                      setVoice(v.id);
                      setMenuView("root");
                    }}
                  >
                    <span className={styles.voiceName}>{v.id}</span>
                    <span className={styles.voiceDesc}>{v.desc}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.voicePlay}
                    onClick={() => playSample(v.id)}
                    aria-label={`preview ${v.id}`}
                    // Disabled until /public/voice-samples/* is filled in
                    // (see scripts/generate-voice-samples.mjs).
                    disabled
                  >
                    {previewVoice === v.id ? IconPause : IconPlay}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    )}
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
    <div className={styles.welcome}>
      <div className={styles.welcomeLogoRow}>
        <Image
          src="/wtw-logo.svg"
          alt=""
          width={24}
          height={24}
          className={styles.welcomeLogo}
          priority
        />
        <span className={styles.welcomeLogoName}>WTW</span>
      </div>
      <p className={styles.onboardHint}>{hint}</p>
      {onPlayVoice && (
        <button
          type="button"
          className={styles.onboardPlayBtn}
          onClick={() => onPlayVoice(spoken)}
          aria-label="play message"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 5 6 9H2v6h4l5 4Z" />
            <path d="M16 9a4 4 0 0 1 0 6" />
          </svg>
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
          src="/wtw-logo.svg"
          alt=""
          width={24}
          height={24}
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
        <Image src="/wtw-logo.svg" alt="wtw" width={18} height={18} />
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
type Stage =
  | "onboard"
  | "welcome"
  | "conversation"
  | "recommendations"
  | "learning";

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
          placeholder="Type here"
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
          {I.liveBars}
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
}: {
  user: AppUser;
  conversation: Conversation;
  welcome: Welcome;
}) {
  const router = useRouter();
  // Every login (and every reload) lands on the welcome/continue screen,
  // not directly inside the chat. The chat is still one tap away (via the
  // message icon in the top-left when there's history) and the Onboard
  // component shows the AI's last question as its prompt so the user
  // sees continuity.
  const [stage, setStage] = useState<Stage>("onboard");
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

  // Hydrate Movies/Series + voice from localStorage after mount. SSR-safe
  // (window check happens only here). Brief race on first paint is fine.
  useEffect(() => {
    const c = window.localStorage.getItem("wtw:contentType");
    if (c === "movies" || c === "series") setContentType(c);
    const v = window.localStorage.getItem("wtw:voice");
    if (isVoice(v)) setVoice(v);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("wtw:contentType", contentType);
  }, [contentType]);

  useEffect(() => {
    window.localStorage.setItem("wtw:voice", voice);
  }, [voice]);

  const { messages, append, setMessages, status, error, reload } = useChat({
    api: "/api/conversation/message",
    initialMessages: conversation.messages,
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
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function handleSubmit(text: string) {
    // First-ever submit on this conversation: persist favorites + flip stage.
    // Subsequent submits just stream — server already knows the conversation.
    const isFirstOnboard = stage === "onboard" && messages.length === 0;
    const nextStage: Stage = "conversation";

    setHasInteracted(true);
    if (isFirstOnboard) setFavorites(text);
    setStage(nextStage);

    const body = isFirstOnboard
      ? { stage: nextStage, favorites: text }
      : undefined;

    void append(
      { role: "user", content: text },
      body ? { body } : undefined,
    );
  }

  function handleRecommend() {
    setVoiceOpen(false);
    setStage("recommendations");
  }

  function handleFastLearning() {
    setVoiceOpen(false);
    setStage("learning");
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
      ...(userText
        ? [
            {
              id: crypto.randomUUID(),
              role: "user" as const,
              content: userText,
            },
          ]
        : []),
      ...(assistantText
        ? [
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: assistantText,
            },
          ]
        : []),
    ]);

    // First voice turn from onboard flips stage like the text path does.
    const wasOnboard = stage === "onboard";
    if (wasOnboard) setStage("conversation");

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

  return (
    <AppShell>
      {voiceOpen ? (
        <VoiceMode
          onExit={() => {
            setVoiceOpen(false);
            setVoicePrimer(null);
          }}
          onBack={() => {
            setVoiceOpen(false);
            setVoicePrimer(null);
            backToOnboard();
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
            onBack={() => setStage("onboard")}
            contentType={contentType}
            mode="recommendations"
          />
        </div>
      ) : stage === "learning" ? (
        <div className={styles.shell}>
          <RecommendationsView
            onBack={() => setStage("onboard")}
            contentType={contentType}
            mode="learning"
          />
        </div>
      ) : (
        <div className={styles.shell}>
          <TopBar
            hasConversation={stage === "conversation"}
            hasMessages={messages.length > 0}
            onBack={backToOnboard}
            onOpenChat={() => setStage("conversation")}
            onFastLearning={handleFastLearning}
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
                  messages.findLast((m) => m.role === "assistant")?.content
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
                    <UserMessage key={m.id} text={m.content} />
                  ) : (
                    <AIMessage key={m.id}>
                      <div className={styles.aiIntro}>{m.content}</div>
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
                      onClick={() => void reload()}
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

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
        </div>
      )}
    </AppShell>
  );
}
