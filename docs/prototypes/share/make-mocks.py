"""Share a title (2026-11-03): still mock-ups, one JPEG per case.

Where the share button sits (two options, A and B) on the game posters and
the feed card, My watchlist, then what happens after the tap: the phone's
share sheet, the WhatsApp message, and the page the friend opens.

Built on the app's real CSS (src/app/play/play.css, the feed's
RecommendationsView.module.css) plus the few new rules marked SHARE. Real
posters from src/app/play/data/titles.json. Run from the repo root:
    python3 docs/prototypes/share/make-mocks.py
"""
import json, os, subprocess

OUT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(OUT, '../../..'))
IMG = 'https://image.tmdb.org/t/p/'
W, H = 375, 812
T = {t['title']: t for t in json.load(open(f'{REPO}/src/app/play/data/titles.json'))}
DM = {'title': 'Dangerous Minds', 'year': 1995, 'poster_path': '/yWHWC8fJRp2kLgiFrEa8o3krOH9.jpg', 'backdrop': '/yK5vziICSiW6uHLltNqkZ1TXhNx.jpg'}
DOMAIN = 'wtw.app'  # placeholder: the real address goes here

# Lucide "share" (the iOS-style box and arrow), the feed's icon set.
SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" width="{s}" height="{s}"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>'
def share_icon(s=18, sw=2.2): return SHARE.format(s=s, sw=sw)
X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
Q = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>'
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap">'
FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important}'

# ── the games (play.css) ─────────────────────────────────────────

PLAY_FRAME = f"""
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000}}
.wtw-play{{--font-inter:"Inter";--font-bebas:"Bebas Neue";padding:0!important;position:absolute;inset:0;width:{W}px;height:{H}px}}
.app{{position:absolute;inset:0;background:#000;isolation:isolate;--wtw-rgb:212,155,58}}
.app::before{{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(120% 60% at 50% 115%,rgba(var(--wtw-rgb),.65) 0%,rgba(var(--wtw-rgb),.22) 35%,transparent 70%),linear-gradient(180deg,#000 50%,rgba(var(--wtw-rgb),.12) 100%)}}
.inner{{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column}}
.wtw-play {FREEZE}
.wtw-play .poster img{{opacity:1}}
/* SHARE option A: a second ribbon beside the watchlist one, same shape and colour */
.wtw-play .rib.shr{{right:44px;padding-top:9px}}
.wtw-play .bet-poster[style] .rib.shr{{right:34px}}
/* SHARE option B: a round button on the poster's bottom-right, the Trailer pill's colour */
.wtw-play .shc{{position:absolute;z-index:3;right:8px;bottom:8px;width:36px;height:36px;border:0;border-radius:50%;display:grid;place-items:center;padding:0 0 1px;
  background:rgba(0,0,0,.72);color:#fff;cursor:pointer}}
"""


def play_page(acc, screen):
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}
<link rel="stylesheet" href="../../../src/app/play/play.css"><style>{PLAY_FRAME}</style></head><body>
<div class="wtw-play"><div class="app"><div class="inner"><div class="phone arcade" style="--gacc:{acc}"><div class="screen game-screen">
{screen}
</div></div></div></div></div></body></html>"""


def top(name, level):
    return (f'<div class="topbar"><button class="hb">{X}</button><div class="gtitle">{name}</div><button class="hb r">{Q}</button></div>'
            f'<div class="glevel">{level}</div>')


def rib(t, opt):
    """The watchlist ribbon, plus option A's share ribbon beside it."""
    r = '<button class="rib"><span>+</span></button>'
    return r + (f'<button class="rib shr">{share_icon(17, 2.3)}</button>' if opt == 'A' else '')


def poster(t, opt, extra=''):
    tvb = '<span class="tvb">SERIES</span>' if t['type'] == 'tv' else ''
    shc = f'<button class="shc">{share_icon()}</button>' if opt == 'B' else ''
    return f'<div class="poster real"><img src="{IMG}w342{t["poster_path"]}" alt="">{tvb}{extra}{shc}</div>'


SEEN = ('<div class="seen-it"><p class="seen-prompt">Seen it? Tell me how it was</p><div class="seen-btns three">'
        '<button class="seen-chip"><span class="seen-emoji">❤️</span>Loved</button>'
        '<button class="seen-chip"><span class="seen-emoji">👍</span>Liked</button>'
        '<button class="seen-chip"><span class="seen-emoji">👎</span>Disliked</button></div></div>')


