"""Share a title, round 3 (2026-11-03): still mock-ups, one JPEG per case.

Round 3 notes from Eran: the share icon is the forward-pointing arrow
(Instagram, YouTube), on the homepage too; the "+" ribbon gets the same white
hairline as the share circle; game posters carry no trailer button (only the
Recommendations and Watchlist cards do). The share sequence (6-8) is approved
as it was in round 2, redrawn here with the new icon.

Round 2 notes:

Eran's notes on round 1: the share icon is the homepage's three connected
dots (Lucide Share2); share must sit apart from save, never beside it; the
share sheet is Android's (his phone); the watchlist is the feed-style page,
not the old games-side list. So share lives on the poster, bottom-right, away
from the "+" (top-right) and from "Add to Watchlist".

Built on the app's real CSS (src/app/play/play.css, the feed's
RecommendationsView.module.css) plus the few new rules marked SHARE. Run from
the repo root:
    python3 docs/prototypes/share/v2/make-mocks.py [name-prefix ...]
"""
import json, os, re, subprocess, sys

OUT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(OUT, '../../../..'))
UP = '../../../..'  # from this folder to the repo root, for stylesheet and logo links
IMG = 'https://image.tmdb.org/t/p/'
W, H = 375, 812
T = {t['title']: t for t in json.load(open(f'{REPO}/src/app/play/data/titles.json'))}
DM = {'poster_path': '/yWHWC8fJRp2kLgiFrEa8o3krOH9.jpg', 'backdrop': '/yK5vziICSiW6uHLltNqkZ1TXhNx.jpg'}
DOMAIN = 'wtw-wine.vercel.app'
LINK = f'https://{DOMAIN}/t/movie-9909'

# The forward arrow (Instagram and YouTube's share), as an outline like the app's other icons.
SHARE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" width="{s}" height="{s}">'
         '<path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>')
def share_icon(s=19, sw=1.8): return SHARE.format(s=s, sw=sw)
# Lucide Share2: the homepage's icon today, for the before/after.
SHARE2 = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="30" height="30">'
          '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>')
X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
Q = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>'
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&family=Roboto:wght@400;500&display=swap">'
FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important}'

# ── the games (play.css) ─────────────────────────────────────────

PLAY_FRAME = f"""
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000;position:relative}}
.wtw-play{{--font-inter:"Inter";--font-bebas:"Bebas Neue";padding:0!important;position:absolute;inset:0;width:{W}px;height:{H}px}}
.app{{position:absolute;inset:0;background:#000;isolation:isolate;--wtw-rgb:212,155,58}}
.app::before{{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(120% 60% at 50% 115%,rgba(var(--wtw-rgb),.65) 0%,rgba(var(--wtw-rgb),.22) 35%,transparent 70%),linear-gradient(180deg,#000 50%,rgba(var(--wtw-rgb),.12) 100%)}}
.inner{{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column}}
.wtw-play {FREEZE}
/* SHARE: a round glass button on the poster's bottom-right, the opposite corner from the "+".
   The feed's trailer circle, smaller; the hairline keeps it visible on dark posters. */
.wtw-play .shc{{position:absolute;z-index:3;right:8px;bottom:8px;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;padding:0 1px 0 0;
  border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;cursor:pointer}}
/* SHARE: the "+" ribbon gets the share circle's white hairline (sides and notch; the top hangs off the poster's edge) */
.wtw-play .rib{{clip-path:none;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 44'%3E%3Cpath d='M.5 0V43.1L16 35.3l15.5 7.8V0' fill='rgba(10,10,14,.74)' stroke='rgba(255,255,255,.35)'/%3E%3C/svg%3E") center/100% 100% no-repeat}}
"""


