"""My taste, v2 (#249 / P2-U8): still mock-ups, one JPEG per case, with an explanation under each.

The page shell, cards and people rows are the live page's own CSS and classes (assets/app*.css,
saved from the dev server on 2026-11-07, same as docs/prototypes/taste-dna). The scale rows copy
the season's AxisRow exactly (src/app/play/play.css .axis/.track/.dot). The genre rows use the
genre screen's own icons, colours, wash and Love/Like/Never icons (GenreStep.tsx, onboarding.css).

Data: real, read once from the live database on 2026-11-13 (read-only) into a file OUTSIDE the
repo (the repo is public: ratings never go in it). Pass its path:

    python3 build.py /path/to/dna-dump.json <new-user id> <alon id> [case-prefix ...]
"""
import html, json, os, re, subprocess, sys
from collections import Counter

OUT = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(f'{OUT}/../../..')
DUMP = {u['id']: u for u in json.load(open(sys.argv[1]))}
NEW, ALON = DUMP[sys.argv[2]], DUMP[sys.argv[3]]   # the account that went through the new onboarding today; Alon (ids passed in, never committed)
W = 375
IMG = 'https://image.tmdb.org/t/p/w185'
LUCIDE = f'{ROOT}/node_modules/lucide-react/dist/esm/icons'


def D(c): return ' '.join('dna-module__DPj9xq__' + x for x in c.split())
def A(c): return ' '.join('WTWApp-module__gS1tAq__' + x for x in c.split())


def icon(name, size=24, sw=1.75):
    src = open(f'{LUCIDE}/{name}.mjs').read()
    alias = re.search(r"export \{ default \} from './([\w-]+)\.mjs'", src)
    if alias: return icon(alias.group(1), size, sw)
    els = ''
    for tag, attrs in re.findall(r'\[\s*"(\w+)",\s*\{([^}]*)\}', src):
        a = ' '.join(f'{k}="{v}"' for k, v in re.findall(r'(\w+): "([^"]*)"', attrs) if k != 'key')
        els += f'<{tag} {a}/>'
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round">{els}</svg>')


def svg(d, fill=False):   # the games' Icon set (src/app/play/components/ui.tsx)
    f = 'fill="currentColor" stroke="none"' if fill else 'fill="none" stroke="currentColor"'
    return f'<svg viewBox="0 0 24 24" {f} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{d}</svg>'


I_LOVE = svg('<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21z"/>', True)
I_LIKE = svg('<path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 2.8 1.3 2.5 3L13 9h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.1 20H7"/>')
I_NEVER = svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>')
I_LESS = svg('<path d="M7 6l5 5 5-5M7 13l5 5 5-5"/>')
I_NEUTRAL = svg('<path d="M6 12h12"/>')
BACK = '<svg viewBox="0 0 72 72" width="30" height="30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M45 54L27 36L45 18"></path></svg>'
MENU = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path></svg>'
CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
X = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

# ── The 16 genres, in the genre screen's order, with its icons and colours (GenreStep.tsx LOOK) ──
GENRES = [('comedy', 'Comedy', 'laugh', '#ffad33'), ('drama', 'Drama', 'drama', '#a565d8'), ('action', 'Action', 'flame', '#e5533c'),
          ('crime', 'Crime', 'siren', '#8aa0bd'), ('thriller', 'Thriller &amp; mystery', 'search', '#8e44ad'), ('scifi', 'Sci-fi', 'rocket', '#3a8fd9'),
          ('fantasy', 'Fantasy', 'wand-sparkles', '#6a5acd'), ('hero', 'Superheroes', 'zap', '#d63a55'), ('horror', 'Horror', 'ghost', '#c0392b'),
          ('romance', 'Romance', 'flower-2', '#ee2d8f'), ('adultanim', 'Adult animation', 'tv', '#f2c94c'), ('anim', 'Kids’ animation', 'rabbit', '#1fbf9c'),
          ('family', 'Family &amp; kids', 'toy-brick', '#7cc96b'), ('anime', 'Anime', 'origami', '#d42fb0'), ('doc', 'Documentary', 'video', '#b9a24a'),
          ('war', 'War &amp; history', 'swords', '#8b7d62')]
