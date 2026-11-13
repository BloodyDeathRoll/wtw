'use client'
/**
 * The Taste DNA page's body (P2-U8), as signed off on the playable prototype (docs/prototypes/taste-dna-v2/play.py,
 * Eran, 2026-11-13): In short · How you like it · People who pull you in · Genres. Tap a person or a genre for a
 * sheet; a genre's sheet holds your call on it (Never · Less · Normal · More · Much more), saved at once.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { GENRE_CALLS, type GenreCall } from '@/lib/genre-calls'
import { LOOK } from '@/app/onboarding/lib/genre-look'
import type { Genre16 } from '@/app/play/lib/genres16'
import { CALL_SAYS, CALL_STAYS, genreSays } from './lib/taste-words'
import type { TasteGenre, TastePageData, TastePerson, TasteTitle } from './lib/taste-page'
import base from './dna.module.css'
import s from './taste.module.css'

/** Titles a sheet shows before "Show all". */
const SHOW = 20

/** A level meter: four rising bars, `lit` of them on. More bars = more of the genre in your feed; Never = none. */
function Meter({ lit }: { lit: number }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <rect key={i} x={2.5 + i * 5.25} y={20 - (5 + i * 4)} width="3.5" height={5 + i * 4} rx="1" fill="currentColor" fillOpacity={i < lit ? 1 : 0.22} />
      ))}
    </svg>
  )
}

const CALL_LOOK: Record<GenreCall, { name: string; lit: number; colour: string }> = {
  never: { name: 'Never', lit: 0, colour: '#ff5a4f' },
  less: { name: 'Less', lit: 1, colour: '#f0a35e' },
  normal: { name: 'Normal', lit: 2, colour: '#b4b4ba' },
  more: { name: 'More', lit: 3, colour: '#7fdcb0' },
  much: { name: 'Much more', lit: 4, colour: '#3ddc97' },
}

const MARK = { loved: ['❤️', 'Loved'], liked: ['👍', 'Liked'], disliked: ['👎', 'Disliked'] } as const

const cssVar = (name: string, value: string) => ({ [name]: value }) as React.CSSProperties

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={base.section}>
      <div className={base.sectionHead}><h2 className={`${base.sectionTitle} ${base.sectionTitleAccent}`}>{title}</h2></div>
      {children}
    </section>
  )
}

function TitleRow({ t }: { t: TasteTitle }) {
  return (
    <div className={s.trow}>
      {t.poster ? <img src={`https://image.tmdb.org/t/p/w92${t.poster}`} alt="" loading="lazy" /> : <span className={s.noposter} />}
      <div className={s.tinfo}><div className={s.tname}>{t.title}</div><div className={s.tyear}>{t.year ?? ''}</div></div>
      <span className={s.mark}><span className={s.e}>{MARK[t.reaction][0]}</span>{MARK[t.reaction][1]}</span>
    </div>
  )
}

function Titles({ titles }: { titles: TasteTitle[] }) {
  const [all, setAll] = useState(false)
  const cut = !all && titles.length > SHOW + 5
  return (
    <>
      {(cut ? titles.slice(0, SHOW) : titles).map(t => <TitleRow key={t.key} t={t} />)}
      {cut && <button type="button" className={s.more} onClick={() => setAll(true)}>Show all {titles.length}</button>}
    </>
  )
}

