/**
 * The one thing the consultant chat writes (docs/plan/PLAN.md P3-6; Q5, Eran
 * 2026-11-14): a title on the person's watchlist, when they asked for it in so
 * many words. Never the DNA, the rules or the feed. A chat save is a row in
 * `watchlist_entries` and nothing else: the "saved" mark a card's button
 * leaves in the fingerprint (it keeps the title out of the feed) is not set.
 *
 * Two things must agree before anything is saved. The person's own message
 * asks for it (`asksToSave`, plain pattern matching), and the model names the
 * title on an `ADD:` line (`splitAdds`). The title is then matched to our
 * catalogue as every title in a reply is (grounding.ts), and the app, not the
 * model, says what happened (`addTitles`).
 *
 * The write itself is the watchlist's own (`saveRows`). This is the only file
 * in this folder that may use it; tests/unit/chat-read-only.test.ts says so.
 */

import { loadSharedTitle } from "@/app/t/[key]/data";
import { saveRows, toRow } from "@/app/api/watchlist/store";
import { titleKey } from "@/lib/title-key";
import { CHAT_ADDED } from "@/lib/watchlist";
import type { createClient } from "@/lib/supabase/server";
import { normTitle, type Resolution } from "./grounding";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const MAX_ADDS = 3; // one turn; more titles than this are not added
const MAX_NAME_CHARS = 80;
const MAX_OPTIONS = 4;

/** The start of our own "which one?" line. */
export const WHICH_ONE = "There is more than one";
/** How our line about a title that was there already ends. */
const ALREADY = "is already on your watchlist.";

const ASK = /\b(?:add|save|bookmark|queue)\b|\bput\b[^.?!]*\b(?:watch\s?list|list|queue)\b|\bto (?:my|the) (?:watch\s?list|list)\b/i;

/**
 * Did the person ask for a save? In their latest message; or in the one before
 * it, when the chat answered that with a question ("which one?", ours or the
 * model's) and this is their answer. `lastReply` is the chat's message between
 * the two. An ask the chat already carried out is over: "Added Heat… Anything
 * else?" does not make the next message an ask.
 */
export function asksToSave(lastUser: string, lastReply = "", userBefore = ""): boolean {
  if (ASK.test(lastUser)) return true;
  const reply = lastReply.trim();
  const open = reply.includes(WHICH_ONE) || (reply.endsWith("?") && !reply.startsWith(`${CHAT_ADDED} `) && !reply.includes(ALREADY));
  return open && ASK.test(userBefore);
}

export interface Wanted {
  name: string;
  /** The year the model put after the title, to tell two of the same name apart. */
  year: number | null;
}

// The model is asked for a last line of its own, and often writes it at the
// end of its last sentence instead. Capitals only: "add: Heat" is the model's prose.
const ADD_LINE = /(?:^|(?<=\s))ADD:[ \t]*([^\n]*)/g;

/** A draft, split into what is shown and the titles its `ADD:` line asks for. */
export function splitAdds(draft: string): { text: string; wanted: Wanted[] } {
  const wanted: Wanted[] = [];
  const text = draft.replace(ADD_LINE, (_line, rest: string) => {
    for (const m of rest.matchAll(/\*([^*\n]+)\*(?:\s*\((\d{4})\))?/g)) {
      const name = m[1].trim();
      if (name && !wanted.some((w) => normTitle(w.name) === normTitle(name))) wanted.push({ name, year: m[2] ? Number(m[2]) : null });
    }
    return "";
  }).trim();
  return { text, wanted: wanted.slice(0, MAX_ADDS) };
}