G = {g[0]: g for g in GENRES}

# Your call on a genre: the genre screen's three answers plus "Less of", and "Neutral" (= blank on the genre screen).
CALLS = {'never': ('Never', I_NEVER, '#ff5a4f'), 'less': ('Less of', I_LESS, '#e0a3a0'), 'neutral': ('Neutral', I_NEUTRAL, '#8c8c91'),
         'like': ('Like', I_LIKE, '#3ddc97'), 'love': ('Love', I_LOVE, '#ff4f9a')}

CSS = """
html,body{margin:0;background:#000}
body{width:375px}
.phone{position:relative;width:375px;overflow:hidden}
.phone .""" + A('page') + """{position:relative;inset:auto;width:375px;height:var(--ph)}
.phone .""" + A('app') + """{border:0!important;border-radius:0!important;box-shadow:none!important;height:100%!important;max-width:none}
*,*::before,*::after{animation:none!important;transition:none!important}
.particles{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;object-fit:cover}
.tall .""" + D('page') + """{overflow:visible!important;height:auto!important}
.quiet{margin:0;font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.7)}

/* NEW · the summary sentence */
.summary{margin:0;font-size:19px;line-height:1.4;color:#fff}

/* The season's AxisRow, exactly (play.css .axis / .track / .dot, .axes gap 9px) */
.axes{display:grid;gap:14px}
.axis{display:grid;grid-template-columns:76px minmax(0,1fr) 76px;gap:8px;align-items:center;font-size:13.5px;color:#8A8A8E;line-height:1.45}
.axis .r{text-align:right}
.axis.lean-l .l,.axis.lean-r .r{color:#F2F2F2;font-weight:600}
.axis.flat{opacity:.45}
.track{position:relative;height:6px;border-radius:3px;background:#1E1E22}
.track::before{content:"";position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:rgba(255,255,255,.14)}
.dot{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:#D49B3A;transform:translate(-50%,-50%);box-shadow:0 0 10px rgba(212,155,58,.45)}

/* NEW · genre rows: the genre screen's row (icon, name, wash) with your call on the right */
.never-line{margin:0 0 6px;font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.7)}
.grows{display:flex;flex-direction:column;margin:0 -4px}
.grow{position:relative;overflow:hidden;display:grid;grid-template-columns:26px minmax(0,1fr) auto 16px;gap:12px;align-items:center;
  padding:11px 4px;border-bottom:1px solid rgba(255,255,255,.1)}
.grow:last-child{border-bottom:0}
.grow>*{position:relative;z-index:1}
.gwash{position:absolute!important;inset:0;z-index:0!important;pointer-events:none;
  background:linear-gradient(90deg,color-mix(in srgb,var(--gc) 22%,transparent),transparent 62%)}
.gline{display:grid;place-items:center;width:26px;height:26px;color:#5c5c61}
.grow.rated .gline{color:var(--gc);filter:drop-shadow(0 0 6px color-mix(in srgb,var(--gc) 70%,transparent))}
.gtext{min-width:0}
.glabel{font-size:17px;line-height:1.25;color:rgba(255,255,255,.72)}
.grow.rated .glabel{color:#fff}
.gsays{font-size:13.5px;line-height:1.35;color:rgba(255,255,255,.6);margin-top:2px}
.gsays.thin{color:rgba(255,255,255,.38)}
.call{display:grid;place-items:center;width:44px;height:36px;border-radius:8px;background:#2a2a2d;color:var(--cc)}
.call svg{width:20px;height:20px}
.chev{display:flex;color:rgba(255,255,255,.4)}

/* NEW · the crowd line */
.crowd{margin:0;font-size:17px;line-height:1.4;color:#fff}

/* People (unchanged from docs/prototypes/taste-dna) */
.prow{display:grid;grid-template-columns:minmax(0,1fr) 104px 16px;align-items:center;gap:12px}
.pname{font-size:16px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pfrom{font-size:13.5px;color:rgba(255,255,255,.7);margin-top:2px}
.mtrack{height:6px;border-radius:3px;background:rgba(255,255,255,.2);overflow:hidden}
.mfill{height:100%;border-radius:3px;background:#ffa900}

/* The sheet: same as the person sheet / "Why it's a match" */
.scrim{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,.65)}
.sheet{position:absolute;left:0;right:0;top:var(--top);bottom:0;z-index:41;display:flex;flex-direction:column;
  background:#161614;border-radius:24px 24px 0 0;box-shadow:0 -10px 34px rgba(0,0,0,.55);overflow:hidden;color:#fff;font-family:var(--font-inter),Inter,system-ui,sans-serif}
.grab{flex:none;width:36px;height:4px;margin:8px auto 0;border-radius:2px;background:rgba(255,255,255,.28)}
.shead{flex:none;display:flex;align-items:flex-start;gap:12px;padding:10px 10px 0 20px}
.stitle{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-top:8px}
.stitle h2{margin:0;font-size:23px;font-weight:700;line-height:1.2;color:#fff;display:flex;align-items:center;gap:10px}
.stitle h2 i{display:grid;color:var(--gc);filter:drop-shadow(0 0 6px color-mix(in srgb,var(--gc) 70%,transparent))}
.smeta{font-size:13.5px;color:rgba(255,255,255,.7)}
.sclose{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:0;color:#fff}
.sbody{padding:20px 20px 40px;display:flex;flex-direction:column;gap:16px;overflow:hidden}
.ask{margin:0;font-size:17px;color:#fff}
.seg{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.opt{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;height:62px;border-radius:10px;background:#2a2a2d;
  color:#8c8c91;font-size:12.5px;border:1.5px solid transparent}
.opt svg{width:22px;height:22px}
.opt.on{color:var(--cc);border-color:var(--cc);background:color-mix(in srgb,var(--cc) 14%,#2a2a2d)}
.opt.on span{color:#fff;font-weight:500}
.does{margin:-4px 0 0;font-size:13.5px;line-height:1.45;color:rgba(255,255,255,.7)}
.sub2{margin:8px 0 0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55)}
.trow{display:flex;align-items:center;gap:14px}
.trow img{width:46px;height:69px;border-radius:6px;object-fit:cover;flex:none;background:#0e0e10}
.tinfo{flex:1;min-width:0}
.tname{font-size:16px;color:#fff;line-height:1.25}
.tyear{font-size:13.5px;color:rgba(255,255,255,.7);margin-top:2px}
.mark{flex:none;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px;border-radius:999px;
  background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);font-size:13.5px}
.mark .e{color:#fff}

/* The explanation under each mock */
.cap{box-sizing:border-box;width:375px;padding:14px 16px 18px;background:#f4f1ea;color:#1b1b1b;border-top:3px solid #D49B3A;
  font:400 13.5px/1.45 Inter,system-ui,sans-serif}
.cap h3{margin:0 0 6px;font-size:15px;font-weight:600;color:#8a5a00}
.cap p{margin:0 0 7px}.cap p:last-child{margin:0}
.cap b{font-weight:600}
"""