def other(opt):
    t = T['Eternal Sunshine of the Spotless Mind']
    body = ('<div class="gstage"><div class="ptsrow"><span>Story 2 of 4</span><span>Points <b>10</b></span></div>'
            '<div class="reveal-card other-reveal"><div class="verdict-tag ok">✓ +5 points</div>'
            f'<div class="reveal-poster">{poster(t, opt)}{rib(t, opt)}</div>'
            f'<h2>{t["title"]}</h2>'
            f'<div class="other-after">{SEEN}<button class="cta">Next story</button></div></div></div>')
    return play_page('#ff5fa2', top('The Other Side of the Story', 'LEVEL <b>2</b> · 4 stories') + body)


def blind(opt):
    t = T['The Mandalorian']
    dots = ''.join(f'<i class="{"on" if k == 0 else ""}"></i>' for k in range(5))
    body = (f'<div class="gstage blind-play"><div class="blind-dots">{dots}</div>'
            '<div class="blind-screen reveal-card"><small class="blind-eyebrow">You\'d watch it. Here\'s the cover</small>'
            f'<div class="reveal-poster blind-unveil">{poster(t, opt)}{rib(t, opt)}<a class="blind-trailer">▶ Trailer</a></div>'
            f'<h2 class="blind-rise r1">{t["title"]}</h2>'
            '<p class="q blind-rise r2">2019 · Disney+ · <span class="blind-star">★ 8.4</span></p>'
            '<p class="cover-line blind-rise r3">It\'s a series: 3 seasons, 24 episodes.</p>'
            '<div class="blind-after blind-rise r4"><button class="cta">Next story</button>'
            '<div class="row-btns"><button class="opt">Seen it</button><button class="opt">Changed my mind</button></div></div></div></div>')
    return play_page('#3ddc97', top('Blind Taste Test', 'LEVEL <b>2</b> · Longer than you think') + body)


def hilo(opt):
    a, b = T['Inception'], T['Arrival']
    def side(t, val):
        return (f'<div class="side">{rib(t, opt)}<div class="pick">{poster(t, opt)}<div><div class="nm">{t["title"]}</div></div></div>'
                f'<div class="hilo-val">{val}</div></div>')
    body = ('<div class="gstage hilo"><div class="ptsrow"><span>In a row: <b>2</b></span><span>5 clears the level</span></div>'
            f'<div class="duel" style="padding:0;width:100%">{side(a, "★ 8.4")}{side(b, "?")}</div>'
            f'<h2 class="gq">Is {b["title"]} rated higher or lower?</h2>'
            '<div class="row-btns" style="width:100%"><button class="opt primary">↑ Higher</button><button class="opt">↓ Lower</button></div>'
            '<p class="q" style="text-align:center">TMDB audience rating</p></div>')
    return play_page('#ffd23d', top('Higher or Lower', 'LEVEL <b>1</b> · Ratings · 5 in a row') + body)


def watchlist():
    rows = [('Dangerous Minds', 'movie', 1995, DM['poster_path'], 'From your picks · today', 'Netflix', None),
            ('The Mandalorian', 'tv', 2019, T['The Mandalorian']['poster_path'], 'From Blind Taste Test · yesterday', 'Disney+', None),
            ('Eternal Sunshine of the Spotless Mind', 'movie', 2004, T['Eternal Sunshine of the Spotless Mind']['poster_path'], 'From The Other Side · 3 days ago', None, 'Loved it'),
            ('Arrival', 'movie', 2016, T['Arrival']['poster_path'], 'From Higher or Lower · last week', 'Paramount+', None)]
    items = ''
    for title, kind, yr, p, src, where, rated in rows:
        meta = f'<i class="src">{src}</i>' + (f'<i>{where}</i>' if where else '') + (f'<i class="rated">{rated}</i>' if rated else '')
        items += (f'<div class="wl-it"><div class="wl-ps"><img src="{IMG}w185{p}" alt=""></div>'
                  f'<div class="wl-tx"><b>{title}</b><small>{"Series" if kind == "tv" else "Movie"} · {yr}</small><div class="wl-meta">{meta}</div></div>'
                  f'<div class="wl-acts"><button class="wl-x wl-sh">{share_icon(16, 2)}</button><button class="wl-x">✕</button></div></div>')
    extra = """
/* SHARE: My watchlist rows get a share button above the ✕, same round outline (stacked, so the text keeps its width) */
.wtw-play .wl-acts{display:flex;flex-direction:column;gap:10px}
.wtw-play .wl-sh{color:#fff}
"""
    apptop = ('<div class="apptop"><div class="tb-l"><button class="tb-back"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button></div>'
              '<div class="brand app-brand"><img src="../../../public/logo_vector.svg" alt="" width="56" height="56">WTW</div>'
              '<div class="tb-r"><button style="background:none;border:0;color:#fff;padding:4px"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button></div></div>')
    screen = (f'<div class="screen wl">{apptop}<div class="wl-hd"><h1>My watchlist</h1><span>4 titles</span></div>'
              '<div class="wl-chips"><button class="on">All</button><button>Movies</button><button>Series</button></div>'
              f'<div class="wl-list">{items}</div><p class="wl-note">One list with the WTW app on this device.</p></div>')
    return (f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}