/** The bottom sheet: slides up over a scrim, 88% of the screen whatever it holds. */
function Sheet({ open, onClose, colour, children }: { open: boolean; onClose: () => void; colour?: string; children: React.ReactNode }) {
  const [shown, setShown] = useState(false)
  const [on, setOn] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const back = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      back.current = document.activeElement
      setShown(true)
      const r = requestAnimationFrame(() => requestAnimationFrame(() => { setOn(true); sheetRef.current?.querySelector<HTMLElement>('[data-close]')?.focus({ preventScroll: true }) }))
      return () => cancelAnimationFrame(r)
    }
    setOn(false)
    const t = setTimeout(() => { setShown(false); (back.current as HTMLElement | null)?.focus?.({ preventScroll: true }) }, 280)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!shown) return null
  return (
    <>
      <div className={`${s.scrim} ${on ? s.scrimOn : ''}`} onClick={onClose} />
      <div ref={sheetRef} className={`${s.sheet} ${on ? s.sheetOn : s.closing}`} role="dialog" aria-modal="true" style={cssVar('--gc', colour ?? '#d49b3a')}>
        <div className={s.grab} />
        <SheetClose.Provider value={onClose}>{children}</SheetClose.Provider>
      </div>
    </>
  )
}
const SheetClose = createContext<() => void>(() => {})
function CloseButton() {
  const onClose = useContext(SheetClose)
  return <button data-close type="button" className={s.sclose} aria-label="Close" onClick={onClose}><X size={26} strokeWidth={1.5} /></button>
}

function GenreSheet({ g, call, saving, error, onCall }: {
  g: TasteGenre; call: GenreCall; saving: boolean; error: string | null; onCall: (c: GenreCall) => void
}) {
  const { icon: GIcon } = LOOK[g.id]
  return (
    <>
      <div className={s.shead}>
        <div className={s.stitle}>
          <h2><i><GIcon size={26} strokeWidth={1.75} /></i>{g.label}</h2>
          <div className={s.smeta}>{genreSays(g.tally, call).text}</div>
        </div>
        <CloseButton />
      </div>
      <div className={s.sbody}>
        <p className={s.ask}>How much {g.label} do you want?</p>
        <div className={s.seg} role="radiogroup" aria-label={`How much ${g.label} do you want?`}>
          {GENRE_CALLS.map(k => (
            <button key={k} type="button" role="radio" aria-checked={k === call} disabled={saving}
              className={`${s.opt} ${k === call ? s.optOn : ''}`} style={cssVar('--cc', CALL_LOOK[k].colour)} onClick={() => onCall(k)}>
              <Meter lit={CALL_LOOK[k].lit} /><span>{CALL_LOOK[k].name}</span>
            </button>
          ))}
        </div>
        <p className={s.does}>{CALL_SAYS[call](g.label)}</p>
        <p className={s.stays}>{CALL_STAYS(call)}</p>
        {error && <p className={s.err} role="alert">{error}</p>}
        <p className={s.sub2}>What you rated</p>
        {g.titles.length ? <Titles titles={g.titles} /> : <p className={s.quiet}>Nothing yet. Rate a few and they’ll show up here.</p>}
      </div>
    </>
  )
}

function PersonSheet({ p }: { p: TastePerson }) {
  return (
    <>
      <div className={s.shead}>
        <div className={`${s.stitle} ${p.face ? s.face : ''}`}>
          {p.face && <img src={`https://image.tmdb.org/t/p/w185${p.face}`} alt="" />}
          <div className={s.who}><h2>{p.name}</h2><div className={s.smeta}>{p.roles} · from {p.titles.length} titles</div></div>
        </div>
        <CloseButton />
      </div>
      <div className={s.sbody}><div className={s.pdiv} /><Titles titles={p.titles} /></div>
    </>
  )
}