SHELL = """<!doctype html><html class="dark"><head><meta charset="utf-8">
<link rel="stylesheet" href="assets/app1.css"><link rel="stylesheet" href="assets/app2.css"><link rel="stylesheet" href="assets/app3.css">
<style>{css}</style></head>
<body class="inter_3d9c7ff2-module__6cOLqa__variable font-sans"><div class="phone {mode}" style="--ph:{ph}"><div class="{page}"><div class="{app}">
<img class="particles" src="assets/particles.png" alt="">
<div class="{inner}"><main class="{main}" id="main">{header}<div class="{cont}">{content}</div></main></div>{overlay}</div></div></div>
<div class="cap">{cap}</div>
<script>
const go=()=>{{const m=document.getElementById('main');const s='{scroll}';
if(s.startsWith('#')){{const el=document.querySelector(s);m.scrollTop=el.offsetTop-12}}else if(s==='max')m.scrollTop=m.scrollHeight;else m.scrollTop=+s;
document.title=JSON.stringify({{main:m.scrollHeight,body:document.body.scrollHeight}})}};
document.fonts.ready.then(()=>{{go();setTimeout(go,300)}});
</script></body></html>"""


def page(u, content, cap, overlay='', scroll='0', tall=False, ph=812):
    header = (f'<header class="{D("header")}"><button type="button" class="{D("backBtn")}">{BACK}</button>'
              f'<div class="{D("headerTitleBlock")}"><h1 class="{D("title")}">My taste</h1>'
              f'<p class="{D("subtitle")}">{u["rows"]} ratings{f" · {u[chr(112)+chr(97)+chr(105)+chr(114)+chr(115)]} picks" if u["pairs"] else ""} · updated 13 Nov</p></div>'
              f'<div class="{A("userMenuWrap")}"><button class="{A("hamburgerBtn")}" type="button">{MENU}</button></div></header>')
    return SHELL.format(css=CSS, mode='tall' if tall else '', ph=f'{ph}px', page=A('page'), app=A('app'), inner=A('appInner'),
                        main=D('page'), cont=D('container'), header=header, content=content, overlay=overlay, scroll=scroll, cap=cap)


