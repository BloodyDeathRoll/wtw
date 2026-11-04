"""Search (2026-11-04): still mock-ups, one JPEG per case.

Menu → Search → type → tap a result → the same card as Recommendations, with
Add to Watchlist. Built on the app's real compiled CSS (app.css, saved from the
running dev server) and the real markup of the menu and feed card, so only the
rules marked SEARCH below are new. The search field and suggestion list copy
the Other Side game's (src/app/play/play.css .tguess, incl. the line-914
override). Real posters and data: our catalogue for "se", "slow h" and Slow
Horses; TMDB for Shtisel, which isn't in our catalogue. The keyboard is drawn
Android (Gboard, dark). Run from anywhere:
    python3 docs/prototypes/search/make-mocks.py
"""
import os, subprocess

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 375, 812
IMG = 'https://image.tmdb.org/t/p/'
def R(c): return ' '.join('RecommendationsView-module__IjrHsa__' + x for x in c.split())
def A(c): return ' '.join('WTWApp-module__gS1tAq__' + x for x in c.split())

# ── icons, copied from the rendered app ───────────────────────────
CHEV_L = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'
MENU = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/></svg>'
CHEV_R = lambda s=16.5, w=2: f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
X = lambda s=16.5, w=2: f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
STAR = f'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="{R("metaStar")}"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>'
SHARE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>'
PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>'
BOOKMARK = lambda filled: f'<svg width="16" height="16" viewBox="0 0 24 24" fill="{"currentColor" if filled else "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg>'
# src/app/components/ProviderIcon.tsx
PROVIDER = {
    'appletv': ('Apple TV+', '<rect width="24" height="24" rx="5" fill="#111"/><rect x="4.5" y="7" width="15" height="9.5" rx="1.5" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M9 19h6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M12 9.5l2 2.2-2 2.3" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
    'netflix': ('Netflix', '<rect width="24" height="24" rx="5" fill="#141414"/><path d="M7 4h3.4l6.6 16H13.6z" fill="#E50914"/><path d="M7 4v16h3.4V4zM13.6 4H17v16h-3.4z" fill="#B20710"/>'),
}

# ── new rules ─────────────────────────────────────────────────────
CSS = f"""
html,body{{margin:0;overflow:hidden}}
/* headless Chrome won't go below ~500px wide: pin the app to the phone's size, without the desktop frame */
.{A('page')}{{right:auto;bottom:auto;width:{W}px;height:var(--h)}}
.{A('app')}{{border:0!important;border-radius:0!important;box-shadow:none!important;height:100%!important;max-width:none}}
*,*::before,*::after{{animation:none!important;transition:none!important}}
.{R('posterImg')}{{opacity:1!important}}
/* SEARCH: the field and list, copied from the Other Side game (play.css .tguess + its line-914 override) */
.sbox{{display:grid;gap:6px;padding:6px 16px 0;position:relative;z-index:2}}
.sfield{{position:relative}}
.sfield .sinput{{box-sizing:border-box;width:100%;min-height:64px;display:flex;align-items:center;background:#1c1c1e;border:0;border-radius:16px;padding:20px 52px 20px 20px;color:#F2F2F2;font:inherit;font-size:20px;outline:none}}
.sfield .ph{{color:#8A8A8E}}
.sfield .caret{{display:inline-block;width:2px;height:26px;margin:0 1px;background:#F2F2F2;vertical-align:middle}}
/* SEARCH, new: a clear button inside the field once there's text */
.sfield .clear{{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:#8A8A8E;display:grid;place-items:center;padding:0}}
.slist{{display:grid;gap:4px;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:4px;background:rgba(10,8,20,.92)}}
.slist button{{display:flex;align-items:center;gap:10px;text-align:left;padding:6px 8px;border-radius:10px;background:transparent;border:0;color:#F2F2F2;font:inherit}}
.slist img,.slist .noimg{{width:28px;height:42px;border-radius:4px;object-fit:cover;background:#0E0E10;flex:none}}
.slist b{{display:block;font-size:16px;font-weight:600}}
.slist small{{font-size:13.5px;color:#8A8A8E}}
.snone{{margin:6px 0 0;font-size:14.5px;color:#5E5E62;text-align:center}}
/* SEARCH, new: no Why link on a title we haven't studied, so the text needs its own gap above the button */
.{R('heroReason')} + .{R('watchlistBtn')}{{margin-top:16px}}
/* the card under the field: the feed's list, same padding */
.{R('list')}.under{{padding-top:16px}}
/* Android keyboard (Gboard, dark theme) — system UI, drawn for the mock only */
.kb{{position:absolute;left:0;right:0;bottom:0;z-index:30;background:#1f1f1f;padding:0 3px 0;font-family:Roboto,system-ui,sans-serif;color:#e3e3e3}}
.kb .sug{{height:42px;display:flex;align-items:center;justify-content:space-around;font-size:15px;color:#c4c7c5;border-bottom:1px solid #2c2c2c}}
.kb .row{{display:flex;gap:5px;padding:0 2px;margin-top:9px}}
.kb .k{{flex:1;height:44px;border-radius:7px;background:#3a3a3a;display:grid;place-items:center;font-size:21px}}
.kb .k.f{{background:#2c2c2c;font-size:14px}}
.kb .k.go{{background:#a8c7fa;color:#062e6f}}
.kb .row.mid{{padding:0 18px}}
.kb .nav{{height:30px;display:grid;place-items:center}}
.kb .nav i{{display:block;width:108px;height:4px;border-radius:2px;background:#c4c7c5;opacity:.8}}
"""

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap">'


def page(view, overlay='', h=H):
    return f"""<!doctype html><html class="dark" style="--h:{h}px"><head><meta charset="utf-8">{FONTS}<link rel="stylesheet" href="app.css"><style>{CSS}</style></head>
<body class="inter_3d9c7ff2-module__6cOLqa__variable font-sans"><div class="{A('page')}"><div class="{A('app')}"><div class="{A('appInner')}"><div class="{A('shell')}">
{view}{overlay}</div></div></div></div></body></html>"""


def header(title):
    return (f'<div class="{R("header")}"><button class="{R("headerBtn")}">{CHEV_L}</button><span class="{R("headerTitle")}">{title}</span>'
            f'<div class="{R("headerRight")}"><div class="{A("userMenuWrap")}"><button class="{A("hamburgerBtn")}">{MENU}</button></div></div></div>')


def field(text='', caret=True):
    car = '<span class="caret"></span>' if caret else ''
    if text:
        body, clr = f'<span>{text}</span>{car}', f'<button class="clear">{X(22, 2)}</button>'
    else:
        body, clr = f'{car}<span class="ph">Search movies and series</span>', ''
    return f'<div class="sfield"><div class="sinput">{body}</div>{clr}</div>'


def results(rows):
    out = ''.join(f'<button><img src="{IMG}w92{p}" alt=""><span><b>{t}</b><small>{y}{" · series" if tv else ""}</small></span></button>' for t, y, tv, p in rows)
    return f'<div class="slist">{out}</div>'


KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
def keyboard(sugs=('', '', '')):
    r1 = ''.join(f'<span class="k">{c}</span>' for c in KEYS[0])
    r2 = ''.join(f'<span class="k">{c}</span>' for c in KEYS[1])
    r3 = '<span class="k f" style="flex:1.5">⇧</span>' + ''.join(f'<span class="k">{c}</span>' for c in KEYS[2]) + '<span class="k f" style="flex:1.5">⌫</span>'
    r4 = ('<span class="k f" style="flex:1.6">?123</span><span class="k f">,</span><span class="k f">☺</span>'
          '<span class="k" style="flex:4.2"></span><span class="k f">.</span><span class="k go" style="flex:1.6">'
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></span>')
    s = ''.join(f'<span>{x}</span>' for x in sugs)
    return (f'<div class="kb"><div class="sug">{s}</div><div class="row">{r1}</div><div class="row mid">{r2}</div>'
            f'<div class="row">{r3}</div><div class="row">{r4}</div><div class="nav"><i></i></div></div>')


def card(t, saved=False):
    where = ''
    if t.get('where'):
        label, icon = PROVIDER[t['where']]
        where = f'<div class="{R("whereBadge")}"><svg viewBox="0 0 24 24" width="16" height="16" class="{R("whereIcon")}">{icon}</svg><span>{label}</span></div>'
    ring = ''
    if t.get('match'):
        ring = (f'<div class="{R("matchRing heroRing")}"><div class="{R("matchRingInner")}"><span><span class="{R("matchRingPct")}">{t["match"]}</span>'
                f'<span class="{R("matchRingSign")}">%</span></span></div></div>')
    why = (f'<button class="{R("whyLink")}"><span>{t["why"]}</span>{CHEV_R(18, 2.2)}</button>') if t.get('why') else ''
    label = 'Remove from watchlist' if saved else 'Add to Watchlist'
    btn = f'<button class="{R("watchlistBtn watchlistBtnPrimary")}{" " + R("watchlistBtnSaved") if saved else ""}">{BOOKMARK(saved)}<span>{label}</span></button>'
    chips = ''.join(f'<button class="{R("seenChip")}"><span class="{R("chipEmoji")}">{e}</span><span>{l}</span></button>' for e, l in (('❤️', 'Loved'), ('👍', 'Liked'), ('👎', 'Disliked')))
    chips += f'<button class="{R("seenChip seenChipRemove")}">{X(18, 1.8)}</button>'
    return f"""<article class="{R('card heroCard')}"><div class="{R('hero')}">
<div class="{R('poster poster_hero')}" style="background:rgb(30,30,34)"><img class="{R('posterImg posterImgLoaded')}" src="{IMG}w500{t['poster']}" alt=""></div>
<div class="{R('heroShade')}"></div>{where}{ring}
<div class="{R('heroFoot')}"><div class="{R('cardTitleBlock')}"><h3 class="{R('heroTitle')}">{t['title']}</h3>
<div class="{R('cardMeta')}"><span>{t['year']}</span><span>{t['meta']}</span><span class="{R('metaRating')}">{STAR}{t['rating']}</span></div></div>
<div class="{R('heroCircles')}"><button class="{R('trailerCircle')}">{SHARE}</button><button class="{R('trailerCircle')}">{PLAY}</button></div></div></div>
<div class="{R('heroBody')}"><p class="{R('heroReason')}">{t['reason']}</p>{why}{btn}
<div class="{R('seenIt')}"><span class="{R('seenItPrompt')}">Seen it? Tell me how it was</span><div class="{R('seenItRow')}">{chips}</div></div></div></article>"""


# ── the data ──────────────────────────────────────────────────────
# Our catalogue, `title ilike 'se%'` by vote count (run 2026-11-04)
SE = [('Se7en', 1995, 0, '/191nKfP0ehp3uIvWqgPbFmI4lv9.jpg'), ('Sex Education', 2019, 1, '/bc3bmTdnoKcRuO9xdQKgAbB7Y9Z.jpg'),
      ('Seven Pounds', 2008, 0, '/85zUipgVy2QbvAJ6djZXYaGckMv.jpg'), ('Seven Psychopaths', 2012, 0, '/4ukEYAxlSivFcDG6vLxJB6PjTjg.jpg'),
      ('Searching', 2018, 0, '/yuAPCsCGJGSxA7YOW4elF5JNrzK.jpg')]
# 'slow h': Slow Horses from our catalogue, then TMDB's next match
SLOWH = [('Slow Horses', 2022, 1, '/5RuZZIouptatjV96BdPmKmRsnGg.jpg'), ('Slow Boat Home', 2013, 1, '/fOWRYC3s5MFw1cB2BlHNjXcz7jH.jpg')]
# 'shtisel': not in our catalogue, so only TMDB has it
SHTI = [('Shtisel', 2013, 1, '/rzzhyWdTqLSzgOuVYoBLKPXLtXN.jpg')]

SLOW_HORSES = dict(title='Slow Horses', year=2022, meta='Series', rating='8.0', poster='/5RuZZIouptatjV96BdPmKmRsnGg.jpg', where='appletv', match=86,
                   why='Why it’s a match',
                   reason='A sharp, darkly funny spy story led by the kind of brilliant, impossible character you keep rating high—think <em>Tinker Tailor Soldier Spy</em>.')
SHTISEL = dict(title='Shtisel', year=2013, meta='Series', rating='7.9', poster='/rzzhyWdTqLSzgOuVYoBLKPXLtXN.jpg', where='netflix', match=None, why=None,
               reason='New to WTW: we haven’t studied this one yet, so there’s no match score. Save it and we’ll get to know it.')


def search(body='', text='', kb=True, sugs=('', '', ''), caret=True):
    view = (f'<div class="{R("view")}">{header("Search")}<div class="sbox">{field(text, caret and kb)}{body}</div></div>')
    return page(view, keyboard(sugs) if kb else '')


def with_card(t, saved=False):
    view = (f'<div class="{R("view")}">{header("Search")}<div class="sbox">{field(t["title"], False)}</div>'
            f'<div class="{R("content")}"><div class="{R("list")} under">{card(t, saved)}</div></div></div>')
    return page(view, h=TALL)


def menu():
    items = ['Recommendations', 'Watchlist', 'Play', 'Search', 'My Ratings', 'My Taste DNA']
    rows = ''.join(f'<button class="{A("userMenuItem")}"><span>{i}</span><span class="{A("userMenuTrail")}">{CHEV_R()}</span></button>' for i in items)
    rows += f'<button class="{A("userMenuItem")}"><span>Set Voice</span><span class="{A("userMenuTrail")}">Aoede{CHEV_R()}</span></button>'
    rows += f'<button class="{A("userMenuItem")}">Sign out</button>'
    head = (f'<div class="{A("userMenuHeader")}"><span class="{A("userMenuAvatarInitial")}" style="background:#4aa3c2;color:#fff">S</span>'
            f'<div class="{A("userMenuHeaderText")}"><div class="{A("userMenuName")}">Solomon Kaputnik</div><div class="{A("userMenuEmail")}">solomonkaputnik@gmail.com</div></div>'
            f'<button class="{A("userMenuClose")}">{X()}</button></div>')
    overlay = f'<div class="{A("userMenuOverlay")}"><div class="{A("userMenuPanel")}">{head}{rows}</div></div>'
    view = (f'<div class="{R("view")}">{header("Recommendations")}<div class="{R("content")}"><div class="{R("list")}">{card(SLOW_HORSES)}</div></div></div>')
    return page(view, overlay)


CASES = [
    ('1-menu', menu),
    ('2-search-opens', lambda: search()),
    ('3-typing-se', lambda: search(results(SE), 'se', sugs=('se', 'see', 'set'))),
    ('4-typing-slow-h', lambda: search(results(SLOWH), 'slow h', sugs=('slow h', 'how', 'home'))),
    ('5-slow-horses-card', lambda: with_card(SLOW_HORSES)),
    ('6-slow-horses-added', lambda: with_card(SLOW_HORSES, saved=True)),
    ('7-typing-shtisel', lambda: search(results(SHTI), 'shtisel', sugs=('Shtisel', 'shtisel', 'Shtisels'))),
    ('8-shtisel-card', lambda: with_card(SHTISEL)),
    ('9-no-match', lambda: search('<p class="snone">No title like that. Check the spelling?</p>', 'slwo hroses', sugs=('slow horses', 'slwo', 'hroses'))),
]

TALL = 890  # the card pages: the whole card, as if scrolled
CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if __name__ == '__main__':
    import sys
    only = sys.argv[1:]
    for name, make in CASES:
        if only and not any(name.startswith(o) for o in only): continue
        fn = f'{OUT}/{name}'
        html = make(); h = TALL if f'--h:{TALL}px' in html else H
        open(f'{fn}.html', 'w').write(html)
        subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', f'--window-size={W},{h}',
                        '--force-device-scale-factor=2', '--virtual-time-budget=8000', f'--screenshot={fn}.png', f'file://{fn}.html'], capture_output=True)
        subprocess.run(['sips', '-c', str(h * 2), str(W * 2), '--cropOffset', '0', '0', f'{fn}.png', '--out', f'{fn}.png'], capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', f'{fn}.png', '--out', f'{fn}.jpg'], capture_output=True)
        os.remove(f'{fn}.png')
        print(name)
