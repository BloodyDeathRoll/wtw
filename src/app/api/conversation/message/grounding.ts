/**
 * Grounding for the consultant chat (docs/plan/PLAN.md P3-3).
 *
 *   1. Every title the reply names (the model writes titles in *asterisks*)
 *      must be one we hold: in the person's own feed, watchlist or ratings, or
 *      a row in `titles`, found through the same search the Search screen uses.
 *   2. Every number and every capitalised name in the reply must come from our
 *      rows for those titles, from the briefing the model was given, or from
 *      what the person wrote. The model's memory is not a source.
 *
 * A sentence that fails either is dropped. Read-only, like the rest of this
 * folder. The approach (and the capitalised-name scan) follows the "Why it's a
 * match" fact-check in src/modules/engine/why/write-why.ts.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { searchTitles } from "@/lib/tmdb";
import { titleKey } from "@/lib/title-key";

/** Titles we already hold for this person: normalised title → "type:tmdb_id" keys. */
export type KnownTitles = Map<string, string[]>;

const MAX_TITLES = 8; // a reply is two to four sentences; more names than this are not looked up
const SEARCH_HITS = 5;
const CAST_NAMES = 12;

export const normTitle = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");

/** For comparing a name in the reply with our rows: "Sánchez-Gijón" is "Sanchez Gijon". */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015-]/g, " ").replace(/\s+/g, " ").trim();

/** The titles a reply names, as written. */
export function namedTitles(reply: string): string[] {
  return [...new Set([...reply.matchAll(/\*([^*\n]+)\*/g)].map((m) => m[1].trim()).filter(Boolean))];
}

interface TitleRow {
  title: string;
  type: "movie" | "tv";
  tmdb_id: string;
  release_year: number | null;
  runtime_minutes: number | null;
  genres: { name?: string }[] | null;
  crew: Record<string, { name?: string }[] | undefined> | null;
  synopsis: string | null;
  keywords: string[] | null;
  original_language: string | null;
  watch_providers: Record<string, string[]> | null;
}

export interface Resolution {
  /** Normalised names that are ours. */
  resolved: Set<string>;
  /** Our rows for the titles named, for the fact check and the retry. */
  rows: TitleRow[];
}

export async function resolveTitles(names: string[], known: KnownTitles): Promise<Resolution> {
  const keysByName = new Map<string, string[]>();
  await Promise.all(names.slice(0, MAX_TITLES).map(async (name) => {
    const n = normTitle(name);
    const mine = known.get(n);
    if (mine) return void keysByName.set(n, mine);
    try {
      const hits = await searchTitles(name.slice(0, 100), SEARCH_HITS);
      // The model's wording must be the title's own: "the one with the heist" finds something, and proves nothing.
      keysByName.set(n, hits.filter((h) => normTitle(h.title) === n).map((h) => titleKey(h.type, h.tmdb_id)));
    } catch (e) {
      console.error("[conversation] title search failed", e instanceof Error ? e.message : e);
      keysByName.set(n, []);
    }
  }));

  const wanted = new Set([...keysByName.values()].flat());
  const ids = [...new Set([...wanted].map((k) => k.split(":")[1]))];
  let rows: TitleRow[] = [];
  if (ids.length) {
    const { data, error } = await createServiceClient()
      .from("titles")
      .select("title, type, tmdb_id, release_year, runtime_minutes, genres, crew, synopsis, keywords, original_language, watch_providers")
      .in("tmdb_id", ids);
    if (error) throw new Error(error.message);
    // tmdb_id alone is not a title: a film and a series can share one.
    rows = ((data ?? []) as TitleRow[]).filter((r) => wanted.has(titleKey(r.type, r.tmdb_id)));
  }
  const have = new Set(rows.map((r) => titleKey(r.type, r.tmdb_id)));
  const resolved = new Set<string>();
  for (const [n, keys] of keysByName) if (known.has(n) || keys.some((k) => have.has(k))) resolved.add(n);
  return { resolved, rows };
}