def section(title, body, sid=''):
    return (f'<section class="{D("section")}"{f" id={sid!r}" if sid else ""}><div class="{D("sectionHead")}">'
            f'<h2 class="{D("sectionTitle")} {D("sectionTitleAccent")}">{title}</h2></div>{body}</section>')


# ── How you like it: the 11 scales (backlog spec: lean = weight ÷ 0.4; sure = rated titles clearly at one end, 8+ = full) ──
SCALES = ['commit', 'complex', 'dark', 'energy', 'fantastic', 'humor', 'indie', 'modern', 'pace', 'tone', 'audience']
LABELS = {'tone': ('Serious', 'Funny'), 'energy': ('Talk', 'Action'), 'pace': ('Slow burn', 'Fast'), 'dark': ('Light', 'Dark'),
          'complex': ('Easy watch', 'Puzzle'), 'fantastic': ('Real world', 'Other worlds'), 'modern': ('Classic', 'Recent'),
          'indie': ('Blockbuster', 'Off-beat'), 'humor': ('Silly', 'Dry wit'), 'commit': ('Mini-series', 'Long haul'), 'audience': ('For kids', 'For adults')}


def scale_rows(u):
    rated = [r for r in u['ratings'] if r['reaction'] in ('loved', 'liked', 'disliked')]
    series = sum(r['key'].startswith('tv:') for r in rated)
    comedies = sum('comedy' in r['g16'] for r in rated)
    rows = []
    for i, s in enumerate(SCALES):
        if s == 'humor' and comedies < 5: continue
        if s == 'commit' and series < 5: continue
        e = max(-1, min(1, u['w'][14 + i] / 0.4))
        sure = sum(1 for r in rated if r['scales'] and abs(r['scales'].get(s) or 0) >= 0.5)
        c = min(1, sure / 8)
        clear = c > 0.35 and abs(e) > 0.25   # AxisRow's own test
        rows.append((clear, abs(e), s, e, c))
    rows.sort(key=lambda x: (not x[0], -x[1]))
    out = ''
    for clear, _, s, e, c in rows:
        cls = ('lean-r' if e > 0 else 'lean-l') if clear else 'flat'
        l, r = LABELS[s]
        out += (f'<div class="axis {cls}"><span class="l">{l}</span><div class="track"><span class="dot" '
                f'style="left:{50 + e * 46:.1f}%;opacity:{0.15 + c * 0.85:.2f}"></span></div><span class="r">{r}</span></div>')
    return f'<div class="axes">{out}</div>'


