'use client'
/**
 * My watchlist (design approved 2026-10-19, docs/prototypes/watchlist/w3-watchlist.jpg).
 * The same list as the live app's watchlist on this device: titles saved from
 * the games and from the recommendations feed, newest first. ✕ removes one.
 */
import { useState } from 'react'
import type { WatchlistEntry } from '@/lib/watchlist'
import { savedFrom, watchlist } from '../lib/watchlist'
import type { Ctl } from './types'
import { TopBar } from './ui'

const RATED: Record<string, string> = { loved: 'Loved it', liked: 'Liked it', disliked: 'Not for me' }

function when(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (Date.now() - ms < 3_600_000) return 'just now'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function WatchlistScreen({ ctl }: { ctl: Ctl }) {
  const [kind, setKind] = useState<'all' | 'movie' | 'tv'>('all')
  const all = watchlist()
  const list = all.filter((e: WatchlistEntry) => kind === 'all' || e.rec.type === kind)
  return (
    <div className="screen wl">
      <TopBar onMenu={() => ctl.setMenu(true)} />
      <div className="wl-hd"><h1>My watchlist</h1><span>{all.length} {all.length === 1 ? 'title' : 'titles'}</span></div>
      <div className="wl-chips" role="group" aria-label="Show">
        {(['all', 'movie', 'tv'] as const).map(k => (
          <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'all' ? 'All' : k === 'movie' ? 'Movies' : 'Series'}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="wl-empty">{all.length ? 'Nothing here in this filter.' : 'Nothing saved yet. Tap the ribbon on any poster to save it here.'}</p>
      ) : (
        <div className="wl-list">
          {list.map(e => (
            <div key={e.rec.id} className="wl-it">
              <div className="wl-ps">
                {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, same as the live card */}
                {e.rec.poster_url && <img src={e.rec.poster_url} alt="" loading="lazy" />}
              </div>
              <div className="wl-tx">
                <b>{e.rec.title}</b>
                <small>{e.rec.type === 'tv' ? 'Series' : 'Movie'}{e.rec.year ? ` · ${e.rec.year}` : ''}</small>
                <div className="wl-meta">
                  <i className="src">{savedFrom(e)} · {when(e.added_at)}</i>
                  {e.rec.where && <i>{e.rec.where}</i>}
                  {e.rating && RATED[e.rating] && <i className="rated">{RATED[e.rating]}</i>}
                </div>
              </div>
              <button type="button" className="wl-x" aria-label={`Remove ${e.rec.title} from your watchlist`} onClick={() => ctl.removeSaved(e.rec.id, e.rec.title)}>✕</button>
            </div>
          ))}
        </div>
      )}
      <p className="wl-note">One list with the WTW app on this device.</p>
    </div>
  )
}
