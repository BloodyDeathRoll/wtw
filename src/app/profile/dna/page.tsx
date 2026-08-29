import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDNA } from '@/modules/dna/lib/load-save'
import type { DNASchema, StrandA } from '@/types/dna'
import { DnaHeader } from './DnaHeader'
import styles from './dna.module.css'

export const metadata = { title: 'Your Taste DNA — WTW' }

// ── Helpers ──────────────────────────────────────────────────

function pct(n: number) { return `${Math.round(n * 100)}%` }

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

/**
 * Below this, a dimension is still sitting on the blank-DNA default rather
 * than anything the fingerprint has learned — say so instead of stating a
 * preference the user never expressed.
 */
const UNSURE_BELOW = 0.1

/** A numeric dimension (originality) as a 0–100 readout, not 0.5787002162. */
function dimensionValue(value: unknown): string {
  if (typeof value === 'number') return `${Math.round(value * 100)} / 100`
  return String(value).replace(/_/g, ' ')
}

// ── Sub-components (server) ───────────────────────────────────

function Meter({ value, color = 'var(--wtw-green)' }: { value: number; color?: string }) {
  return (
    <div className={styles.track}>
      <div className={styles.fill} style={{ width: pct(value), background: color }} />
    </div>
  )
}

function SpecRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={styles.specRow}>
      <span className={styles.specLabel}>{label.replace(/_/g, ' ')}</span>
      <Meter value={value} color={color} />
      <span className={styles.specValue}>{Math.round(value * 100)}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
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
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.note}>Could not load your DNA profile.</p>
        </div>
      </main>
    )
  }

  const { metadata, strand_a_creative_affinity: sa, strand_b_narrative_dimensions: sb,
          strand_c_visceral_specs: sc, contextual_logic: cl, signals, learning_loop: ll } = dna

  const hasData = signals.length >= 3
  const appUser = {
    id: user.id,
    email: user.email ?? null,
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  }
  const subtitle =
    `${signals.length} signal${signals.length !== 1 ? 's' : ''} · ` +
    `v${metadata.taste_version} · ${new Date(metadata.last_updated).toLocaleDateString()}`

  return (
    <main className={styles.page}>
      <DnaHeader user={appUser} subtitle={subtitle} />

      <div className={styles.container}>
        {!hasData && (
          <section className={styles.section}>
            <p className={styles.note}>
              Your fingerprint is just getting started. Rate a few more films and have a
              conversation to see your DNA take shape.
            </p>
          </section>
        )}

        {/* Strand A — Creative Affinities.
            One number per person: how confident the fingerprint is. The raw
            ±score it used to show is an internal reaction-average, and the
            unit is named once per group instead of on every row. */}
        <Section title="Creative Affinities">
          {(['directors', 'writers', 'actors'] as const).map(bucket => {
            const crew = topCrew(sa[bucket])
            if (crew.length === 0) return null
            return (
              <div key={bucket} className={styles.group}>
                <div className={styles.groupHead}>
                  <span className={styles.groupName}>{bucket}</span>
                  <span className={styles.groupLegend}>Confidence</span>
                </div>
                {crew.map(person => (
                  <div key={person.name} className={styles.personRow}>
                    <span className={styles.personName}>{person.name}</span>
                    <Meter value={person.confidence} />
                    <span className={styles.personPct}>{pct(person.confidence)}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {Object.values(sa.directors).length === 0 && Object.values(sa.actors).length === 0 && (
            <p className={styles.note}>No crew affinities yet.</p>
          )}
        </Section>

        {/* Strand B — Narrative Dimensions.
            Each dimension is a block: quiet label, the reading as the
            headline, the plain-English note, then a confidence meter. */}
        <Section title="Narrative Dimensions">
          {(Object.keys(sb) as (keyof typeof sb)[]).map(dim => {
            const d = sb[dim]
            const unsure = d.confidence < UNSURE_BELOW
            return (
              <div key={dim} className={styles.dim}>
                <div className={styles.dimLabel}>{STRAND_B_LABELS[dim] ?? dim}</div>
                <div className={`${styles.dimValue} ${unsure ? styles.dimUnknown : ''}`}>
                  {unsure ? 'Not enough signal yet' : dimensionValue(d.value)}
                </div>
                {!unsure && d.notes && <p className={styles.dimNote}>{d.notes}</p>}
                <div className={styles.dimMeter}>
                  <Meter value={d.confidence} />
                  <span className={styles.dimConf}>{pct(d.confidence)} confidence</span>
                </div>
              </div>
            )
          })}
        </Section>

        {/* Strand C — Visceral Specs */}
        <Section title="Visceral Specs">
          <div className={styles.specGroup}>
            <p className={styles.subhead}>Pacing</p>
            {Object.entries(sc.pacing_weights).map(([k, v]) => (
              <SpecRow key={k} label={k} value={v} color="var(--wtw-green)" />
            ))}
          </div>
          <div className={styles.specGroup}>
            <p className={styles.subhead}>Tone</p>
            {Object.entries(sc.tone_weights).map(([k, v]) => (
              <SpecRow key={k} label={k} value={v} color="#7c6df2" />
            ))}
          </div>
          <div className={styles.specGroup}>
            <p className={styles.subhead}>Craft aspects (from deep surveys)</p>
            {Object.entries(sc.aspect_weights).map(([k, v]) => (
              <SpecRow key={k} label={k} value={v} color="#4a9d7f" />
            ))}
          </div>
        </Section>

        {/* Contextual Logic */}
        {(cl.exclusion_rules.length > 0 || cl.soft_preferences.length > 0) && (
          <Section title="Your Rules">
            {cl.exclusion_rules.length > 0 && (
              <div className={styles.specGroup}>
                <p className={styles.subhead}>Hard exclusions</p>
                {cl.exclusion_rules.map((r, i) => (
                  <div key={i} className={styles.ruleRow}>
                    <span className={`${styles.tag} ${styles.tagDeny}`}>{r.type}</span>
                    <span>{r.name}</span>
                    {r.reason && <span className={styles.ruleReason}>— {r.reason}</span>}
                  </div>
                ))}
              </div>
            )}
            {cl.soft_preferences.length > 0 && (
              <div className={styles.specGroup}>
                <p className={styles.subhead}>Soft preferences</p>
                {cl.soft_preferences.map((p, i) => (
                  <div key={i} className={styles.ruleRow}>
                    <span>{p.signal}</span>
                    <span className={styles.tag}>weight {Math.round(p.weight_modifier * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Learning Loop */}
        {ll.open_questions.length > 0 && (
          <Section title="Open Questions">
            <div className={styles.questions}>
              {ll.open_questions.map((q, i) => (
                <p key={i} className={styles.question}>
                  <span className={styles.questionMark}>?</span>
                  <span>{q}</span>
                </p>
              ))}
            </div>
          </Section>
        )}

        {/* Stretch picks summary */}
        {ll.stretch_pick_history.length > 0 && (
          <Section title="Stretch Pick Results">
            {ll.stretch_pick_history.slice(-5).reverse().map((s, i) => (
              <div key={i} className={styles.ruleRow}>
                <span style={{ flex: 1 }}>{s.title}</span>
                <span
                  className={styles.tag}
                  style={
                    s.accepted
                      ? { background: 'var(--wtw-green-soft)', color: 'var(--wtw-green)' }
                      : undefined
                  }
                >
                  {s.reaction ?? (s.accepted ? 'watched' : 'skipped')}
                </span>
              </div>
            ))}
          </Section>
        )}

        <p className={styles.footer}>
          Schema v{metadata.schema_version} · {metadata.total_sessions} session
          {metadata.total_sessions !== 1 ? 's' : ''}
        </p>
      </div>
    </main>
  )
}
