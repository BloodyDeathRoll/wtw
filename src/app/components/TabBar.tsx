"use client";

// The bottom tab bar (NAV_TABS, Eran 2026-11-15; mocks in docs/prototypes/nav): For you · Watchlist · Games · You,
// in place of the ☰ menu and the home screen. Look A · White: the selected tab white, the rest grey; 56px tall (4px of it above the icons),
// near-black at 90% with no blur, so the screen shows through a touch.
//
// It sits inside AppShell (its `tabs` slot), over the bottom of the screen; AppShell sets --tabbar-space so a
// screen's scroller can leave room for it. Rules from the apps it copies (Spotify, YouTube, Instagram):
// - always on screen while you scroll; hidden while the keyboard is up (a text field has focus);
// - tapping the tab you're on scrolls that screen back to the top (on one of its inner pages, returns to it);
// - the Watchlist carries its count.
// Sheets and overlays sit above it (z-index 20 < the Why sheet, the genre sheet, search).

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Gamepad2, MessageCircle, Sparkles } from "lucide-react";
import { watchlistCount, WATCHLIST_CHANGED_EVENT, WATCHLIST_HYDRATED_EVENT } from "@/lib/watchlist";
import { forYouV3Enabled, navHistoryEnabled } from "@/lib/flags";
import { markInApp } from "@/modules/session/nav-history";
import { useTabPlace } from "@/modules/session/tab-place";
import type { AppUser } from "@/modules/session/types";
import { LEAVE_TIMEOUT_MS, RouteLoading } from "./RouteLoading";
import styles from "./TabBar.module.css";

export type Tab = "foryou" | "watchlist" | "games" | "you";

/** Where each tab lives. For you and Watchlist are stages of the home route, read once on its mount. */
export const TAB_HREF: Record<Tab, string> = {
  foryou: "/?stage=recommendations",
  watchlist: "/?stage=watchlist",
  games: "/play?tab=games",
  you: "/you",
};

/** Marks a screen's main scroller: tapping its tab again scrolls it to the top. */
export const TAB_SCROLL = { "data-tab-scroll": "" } as const;

/**
 * Ask WTW, the chat (Eran 2026-11-15): a chat bubble in the top-left corner of a tab, where the back arrow used to
 * be. The ☰ was the chat's only way in (Q5); under the tab bar this is.
 */
export function AskButton({ className, onClick }: { className: string; onClick: () => void }) {
  return (
    <button type="button" className={className} onClick={onClick} aria-label="Ask WTW">
      <MessageCircle size={30} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

const STROKE = 1.5;
const STROKE_ON = 1.9;

export function TabBar({
  active,
  user,
  onTab,
  atRoot = true,
  keepPlace = true,
}: {
  active: Tab;
  user: AppUser;
  /** False on a tab's inner page (My taste, Seen): tapping the tab then returns to the tab itself. */
  atRoot?: boolean;
  /**
   * A host that can switch to a tab itself (the home route's stages) handles it here and returns true;
   * anything else is a route change, with the loading screen the app shows on every other one.
   */
  onTab?: (tab: Tab) => boolean | void;
  /** False for the copy drawn over a loading screen: only the real bar keeps the screen's place (N2). */
  keepPlace?: boolean;
}) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  // N2 (NAV_HISTORY): each tab screen keeps its scroll place; an inner page (Seen, My taste, Account) has its own.
  // For you keeps its place only once FOR_YOU_V3 holds its list still (Eran, #357).
  const placeKey =
    !keepPlace || !navHistoryEnabled() || (active === "foryou" && !forYouV3Enabled())
      ? null
      : atRoot
        ? active
        : `${active}:${typeof window === "undefined" ? "" : window.location.pathname}`;
  useTabPlace(placeKey);
  const [typing, setTyping] = useState(false);
  const [leaving, setLeaving] = useState<Tab | null>(null);

  // A tab on its own route (Games, You): WTW has a screen in this browser tab now, so the home route opened from here
  // keeps the history under it (NAV_HISTORY, src/modules/session/nav-history.ts). The home route marks itself.
  useEffect(() => {
    if (!onTab) markInApp();
  }, [onTab]);

  useEffect(() => {
    const read = () => setCount(watchlistCount());
    read();
    window.addEventListener(WATCHLIST_CHANGED_EVENT, read);
    window.addEventListener(WATCHLIST_HYDRATED_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(WATCHLIST_CHANGED_EVENT, read);
      window.removeEventListener(WATCHLIST_HYDRATED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  // The keyboard covers the bottom of the screen; the bar steps aside while a text field has focus.
  useEffect(() => {
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const onIn = (e: FocusEvent) => { if (isField(e.target)) setTyping(true); };
    const onOut = (e: FocusEvent) => { if (isField(e.target)) setTyping(false); };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), LEAVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  function go(tab: Tab) {
    if (tab === active && atRoot) {
      document.querySelectorAll<HTMLElement>("[data-tab-scroll]").forEach((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
      return;
    }
    if (onTab?.(tab)) return;
    setLeaving(tab);
    router.push(TAB_HREF[tab]);
  }

  const initial = (user.name?.trim()[0] || user.email?.trim()[0] || "?").toUpperCase();
  const icon = (tab: Tab, on: boolean): ReactNode => {
    const sw = on ? STROKE_ON : STROKE;
    switch (tab) {
      case "foryou":
        return <Sparkles size={24} strokeWidth={sw} aria-hidden />;
      case "watchlist":
        return (
          <>
            <Bookmark size={24} strokeWidth={sw} aria-hidden />
            {count > 0 && <span className={styles.badge}>{count}</span>}
          </>
        );
      case "games":
        return <Gamepad2 size={24} strokeWidth={sw} aria-hidden />;
      case "you":
        return user.avatarUrl ? (
          // <img> + no-referrer: Google's avatar URLs reject requests carrying our origin (as in AppMenu).
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.avatar} src={user.avatarUrl} alt="" referrerPolicy="no-referrer" width={24} height={24} />
        ) : (
          <span className={styles.avatar}>{initial}</span>
        );
    }
  };
  const TABS: { tab: Tab; label: string }[] = [
    { tab: "foryou", label: "For you" },
    { tab: "watchlist", label: "Watchlist" },
    { tab: "games", label: "Games" },
    { tab: "you", label: "You" },
  ];
  const shown = leaving ?? active;

  return (
    <>
      <nav className={`${styles.bar} ${typing ? styles.away : ""}`} aria-label="Main">
        {TABS.map(({ tab, label }) => {
          const on = tab === shown;
          return (
            <button
              key={tab}
              type="button"
              className={`${styles.tab} ${on ? styles.on : ""}`}
              aria-current={tab === active ? "page" : undefined}
              aria-label={tab === "watchlist" && count > 0 ? `Watchlist, ${count} saved` : label}
              onClick={() => go(tab)}
            >
              <span className={styles.icon}>{icon(tab, on)}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      {leaving && <RouteLoading label="Loading" overlay tabs={<TabBar active={leaving} user={user} onTab={() => true} keepPlace={false} />} />}
    </>
  );
}