export function TastePage({ data }: { data: TastePageData }) {
  const [calls, setCalls] = useState(data.calls)
  const [popped, setPopped] = useState<Genre16 | null>(null)
  const [open, setOpen] = useState<{ kind: 'genre'; id: Genre16 } | { kind: 'person'; p: TastePerson } | null>(null)
  const [shut, setShut] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const show = (o: NonNullable<typeof open>) => { setError(null); setOpen(o); setShut(false) }
  const close = useCallback(() => setShut(true), [])

  async function choose(g: Genre16, call: GenreCall) {
    if (call === calls[g] || saving) return
    const before = calls
    setCalls({ ...calls, [g]: call })
    setPopped(g)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/dna/genre-call', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ genre: g, call }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { calls?: Record<Genre16, GenreCall> }
      if (body.calls) setCalls(body.calls)
    } catch {
      setCalls(before)
      setError('Couldn’t save that. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const genre = open?.kind === 'genre' ? data.genres.find(g => g.id === open.id)! : null

  return (
    <>
      <Section title="In short">
        {data.summary
          ? <p className={s.summary}>{data.summary}</p>
          : <p className={s.quiet} style={{ fontSize: 16 }}>Still getting to know you. Every title you rate sharpens this page.</p>}
      </Section>

      <Section title="How you like it">
        <div className={s.axes}>
          {data.scales.map(a => (
            <div key={a.id} className={`${s.axis} ${a.clear ? (a.lean > 0 ? s.leanR : s.leanL) : s.flat}`}>
              <span className={s.l}>{a.left}</span>
              <div className={s.track}><span className={s.dot} style={{ left: `${50 + a.lean * 46}%`, opacity: +(0.15 + a.sure * 0.85).toFixed(2) }} /></div>
              <span className={s.r}>{a.right}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="People who pull you in">
        {data.people.length ? data.people.map(g => (
          <div key={g.role} className={base.group}>
            <div className={base.groupHead}><span className={base.groupName}>{g.role}</span></div>
            {g.list.map(p => (
              <button key={p.id} type="button" className={s.prow} onClick={() => show({ kind: 'person', p })}>
                <div><div className={s.pname}>{p.name}</div><div className={s.pfrom}>from {p.titles.length} titles</div></div>
                <span className={s.chev}><ChevronRight size={16} strokeWidth={2} /></span>
              </button>
            ))}
          </div>
        )) : <p className={s.quiet}>Rate a few titles you’ve seen and we’ll spot the cast, directors and writers you keep coming back to.</p>}
      </Section>

      <Section title="Genres">
        <p className={s.quiet} style={{ marginTop: -4 }}>
          Your ratings decide how often each genre shows up in your feed, and that keeps changing as you rate. Want more or less
          of one? Tap it and pick. Your pick stays until you change it. Bars on a genre show your pick; no bars means your ratings decide.
        </p>
        <div className={s.grows}>
          {data.genres.map(g => {
            const call = calls[g.id], lit = call !== 'normal', says = genreSays(g.tally, call), { icon: GIcon, colour } = LOOK[g.id]
            return (
              <button key={g.id} type="button" className={`${s.grow} ${lit ? s.lit : ''}`} style={cssVar('--gc', colour)} onClick={() => show({ kind: 'genre', id: g.id })}>
                <i className={s.gwash} aria-hidden="true" />
                <i className={s.gline} aria-hidden="true"><GIcon size={24} strokeWidth={1.75} /></i>
                <span className={s.gtext}>
                  <span className={s.glabel} style={{ display: 'block' }}>{g.label}</span>
                  <span className={`${s.gsays} ${says.thin ? s.thin : ''}`} style={{ display: 'block' }}>{says.text}</span>
                </span>
                <span>
                  {lit && (
                    <span key={call} className={`${s.call} ${popped === g.id ? s.pop : ''}`} style={cssVar('--cc', CALL_LOOK[call].colour)} title={CALL_LOOK[call].name}>
                      <Meter lit={CALL_LOOK[call].lit} />
                    </span>
                  )}
                </span>
                <span className={s.chev}><ChevronRight size={16} strokeWidth={2} /></span>
              </button>
            )
          })}
        </div>
      </Section>

      <Sheet open={!shut && !!open} onClose={close} colour={genre ? LOOK[genre.id].colour : undefined}>
        {genre && <GenreSheet g={genre} call={calls[genre.id]} saving={saving} error={error} onCall={c => choose(genre.id, c)} />}
        {open?.kind === 'person' && <PersonSheet p={open.p} />}
      </Sheet>
    </>
  )
}