# ── Genres: one row each, what your ratings say + your call ──
def tally(u, g):
    return Counter(r['reaction'] for r in u['ratings'] if g in r['g16'] and r['reaction'] in ('loved', 'liked', 'disliked'))


def says(t, call):
    n = sum(t.values())
    if n == 0: return ('Hidden from your feed' if call == 'never' else 'Nothing rated yet'), True
    if n < 3: return f'Only {n} rated so far', True
    if t['loved'] == n: return f'Loved all {n}', False
    if t['disliked'] == 0: return f'Enjoyed all {n}', False
    share = t['disliked'] / n
    if share <= .25: return f'Mostly enjoyed · {n} titles', False
    if share >= .6: return f'Mostly disliked · {n} titles', False
    return f'Mixed · {n} titles', False


def calls_of(u):
    c = dict(u['genres16'] or {})
    for r in u['rules']:   # Nevers the season made (play:never:<13 id>) count on the genres they name
        m = re.match(r'play:never:(\w+)$', r.get('id') or '')
        if m and m.group(1) in G: c[m.group(1)] = 'never'
    for p in u['less']:
        pass   # no "Less of" on any account yet
    return c


def call_pill(k):
    name, ic, col = CALLS[k]
    return f'<span class="call" style="--cc:{col}" title="{name}">{ic}</span>'


def genre_rows(u, calls):
    out = ''
    for gid, label, ic, col in GENRES:
        call = calls.get(gid)
        text, thin = says(tally(u, gid), call)
        lit = ' rated' if call else ''
        out += (f'<div class="grow{lit}" style="--gc:{col}">{"<i class=gwash></i>" if call else ""}'
                f'<i class="gline">{icon(ic)}</i><div class="gtext"><div class="glabel">{label}</div>'
                f'<div class="gsays{" thin" if thin else ""}">{text}</div></div>'
                f'{call_pill(call) if call else "<span></span>"}<span class="chev">{CHEV}</span></div>')
    nevers = [html.unescape(G[g][1]) for g, _, _, _ in GENRES if calls.get(g) == 'never']
    line = f'<p class="never-line">We’ll never show you {", ".join(nevers)}.</p>' if nevers else ''
    hint = '<p class="quiet" style="margin:-4px 0 4px">Tap a genre to get more or less of it.</p>'
    return section('Genres', hint + line + f'<div class="grows">{out}</div>', sid='genres')


def crowd(u):
    w = u['w'][0]
    t = ('You tend to love what everybody loves.' if w >= .30 else
         'Sometimes you’re with the crowd, sometimes not.' if w >= .10 else
         'You don’t go by popularity: plenty of crowd favourites leave you cold.')
    return section('You and the crowd', f'<p class="crowd">{t}</p>', sid='crowd')


def people(u):
    body = ''
    for role in ('directors', 'writers', 'actors'):
        ps = sorted(u['people'][role], key=lambda p: (-p['score'], -p['n']))[:5]
        if not ps: continue
        rows = ''.join(f'<div class="prow"><div><div class="pname">{p["name"]}</div><div class="pfrom">from {p["n"]} titles</div></div>'
                       f'<div class="mtrack"><div class="mfill" style="width:{min(max(p["score"] / .30, 0), 1) * 100:.0f}%"></div></div>'
                       f'<span class="chev">{CHEV}</span></div>' for p in ps)
        body += f'<div class="{D("group")}"><div class="{D("groupHead")}"><span class="{D("groupName")}">{role.capitalize()}</span></div>{rows}</div>'
    if not body:
        body = '<p class="quiet">Rate a few titles you’ve seen and we’ll spot the directors and actors you keep coming back to.</p>'
    return section('People who pull you in', body)


