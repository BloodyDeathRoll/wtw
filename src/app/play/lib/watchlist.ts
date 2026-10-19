/**
 * The taste games save into the live app's own watchlist (src/lib/watchlist.ts):
 * one list, synced across the player's devices by the live app's own sync (#118),
 * whether a title was saved from the games or from the recommendations feed
 * (Eran, 2026-10-19). Where it was saved travels in the card itself (`reason`),
 * since that is what the server stores. A save from the games counts like any
 * other: it is stored unsynced, so the live app's next session end reports it to
 * the fingerprint as a "wants to watch" signal ("a save is a save").
 */
import { addToWatchlist, getWatchlist, hydrateWatchlist, isInWatchlist, removeFromWatchlist, type WatchlistEntry } from '@/lib/watchlist'
import type { Recommendation } from '@/types/recommendation'
import type { GameTitle } from './scales'

export type SaveSource = 'training' | 'knockout' | 'final' | 'blind' | 'other' | 'hilo' | 'bet' | 'mind' | 'picks'

/** The label the watchlist shows under each title. */
export const SAVED_FROM: Record<SaveSource, string> = {
  training: 'Saved in training',
  knockout: 'From the Knockout',
  final: 'From the final round',
  blind: 'From Blind Taste Test',
  other: 'From The Other Side',
  hilo: 'From Higher or Lower',
  bet: 'From The Bet',
  mind: 'From Mind Reader',
  picks: 'From my picks',
}

const meta = (t: GameTitle) =>
  t.type === 'tv'
    ? (t.seasons ? `${t.seasons} season${t.seasons > 1 ? 's' : ''}` : 'Series')
    : (t.runtime ? `${Math.floor(t.runtime / 60)}h ${t.runtime % 60}m` : 'Movie')

/**
 * A game title in the live card's shape, so the live watchlist renders it.
 * `match` is 0: the games make no "% match" claim (the live card shows the
 * figure only when it has one — see the note to A1 in the PR).
 */
export function toRecommendation(t: GameTitle, source: SaveSource): Recommendation {
  return {
    id: t.id,
    title: t.title,
    type: t.type,
    year: t.year ?? 0,
    poster_url: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : null,
    trailer_url: t.trailer_key ? `https://www.youtube.com/watch?v=${t.trailer_key}` : null,
    meta: meta(t),
    rating: t.rating,
    match: 0,
    reason: SAVED_FROM[source],
    where: t.where,
    motif: 'dot',
    palette: ['#1E1E22', '#D49B3A'],
  }
}

export const isSaved = (id: string) => isInWatchlist(id)
export const savedIds = (): Set<string> => new Set(getWatchlist().map(e => e.rec.id))
export const watchlist = (): WatchlistEntry[] => getWatchlist()

export function saveTitle(t: GameTitle, source: SaveSource) {
  addToWatchlist(toRecommendation(t, source))
}

export function unsaveTitle(id: string) {
  removeFromWatchlist(id)
}

const LABELS = new Set<string>(Object.values(SAVED_FROM))

/** Where an entry came from, for the list: the games' label (kept in the card), else the feed. */
export const savedFrom = (e: WatchlistEntry) => (LABELS.has(e.rec.reason) ? e.rec.reason : 'From recommendations')

/** Signed-in players: load the account's list (as the live app does on start), then report the ids. */
export async function loadAccountWatchlist(userId: string): Promise<Set<string>> {
  await hydrateWatchlist(userId)
  return savedIds()
}
