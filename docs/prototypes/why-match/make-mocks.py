"""Why it's a match (2026-11-05): still mock-ups, one JPEG per case.

The backlog task "Strip 'Why it's a match' down to the why". Built on the app's
real compiled CSS (../search/app.css, saved from the running dev server) and the
real feed card markup from the Search mocks, so only the rules marked WHY below
are new. Section labels, crew rows and the "Doesn't quite fit" rows are the
live WhyPanel's own classes (src/app/components/RecCard.module.css).
Real posters and title data from our catalogue (titles table, 2026-11-05):
pacing_tag, tone_tags (only the five tones the engine scores), genre, language,
cast and director. The written reasons, bar lengths and the person rated down
are made up for the mock. Run from anywhere:
    python3 docs/prototypes/why-match/make-mocks.py
"""
import importlib.util, os, re, subprocess

OUT = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('search', os.path.join(OUT, '..', 'search', 'make-mocks.py'))
S = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(S)
R, A, W, H = S.R, S.A, S.W, S.H
def C(c): return ' '.join('RecCard-module__4UCK-G__' + x for x in c.split())

X = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
# lucide TriangleAlert, size 20, stroke 1.5 — as in WhyPanel
WARN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'

CSS = S.CSS + f"""
/* WHY: the page under the sheet goes dark */
.scrim{{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,var(--dim,.65))}}
/* WHY: the sheet. Solid dark (the feed's dark-50), no poster behind it */
.sheet{{position:absolute;left:0;right:0;top:var(--top);bottom:0;z-index:41;display:flex;flex-direction:column;
  background:#161614;border-radius:24px 24px 0 0;box-shadow:0 -10px 34px rgba(0,0,0,.55);overflow:hidden}}
.sheet{{--rv-yellow:#ffa900;--rv-white-70:rgba(255,255,255,.7)}}
.grab{{flex:none;width:36px;height:4px;margin:8px auto 0;border-radius:2px;background:rgba(255,255,255,.28)}}
.shead{{flex:none;display:flex;align-items:flex-start;gap:12px;padding:10px 10px 0 20px}}
.shead .{R('cardTitleBlock')}{{padding-top:8px}}
.sbody{{padding:0 20px 40px}}
.sbody .{C('whyPanel')}{{padding-top:22px}}
/* WHY: bars only, no weight and no number, so the bar takes the room they had */
.sbody .{C('scoreLabel')}{{flex:0 0 112px}}
.sbody .{C('scoreTrack')}{{flex:1 1 auto}}
/* WHY: the written reason, unboxed */
.sbody .{C('whyText')} em{{font-style:italic}}
.sbody .muted{{color:rgba(255,255,255,.7)}}
/* WHY: "Label: value" lines — grey label, white value, values lined up */
.kv{{display:grid;grid-template-columns:96px 1fr;gap:12px 16px;font-size:16px;line-height:1.3}}
.kv dt{{color:rgba(255,255,255,.7)}}
.kv dd{{margin:0;color:#fff}}
"""


def page(view, overlay, h):
    return f"""<!doctype html><html class="dark" style="--h:{h}px"><head><meta charset="utf-8"><link rel="stylesheet" href="../search/app.css"><style>{CSS}</style></head>
<body class="inter_3d9c7ff2-module__6cOLqa__variable font-sans"><div class="{A('page')}"><div class="{A('app')}"><div class="{A('appInner')}"><div class="{A('shell')}">
{view}{overlay}</div></div></div></div></body></html>"""


def feed(t):
    return f'<div class="{R("view")}">{S.header("Recommendations")}<div class="{R("content")}"><div class="{R("list")}">{S.card(t)}</div></div></div>'


def sec(label, body, warn=False):
    return f'<div class="{C("whySection")}"><div class="{C("whySectionLabelWarn" if warn else "whySectionLabel")}">{label}</div>{body}</div>'


def em(s): return re.sub(r'\*([^*]+)\*', r'<em>\1</em>', s)