def full(u, summary):
    calls = calls_of(u)
    if u.get('little'):
        top = section('In short', '<p class="quiet" style="font-size:16px">Still getting to know you. Every title you rate sharpens this page.</p>')
        return top + section('How you like it', scale_rows(u)) + genre_rows(u, calls) + people(u)
    top = section('In short', f'<p class="summary">{summary}</p>') if summary else ''
    return (top + section('How you like it', scale_rows(u))
            + genre_rows(u, calls) + crowd(u) + people(u))


# ── The genre sheet ──
DOES = {'love': 'Your feed leans towards {g} from the start. As you rate more, your ratings take over.',
        'like': 'Your feed leans a little towards {g}. As you rate more, your ratings take over.',
        'neutral': 'No lean either way: your ratings alone decide.',
        'less': 'You’ll still see {g}, just lower down your feed. Stays until you change it.',
        'never': 'We’ll never show you {g}.'}
MARK = {'loved': ('❤️', 'Loved'), 'liked': ('👍', 'Liked'), 'disliked': ('👎', 'Disliked')}


def genre_sheet(u, gid, chosen, top=150):
    _, label, ic, col = G[gid]
    t = tally(u, gid)
    text, _ = says(t, chosen)
    seg = ''.join(f'<div class="opt{" on" if k == chosen else ""}" style="--cc:{c[2]}">{c[1]}<span>{c[0]}</span></div>'
                  for k, c in CALLS.items())
    order = {'loved': 0, 'liked': 1, 'disliked': 2}
    titles = sorted((r for r in u['ratings'] if gid in r['g16'] and r['reaction'] in order),
                    key=lambda r: -(r['year'] or 0))
    rows = ''.join(f'<div class="trow"><img src="{IMG}{r["poster"]}" alt=""><div class="tinfo"><div class="tname">{r["title"]}</div>'
                   f'<div class="tyear">{r["year"] or ""}</div></div><span class="mark"><span class="e">{MARK[r["reaction"]][0]}</span>'
                   f'{MARK[r["reaction"]][1]}</span></div>' for r in titles)
    body = (f'<p class="ask">How much of it do you want?</p><div class="seg">{seg}</div>'
            f'<p class="does">{DOES[chosen].format(g=label)}</p><p class="sub2">What you rated</p>{rows}')
    return (f'<div class="scrim"></div><div class="sheet" style="--top:{top}px;--gc:{col}"><div class="grab"></div>'
            f'<div class="shead"><div class="stitle"><h2><i>{icon(ic, 26)}</i>{label}</h2><div class="smeta">{text}</div></div>'
            f'<button class="sclose">{X}</button></div><div class="sbody">{body}</div></div>')


# ── A user with very little data: this account's first 6 ratings, the taste model retrained on them the app's way
# (taste-model.ts: levels 3/2/1 centred, ridge 0.5 on crowd and 4.0 on the rest). Simulated: no picks, crowd input 0
# (the dump has no TMDB rating), genres mapped 16 → 13 as GENRE_13_OF does. People need 2 titles: nobody yet. ──
G13 = ['action', 'anim', 'anime', 'comedy', 'crime', 'doc', 'drama', 'family', 'horror', 'romance', 'scifi', 'thriller', 'war']
TO13 = {'fantasy': 'scifi', 'hero': 'scifi', 'adultanim': 'anim'}