// The model is told not to say a title was saved: the app says it. A sentence
// that says so anyway is dropped, on every turn: a claim nobody asked for is
// as false as one that was. Kept narrow, so "I put this ahead of the sequel"
// and "the ending is saved for the last act" stay.
const SAVE_CLAIMS = [
  /\bI(?:'ve| have)?\s+(?:just |now |already |also )?(?:added|saved)\b/i, // "I've added it", "I saved Heat"
  /\bI(?:'ll| will)\s+(?:add|save|put)\s+(?:it|that|them|this|those|both)\b/i, // "I'll add it now"
  /\bbeen (?:added|saved)\b/i,
  /\bnow on your (?:watch\s?list|list)\b/i,
];
const THE_LIST = /\b(?:watch\s?list|your list)\b/i;
// Only in a sentence about the list: "Done, added Heat to your watchlist", "I've put it on your list".
const SAVING = /\b(?:added|saved|adding|saving)\b|\bI(?:'ve| have|'ll| will)?\s+(?:just |now )?(?:add|put)\b/i;

/** The reply's sentences without any that say a title was, or will be, saved. */
export function dropSaveClaims(text: string): string {
  const claims = (s: string) => SAVE_CLAIMS.some((re) => re.test(s)) || (THE_LIST.test(s) && SAVING.test(s));
  return text.split(/(?<=[.!?])\s+/).filter((s) => s && !claims(s.replace(/’/g, "'"))).join(" ");
}

export interface Added {
  status: "saved" | "already" | "failed";
  /** "Dune (film, 2021)"; '' when the title's card could not be read. */
  label: string;
}

const kind = (type: unknown) => (type === "tv" ? "series" : "film");
const labelOf = (rec: { title?: unknown; type?: unknown; year?: unknown } | null | undefined) =>
  typeof rec?.title === "string" && rec.title.trim()
    ? `${rec.title.trim().slice(0, MAX_NAME_CHARS)} (${kind(rec.type)}${typeof rec.year === "number" && rec.year > 0 ? `, ${rec.year}` : ""})`
    : "";

/**
 * Saves one title, `key` being "type:tmdb_id". A title already on the list is
 * left as it is: a save over it would reset its date and its rating tag.
 */
export async function addToWatchlist(supabase: SupabaseClient, userId: string, key: string): Promise<Added> {
  try {
    const { data: there, error } = await supabase
      .from("watchlist_entries")
      .select("rec")
      .eq("user_id", userId)
      .eq("rec_id", key)
      .limit(1);
    if (error) throw new Error(error.message);
    const held = (there ?? []) as { rec: { title?: unknown; type?: unknown; year?: unknown } | null }[];
    if (held.length) return { status: "already", label: labelOf(held[0].rec) };

    // The card the Search screen saves: our row when we have one, in the watchlist's shape.
    const shared = await loadSharedTitle(key.replace(":", "-"));
    if (!shared) return { status: "failed", label: "" };
    const rec = { ...shared.rec, reason: shared.synopsis || "Added from the chat" };
    const row = toRow(userId, { rec, added_at: Date.now() });
    const failed = row ? await saveRows(supabase, userId, [row]) : { message: "the card is not a valid entry" };
    if (failed) throw new Error(failed.message);
    return { status: "saved", label: labelOf(rec) };
  } catch (e) {
    console.error("[conversation] watchlist add failed", e instanceof Error ? e.message : e);
    return { status: "failed", label: "" };
  }
}

const quoted = (name: string) => `"${name.replace(/["\s]+/g, " ").trim().slice(0, MAX_NAME_CHARS)}"`;
const listed = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export interface AddOutcome {
  /** What the app says happened, in full sentences. */
  said: string;
  /** Every title asked for is on the watchlist now (saved, or there already). */
  allThere: boolean;
}

/**
 * Adds the titles the model named, and says what happened. `resolution` is
 * those names matched to our catalogue; `add` saves one key. A name that is
 * not ours is not added, and a name with several titles behind it is asked
 * about, not guessed.
 */
export async function addTitles(wanted: Wanted[], resolution: Resolution, add: (key: string) => Promise<Added>): Promise<AddOutcome> {
  const saved: string[] = [];
  const lines: string[] = [];
  let allThere = true;
  for (const w of wanted) {
    const rowOf = (key: string) => resolution.rows.find((r) => titleKey(r.type, r.tmdb_id) === key);
    let keys = resolution.keys.get(normTitle(w.name)) ?? [];
    // Names are matched loosely ("Heat" is also "The Heat"). The title as it was written wins, then the year.
    const narrow = (fits: (key: string) => boolean) => {
      const fewer = keys.filter(fits);
      if (fewer.length) keys = fewer;
    };
    narrow((k) => rowOf(k)?.title.trim().toLowerCase() === w.name.toLowerCase());
    if (w.year) narrow((k) => rowOf(k)?.release_year === w.year);

    if (keys.length === 0) {
      allThere = false;
      lines.push(`I couldn't find ${quoted(w.name)} in our catalogue, so I didn't add it.`);
    } else if (keys.length > 1) {
      allThere = false;
      const options = keys.slice(0, MAX_OPTIONS).map((k) => {
        const row = rowOf(k);
        return labelOf(row ? { title: row.title, type: row.type, year: row.release_year } : null) || `a ${kind(k.split(":")[0])}`;
      });
      lines.push(`${WHICH_ONE} ${quoted(w.name)}: ${listed(options)}. Which one should I add?`);
    } else {
      const done = await add(keys[0]);
      const label = done.label || quoted(w.name);
      if (done.status === "saved") saved.push(label);
      else if (done.status === "already") lines.push(`${label} ${ALREADY}`);
      else {
        allThere = false;
        lines.push(`I couldn't add ${label} just now. You can add it from Search.`);
      }
    }
  }
  if (saved.length) lines.unshift(`${CHAT_ADDED} ${listed(saved)} to your watchlist.`);
  return { said: lines.join(" "), allThere };
}
