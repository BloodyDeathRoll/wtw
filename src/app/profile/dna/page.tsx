import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDNA } from '@/modules/dna/lib/load-save'
import type { DNASchema, StrandA } from '@/types/dna'

export const metadata = { title: 'Your Taste DNA — WTW' }

// ── Helpers ──────────────────────────────────────────────────

function pct(n: number) { return `${Math.round(n * 100)}%` }
function scorePct(n: number) { return `${Math.round(((n + 1) / 2) * 100)}%` }  // -1…1 → 0%…100%

function topCrew(bucket: StrandA[keyof StrandA], limit = 5) {
  return Object.values(bucket)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, limit)
}

const STRAND_B_LABELS: Record<string, string> = {
  moral_ambiguity:      'Moral Ambiguity',
  narrative_complexity: 'Narrative Complexity',
  emotional_demand:     'Emotional Demand',
  originality_weight:   'Originality',
  humor_style:          'Humor Style',
  protagonist_type:     'Protagonist Type',
  ensemble_vs_solo:     'Ensemble vs Solo',
}

// ── Sub-components (server) ───────────────────────────────────

function ScoreBar({ score, confidence }: { score: number; confidence: number }) {
  const positive = score >= 0
  const fillWidth = Math.abs(score) * 100
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="relative h-1.5 w-24 rounded-full bg-white/10 flex-shrink-0">
        {positive ? (
          <div
            className="absolute left-1/2 top-0 h-full rounded-full"
            style={{ width: `${fillWidth / 2}%`, background: 'var(--wtw-green)' }}
          />
        ) : (
          <div
            className="absolute right-1/2 top-0 h-full rounded-full"
            style={{ width: `${fillWidth / 2}%`, background: '#e05c5c' }}
          />
        )}
        <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
      </div>
      <span className="text-xs" style={{ color: 'var(--wtw-fg-dim)' }}>
        {Math.round(confidence * 100)}% conf.
      </span>
    </div>
  )
}