def ridge(rows):
    d = 25
    A = [[(0.5 if i == 0 else 4.0) if i == j else 0.0 for j in range(d)] for i in range(d)]
    b = [0.0] * d
    lv = {'loved': 3, 'liked': 2, 'disliked': 1}
    mean = sum(lv[r['reaction']] for r in rows) / len(rows)
    for r in rows:
        g = sorted({TO13.get(x, x) for x in r['g16']})
        sc = r['scales'] or {}
        x = [0.0] + [1 / len(g) if k in g else 0.0 for k in G13] + [sc.get(k) or 0.0 for k in SCALES]
        y = lv[r['reaction']] - mean
        for i in range(d):
            b[i] += x[i] * y
            for j in range(d): A[i][j] += x[i] * x[j]
    for c in range(d):   # Gauss-Jordan
        piv = A[c][c]
        for j in range(d): A[c][j] /= piv
        b[c] /= piv
        for r2 in range(d):
            if r2 != c and A[r2][c]:
                f = A[r2][c]
                for j in range(d): A[r2][j] -= f * A[c][j]
                b[r2] -= f * b[c]
    return b


FIRST = [r for r in NEW['ratings'] if r['reaction'] in ('loved', 'liked', 'disliked')][:6]
LITTLE = dict(NEW, ratings=FIRST, rows=len(FIRST), pairs=0, w=ridge(FIRST), little=True,
              people={'directors': [], 'writers': [], 'actors': []})

CAP_LITTLE = """<h3>5 · A user with very little data (6 ratings)</h3>
<p><b>Simulated</b> from the same account's first 6 ratings, with the taste model retrained on just those (picks left out).</p>
<p><b>In short</b> says it's still learning instead of guessing. The scale dots are faint: few titles sit clearly at either end yet. The genre rows still show <b>your calls</b> from the genre screen at once, so the page is never empty of you. No crowd line and no people yet: both need more ratings.</p>"""

# ── Cases ──
NEW_SUMMARY = ('You go for funny, light stories, with crime above all. You tend to love what everybody loves, '
               'and anything Quentin Tarantino makes.')
ALON_SUMMARY = ''

CAP_TOP = """<h3>1a · My taste, top</h3>
<p>A real account that went through the new onboarding today (30 cards, 12 picks). All real data.</p>
<p><b>In short:</b> one sentence built from facts only (strongest scales, strongest genre, the crowd line, the strongest person).</p>
<p><b>How you like it:</b> the season's own scale rows, strongest lean first. Faded rows = no clear lean yet. This is half of every match score.</p>
<p><b>Gone:</b> Story traits, Mood &amp; pace, Open questions, Stretch picks, every %. None of them moves the feed in v2.</p>"""

CAP_GENRES = """<h3>1b · Genres, with no Rules section</h3>
<p>The 16 genres in the genre screen's order, icons and colours. Each row says two things:</p>
<p><b>Left, grey:</b> what your ratings say ("Mixed · 12 titles").<br><b>Right:</b> your call, with the genre screen's own icons: pink heart = Love, green thumb = Like, red = Never, double arrow = Less of. A row with a call lights up, as on the genre screen. No icon = neutral: the app goes by your ratings.</p>
<p>This replaces the Rules list: a rule is just your call on a genre.</p>"""

CAP_BOTTOM = """<h3>1c · The crowd and people</h3>
<p><b>You and the crowd:</b> one line from the taste model (this account follows the crowd strongly). Three wordings: with the crowd / sometimes / not at all.</p>
<p><b>People who pull you in:</b> unchanged from the earlier mock: shown from 2 rated titles, bar = how much you like their work, tap for the titles.</p>
<p>The page ends here: no Rules, no Stretch picks.</p>"""

CAP_SHEET = """<h3>2 · Tapping a genre (Action)</h3>
<p>Tapping a row opens this sheet. The heart / thumb icons on the rows are named here. Top: your call, five choices from "less" to "more": <b>Never · Less of · Neutral · Like · Love</b>. Neutral is the genre screen's "blank". Under it, one line says what the choice does to your feed, and it changes as you tap.</p>
<p>Below: <b>what you rated</b> in Action, your proof. Here they disagree, and that's the point: this account said "Love Action" but its ratings are mixed. You see both and decide.</p>
<p>Love / Like lean the feed and fade as you rate (DEC-13, Shahar's #278, not built yet). Less of and Never hold until you change them.</p>"""

