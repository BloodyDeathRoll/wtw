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
import VoiceMode from "../voice/VoiceMode";
import type { AppUser } from "../types";
import styles from "./WTWApp.module.css";

// ─────────────────────────────────────────────────────────────
// Mock data — bespoke poster tiles (no external assets)
// ─────────────────────────────────────────────────────────────
type MotifKind = "spades" | "circle" | "star" | "cross" | "dot" | "wave";

interface Poster {
  title: string;
  palette: [string, string];
  motif: MotifKind;
  year: string;
  meta: string;
  rating: string;
  where: string;
}

const POSTERS: Record<string, Poster> = {
  pokerFace: {
    title: "Poker Face",
    palette: ["#2A1810", "#E8C547"],
    motif: "spades",
    year: "2023",
    meta: "10 ep · S1",
    rating: "8.0",
    where: "Peacock",
  },
  badSisters: {
    title: "Bad Sisters",
    palette: ["#1B2A28", "#C7B8FF"],
    motif: "circle",
    year: "2022",
    meta: "10 ep · S1",
    rating: "8.3",
    where: "Apple TV+",
  },
  loot: {
    title: "Loot",
    palette: ["#2D0F2E", "#FF7AB8"],
    motif: "star",
    year: "2022",
    meta: "20 ep · S1–2",
    rating: "7.4",
    where: "Apple TV+",
  },
  smiths: {
    title: "Mr & Mrs Smith",
    palette: ["#0F1620", "#7FB3FF"],
    motif: "cross",
    year: "2024",
    meta: "8 ep · S1",
    rating: "7.4",
    where: "Prime Video",
  },
  past: {
    title: "Past Lives",
    palette: ["#16242E", "#F5C9A6"],
    motif: "dot",
    year: "2023",
    meta: "1h 45m",
    rating: "7.9",
    where: "Paramount+",
  },
  banshees: {
    title: "The Banshees of Inisherin",
    palette: ["#1C2A1A", "#E9E2C8"],
    motif: "wave",
    year: "2022",
    meta: "1h 54m",
    rating: "7.7",
    where: "Disney+",
  },
};

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
  play: (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
      <path d="M7 4.5v15l13-7.5L7 4.5Z" />
    </svg>
  ),
  bookmark: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
    </svg>
  ),
  thumbs: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M7 22V11M2 13v7a2 2 0 0 0 2 2h3V11H4a2 2 0 0 0-2 2Zm5-2V8a3 3 0 0 1 3-3l1 5h6.5a2 2 0 0 1 2 2.3l-1.5 7a2 2 0 0 1-2 1.7H7" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Poster tile
