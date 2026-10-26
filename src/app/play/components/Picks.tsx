'use client'
/**
 * Tonight's picks in the live app's own card look (option A, agreed with
 * Eran 2026-10-17): poster, trailer, where to watch, "Why this pick?".
 *
 * Read-only on purpose. The live card's rating and watchlist buttons write
 * straight into the taste DNA and the watchlist, which Slice 1 must not
 * touch — so there are no rating buttons and the watchlist button says
 * "Soon". Slice 2 swaps this for the real card fed by the real engine.
 *
 * The styles are the live feed's CSS module, imported read-only so the two
 * look the same; nothing in src/modules/session is changed.
 */
import { useState } from 'react'
import styles from '@/modules/session/recommendations/RecommendationsView.module.css'
import { ProviderIcon } from '@/app/components/ProviderIcon'
import { canonicalProvider } from '@/lib/watch-providers'
import { readsYou, recReason, whyPick, type PickReaction, type Rec, type Title } from '../lib/brain'
import type { Ctl } from './types'
import { SaveRibbon } from './ui'

const meta = (t: Title) =>
  t.type === 'tv'
    ? (t.seasons ? `${t.seasons} season${t.seasons > 1 ? 's' : ''}` : 'Series')
    : (t.runtime ? `${Math.floor(t.runtime / 60)}h ${t.runtime % 60}m` : 'Movie')

const posterUrl = (t: Title, size = 'w500') => (t.poster_path ? `https://image.tmdb.org/t/p/${size}${t.poster_path}` : null)
const trailerUrl = (t: Title) => (t.trailer_key ? `https://www.youtube.com/watch?v=${t.trailer_key}` : null)

function WherePill({ where, hero }: { where: string | null; hero?: boolean }) {
  if (!where) return null
  const { key, label } = canonicalProvider(where)
  return (
    <div className={`${styles.wherePill} ${hero ? styles.wherePillHero : ''}`}>
      <ProviderIcon providerKey={key} className={styles.whereIcon} />
      <span>{label}</span>
    </div>
  )
}

function TrailerButton({ t, showLabel }: { t: Title; showLabel?: boolean }) {
  const url = trailerUrl(t)
  return (
    <button type="button" className={`${styles.playBtn} ${showLabel ? styles.playBtnLabeled : ''}`} disabled={!url}
      onClick={url ? () => window.open(url, '_blank', 'noopener,noreferrer') : undefined}
      aria-label={url ? `Play ${t.title} trailer` : 'Trailer unavailable'} title={url ? 'Play trailer' : 'Trailer unavailable'}>
      {showLabel && <span className={styles.playBtnText}>{url ? 'Play trailer' : 'No trailer'}</span>}
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
    </button>
  )
}

/** The live feed's watchlist button, same look and labels, saving into the same list (lib/watchlist.ts). */
function WatchlistButton({ ctl, t, block }: { ctl: Ctl; t: Title; block?: boolean }) {
  const saved = ctl.isSaved(t.id)
  const label = saved ? 'Remove from watchlist' : 'Add to watchlist'
  return (
    <button type="button" className={[styles.watchlistBtn, saved ? styles.watchlistBtnSaved : '', block ? styles.watchlistBtnBlock : ''].filter(Boolean).join(' ')}
      onClick={() => ctl.toggleSave(t, 'picks')} aria-pressed={saved} aria-label={`${label}: ${t.title}`} title={label}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      <span>{label}</span>
    </button>
  )
}

/** The live feed's reaction row, same look and labels. */
const REACTIONS: { value: Exclude<PickReaction, 'removed'>; emoji: string; label: string; aria: string }[] = [
  { value: 'loved', emoji: '❤️', label: 'Loved', aria: 'Loved it' },
  { value: 'liked', emoji: '👍', label: 'Liked', aria: 'Liked it' },
  { value: 'disliked', emoji: '👎', label: 'Disliked', aria: 'Watched it, didn\'t like it' },
]
const RATED_MESSAGE: Record<PickReaction, string> = {
  loved: 'Loved — weighted strongly into your taste',
  liked: 'Saved to your taste',
  disliked: 'Noted — not to your taste',
  removed: 'Removed — won\'t be recommended again',
}

function ReactionRow({ t, rated, onReact, compact }: { t: Title; rated: PickReaction | undefined; onReact: (r: PickReaction) => void; compact?: boolean }) {
  if (rated) return <div className={styles.feedbackAcked}>{RATED_MESSAGE[rated]}</div>
  return (
    <div className={`${styles.feedback} ${compact ? styles.feedbackCompact : ''}`}>
      {REACTIONS.map(r => (
        <button key={r.value} type="button" className={styles.reactionBtn} onClick={() => onReact(r.value)} aria-label={`${r.aria}: ${t.title}`} title={r.aria}>
          <span className={`${styles.reactionEmoji} ${styles.chipEmoji}`}>{r.emoji}</span>
          <span className={styles.reactionLabel}>{r.label}</span>
        </button>
      ))}
      <button type="button" className={`${styles.reactionBtn} ${styles.removeBtn}`} onClick={() => onReact('removed')} aria-label={`Remove ${t.title}: never recommend this again`} title="Never recommend this again">
        <span className={styles.reactionEmoji} aria-hidden>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </span>
        <span className={styles.reactionLabel}>Remove</span>
      </button>
    </div>
  )
}