CAP_ALON = """<h3>3 · Alon's genres</h3>
<p>Alon's real ratings, on the 16 genres. <b>Sci-fi: enjoyed all 28. Superheroes: mostly disliked (14 of 21).</b> Under the old single "Sci-fi &amp; fantasy" this was one muddy line; now the page tells it straight.</p>
<p>Never on Horror and Anime came from his season. Note Horror: he rated 6 and enjoyed 5, yet it's hidden. The page shows both sides without nagging; one tap changes it.</p>
<p>The model underneath still sees Sci-fi, Fantasy and Superheroes as one genre. Splitting it is a later note for Shahar.</p>"""

CAP_LESS = """<h3>4 · Alon sets "Less of" on Superheroes</h3>
<p>The fix is his to make, in two taps. "Less of" keeps superhero films in his feed, but lower down (their score × 0.7), and it holds until he changes it. It touches only Superheroes, not Sci-fi or Fantasy.</p>
<p>This is the whole "rules" feature now: no separate list, no typing. When rules about people come later, a person's sheet gets the same row of choices.</p>"""

CASES = [
    ('1a-top', lambda: page(NEW, full(NEW, NEW_SUMMARY), CAP_TOP)),
    ('1b-genres', lambda: page(NEW, full(NEW, NEW_SUMMARY), CAP_GENRES, scroll='#genres')),
    ('1c-bottom', lambda: page(NEW, full(NEW, NEW_SUMMARY), CAP_BOTTOM, scroll='#crowd')),
    ('2-genre-tapped', lambda: page(NEW, full(NEW, NEW_SUMMARY), CAP_SHEET, overlay=genre_sheet(NEW, 'action', 'love'), scroll='#genres')),
    ('3-alon-genres', lambda: page(ALON, full(ALON, ALON_SUMMARY), CAP_ALON, scroll='#genres')),
    ('5-little-data', lambda: page(LITTLE, full(LITTLE, ''), CAP_LITTLE)),
    ('4-alon-less-of', lambda: page(ALON, full(ALON, ALON_SUMMARY), CAP_LESS, overlay=genre_sheet(ALON, 'hero', 'less', top=130), scroll='#genres')),
]

CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
TMP = os.environ.get('TMPDIR', '/tmp') + '/tdna2'


def chrome(*args):
    return subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                           f'--user-data-dir={TMP}/prof', '--force-device-scale-factor=2', '--virtual-time-budget=8000', *args],
                          capture_output=True, text=True)


if __name__ == '__main__':
    os.makedirs(TMP, exist_ok=True)
    only = sys.argv[4:]
    for name, make in CASES:
        if only and not any(name.startswith(o) for o in only): continue
        fn = f'{OUT}/{name}'
        src = make()
        open(f'{fn}.html', 'w').write(src)
        # pass 1: measure (the page height for the tall case, then the caption)
        dom = chrome('--window-size=375,812', '--dump-dom', f'file://{fn}.html').stdout
        m = json.loads(html.unescape(re.search(r'<title>(.*?)</title>', dom).group(1)))
        ph = m['main'] if name == '1-full-page' else 812
        if ph != 812:
            src = src.replace('--ph:812px', f'--ph:{ph}px')
            open(f'{fn}.html', 'w').write(src)
            dom = chrome('--window-size=375,812', '--dump-dom', f'file://{fn}.html').stdout
            m = json.loads(html.unescape(re.search(r'<title>(.*?)</title>', dom).group(1)))
        h = m['body']
        chrome(f'--window-size=375,{h}', f'--screenshot={TMP}/{name}.png', f'file://{fn}.html')
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '86', f'{TMP}/{name}.png', '--out', f'{fn}.jpg'], capture_output=True)
        print(name, ph, h)