<link rel="stylesheet" href="../../../src/app/play/play.css"><style>{PLAY_FRAME}{extra}</style></head><body>
<div class="wtw-play"><div class="app"><div class="inner"><div class="phone">{screen}</div></div></div></div></body></html>""")


# ── the feed card (RecommendationsView.module.css) ───────────────

FEED_FRAME = f"""
:root{{--ease-out:cubic-bezier(0.23,1,0.32,1);--ease-drawer:cubic-bezier(0.32,0.72,0,1);--enter-y:8px;--wtw-border-strong:rgba(255,255,255,0.12)}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000;color:#fff;position:relative;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
button{{font-family:inherit}}
{FREEZE}
.frame{{position:absolute;inset:0;display:flex;flex-direction:column;isolation:isolate}}
.frame::before{{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(120% 60% at 50% 115%,rgba(212,155,58,.65) 0%,rgba(212,155,58,.22) 35%,transparent 70%),linear-gradient(180deg,#000 50%,rgba(212,155,58,.12) 100%)}}
.posterImg{{opacity:1!important}}
/* SHARE option A: a round dark button beside Add to Watchlist, the Seen-it chips' fill */
.ctaPair{{display:flex;gap:10px}}
.ctaPair > :first-child{{flex:1;width:auto}}
.shareBtn{{flex:0 0 50px;height:50px;border:0;border-radius:50%;display:grid;place-items:center;padding:0 0 2px;background:var(--rv-white-10);color:#fff;cursor:pointer}}
/* SHARE option B: a second glass circle beside the trailer one, same size and look */
.heroFoot .shareCircle{{flex-shrink:0;width:48px;height:48px;display:grid;place-items:center;padding:0 0 2px;border-radius:50%;border:1px solid rgba(255,255,255,.35);
  background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff}}
.heroFoot .circles{{display:flex;gap:10px;flex-shrink:0}}
"""
CHEV_L = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
CHEV_D = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
CHEV_R = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
MENU = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
PLAY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l15 8-15 8z"/></svg>'
STAR = '<svg class="metaStar" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>'
BOOKMARK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
REASON = ('This gripping drama nails the kind of raw, character-driven storytelling you love—think <em><i>The Blind Side</i></em> meets '
          '<em><i>Stand and Deliver</i></em>, but with the gritty edge of a teacher (Michelle Pfeiffer) who refuses to give up on her students.')


def feed_card(opt, ring=True, reason=REASON, why='Why it’s a match', cta_label='Add to Watchlist', seen=True):
    circles = f'<button class="trailerCircle">{PLAY}</button>'
    if opt == 'B': circles = f'<div class="circles"><button class="shareCircle">{share_icon(20, 2)}</button>{circles}</div>'
    cta = f'<button class="watchlistBtn watchlistBtnPrimary">{BOOKMARK}<span>{cta_label}</span></button>'
    if opt == 'A': cta = f'<div class="ctaPair">{cta}<button class="shareBtn">{share_icon(20, 2)}</button></div>'
    ring_html = ('<div class="matchRing heroRing"><div class="matchRingInner"><span><span class="matchRingPct">83</span>'
                 '<span class="matchRingSign">%</span></span></div></div>') if ring else ''
    seen_html = ('<div class="seenIt"><span class="seenItPrompt">Seen it? Tell me how it was</span><div class="seenItRow">'
                 '<button class="seenChip"><span class="chipEmoji">❤️</span><span>Loved</span></button>'
                 '<button class="seenChip"><span class="chipEmoji">👍</span><span>Liked</span></button>'
                 '<button class="seenChip"><span class="chipEmoji">👎</span><span>Disliked</span></button>'
                 f'<button class="seenChip seenChipRemove">{X.replace("<svg", "<svg width=18 height=18")}</button></div></div>') if seen else ''
    why_html = f'<button class="whyLink"><span>{why}</span>{CHEV_R}</button>' if why else ''
    return (f'<article class="card heroCard"><div class="hero"><div class="poster poster_hero" style="background:#2a2420">'
            f'<img class="posterImg" src="{IMG}w780{DM["poster_path"]}" alt=""></div><div class="heroShade"></div>{ring_html}'
            '<div class="heroFoot"><div class="cardTitleBlock"><h3 class="heroTitle">Dangerous Minds</h3>'
            f'<div class="cardMeta"><span>1995</span><span>1h 39m</span><span class="metaRating">{STAR}7.0</span></div></div>'
            f'{circles}</div></div><div class="heroBody"><p class="heroReason">{reason}</p>{why_html}{cta}{seen_html}</div></article>')


def feed_page(body, extra_css='', header=True):
    head = (f'<div class="header"><button class="headerBtn">{CHEV_L}</button><div class="typePicker"><button class="typePickerBtn">Movies{CHEV_D}</button></div>'
            f'<div class="headerRight"><button class="headerBtn">{MENU}</button></div></div>') if header else ''
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}
<link rel="stylesheet" href="../../../src/modules/session/recommendations/RecommendationsView.module.css"><style>{FEED_FRAME}{extra_css}</style></head><body>
<div class="frame"><div class="view">{head}<div class="content"><div class="list">{body}</div></div></div></div></body></html>"""


def feed(opt):
    return feed_page(feed_card(opt))


# ── after the tap ────────────────────────────────────────────────

def sheet():
    """The phone's own share sheet (iPhone shown). WTW only hands it the title, text and link."""
    people = [('Noa', '#c86b4a'), ('Dad', '#4a7bc8'), ('Movie night', '#7a5ac8'), ('Shira', '#3f9b74')]
    ppl = ''.join(f'<div class="p"><div class="av" style="background:{c}">{n[0]}<span class="wa"></span></div><span>{n}</span></div>' for n, c in people)
    apps = [('AirDrop', '#1c8cf0', '◎'), ('Messages', '#34c759', '💬'), ('WhatsApp', '#25d366', '✆'), ('Mail', '#2f8cf4', '✉'), ('Notes', '#f6c945', '▤')]
    aps = ''.join(f'<div class="p"><div class="ap" style="background:{c}">{g}</div><span>{n}</span></div>' for n, c, g in apps)
    css = """
.dim{position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:5}
.sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;background:#1c1c1e;border-radius:14px 14px 0 0;padding:16px 0 30px;font-family:-apple-system,"SF Pro Text",Inter,sans-serif}
.sheet .hd{display:flex;align-items:center;gap:12px;padding:0 16px 14px;border-bottom:1px solid rgba(255,255,255,.1)}
.sheet .hd img{width:44px;height:66px;border-radius:6px;object-fit:cover}
.sheet .hd b{display:block;font-size:15px;font-weight:600}.sheet .hd small{font-size:13px;color:#8e8e93}
.sheet .hd .x{margin-left:auto;width:30px;height:30px;border-radius:50%;background:#3a3a3c;display:grid;place-items:center;color:#c7c7cc;font-size:15px}
.sheet .row{display:flex;gap:6px;padding:16px 12px 6px;overflow:hidden}
.sheet .p{width:70px;flex:none;text-align:center;font-size:11.5px;color:#e5e5ea}
.sheet .p span{display:block;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sheet .av{position:relative;width:58px;height:58px;margin:0 auto;border-radius:50%;display:grid;place-items:center;font-size:24px;font-weight:600;color:#fff}
.sheet .av .wa{position:absolute;right:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:#25d366;border:2px solid #1c1c1e;margin:0}
.sheet .ap{width:58px;height:58px;margin:0 auto;border-radius:14px;display:grid;place-items:center;font-size:26px;color:#fff}
.sheet .acts{margin:14px 16px 0;background:#2c2c2e;border-radius:12px}
.sheet .acts div{display:flex;justify-content:space-between;padding:13px 16px;font-size:16px;border-bottom:1px solid rgba(255,255,255,.08)}
.sheet .acts div:last-child{border:0}
.sheet .acts i{font-style:normal;color:#8e8e93}
.tag{position:absolute;z-index:7;top:14px;left:16px;right:16px;text-align:center;font:600 12.5px Inter;color:#f1c46d;background:rgba(0,0,0,.6);border-radius:999px;padding:6px 10px}
"""
    body = feed_card('A')
    over = (f'<div class="dim"></div><div class="sheet"><div class="hd"><img src="{IMG}w185{DM["poster_path"]}" alt=""><div><b>Dangerous Minds (1995)</b><small>{DOMAIN}</small></div><div class="x">✕</div></div>'
            f'<div class="row">{ppl}</div><div class="row">{aps}</div>'
            '<div class="acts"><div>Copy<i>⧉</i></div><div>Add to Reading List<i>∞</i></div></div></div>')
    return feed_page(body, css).replace('</body>', over + '</body>')


def whatsapp():
    css = f"""
.wa{{position:absolute;inset:0;background:#0b141a;font-family:-apple-system,"SF Pro Text",Inter,sans-serif;color:#e9edef}}
.wa .bar{{display:flex;align-items:center;gap:10px;padding:14px 12px;background:#1f2c34}}
.wa .bar .av{{width:38px;height:38px;border-radius:50%;background:#c86b4a;display:grid;place-items:center;font-weight:600;font-size:17px}}
.wa .bar b{{font-size:16.5px;font-weight:600}}.wa .bar small{{display:block;font-size:12.5px;color:#8696a0}}
.wa .chat{{padding:14px 10px;display:flex;flex-direction:column;gap:6px}}
.wa .day{{align-self:center;font-size:12px;background:#1f2c34;color:#8696a0;border-radius:8px;padding:4px 10px;margin-bottom:6px}}
.wa .in{{align-self:flex-start;max-width:78%;background:#202c33;border-radius:0 10px 10px 10px;padding:7px 10px;font-size:15px}}
.wa .out{{align-self:flex-end;width:290px;background:#005c4b;border-radius:10px 0 10px 10px;padding:4px;font-size:15px}}
.wa .card{{background:#025144;border-radius:7px;overflow:hidden}}
.wa .og{{position:relative;height:152px;background:url({IMG}w780{DM["backdrop"]}) center 30%/cover}}
.wa .og::after{{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.9) 0%,rgba(0,0,0,.75) 55%,rgba(0,0,0,.45) 100%)}}
.wa .og img{{position:absolute;z-index:1;left:12px;top:12px;width:85px;height:128px;border-radius:6px;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,.6)}}
.wa .og .t{{position:absolute;z-index:1;left:110px;right:10px;top:18px;font-family:Inter;color:#fff}}
.wa .og .t b{{display:block;font-size:19px;font-weight:800;line-height:1.1}}
.wa .og .t small{{display:block;margin-top:5px;font-size:12.5px;color:rgba(255,255,255,.8)}}
.wa .og .t .brand{{display:flex;align-items:center;gap:4px;margin-top:26px;font-size:15px;font-weight:600;letter-spacing:.02em}}
.wa .og .t .brand img{{position:static;width:34px;height:34px;margin:-8px -7px;box-shadow:none;border-radius:0}}
.wa .card .tx{{padding:8px 10px 9px}}
.wa .card .tx b{{display:block;font-size:14.5px;font-weight:600}}
.wa .card .tx p{{margin:2px 0 0;font-size:13px;color:#b5c7c3;line-height:1.3}}
.wa .card .tx small{{display:block;margin-top:4px;font-size:12px;color:#8fb2ab}}
.wa .msg{{padding:6px 6px 2px}}.wa .msg a{{color:#53bdeb}}
.wa .tm{{display:block;text-align:right;font-size:11px;color:#a5c7bf;padding:0 4px 2px}}
.wa .in .tm{{color:#8696a0}}
.wa .box{{position:absolute;left:8px;right:8px;bottom:22px;display:flex;gap:8px}}
.wa .box div{{flex:1;height:44px;border-radius:22px;background:#1f2c34;color:#8696a0;display:flex;align-items:center;padding:0 16px;font-size:15.5px}}
.wa .box span{{width:44px;height:44px;border-radius:50%;background:#00a884}}
.tag{{position:absolute;z-index:7;bottom:84px;left:16px;right:16px;text-align:center;font:600 12.5px Inter;color:#f1c46d;background:rgba(0,0,0,.6);border-radius:999px;padding:6px 10px}}
"""
    page = (f'<div class="wa"><div class="bar"><div class="av">N</div><div><b>Noa</b><small>online</small></div></div><div class="chat">'
            '<div class="day">Today</div><div class="in">what should we watch tonight?<span class="tm">20:41</span></div>'
            '<div class="out"><div class="card"><div class="og">'
            f'<img src="{IMG}w342{DM["poster_path"]}" alt=""><div class="t"><b>Dangerous Minds</b><small>1995 · Movie · ★ 7.0</small>'
            '<div class="brand"><img src="../../../public/logo_vector.svg" alt="">WTW</div></div></div>'
            '<div class="tx"><b>Dangerous Minds (1995) · WTW</b><p>A former Marine takes on a class of tough inner-city kids and won\'t give up on them.</p>'
            f'<small>{DOMAIN}</small></div></div>'
            f'<div class="msg">You\'d like this one 🎬 <a>https://{DOMAIN}/t/movie-9909</a></div><span class="tm">20:43 ✓✓</span></div>'
            '</div><div class="box"><div>Message</div><span></span></div></div>')
    return f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;position:relative}}{css}</style></head><body>{page}</body></html>"""


def landing():
    """The page the friend opens, signed out: the feed card's look, no match score, two ways in."""
    css = """
.lp-top{display:flex;align-items:center;justify-content:center;gap:8px;padding:18px 16px 8px;font-size:24px;font-weight:500;letter-spacing:.02em}
.lp-top img{width:56px;height:56px;margin:-14px -12px;display:block}
.heroReason{margin-bottom:22px}
.lp-from{align-self:center;display:inline-flex;align-items:center;gap:8px;margin:2px auto 0;padding:6px 14px 6px 6px;border-radius:999px;background:rgba(255,255,255,.07);font-size:14px;color:rgba(255,255,255,.8)}
.lp-from b{color:#fff;font-weight:600}
.lp-from i{width:26px;height:26px;border-radius:50%;background:#7a5ac8;display:grid;place-items:center;font-style:normal;font-weight:700;font-size:13px;color:#fff}
.lp-sub{margin:10px 0 0;text-align:center;font-size:13px;color:rgba(255,255,255,.5)}
.lp-second{margin-top:10px;height:50px;width:100%;border:0;border-radius:999px;background:var(--rv-white-10);color:#fff;font-size:16px;font-weight:500}
.list{padding-top:10px;gap:12px}
"""
    card = feed_card(None, ring=False,
                     reason='A former Marine takes a teaching job at an inner-city high school, with a class everyone else has given up on. Streaming on Netflix.',
                     why=None, cta_label='Save to my watchlist', seen=False)
    card = card.replace('</div></article>', '<p class="lp-sub">Free. Sign in with Google and it\'s saved.</p><button class="lp-second">Is it a match for me?</button></div></article>')
    body = ('<div class="lp-from"><i>E</i><span><b>Eran</b> thinks you\'d like this</span></div>' + card)
    top = '<div class="lp-top"><img src="../../../public/logo_vector.svg" alt=""><span>WTW</span></div>'
    return feed_page(body, css, header=False).replace('<div class="content">', top + '<div class="content">')


CASES = [
    ('1a-other-side', lambda: other('A')), ('1b-other-side', lambda: other('B')),
    ('2a-blind-taste-test', lambda: blind('A')), ('2b-blind-taste-test', lambda: blind('B')),
    ('3a-higher-or-lower', lambda: hilo('A')), ('3b-higher-or-lower', lambda: hilo('B')),
    ('4a-feed-card', lambda: feed('A')), ('4b-feed-card', lambda: feed('B')),
    ('5-my-watchlist', watchlist),
    ('6-share-sheet', sheet), ('7-whatsapp', whatsapp), ('8-friend-opens-link', landing),
]

CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if __name__ == '__main__':
    import sys
    only = sys.argv[1:]
    for name, make in CASES:
        if only and not any(name.startswith(o) for o in only): continue
        fn = f'{OUT}/{name}'
        open(f'{fn}.html', 'w').write(make())
        subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', f'--window-size={W},{H}',
                        '--force-device-scale-factor=2', '--virtual-time-budget=8000', f'--screenshot={fn}.png', f'file://{fn}.html'], capture_output=True)
        subprocess.run(['sips', '-c', str(H * 2), str(W * 2), '--cropOffset', '0', '0', f'{fn}.png', '--out', f'{fn}.png'], capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', f'{fn}.png', '--out', f'{fn}.jpg'], capture_output=True)
        os.remove(f'{fn}.png')
        print(name)