function HBar({ value, label, color = 'var(--wtw-green)' }: { value: number; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 text-xs flex-shrink-0 capitalize" style={{ color: 'var(--wtw-fg-muted)' }}>
        {label.replace(/_/g, ' ')}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: pct(value), background: color }} />
      </div>
      <span className="w-8 text-right text-xs" style={{ color: 'var(--wtw-fg-dim)' }}>
        {Math.round(value * 100)}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-2xl p-5 space-y-4"
      style={{ background: 'var(--wtw-bg-elev-1)', border: '1px solid var(--wtw-border)' }}
    >
      <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--wtw-fg-muted)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default async function DNAProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let dna: DNASchema
  try {
    dna = await loadDNA(user.id)
  } catch {
    return (
      <main className="min-h-screen p-6 flex items-center justify-center" style={{ background: 'var(--wtw-bg)', color: 'var(--wtw-fg)' }}>
        <p style={{ color: 'var(--wtw-fg-muted)' }}>Could not load your DNA profile.</p>
      </main>
    )
  }

  const { metadata, strand_a_creative_affinity: sa, strand_b_narrative_dimensions: sb,
          strand_c_visceral_specs: sc, contextual_logic: cl, signals, learning_loop: ll } = dna

  const hasData = signals.length >= 3

  return (
    <main
      className="min-h-screen px-4 py-8 max-w-2xl mx-auto space-y-5"
      style={{ background: 'var(--wtw-bg)', color: 'var(--wtw-fg)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Taste DNA</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--wtw-fg-muted)' }}>
            {signals.length} signal{signals.length !== 1 ? 's' : ''} · v{metadata.taste_version} ·{' '}
            {new Date(metadata.last_updated).toLocaleDateString()}
          </p>
        </div>
        <Link
          href="/"
          className="text-sm px-3 py-1.5 rounded-full"
          style={{ background: 'var(--wtw-bg-elev-2)', color: 'var(--wtw-fg-muted)', border: '1px solid var(--wtw-border)' }}
        >
          ← Home
        </Link>
      </div>

      {!hasData && (
        <div
          className="rounded-2xl p-5 text-sm"
          style={{ background: 'var(--wtw-bg-elev-1)', border: '1px solid var(--wtw-border)', color: 'var(--wtw-fg-muted)' }}
        >
          Your fingerprint is just getting started. Rate a few more films and have a conversation to see your DNA take shape.
        </div>
      )}

      {/* Strand A — Creative Affinities */}
      <Section title="Creative Affinities">
        {(['directors', 'writers', 'actors'] as const).map(bucket => {
          const crew = topCrew(sa[bucket])
          if (crew.length === 0) return null
          return (
            <div key={bucket}>
              <p className="text-xs mb-2 font-medium capitalize" style={{ color: 'var(--wtw-fg-dim)' }}>
                {bucket}
              </p>
              <div className="space-y-2">
                {crew.map(person => (
                  <div key={person.name} className="flex items-center gap-3">
                    <span className="flex-1 text-sm truncate" style={{ color: 'var(--wtw-fg)' }}>
                      {person.name}
                    </span>
                    <ScoreBar score={person.score} confidence={person.confidence} />
                    <span className="text-xs w-6 text-right" style={{ color: person.score >= 0 ? 'var(--wtw-green)' : '#e05c5c' }}>
                      {person.score > 0 ? '+' : ''}{person.score.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {Object.values(sa.directors).length === 0 && Object.values(sa.actors).length === 0 && (
          <p className="text-sm" style={{ color: 'var(--wtw-fg-dim)' }}>No crew affinities yet.</p>
        )}
      </Section>

      {/* Strand B — Narrative Dimensions */}
      <Section title="Narrative Dimensions">
        <div className="space-y-3">
          {(Object.keys(sb) as (keyof typeof sb)[]).map(dim => {
            const d = sb[dim]
            return (
              <div key={dim} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--wtw-fg)' }}>
                    {STRAND_B_LABELS[dim] ?? dim}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--wtw-bg-elev-3)', color: 'var(--wtw-fg-muted)' }}>
                      {String(d.value).replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs w-16 text-right" style={{ color: 'var(--wtw-fg-dim)' }}>
                      {Math.round(d.confidence * 100)}% conf.
                    </span>
                  </div>
                </div>
                <div className="h-1 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{ width: pct(d.confidence), background: `rgba(var(--wtw-rgb), ${0.3 + d.confidence * 0.7})` }}
                  />
                </div>
                {d.notes && (
                  <p className="text-xs" style={{ color: 'var(--wtw-fg-dim)' }}>{d.notes}</p>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Strand C — Visceral Specs */}
      <Section title="Visceral Specs">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: 'var(--wtw-fg-dim)' }}>Pacing</p>
            {Object.entries(sc.pacing_weights).map(([k, v]) => (
              <HBar key={k} label={k} value={v} />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: 'var(--wtw-fg-dim)' }}>Tone</p>
            {Object.entries(sc.tone_weights).map(([k, v]) => (
              <HBar key={k} label={k} value={v} color="#7c6df2" />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium" style={{ color: 'var(--wtw-fg-dim)' }}>Craft aspects (from deep surveys)</p>
            {Object.entries(sc.aspect_weights).map(([k, v]) => (
              <HBar key={k} label={k} value={v} color="#4a9d7f" />
            ))}
          </div>
        </div>
      </Section>

      {/* Contextual Logic */}
      {(cl.exclusion_rules.length > 0 || cl.soft_preferences.length > 0) && (
        <Section title="Your Rules">
          {cl.exclusion_rules.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: 'var(--wtw-fg-dim)' }}>Hard exclusions</p>
              {cl.exclusion_rules.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#e05c5c22', color: '#e05c5c' }}>
                    {r.type}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--wtw-fg)' }}>{r.name}</span>
                  {r.reason && <span className="text-xs" style={{ color: 'var(--wtw-fg-dim)' }}>— {r.reason}</span>}
                </div>
              ))}
            </div>
          )}
          {cl.soft_preferences.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium" style={{ color: 'var(--wtw-fg-dim)' }}>Soft preferences</p>
              {cl.soft_preferences.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--wtw-fg)' }}>{p.signal}</span>
                  <span className="text-xs" style={{ color: 'var(--wtw-fg-dim)' }}>
                    weight {Math.round(p.weight_modifier * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Learning Loop */}
      {ll.open_questions.length > 0 && (
        <Section title="Open Questions">
          <ul className="space-y-1.5">
            {ll.open_questions.map((q, i) => (
              <li key={i} className="text-sm flex gap-2" style={{ color: 'var(--wtw-fg-muted)' }}>
                <span style={{ color: 'var(--wtw-fg-dim)' }}>?</span>
                {q}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Stretch picks summary */}
      {ll.stretch_pick_history.length > 0 && (
        <Section title="Stretch Pick Results">
          <div className="space-y-2">
            {ll.stretch_pick_history.slice(-5).reverse().map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--wtw-fg)' }}>{s.title}</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: s.accepted ? 'var(--wtw-green-soft)' : 'rgba(255,255,255,0.06)',
                    color: s.accepted ? 'var(--wtw-green)' : 'var(--wtw-fg-dim)',
                  }}
                >
                  {s.reaction ?? (s.accepted ? 'watched' : 'skipped')}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Footer */}
      <p className="text-center text-xs pb-6" style={{ color: 'var(--wtw-fg-dim)' }}>
        Schema v{metadata.schema_version} · {metadata.total_sessions} session{metadata.total_sessions !== 1 ? 's' : ''}
      </p>
    </main>
  )
}