// ─────────────────────────────────────────────────────────────
function Motif({ kind, fg }: { kind: MotifKind; fg: string }) {
  const style = { color: fg } as const;
  if (kind === "spades") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <path d="M50 30 C 30 60, 20 75, 35 90 C 42 97, 50 90, 50 80 C 50 90, 58 97, 65 90 C 80 75, 70 60, 50 30 Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "circle") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <circle cx="50" cy="68" r="40" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="50" cy="68" r="28" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="50" cy="68" r="16" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (kind === "star") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <path d="M50 25 L58 55 L88 55 L64 73 L72 103 L50 85 L28 103 L36 73 L12 55 L42 55 Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "cross") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <path d="M20 20 L80 80 M80 20 L20 80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M50 30 L50 100" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    );
  }
  if (kind === "dot") {
    return (
      <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
        <circle cx="50" cy="55" r="22" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={styles.posterMotif} style={style} viewBox="0 0 100 150" preserveAspectRatio="none">
      <path d="M0 70 Q 25 55, 50 70 T 100 70" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 85 Q 25 70, 50 85 T 100 85" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M0 100 Q 25 85, 50 100 T 100 100" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

function PosterTile({ poster, size = "md" }: { poster: Poster; size?: "sm" | "md" | "lg" }) {
  const [bg, fg] = poster.palette;
  const dims =
    size === "sm"
      ? { w: 72, h: 108, font: 13, pad: 8 }
      : size === "lg"
        ? { w: 132, h: 198, font: 19, pad: 12 }
        : { w: 104, h: 156, font: 16, pad: 10 };

  return (
    <div
      className={styles.poster}
      style={{
        width: dims.w,
        height: dims.h,
        background: bg,
        ["--p-pad" as string]: `${dims.pad}px`,
        ["--p-font" as string]: `${dims.font}px`,
      }}
    >
      <Motif kind={poster.motif} fg={fg} />
      <div className={styles.posterTitle} style={{ color: fg }}>
        {poster.title}
      </div>
      <div className={styles.posterYear} style={{ color: fg }}>
        {poster.year}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Top bar
// ─────────────────────────────────────────────────────────────
function TopBar({
  hasConversation,
  onBack,
  user,
  onSignOut,
}: {
  hasConversation: boolean;
  onBack: () => void;
  user: AppUser;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const initial =
    (user.name?.trim()[0] || user.email?.trim()[0] || "?").toUpperCase();

  return (
    <div className={styles.topbar}>
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
        <div className={styles.userMenuWrap} ref={menuRef}>
          <button
            className={styles.avatarBtn}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="account menu"
            aria-expanded={menuOpen}
            type="button"
          >
            {user.avatarUrl ? (
              <span
                className={styles.avatarImg}
                style={{ backgroundImage: `url(${user.avatarUrl})` }}
                role="img"
                aria-label={user.name ?? user.email ?? "account"}
              />
            ) : (
              <span className={styles.avatarInitial}>{initial}</span>
            )}
          </button>
          {menuOpen && (
            <div className={styles.userMenu} role="menu">
              <div className={styles.userMenuHeader}>
                <div className={styles.userMenuName}>
                  {user.name ?? "Signed in"}
                </div>
                {user.email && (
                  <div className={styles.userMenuEmail}>{user.email}</div>
                )}
              </div>
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
            </div>
          )}
        </div>
      )}
      <div className={styles.brand}>
        <button className={styles.brandModel} type="button">
          <span>Cinema</span>
          {I.chevDown}
        </button>
      </div>
      <span className={styles.topbarSpacer} aria-hidden="true" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Onboard / Welcome
// ─────────────────────────────────────────────────────────────
function Onboard() {
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
      <p className={styles.onboardHint}>
        Let&rsquo;s calibrate your taste: name a few of your all time favorite flicks.
      </p>
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

interface Rec {
  poster: Poster;
  match: number;
  why: string;
}

function RecCard({ rec, expanded }: { rec: Rec; expanded: boolean }) {
  return (
    <div className={`${styles.rec} ${expanded ? styles.recExp : ""}`}>
      <PosterTile poster={rec.poster} size={expanded ? "lg" : "md"} />
      <div className={styles.recBody}>
        <div className={styles.recHead}>
          <div className={styles.recTitle}>{rec.poster.title}</div>
          <div className={styles.recMatch}>
            <span className={styles.matchDot} />
            {rec.match}% match
          </div>
        </div>
        <div className={styles.recMeta}>
          <span>{rec.poster.year}</span>
          <span className={styles.recDot} />
          <span>{rec.poster.meta}</span>
          <span className={styles.recDot} />
          <span>★ {rec.poster.rating}</span>
        </div>
        <div className={styles.recWhy}>
          <span className={styles.whyEyebrow}>FINGERPRINT</span>
          <span>{rec.why}</span>
        </div>
        <div className={styles.recActions}>
          <button className={styles.btnWatch}>
            {I.play}
            <span>Watch on {rec.poster.where}</span>
          </button>
          <button className={styles.btnGhost} aria-label="save">
            {I.bookmark}
          </button>
          <button className={styles.btnGhost} aria-label="more like this">
            {I.thumbs}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Input bar
// ─────────────────────────────────────────────────────────────
type Stage = "onboard" | "welcome" | "conversation";

function InputBar({
  value,
  setValue,
  onSend,
  onLive,
  stage,
}: {
  value: string;
  setValue: (s: string) => void;
  onSend: (s: string) => void;
  onLive: () => void;
  stage: Stage;
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
  const placeholder =
    stage === "onboard"
      ? "Type your favorites…"
      : stage === "conversation"
        ? "Refine, or ask for more like the second one…"
        : "Ask wtw";
  return (
    <div className={styles.inputbarWrap}>
      <div className={styles.inputbar}>
        <input
          className={styles.inputfield}
          placeholder={placeholder}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main app
// ─────────────────────────────────────────────────────────────
export default function WTWApp({ user }: { user: AppUser }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("onboard");
  const [favorites, setFavorites] = useState("");
  const [input, setInput] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);

  const { messages, append, setMessages, status } = useChat({
    api: "/api/conversation/message",
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function handleSubmit(text: string) {
    if (stage === "onboard") setFavorites(text);
    setStage("conversation");
    void append({ role: "user", content: text });
  }

  function backToWelcome() {
    setStage(favorites ? "welcome" : "onboard");
    setMessages([]);
    setInput("");
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
          onExit={() => setVoiceOpen(false)}
          onRecommend={() => {
            setVoiceOpen(false);
            handleSubmit("Show me recommendations");
          }}
        />
      ) : (
        <div className={styles.shell}>
          <TopBar
            hasConversation={stage === "conversation"}
            onBack={backToWelcome}
            user={user}
            onSignOut={signOut}
          />

          <div className={styles.scroll} ref={scrollRef}>
            {stage === "onboard" && <Onboard />}
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
              </div>
            )}
          </div>

          <InputBar
            value={input}
            setValue={setInput}
            onSend={handleSubmit}
            onLive={() => setVoiceOpen(true)}
            stage={stage}
          />
        </div>
      )}
    </AppShell>
  );
}