const peopleOf = (r: TitleRow) => {
  const names = (role: string, max = 4) => (r.crew?.[role] ?? []).slice(0, max).map((p) => p.name).filter((x): x is string => !!x);
  return { directors: names("directors"), writers: names("writers"), cast: names("cast", CAST_NAMES), camera: names("cinematographers", 2) };
};
const genresOf = (r: TitleRow) => (r.genres ?? []).map((g) => g.name).filter((x): x is string => !!x);
const runtimeOf = (r: TitleRow) => {
  const m = r.runtime_minutes;
  if (!m) return "";
  return r.type === "tv" ? `about ${m} min an episode` : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m (${m} min)`;
};
const languageOf = (r: TitleRow) => {
  try {
    return r.original_language ? new Intl.DisplayNames(["en"], { type: "language" }).of(r.original_language) ?? "" : "";
  } catch {
    return "";
  }
};

/** What the model is given on a retry: the short, checkable facts. */
export function factsForModel(rows: TitleRow[]): string {
  return rows.map((r) => {
    const p = peopleOf(r);
    const parts = [
      runtimeOf(r),
      genresOf(r).join(", "),
      p.directors.length ? `directed by ${p.directors.join(", ")}` : "",
      p.cast.length ? `with ${p.cast.slice(0, 4).join(", ")}` : "",
      languageOf(r) && languageOf(r) !== "English" ? `in ${languageOf(r)}` : "",
    ].filter(Boolean);
    return `- ${r.title} (${r.type === "tv" ? "series" : "film"}${r.release_year ? `, ${r.release_year}` : ""}): ${parts.join("; ")}.`;
  }).join("\n");
}

/** Everything our rows say about the titles named: what a reply may repeat. */
export function factsHaystack(rows: TitleRow[]): string {
  return rows.map((r) => {
    const p = peopleOf(r);
    const m = r.runtime_minutes ?? 0;
    // "about 3 hours" for 2h 50m and "2 hours" for 2h 5m are both fair; 0 is not a fact.
    const hours = m >= 60 ? `${Math.floor(m / 60)} ${Math.round(m / 60)} ${m % 60}` : "";
    return [
      r.title, r.release_year ?? "", m || "", hours, genresOf(r).join(" "),
      ...p.directors, ...p.writers, ...p.cast, ...p.camera,
      r.synopsis ?? "", (r.keywords ?? []).join(" "), languageOf(r),
      Object.values(r.watch_providers ?? {}).flat().join(" "),
    ].join(" ");
  }).join(" ");
}

/** Words the chat may always use: its own name, the page it points to, and how people write genres. */
const ALWAYS = "wtw my taste tv sci-fi i ok";

/** A capitalised word is known as written, or as London is to Londoner. */
function knownWord(word: string, haystack: string): boolean {
  const w = norm(word).replace(/'s$/, "").replace(/s'$/, "s");
  if (haystack.includes(w)) return true;
  for (const suffix of ["ers", "er", "ians", "ian", "ans", "an", "es", "s"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4 && haystack.includes(w.slice(0, -suffix.length))) return true;
  }
  return false;
}

const JOINER = /^(of|the|in|on|a|de|la|von|van)$/;
const HOUR_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** What a small number counts when it is a claim about a title. */
const UNIT = "(?:h|hr|hrs|hours?|min|mins|minutes?|episodes?|seasons?|parts?)";
const COUNT_IN_WORDS = new RegExp(`\\b(${HOUR_WORDS.join("|")})(?:\\s+and\\s+a\\s+half)?[\\s\\u2010-\\u2015-]+${UNIT}\\b`, "gi");
const UNIT_AFTER = new RegExp(`^[\\s\\u2010-\\u2015-]*${UNIT}\\b`, "i");

function sentenceProblems(sentence: string, resolved: ReadonlySet<string>, haystack: string, numbers: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const t of namedTitles(sentence)) {
    if (!resolved.has(normTitle(t))) problems.push(`*${t}* is not a title in our catalogue`);
  }
  if ((sentence.match(/\*/g) ?? []).length % 2 === 1) problems.push("it has an unpaired asterisk");
  const plain = sentence.replace(/\*[^*\n]+\*/g, " ");

  // A number of two digits or more, or any number of hours, episodes or seasons, has to be ours.
  // (A lone small number is usually a count of the chat's own: "2 picks".)
  for (const m of plain.matchAll(/\d+/g)) {
    const n = m[0];
    const counted = UNIT_AFTER.test(plain.slice(m.index! + n.length));
    if ((n.length > 1 || counted) && !numbers.has(n)) problems.push(`it says "${n}", which is not in our facts`);
  }

  // "three hours" and "six-episode" are the same claims in words. Larger numbers in words are not read.
  for (const m of plain.matchAll(COUNT_IN_WORDS)) {
    const n = String(HOUR_WORDS.indexOf(m[1].toLowerCase()) + 1);
    if (!numbers.has(n)) problems.push(`it says "${m[0]}", which is not in our facts`);
  }

  // Names and places: any capitalised word, or run of them, must be in the
  // facts. A sentence's first word is capitalised anyway and is not checked alone.
  const tokens = plain.match(/[A-Za-zÀ-ÿ'’.-]+/g) ?? [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      const name = run.join(" ").replace(/[’']s$/i, "").replace(/(s)[’']$/i, "$1").replace(/[.]$/, "");
      const ok = haystack.includes(norm(name)) || run.filter((w) => !JOINER.test(w)).every((w) => knownWord(w, haystack));
      if (!ok) problems.push(`it mentions "${name}", which is not in our facts`);
    }
    run = [];
  };
  tokens.forEach((tok, i) => {
    if (/^I(['’](d|ll|m|ve))?$/.test(tok)) flush();
    else if (/^[A-ZÀ-Ý]/.test(tok) && i > 0) run.push(tok);
    else if (run.length && JOINER.test(tok) && /^[A-ZÀ-Ý]/.test(tokens[i + 1] ?? "")) run.push(tok);
    else flush();
  });
  flush();
  return problems;
}

export interface Checked {
  /** The sentences that passed, ready to show: no asterisks. '' when none passed. */
  kept: string;
  problems: string[];
}

/**
 * `allowed` is the text the model was given and what was said in the chat;
 * `rows` are ours for the titles the reply names.
 */
export function checkReply(reply: string, resolution: Resolution, allowed: string): Checked {
  const haystack = norm(`${allowed} ${factsHaystack(resolution.rows)} ${ALWAYS}`);
  const numbers = new Set(haystack.match(/\d+/g) ?? []);
  const kept: string[] = [];
  const problems: string[] = [];
  for (const sentence of reply.trim().split(/(?<=[.!?])\s+/).filter(Boolean)) {
    const found = sentenceProblems(sentence, resolution.resolved, haystack, numbers);
    if (found.length) problems.push(...found);
    else kept.push(sentence.replace(/\*/g, ""));
  }
  return { kept: kept.join(" "), problems: [...new Set(problems)] };
}