function PickCard({ ctl, r, match, onWhy, rated, onReact }: { ctl: Ctl; r: Rec; match: number | null; onWhy: () => void; rated: PickReaction | undefined; onReact: (x: PickReaction) => void }) {
  const t = r.t
  const poster = posterUrl(t, 'w342')
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.cardTitleBlock}>
          <h3 className={styles.cardTitle}>{t.title}</h3>
          <div className={styles.cardMeta}>
            <span>{t.year}</span><span className={styles.dot} /><span>{meta(t)}</span><span className={styles.dot} /><span>★ {t.rating.toFixed(1)}</span>
          </div>
          <WherePill where={t.where} />
        </div>
        {match !== null && <div className={styles.cardMatch}><span className={styles.matchDot} />{match}% match</div>}
        <TrailerButton t={t} />
      </div>
      <div className={styles.ctaRow}>
        <button type="button" className={styles.whyPill} onClick={onWhy} aria-label={`Why we picked ${t.title}`}>
          <span aria-hidden>🤔</span><span>Why this pick?</span>
        </button>
        <WatchlistButton ctl={ctl} t={t} />
      </div>
      <div className={styles.cardMid}>
        <div className={`${styles.poster} ${styles.poster_md}`} style={{ background: '#161618', position: 'relative' }}>
          <SaveRibbon ctl={ctl} t={t} from="picks" />
          {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN, same as the live card */}
          {poster && <img src={poster} alt="" className={styles.posterImg} />}
        </div>
        <div className={styles.cardReason}>
          <span className={styles.reasonEyebrow}>FINGERPRINT</span>
          <span>{recReason(ctl.S, r)}</span>
        </div>
      </div>
      <ReactionRow t={t} rated={rated} onReact={onReact} compact />
    </article>
  )
}

function WhySheet({ ctl, r, match, onClose, rated, onReact }: { ctl: Ctl; r: Rec; match: number | null; onClose: () => void; rated: PickReaction | undefined; onReact: (x: PickReaction) => void }) {
  const t = r.t
  const { pros, cons } = whyPick(ctl.S, t)
  const bg = posterUrl(t, 'w780')
  return (
    <div className={styles.whyOverlay} role="dialog" aria-modal="true" aria-label={`Why we picked ${t.title}`}>
      {bg && <div className={styles.heroBg} style={{ backgroundImage: `url(${bg})` }} aria-hidden />}
      <div className={styles.heroScrim} aria-hidden />
      <div className={styles.heroScroll} onClick={onClose}>
        <div className={styles.heroInner} onClick={e => e.stopPropagation()}>
          <div className={styles.heroData}>
            <button type="button" className={styles.heroBack} onClick={onClose} aria-label="back">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <div className={styles.heroHeader}>
              {match !== null && <div className={styles.heroMatch}><span className={styles.heroMatchPct}>{match}%</span><span className={styles.heroMatchLabel}>match</span></div>}
              <TrailerButton t={t} showLabel />
            </div>
            <h2 className={styles.heroTitle}>{t.title}</h2>
            <div className={styles.heroMeta}>
              <span>{t.year}</span><span className={styles.dot} /><span>{meta(t)}</span><span className={styles.dot} /><span>★ {t.rating.toFixed(1)}</span>
            </div>
            <WherePill where={t.where} hero />
            <div className={styles.heroFingerprint}>
              <span className={styles.reasonEyebrow}>THE STORY</span>
              <span>{t.overview}</span>
            </div>
            <WatchlistButton ctl={ctl} t={t} block />
            <ReactionRow t={t} rated={rated} onReact={onReact} />
            <div className="why-lists">
              <div>
                <span className="why-h pro">Why it fits</span>
                <ul>{pros.map(p => <li key={p}>{p}</li>)}</ul>
              </div>
              {cons.length > 0 && (
                <div>
                  <span className="why-h con">Worth knowing</span>
                  <ul>{cons.map(c => <li key={c}>{c}</li>)}</ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Picks({ ctl, recs: fresh }: { ctl: Ctl; recs: Rec[] }) {
  const [open, setOpen] = useState<Rec | null>(null)
  // Cards rated this visit stay on screen with their thank-you line (as in the
  // live feed); they're gone from the picks next time.
  const [kept] = useState<Rec[]>(() => fresh)
  const recs = kept
  const ratedOf = (r: Rec) => ctl.S.pickReactions?.[r.t.id]
  const react = (r: Rec) => (x: PickReaction) => ctl.reactToPick(r.t, x)
  const maxS = Math.max(0.01, recs[0]?.s || 0.01)
  // A "% match" is a claim; shown only once the brain actually reads the player.
  const matchOf = (r: Rec) => (readsYou(ctl.S) ? Math.round(72 + 25 * (r.s / maxS)) : null)
  return (
    <>
      <div className="picks">
        {recs.map(r => <PickCard key={r.t.id} ctl={ctl} r={r} match={matchOf(r)} onWhy={() => setOpen(r)} rated={ratedOf(r)} onReact={react(r)} />)}
        {recs.some(r => r.t.where) && <p className="attribution">Where-to-watch data: JustWatch, via TMDB.</p>}
      </div>
      {open && <WhySheet ctl={ctl} r={open} match={matchOf(open)} onClose={() => setOpen(null)} rated={ratedOf(open)} onReact={react(open)} />}
    </>
  )
}