def sheet(t, top, dim=.65):
    bars = ''.join(f'<div class="{C("scoreRow")}"><div class="{C("scoreLabel")}"><span>{l}</span></div>'
                   f'<div class="{C("scoreTrack")}"><div class="{C("scoreFill")}" style="width:{v * 100:.0f}%"></div></div></div>'
                   for l, v in zip(('Crew', 'Narrative', 'Mood &amp; pace', 'Reviews', 'Recency'), t['bars']))
    story = '<dl class="kv">' + ''.join(f'<dt>{k}:</dt><dd>{v}</dd>' for k, v in t['story']) + '</dl>'
    if t['crew']:
        crew = ''.join(f'<div class="{C("crewRow")}"><div class="{C("crewInfo")}"><span class="{C("crewName")}">{n}</span>'
                       f'<span class="{C("crewRole")}">{r}</span></div></div>' for n, r in t['crew'])
    else:
        crew = f'<div class="{C("whyText")} muted">No one you follow is in this one.</div>'
    parts = [sec('Why', f'<div class="{C("whyText")}">{em(t["explanation"])}</div>'),
             sec('Score breakdown', bars), sec('What it’s like', story), sec('Crew', crew)]
    if t.get('against'):
        parts.append(sec('Doesn’t quite fit', ''.join(f'<div class="{C("negRow")}"><span class="{C("negIcon")}">{WARN}</span><span>{a}</span></div>' for a in t['against']), warn=True))
    meta = (f'<div class="{R("cardMeta")}"><span>{t["year"]}</span><span>{t["meta"]}</span>'
            f'<span class="{R("metaRating")}">{S.STAR}{t["rating"]}</span></div>')
    return (f'<div class="scrim" style="--dim:{dim}"></div><div class="sheet" style="--top:{top}px"><div class="grab"></div>'
            f'<div class="shead"><div class="{R("cardTitleBlock")}"><h2 class="{R("heroTitle")}">{t["title"]}</h2>{meta}</div>'
            f'<button class="{R("headerBtn")}" aria-label="Close">{X}</button></div>'
            f'<div class="sbody"><div class="{C("whyPanel")}">{"".join(parts)}</div></div></div>')


# ── the data ──────────────────────────────────────────────────────
SLOW = dict(S.SLOW_HORSES,
    explanation='Gary Oldman is one of the actors you rate highest, and this is the cynical, darkly funny spy story you keep coming back to: '
                'think *Tinker Tailor Soldier Spy*, played for laughs. Your one likely reservation: the first episode is slow to get going.',
    bars=(.84, .86, .78, .80, .88),
    story=(('Pacing', 'moderate'), ('Tone', 'cynical, dark, comedic'), ('Genre', 'crime'), ('Language', 'English')),
    crew=(('Gary Oldman', 'Actor'), ('Kristin Scott Thomas', 'Actor')))

PAST = dict(title='Past Lives', year=2023, meta='1h 46m', rating='7.7', poster='/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg', match=81,
    why='Why it’s a match',
    reason='A quiet, hopeful love story about the life you didn’t choose, close to <em>Aftersun</em> and <em>Lost in Translation</em>, two you loved.',
    explanation='A quiet, hopeful drama about the people we might have been, close to *Aftersun* and *Lost in Translation*, two you loved. '
                'Slow-burning stories that land softly are the ones you rate highest.',
    bars=(0, .84, .80, .77, .88),
    story=(('Pacing', 'slow burn'), ('Tone', 'hopeful'), ('Genre', 'romance'), ('Language', 'English')),
    crew=())

WHALE = dict(title='The Whale', year=2022, meta='1h 57m', rating='7.8', poster='/jQ0gylJMxWSL490sy0RrPj1Lj7e.jpg', match=74,
    why='Why it’s a match',
    reason='Brendan Fraser in the kind of dark, intimate drama you rate highly. Your one likely reservation: the director.',
    explanation='You’ve loved Brendan Fraser’s dramatic turns, and this is the dark, close-up kind of drama you rate highly. '
                'Your one likely reservation: it’s a Darren Aronofsky film, and you’ve rated two of Aronofsky’s down.',
    bars=(.52, .80, .74, .78, .88),
    story=(('Pacing', 'slow burn'), ('Tone', 'dark'), ('Genre', 'drama'), ('Language', 'English')),
    crew=(('Brendan Fraser', 'Actor'), ('Hong Chau', 'Actor')),
    against=('You’ve rated down other films directed by Darren Aronofsky.',))

TOP = 44
CASES = [
    ('1-sheet-opening', lambda: (feed(SLOW), sheet(SLOW, 430, .4), H)),
    ('2-full-sheet', lambda: (feed(SLOW), sheet(SLOW, TOP), H)),
    ('3-crew-matches', lambda: (feed(SLOW), sheet(SLOW, TOP), 925)),
    ('4-no-crew', lambda: (feed(PAST), sheet(PAST, TOP), 860)),
    ('5-reason-against', lambda: (feed(WHALE), sheet(WHALE, TOP), 1030)),
]

CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if __name__ == '__main__':
    import sys
    only = sys.argv[1:]
    for name, make in CASES:
        if only and not any(name.startswith(o) for o in only): continue
        fn = f'{OUT}/{name}'
        view, overlay, h = make()
        open(f'{fn}.html', 'w').write(page(view, overlay, h))
        subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', f'--window-size={W},{h}',
                        '--force-device-scale-factor=2', '--virtual-time-budget=8000', f'--screenshot={fn}.png', f'file://{fn}.html'], capture_output=True)
        subprocess.run(['sips', '-c', str(h * 2), str(W * 2), '--cropOffset', '0', '0', f'{fn}.png', '--out', f'{fn}.png'], capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', f'{fn}.png', '--out', f'{fn}.jpg'], capture_output=True)
        os.remove(f'{fn}.png')
        print(name)
