/**
 * Your recent searches (docs/plan/v3/SEARCH.md DEC-7, v3 Q3): the last few, newest first, kept on this phone only
 * (localStorage) and never sent to us. Storage off or broken: no list, and Search works as today.
 */
import { useSyncExternalStore } from "react";

const KEY = "wtw:recent-searches";
const CHANGED = "wtw:recent-searches-changed";
export const RECENT_MAX = 6;
const NONE: string[] = [];

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function parse(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return NONE;
    // Once each, whatever its case: a hand-edited or old value can't give two rows (or two React keys) for one search.
    const seenTerms = new Set<string>();
    const list: string[] = [];
    for (const s of v) {
      if (typeof s !== "string" || s.trim() === "" || seenTerms.has(s.toLowerCase())) continue;
      seenTerms.add(s.toLowerCase());
      list.push(s);
    }
    return list.slice(0, RECENT_MAX);
  } catch {
    return NONE;
  }
}
// The same array while the stored text is the same (useSyncExternalStore compares by reference).
let seen: { raw: string | null; list: string[] } = { raw: null, list: NONE };
function snapshot(): string[] {
  const raw = read();
  if (raw !== seen.raw) seen = { raw, list: parse(raw) };
  return seen.list;
}

export function recentSearches(): string[] {
  return snapshot();
}

/** A search made: to the top, once (case doesn't make a second one), at most RECENT_MAX. */
export function rememberSearch(q: string): void {
  const term = q.trim();
  if (term.length < 2) return;
  const next = [term, ...snapshot().filter((s) => s.toLowerCase() !== term.toLowerCase())].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage off: nothing kept, nothing breaks.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function clearRecentSearches(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage off.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The list, live; none on the server and when `on` is false (the flag off). */
export function useRecentSearches(on: boolean): string[] {
  return useSyncExternalStore(subscribe, on ? snapshot : () => NONE, () => NONE);
}
