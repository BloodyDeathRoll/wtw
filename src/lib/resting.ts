// v3 F4 (docs/plan/v3/FOR-YOU.md DEC-6, issue #351): cards you stopped on rest, then retire.
//
// A card on For you that you actually stopped on (at least half of it on screen for at least a second) and then left
// alone (not added, rated or hidden) rests when you tap Refresh: about a week the first time, about a month the second,
// and after the third time it retires from For you. When its rest is over it may come back, but never in the top five.
// Cards you flicked past, or never reached, count for nothing: they go back into the pool as if never shown (DEC-3).
// Adding, rating or hiding a title takes it off For you for good, whatever its count.
//
// The state lives on served_titles (migration 0035): `last_stopped_at` (set by the phone, cleared when it's counted),
// `skips` (times stopped on and skipped), `rest_until`. Only with FOR_YOU_V3 on.
//
// Pure, and safe to import on the phone: the observer's two numbers live here too.

/**
 * How long a skipped card rests, by skip: after the 1st, after the 2nd, … One more skip than there are entries retires
 * it. Placeholders (FOR-YOU.md Q-1): Eran revisits them two weeks after FOR_YOU_V3 is on (retest R1). Change them here.
 */
export const REST_DAYS: readonly number[] = [7, 30];

/** The skip that retires a card: one more than there are rests. */
export const RETIRE_AT_SKIP = REST_DAYS.length + 1;

/** A card back from its rest is never in the top five. */
export const RETURNING_BELOW = 5;

/** "Stopped on": at least this share of the card on screen … */
export const STOP_VISIBLE_SHARE = 0.5;
/** … for at least this long. */
export const STOP_MS = 1000;

const DAY_S = 24 * 60 * 60;

/** REST_DAYS in seconds, for migration 0035's `rest_skipped_titles`. */
export function restSeconds(): number[] {
  return REST_DAYS.map((d) => Math.round(d * DAY_S));
}

/** One served_titles row's rest state, keyed `type:tmdb_id`. */
export type RestRow = { key: string; skips: number; rest_until: string | null };

export type RestPlan = {
  /** Resting (inside its rest) or retired: left out of the 20. */
  blocked: Set<string>;
  /** Skipped before and back from its rest: may be in the 20, below the first five. */
  returning: Set<string>;
};

export const NO_REST: RestPlan = { blocked: new Set(), returning: new Set() };

/** What each row means `now`. A row with no skips is a title never stopped on and skipped: neither. */
export function restPlan(rows: RestRow[], now: number = Date.now()): RestPlan {
  const blocked = new Set<string>();
  const returning = new Set<string>();
  for (const r of rows) {
    const skips = Number(r.skips) || 0;
    if (skips <= 0) continue;
    if (skips >= RETIRE_AT_SKIP) {
      blocked.add(r.key);
      continue;
    }
    const until = r.rest_until ? Date.parse(r.rest_until) : NaN;
    if (Number.isFinite(until) && until > now) blocked.add(r.key);
    else returning.add(r.key);
  }
  return { blocked, returning };
}

/**
 * `items` in order, except that a returning card never sits in the top `below` places: the first `below` places go to
 * the others, in their order, and everything else follows in its order. With fewer than `below` others, the returning
 * cards come right after them.
 */
export function placeReturning<T>(items: T[], isReturning: (t: T) => boolean, below: number = RETURNING_BELOW): T[] {
  const top: T[] = [];
  const rest: T[] = [];
  for (const t of items) {
    if (top.length < below && !isReturning(t)) top.push(t);
    else rest.push(t);
  }
  return [...top, ...rest];
}

/**
 * The phone's "stopped on" rule, per card: once a card is at least STOP_VISIBLE_SHARE on screen, a timer starts; if it
 * stays that visible for STOP_MS, `onStop` fires for it, once (until `reset`, for the next 20). Dropping below the share
 * first cancels it: a flick doesn't count. Fed by an IntersectionObserver in RecommendationsView.
 */
export function stopTracker(onStop: (key: string) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const reported = new Set<string>();
  const cancel = (key: string) => {
    const t = timers.get(key);
    if (t !== undefined) clearTimeout(t);
    timers.delete(key);
  };
  return {
    /** The card `key` is now `share` (0–1) on screen. */
    visible(key: string, share: number) {
      if (reported.has(key)) return;
      if (share < STOP_VISIBLE_SHARE) return cancel(key);
      if (timers.has(key)) return;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          reported.add(key);
          onStop(key);
        }, STOP_MS),
      );
    },
    /** A new 20: every card may be reported again. */
    reset() {
      for (const k of [...timers.keys()]) cancel(k);
      reported.clear();
    },
    /** Leaving: drop the running timers (a card half-watched when you leave doesn't count). */
    stop() {
      for (const k of [...timers.keys()]) cancel(k);
    },
  };
}
