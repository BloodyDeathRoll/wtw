/**
 * Grounding for the consultant chat (docs/plan/PLAN.md P3-3).
 *
 *   1. Every title the reply names (the model writes titles in *asterisks*)
 *      must be one we hold: in the person's own feed, watchlist or ratings, or
 *      a row in `titles`, found through the same search the Search screen uses.
 *   2. Every number and every capitalised name in the reply must come from our
 *      rows for those titles, from the briefing the model was given, or from
 *      what the person wrote. The model's memory is not a source. Names are
 *      matched as whole words, and a name of two words or more as it stands in
 *      those facts: "Tom Hanks" is not known because a Tom and a Hanks are.
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

/** `searched` carries a turn's search results from the first draft to the second try. */
export async function resolveTitles(names: string[], known: KnownTitles, searched = new Map<string, string[]>()): Promise<Resolution> {
  const keysByName = new Map<string, string[]>();
  // *Heat* and *heat* are one title, looked up once.
  const asWritten = new Map<string, string>();
  for (const name of names) if (!asWritten.has(normTitle(name))) asWritten.set(normTitle(name), name);
  await Promise.all([...asWritten].slice(0, MAX_TITLES).map(async ([n, name]) => {
    const mine = known.get(n) ?? searched.get(n);
    if (mine) return void keysByName.set(n, mine);
    try {
      const hits = await searchTitles(name.slice(0, 100), SEARCH_HITS);
      // The model's wording must be the title's own: "the one with the heist" finds something, and proves nothing.
      searched.set(n, hits.filter((h) => normTitle(h.title) === n).map((h) => titleKey(h.type, h.tmdb_id)));
      keysByName.set(n, searched.get(n)!);
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
    // Without our rows only the person's own titles stand, and no year, running time or name
    // can be checked, so those sentences are cut: a shorter answer, never an unchecked one.
    if (error) console.error("[conversation] catalogue lookup failed", error.message);
    // tmdb_id alone is not a title: a film and a series can share one.
    else rows = ((data ?? []) as TitleRow[]).filter((r) => wanted.has(titleKey(r.type, r.tmdb_id)));
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

/** Everything our rows say about the titles named: what a reply may repeat. " | " ends a phrase. */
export function factsHaystack(rows: TitleRow[]): string {
  return rows.flatMap((r) => {
    const p = peopleOf(r);
    const m = r.runtime_minutes ?? 0;
    // "about 3 hours" for 2h 50m and "2 hours" for 2h 5m are both fair; 0 is not a fact.
    const hours = m >= 60 ? `${Math.floor(m / 60)} ${Math.round(m / 60)} ${m % 60}` : "";
    return [
      r.title, r.release_year ?? "", m || "", hours, ...genresOf(r),
      // "with" keeps a person's two names tied to each other (readFacts).
      ...[...p.directors, ...p.writers, ...p.cast, ...p.camera].map((name) => `with ${name}`),
      r.synopsis ?? "", ...(r.keywords ?? []), languageOf(r),
      ...Object.values(r.watch_providers ?? {}).flat(),
    ];
  }).join(" | ");
}

/** Words the chat may always use: its own name, the page it points to, and how people write genres. */
// "yes" and "no" are here for "Short answer: Yes, …": after a colon a capitalised word is read as a name.
const ALWAYS = "wtw | my taste | tv | sci-fi | i | ok | yes | no";

/** Text as words. "Sánchez-Gijón's" is "Sanchez Gijon"; "|" marks where a phrase ends. */
function tokens(s: string): string[] {
  const flat = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'").replace(/'s(?![\p{L}\p{N}])/giu, "")
    // A full stop ends a phrase after a word, not after "Mr." or an initial.
    .replace(/(?<=[\p{L}\p{N}]{4})\.(?=\s|$)/gu, " | ").replace(/\n|[^\p{L}\p{N}\s'.\u2010\u2011-]/gu, " | ");
  return flat.match(/[\p{L}\p{N}]+|\|/gu) ?? [];
}
const wordsOf = (s: string) => tokens(s).filter((t) => t !== "|").map((t) => t.toLowerCase());

/** The facts a reply is held to, read once per reply. */
interface Facts {
  /** Lower-case words in order, a space on each side, "|" between phrases. */
  text: string;
  words: Set<string>;
  /** Words that stand somewhere without a capitalised neighbour: "Korean", not the "Tom" of "Tom Cruise". */
  alone: Set<string>;
  numbers: Set<string>;
}

function readFacts(raw: string): Facts {
  const toks = tokens(raw);
  // A phrase's first word is capitalised anyway, so it does not tie its neighbour to it.
  const cap = (i: number) => i > 0 && i < toks.length && /^\p{Lu}/u.test(toks[i]) && toks[i - 1] !== "|";
  const alone = new Set<string>();
  toks.forEach((t, i) => {
    if (t !== "|" && !cap(i - 1) && !cap(i + 1)) alone.add(t.toLowerCase());
  });
  const lower = toks.map((t) => t.toLowerCase());
  return { text: ` ${lower.join(" ")} `, words: new Set(lower.filter((t) => t !== "|")), alone, numbers: new Set(raw.match(/\d+/g) ?? []) };
}

/** A word of ours, or one made from it as Londoner is from London. */
function knownWord(w: string, words: ReadonlySet<string>): boolean {
  if (words.has(w)) return true;
  for (const suffix of ["ers", "er", "ians", "ian", "ans", "an", "es", "s"]) {
    const stem = w.endsWith(suffix) ? w.slice(0, -suffix.length) : "";
    if (stem.length >= 4 && [...words].some((h) => h.startsWith(stem) && h.length <= stem.length + 2)) return true;
  }
  return false;
}

/**
 * A capitalised run is known when it can be read off the facts piece by piece:
 * each piece a phrase of ours of two words or more, or a single word that
 * stands alone in the facts. One capitalised word on its own only has to be a
 * word of ours ("Bong", "Nolan's").
 */
function knownName(name: string, facts: Facts): boolean {
  const w = wordsOf(name);
  if (w.length === 1) return knownWord(w[0], facts.words);
  for (let i = 0; i < w.length;) {
    let j = w.length;
    while (j - i >= 2 && !facts.text.includes(` ${w.slice(i, j).join(" ")} `)) j--;
    if (j - i >= 2) i = j;
    else if (JOINER.test(w[i]) || facts.alone.has(w[i]) || (!facts.words.has(w[i]) && knownWord(w[i], facts.words))) i++;
    else return false;
  }
  return true;
}

/** Everyday words that take a "'s" or a credit verb at the start of a sentence: "It's", "She plays", "Critics wrote". */
const SUBJECTS = new Set((
  "it that this there here what let he she who they we you i everyone everybody nobody someone anyone one both each all tonight today " +
  "nothing something critics reviewers audiences viewers fans people"
).split(" "));
const CREDIT_VERB = /^(directed|directs|stars|starred|co-stars|wrote|writes|plays|played|leads|shot|scored|produced|helmed)$/i;

const JOINER = /^(of|the|in|on|a|de|la|von|van)$/;
const HOUR_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** What a small number counts when it is a claim about a title. */
const UNIT = "(?:h|hr|hrs|hours?|min|mins|minutes?|episodes?|seasons?|parts?)";
const COUNT_IN_WORDS = new RegExp(`\\b(${HOUR_WORDS.join("|")})(?:\\s+and\\s+a\\s+half)?[\\s\\u2010-\\u2015-]+${UNIT}\\b`, "gi");
const UNIT_AFTER = new RegExp(`^[\\s\\u2010-\\u2015-]*${UNIT}\\b`, "i");

function sentenceProblems(sentence: string, resolved: ReadonlySet<string>, facts: Facts): string[] {
  const { numbers } = facts;
  const problems: string[] = [];
  for (const t of namedTitles(sentence)) {
    if (!resolved.has(normTitle(t))) problems.push(`*${t}* is not a title in our catalogue`);
  }
  if ((sentence.match(/\*/g) ?? []).length % 2 === 1) problems.push("it has an unpaired asterisk");
  // "§" stands where a title was: it ends a run of names, and a word after it is not the sentence's first.
  const plain = sentence.replace(/\*[^*\n]+\*/g, " § ");

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
  // facts. Punctuation ends a run: "Pacino, De Niro" is two names.
  const tokens = plain.match(/[A-Za-zÀ-ÿ'’.-]+|[^\sA-Za-zÀ-ÿ'’.-]/g) ?? [];
  // A sentence's first word is capitalised whatever it is. It is read as a name
  // when our facts have it only inside a name ("Al Mann directed it"), or when
  // they don't have it and it is credited with something ("Spielberg directed it").
  // Only the very first word gets this leave: after a colon or a dash a capitalised
  // word is a name like any other, or "My pick: Dune" would pass unchecked.
  const firstIsName = (tok: string) => {
    const w = wordsOf(tok)[0] ?? "";
    if (SUBJECTS.has(w)) return false;
    if (facts.words.has(w)) return !facts.alone.has(w);
    return /['’]s$/i.test(tok) || CREDIT_VERB.test(tokens[1] ?? "");
  };
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      const name = run.join(" ").replace(/[’']s$/i, "").replace(/(s)[’']$/i, "$1").replace(/[.]$/, "");
      if (!knownName(name, facts)) problems.push(`it mentions "${name}", which is not in our facts`);
    }
    run = [];
  };
  tokens.forEach((tok, i) => {
    if (/^I(['’](d|ll|m|ve))?$/.test(tok)) flush();
    else if (/^[A-ZÀ-Ý]/.test(tok) && (i > 0 || firstIsName(tok))) run.push(tok);
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
  const facts = readFacts(`${allowed} | ${factsHaystack(resolution.rows)} | ${ALWAYS}`);
  const kept: string[] = [];
  const problems: string[] = [];
  // A title is never split: the "." of *Mr. Robot* does not end a sentence.
  const whole = reply.trim().replace(/\*[^*\n]+\*/g, (title) => title.replace(/\s/g, "\u0001"));
  for (const part of whole.split(/(?<=[.!?])\s+/).filter(Boolean)) {
    const sentence = part.replace(/\u0001/g, " ");
    const found = sentenceProblems(sentence, resolution.resolved, facts);
    if (found.length) problems.push(...found);
    else kept.push(sentence.replace(/\*/g, ""));
  }
  return { kept: kept.join(" "), problems: [...new Set(problems)] };
}