def play_page(acc, screen):
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}
<link rel="stylesheet" href="{UP}/src/app/play/play.css"><style>{PLAY_FRAME}</style></head><body>
<div class="wtw-play"><div class="app"><div class="inner"><div class="phone arcade" style="--gacc:{acc}"><div class="screen game-screen">
{screen}
</div></div></div></div></div></body></html>"""


def top(name, level):
    return (f'<div class="topbar"><button class="hb">{X}</button><div class="gtitle">{name}</div><button class="hb r">{Q}</button></div>'
            f'<div class="glevel">{level}</div>')


RIB = '<button class="rib"><span>+</span></button>'


def poster(t):
    tvb = '<span class="tvb">SERIES</span>' if t['type'] == 'tv' else ''
    return f'<div class="poster real"><img src="{IMG}w342{t["poster_path"]}" alt="">{tvb}<button class="shc">{share_icon()}</button></div>'


SEEN = ('<div class="seen-it"><p class="seen-prompt">Seen it? Tell me how it was</p><div class="seen-btns three">'
        '<button class="seen-chip"><span class="seen-emoji">❤️</span>Loved</button>'
        '<button class="seen-chip"><span class="seen-emoji">👍</span>Liked</button>'
        '<button class="seen-chip"><span class="seen-emoji">👎</span>Disliked</button></div></div>')


def other():
    t = T['Eternal Sunshine of the Spotless Mind']
    body = ('<div class="gstage"><div class="ptsrow"><span>Story 2 of 4</span><span>Points <b>10</b></span></div>'
            '<div class="reveal-card other-reveal"><div class="verdict-tag ok">✓ +5 points</div>'
            f'<div class="reveal-poster">{poster(t)}{RIB}</div><h2>{t["title"]}</h2>'
            f'<div class="other-after">{SEEN}<button class="cta">Next story</button></div></div></div>')
    return play_page('#ff5fa2', top('The Other Side of the Story', 'LEVEL <b>2</b> · 4 stories') + body)


def blind():
    t = T['The Mandalorian']
    dots = ''.join(f'<i class="{"on" if k == 0 else ""}"></i>' for k in range(5))
    body = (f'<div class="gstage blind-play"><div class="blind-dots">{dots}</div>'
            '<div class="blind-screen reveal-card"><small class="blind-eyebrow">You\'d watch it. Here\'s the cover</small>'
            f'<div class="reveal-poster blind-unveil">{poster(t)}{RIB}</div>'
            f'<h2 class="blind-rise r1">{t["title"]}</h2>'
            '<p class="q blind-rise r2">2019 · Disney+ · <span class="blind-star">★ 8.4</span></p>'
            '<p class="cover-line blind-rise r3">It\'s a series: 3 seasons, 24 episodes.</p>'
            '<div class="blind-after blind-rise r4"><button class="cta">Next story</button>'
            '<div class="row-btns"><button class="opt">Seen it</button><button class="opt">Changed my mind</button></div></div></div></div>')
    return play_page('#3ddc97', top('Blind Taste Test', 'LEVEL <b>2</b> · Longer than you think') + body)


def hilo():
    a, b = T['Inception'], T['Arrival']
    def side(t, val):
        return f'<div class="side">{RIB}<div class="pick">{poster(t)}<div><div class="nm">{t["title"]}</div></div></div><div class="hilo-val">{val}</div></div>'
    body = ('<div class="gstage hilo"><div class="ptsrow"><span>In a row: <b>2</b></span><span>5 clears the level</span></div>'
            f'<div class="duel" style="padding:0;width:100%">{side(a, "★ 8.4")}{side(b, "?")}</div>'
            f'<h2 class="gq">Is {b["title"]} rated higher or lower?</h2>'
            '<div class="row-btns" style="width:100%"><button class="opt primary">↑ Higher</button><button class="opt">↓ Lower</button></div>'
            '<p class="q" style="text-align:center">TMDB audience rating</p></div>')
    return play_page('#ffd23d', top('Higher or Lower', 'LEVEL <b>1</b> · Ratings · 5 in a row') + body)


# ── the feed card and the watchlist (RecommendationsView.module.css) ──

FEED_FRAME = f"""
:root{{--ease-out:cubic-bezier(0.23,1,0.32,1);--ease-drawer:cubic-bezier(0.32,0.72,0,1);--enter-y:8px;--wtw-border-strong:rgba(255,255,255,0.12)}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;position:relative}}
button{{font-family:inherit}}
{FREEZE}
.frame{{position:absolute;inset:0;display:flex;flex-direction:column;isolation:isolate}}
.frame::before{{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(120% 60% at 50% 115%,rgba(212,155,58,.65) 0%,rgba(212,155,58,.22) 35%,transparent 70%),linear-gradient(180deg,#000 50%,rgba(212,155,58,.12) 100%)}}
.posterImg{{opacity:1!important}}
/* SHARE: a glass circle stacked on the trailer one, same size and look, so the title keeps its full width */
.heroFoot .circles{{display:flex;flex-direction:column;gap:10px;flex-shrink:0}}
.heroFoot .shareCircle{{width:48px;height:48px;display:grid;place-items:center;padding:0 2px 0 0;border-radius:50%;border:1px solid rgba(255,255,255,.35);
  background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff}}
"""
CHEV_L = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
CHEV_D = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
CHEV_R = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
MENU = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8z"/></svg>'
STAR = '<svg class="metaStar" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>'
def bookmark(on): return f'<svg width="16" height="16" viewBox="0 0 24 24" fill="{"currentColor" if on else "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
REASON = ('This gripping drama nails the kind of raw, character-driven storytelling you love—think <em><i>The Blind Side</i></em> meets '
          '<em><i>Stand and Deliver</i></em>, but with the gritty edge of a teacher (Michelle Pfeiffer) who refuses to give up on her students.')
ABOUT = 'A former Marine takes a teaching job at an inner-city high school, with a class everyone else has given up on. Streaming on Netflix.'


def ring(pct):
    return f'<div class="matchRing heroRing"><div class="matchRingInner"><span><span class="matchRingPct">{pct}</span><span class="matchRingSign">%</span></span></div></div>'


def card(poster_path='/yWHWC8fJRp2kLgiFrEa8o3krOH9.jpg', title='Dangerous Minds', meta=('1995', '1h 39m', '7.0'), match=83, reason=REASON,
         why='Why it’s a match', saved=False, seen=True, after=''):
    label = 'Remove from watchlist' if saved else 'Add to Watchlist'
    cta = f'<button class="watchlistBtn watchlistBtnPrimary{" watchlistBtnSaved" if saved else ""}">{bookmark(saved)}<span>{label}</span></button>'
    seen_html = ('<div class="seenIt"><span class="seenItPrompt">Seen it? Tell me how it was</span><div class="seenItRow">'
                 '<button class="seenChip"><span class="chipEmoji">❤️</span><span>Loved</span></button>'
                 '<button class="seenChip"><span class="chipEmoji">👍</span><span>Liked</span></button>'
                 '<button class="seenChip"><span class="chipEmoji">👎</span><span>Disliked</span></button>'
                 f'<button class="seenChip seenChipRemove">{X.replace("<svg", "<svg width=18 height=18")}</button></div></div>') if seen else ''
    why_html = f'<button class="whyLink"><span>{why}</span>{CHEV_R}</button>' if why else ''
    y, rt, r = meta
    return (f'<article class="card heroCard"><div class="hero"><div class="poster poster_hero" style="background:#2a2420">'
            f'<img class="posterImg" src="{IMG}w780{poster_path}" alt=""></div><div class="heroShade"></div>{ring(match) if match else ""}'
            f'<div class="heroFoot"><div class="cardTitleBlock"><h3 class="heroTitle">{title}</h3>'
            f'<div class="cardMeta"><span>{y}</span><span>{rt}</span><span class="metaRating">{STAR}{r}</span></div></div>'
            f'<div class="circles"><button class="shareCircle">{share_icon(22, 1.7)}</button><button class="trailerCircle">{PLAY}</button></div></div></div>'
            f'<div class="heroBody"><p class="heroReason">{reason}</p>{why_html}{cta}{after}{seen_html}</div></article>')


def feed_page(body, extra_css='', header='movies', top=''):
    centre = (f'<div class="typePicker"><button class="typePickerBtn">Movies{CHEV_D.format(sw=2)}</button></div>' if header == 'movies'
              else f'<span class="headerTitle">{header}</span>')
    head = (f'<div class="header"><button class="headerBtn">{CHEV_L}</button>{centre}'
            f'<div class="headerRight"><button class="headerBtn">{MENU}</button></div></div>') if header else top
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}
<link rel="stylesheet" href="{UP}/src/modules/session/recommendations/RecommendationsView.module.css"><style>{FEED_FRAME}{extra_css}</style></head><body>
<div class="frame"><div class="view">{head}<div class="content"><div class="list">{body}</div></div></div></div></body></html>"""


def feed():
    return feed_page(card())


def watchlist():
    sort = ('<div class="sortBar"><span class="sortLabel">Sort by</span><div class="sortMenu"><button class="sortTrigger">'
            f'<span>Date Added</span>{CHEV_D.format(sw=1.8)}</button></div></div>')
    body = card(saved=True) + card(T['The Mandalorian']['poster_path'], 'The Mandalorian', ('2019', '3 seasons', '8.4'), 79, saved=True)
    return feed_page(body, header='Watchlist (4)').replace('<div class="content">', sort + '<div class="content">')


# ── after the tap ────────────────────────────────────────────────

def sheet():
    """Android's own share sheet (Chrome on Eran's phone), drawn from his screenshot. WTW only hands it the title, text and link."""
    people = [('Noa', '#c86b4a', 'wa'), ('Dad', '#4a7bc8', 'wa'), ('Movie night', '#7a5ac8', 'wa'), ('Shira', '#e0559a', 'sms'), ('Yoni', '#2f8f6f', 'mail')]
    badge = {'wa': '<i class="b" style="background:#25d366"></i>', 'sms': '<i class="b" style="background:#fff"><s style="background:#1a73e8"></s></i>',
             'mail': '<i class="b" style="background:#fff"><s style="background:#ea4335"></s></i>'}
    ppl = ''.join(f'<div class="p"><div class="av" style="background:{c}">{n[0]}{badge[k]}</div><span>{n}</span></div>' for n, c, k in people)
    apps = [('Quick Share', '#3b7cf0', '<b style="color:#fff;font-size:30px">⇆</b>'), ('WhatsApp', '#25d366', '<b style="color:#fff;font-size:30px">✆</b>'),
            ('Messages', '#fff', '<s style="width:28px;height:22px;border-radius:12px 12px 12px 3px;background:#1a73e8"></s>'),
            ('Gmail', '#fff', '<b style="font:700 28px Roboto;color:#ea4335">M</b>'),
            ('Messenger<br><small>Chats</small>', '#fff', '<s style="width:28px;height:28px;border-radius:50% 50% 50% 8px;background:linear-gradient(135deg,#0a7cff,#a033ff)"></s>')]
    aps = ''.join(f'<div class="p"><div class="ap" style="background:{c}">{g}</div><span>{n}</span></div>' for n, c, g in apps)
    css = """
.dim{position:absolute;inset:0;background:rgba(0,0,0,.6);z-index:5}
.sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;background:#1d1c22;border-radius:26px 26px 0 0;padding:10px 0 26px;font-family:Roboto,Inter,sans-serif;color:#e6e1e9}
.sheet .grab{width:70px;height:4px;border-radius:2px;background:#5d5b63;margin:0 auto 18px}
.sheet h4{margin:0 18px 14px;font-size:18px;font-weight:400}
.sheet .pv{display:flex;align-items:center;gap:12px;margin:0 18px;padding:10px;border-radius:18px;background:#26252c}
.sheet .pv img{width:58px;height:58px;border-radius:14px;flex:none}
.sheet .pv div{flex:1;min-width:0;font-size:14.5px;line-height:1.35}
.sheet .pv b{display:block;font-weight:400;color:#fff}.sheet .pv span{display:block;color:#b9b5bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sheet .pv svg{flex:none;color:#cfcad6}
.sheet .chips{display:flex;justify-content:center;gap:8px;margin:14px 0 16px}
.sheet .chips span{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:18px;background:#26252c;font-size:13.5px;color:#e6e1e9}
.sheet hr{border:0;border-top:1px solid #34323a;margin:0 18px}
.sheet .row{display:flex;justify-content:space-between;padding:16px 8px 0}
.sheet .p{width:70px;text-align:center;font-size:12.5px;line-height:1.25;color:#e6e1e9}
.sheet .p span{display:block;margin-top:8px}.sheet .p small{font-size:12px;color:#b9b5bf}
.sheet .av{position:relative;width:54px;height:54px;margin:0 auto;border-radius:50%;display:grid;place-items:center;font-size:23px;font-weight:500;color:#fff}
.sheet .av .b{position:absolute;right:-3px;bottom:-3px;width:20px;height:20px;border-radius:50%;border:2px solid #1d1c22;display:grid;place-items:center}
.sheet .av .b s{width:10px;height:8px;border-radius:4px}
.sheet .ap{width:54px;height:54px;margin:0 auto;border-radius:50%;display:grid;place-items:center}
.sheet .ap s{display:block}
"""
    copy = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'
    over = (f'<div class="dim"></div><div class="sheet"><div class="grab"></div><h4>Sharing text</h4>'
            f'<div class="pv"><img src="{UP}/public/icon-192.png" alt=""><div><b>Dangerous Minds (1995)</b><span>You\'d like this one 🎬</span><span>{LINK}</span></div>{copy}</div>'
            '<div class="chips"><span>▭ Send to your device</span><span>▦ QR Code</span></div><hr>'
            f'<div class="row">{ppl}</div><div class="row">{aps}</div></div>')
    return feed_page(card(), css).replace('</body>', over + '</body>')


def whatsapp():
    css = f"""
.wa{{position:absolute;inset:0;background:#0b141a;font-family:Roboto,Inter,sans-serif;color:#e9edef}}
.wa .bar{{display:flex;align-items:center;gap:10px;padding:14px 12px;background:#1f2c34}}
.wa .bar .bk{{font-size:22px;color:#aebac1}}
.wa .bar .av{{width:38px;height:38px;border-radius:50%;background:#c86b4a;display:grid;place-items:center;font-weight:500;font-size:17px}}
.wa .bar b{{font-size:17px;font-weight:500}}.wa .bar small{{display:block;font-size:12.5px;color:#8696a0}}
.wa .chat{{padding:14px 10px;display:flex;flex-direction:column;gap:6px}}
.wa .day{{align-self:center;font-size:12px;background:#1f2c34;color:#8696a0;border-radius:8px;padding:4px 10px;margin-bottom:6px}}
.wa .in{{align-self:flex-start;max-width:78%;background:#202c33;border-radius:0 10px 10px 10px;padding:7px 10px;font-size:15px}}
.wa .out{{align-self:flex-end;width:290px;background:#005c4b;border-radius:10px 0 10px 10px;padding:4px;font-size:15px}}
.wa .cardx{{background:#025144;border-radius:7px;overflow:hidden}}
.wa .og{{position:relative;height:152px;background:url({IMG}w780{DM["backdrop"]}) center 30%/cover}}
.wa .og::after{{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.9) 0%,rgba(0,0,0,.75) 55%,rgba(0,0,0,.45) 100%)}}
.wa .og > img{{position:absolute;z-index:1;left:12px;top:12px;width:85px;height:128px;border-radius:6px;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,.6)}}
.wa .og .t{{position:absolute;z-index:1;left:110px;right:10px;top:18px;font-family:Inter;color:#fff}}
.wa .og .t b{{display:block;font-size:19px;font-weight:800;line-height:1.1}}
.wa .og .t small{{display:block;margin-top:5px;font-size:12.5px;color:rgba(255,255,255,.8)}}
.wa .og .t .brand{{display:flex;align-items:center;gap:4px;margin-top:26px;font-size:15px;font-weight:600;letter-spacing:.02em}}
.wa .og .t .brand img{{width:34px;height:34px;margin:-8px -7px}}
.wa .cardx .tx{{padding:8px 10px 9px}}
.wa .cardx .tx b{{display:block;font-size:14.5px;font-weight:500}}
.wa .cardx .tx p{{margin:2px 0 0;font-size:13px;color:#b5c7c3;line-height:1.3}}
.wa .cardx .tx small{{display:block;margin-top:4px;font-size:12px;color:#8fb2ab}}
.wa .msg{{padding:6px 6px 2px;overflow-wrap:anywhere}}.wa .msg a{{color:#53bdeb}}
.wa .tm{{display:block;text-align:right;font-size:11px;color:#a5c7bf;padding:0 4px 2px}}
.wa .in .tm{{color:#8696a0}}
.wa .box{{position:absolute;left:8px;right:8px;bottom:22px;display:flex;gap:8px}}
.wa .box div{{flex:1;height:46px;border-radius:23px;background:#1f2c34;color:#8696a0;display:flex;align-items:center;padding:0 16px;font-size:16px}}
.wa .box span{{width:46px;height:46px;border-radius:50%;background:#00a884}}
"""
    page = (f'<div class="wa"><div class="bar"><span class="bk">←</span><div class="av">N</div><div><b>Noa</b><small>online</small></div></div><div class="chat">'
            '<div class="day">Today</div><div class="in">what should we watch tonight?<span class="tm">20:41</span></div>'
            '<div class="out"><div class="cardx"><div class="og">'
            f'<img src="{IMG}w342{DM["poster_path"]}" alt=""><div class="t"><b>Dangerous Minds</b><small>1995 · Movie · ★ 7.0</small>'
            f'<div class="brand"><img src="{UP}/public/logo_vector.svg" alt="">WTW</div></div></div>'
            '<div class="tx"><b>Dangerous Minds (1995) · WTW</b><p>A former Marine takes on a class of tough inner-city kids and won\'t give up on them.</p>'
            f'<small>{DOMAIN}</small></div></div>'
            f'<div class="msg">You\'d like this one 🎬 <a>{LINK}</a></div><span class="tm">20:43 ✓✓</span></div>'
            '</div><div class="box"><div>Message</div><span></span></div></div>')
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;position:relative}}{css}</style></head><body>{page}</body></html>"""


# ── the page the friend opens (/t/movie-9909) ────────────────────

LANDING_CSS = """
.lp-top{display:flex;align-items:center;justify-content:center;gap:8px;padding:18px 16px 8px;font-size:24px;font-weight:500;letter-spacing:.02em}
.lp-top img{width:56px;height:56px;margin:-14px -12px;display:block}
.lp-from{align-self:center;display:inline-flex;align-items:center;gap:8px;margin:2px auto 0;padding:6px 14px 6px 6px;border-radius:999px;background:rgba(255,255,255,.07);font-size:14px;color:rgba(255,255,255,.8)}
.lp-from b{color:#fff;font-weight:600}
.lp-from i{width:26px;height:26px;border-radius:50%;background:#7a5ac8;display:grid;place-items:center;font-style:normal;font-weight:700;font-size:13px;color:#fff}
.heroReason{margin-bottom:22px}
.whyLink + .watchlistBtn{margin-top:0}
.heroReason + .whyLink{margin-top:-14px}
.lp-sub{margin:10px 0 0;text-align:center;font-size:13px;color:rgba(255,255,255,.5)}
.lp-done{display:flex;align-items:center;gap:8px;margin:0 0 14px;font-size:14.5px;color:rgba(255,255,255,.88)}
.lp-done b{color:var(--rv-yellow);font-weight:600}
.lp-next{margin-top:12px;height:50px;width:100%;border:0;border-radius:999px;background:var(--rv-white-10);color:#fff;font-size:16px;font-weight:500}
.lp-next.go{background:linear-gradient(90deg,#ffa900 0%,#ff7a00 55%,#ff4400 100%);font-weight:700}
.list{padding-top:10px;gap:12px}
"""
LP_TOP = f'<div class="lp-top"><img src="{UP}/public/logo_vector.svg" alt=""><span>WTW</span></div>'
FROM = '<div class="lp-from"><i>E</i><span><b>Eran</b> thinks you\'d like this</span></div>'


def landing(case):
    if case == 'signed-out':
        c = card(match=None, reason=ABOUT, why=None, seen=False, after='<p class="lp-sub">Free. Sign in with Google and it\'s saved.</p>')
        c = c.replace('<span>Add to Watchlist</span>', '<span>Save to my watchlist</span>')
    elif case == 'signed-in':
        c = card(match=71, reason=ABOUT, why='Why it’s a match for you', seen=True)
    elif case == 'signed-in-saved':
        c = card(match=71, reason=ABOUT, why='Why it’s a match for you', saved=True, seen=False,
                 after='<button class="lp-next">See my recommendations</button>')
    else:  # new account: back from Google sign-in, the title already saved
        c = card(match=None, reason=ABOUT, why=None, saved=True, seen=False,
                 after=('<p class="lp-sub" style="margin-top:18px;color:rgba(255,255,255,.75);font-size:14.5px">It\'s on your watchlist. Now two minutes of games, '
                        'and I\'ll find you more like it.</p><button class="lp-next go">Let\'s play</button>'))
        c = c.replace('<p class="heroReason">', '<p class="lp-done">✓ <b>Saved.</b> Welcome to WTW.</p><p class="heroReason">')
        # Just signed up: "Saved" says it all; the remove button would only compete with Let's play.
        c = re.sub(r'<button class="watchlistBtn[^"]*">.*?</button>', '', c, count=1)
    return feed_page(FROM + c, LANDING_CSS, header=None, top=LP_TOP)


def homepage():
    """The homepage top bar (WTWApp.module.css), today's share icon above, the forward arrow below."""
    msg = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    menu = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
    def bar(icon, label):
        return (f'<p class="lbl">{label}</p><div class="topbar"><div class="topbarSlot"><button class="iconbtn">{msg}</button></div>'
                f'<div class="brand"><button class="brandModel"><span>Both</span>{CHEV_D.format(sw=1.5).replace("16", "16.5")}</button></div>'
                f'<div class="topbarRight"><button class="iconbtn">{icon}</button><div class="userMenuWrap"><button class="hamburgerBtn">{menu}</button></div></div></div>')
    css = """html,body{margin:0;width:375px;height:300px;overflow:hidden;background:#000;color:#fff;font-family:Inter,sans-serif;position:relative;padding-top:10px;box-sizing:border-box}
.lbl{margin:22px 16px 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.5)}
.lbl + .topbar{border-bottom:1px solid rgba(255,255,255,.08)}"""
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}
<link rel="stylesheet" href="{UP}/src/modules/session/components/WTWApp.module.css"><style>{css}</style></head><body>
{bar(SHARE2, 'Homepage today')}{bar(share_icon(30, 1.5), 'New')}</body></html>"""


CASES = [
    ('1-other-side', other), ('2-blind-taste-test', blind), ('3-higher-or-lower', hilo),
    ('4-feed-card', feed), ('5-watchlist', watchlist), ('9-homepage-icon', homepage),
    ('6-share-sheet-android', sheet), ('7-whatsapp', whatsapp),
    ('8a-link-signed-out', lambda: landing('signed-out')), ('8b-link-signed-in', lambda: landing('signed-in')),
    ('8c-link-signed-in-saved', lambda: landing('signed-in-saved')), ('8d-link-new-account', lambda: landing('new')),
]

CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if __name__ == '__main__':
    only = sys.argv[1:]
    for name, make in CASES:
        if only and not any(name.startswith(o) for o in only): continue
        fn = f'{OUT}/{name}'
        open(f'{fn}.html', 'w').write(make())
        h = 300 if name == '9-homepage-icon' else H
        subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', f'--window-size={W},{h}',
                        '--force-device-scale-factor=2', '--virtual-time-budget=8000', f'--screenshot={fn}.png', f'file://{fn}.html'], capture_output=True)
        subprocess.run(['sips', '-c', str(h * 2), str(W * 2), '--cropOffset', '0', '0', f'{fn}.png', '--out', f'{fn}.png'], capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', f'{fn}.png', '--out', f'{fn}.jpg'], capture_output=True)
        os.remove(f'{fn}.png')
        print(name)
