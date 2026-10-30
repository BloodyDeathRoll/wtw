"""Line-up (Cast Call reversed, 2026-10-30): still mock-ups, one per state.

One poster, nine faces: tap the four actors who were in it, then Check. Same
clock, scoring, bonuses and layout as Cast Call, built on the app's real
play.css plus the few new rules below (marked LINE-UP). Real data: faces and
characters from src/app/play/data/cast-call.json and the TMDB cache the Cast
Call build keeps. Run from the repo root:
    python3 docs/prototypes/line-up/make-mocks.py
"""
import json, os, subprocess

OUT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(OUT, '../../..'))
IMG = 'https://image.tmdb.org/t/p/'
ACC = '#17b3a3'
data = json.load(open(f'{REPO}/src/app/play/data/cast-call.json'))
FACE = {f['name']: f for f in data['faces']}
TITLE = {t['t']: t for t in data['titles']}

# Oppenheimer: four of its top-billed faces, and five Nolan regulars who aren't in it (checked: no credit at all).
POSTER = TITLE['Oppenheimer']
RIGHT = {'Emily Blunt': 'Kitty Oppenheimer', 'Matt Damon': 'Leslie Groves', 'Florence Pugh': 'Jean Tatlock', 'Robert Downey Jr.': 'Lewis Strauss'}
ORDER = ['Christian Bale', 'Emily Blunt', 'Anne Hathaway', 'Matt Damon', 'Tom Hardy', 'Florence Pugh', 'Jessica Chastain', 'Robert Downey Jr.', 'Michael Caine']

X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
Q = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>'

FRAME = """
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000}}
.wtw-play{{--font-inter:"Inter";--font-bebas:"Bebas Neue";padding:0!important;position:absolute;inset:0;width:{W}px;height:{H}px}}
.app{{position:absolute;inset:0;background:#000;isolation:isolate;--wtw-rgb:212,155,58}}
.app::before{{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(120% 60% at 50% 115%,rgba(var(--wtw-rgb),.65) 0%,rgba(var(--wtw-rgb),.22) 35%,transparent 70%),linear-gradient(180deg,#000 50%,rgba(var(--wtw-rgb),.12) 100%)}}
.inner{{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column}}
.wtw-play *,.wtw-play *::before,.wtw-play *::after{{animation:none!important;transition:none!important}}
/* LINE-UP: the banner holds a small poster instead of a round face */
.wtw-play .cast-ask .poster{{width:48px;height:72px;border-radius:6px;object-fit:cover;box-shadow:0 0 0 2px rgba(255,255,255,.85);background:#223;justify-self:center}}
/* LINE-UP: a face tile carries the actor's name; the photo and the name shrink together when tapped */
.wtw-play .cast-tile{{container-type:inline-size}}
.wtw-play .cast-tile .pic{{position:absolute;inset:0;border-radius:9px;overflow:hidden;transition:transform .15s}}
.wtw-play .cast-tile .pic .art{{object-position:center 20%}}
.wtw-play .cast-tile.sel .pic{{transform:scale(.84);border-radius:6px}}
.wtw-play .cast-tile.sel .pic .art{{transform:none}}
.wtw-play .cast-tile .nm{{position:absolute;z-index:1;left:0;right:0;bottom:0;padding:26px 6px 8px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.85) 60%);
  font-size:clamp(12px,12.5cqw,14px);font-weight:700;line-height:1.15;color:#fff;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.8)}}
.wtw-play .cast-tile .nm .ch{{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:2px;font-size:clamp(11px,10.7cqw,12px);line-height:1.15;font-weight:500;color:rgba(255,255,255,.78)}}
.wtw-play .cast-tile .nm small{{display:block;font-size:11px;letter-spacing:.08em;font-weight:800;color:var(--good-cc);margin-bottom:3px}}
.wtw-play .cast-tile.pass .nm{{opacity:.35}}
.wtw-play .cast-tile.wrong .nm{{color:rgba(255,255,255,.7)}}
/* LINE-UP: the end screen shows the round's posters, four a row, with x/4 */
.wtw-play .lu-posters{{display:flex;flex-wrap:wrap;justify-content:center;row-gap:18px;column-gap:10px;width:100%;padding:3px;box-sizing:border-box}}
.wtw-play .lu-posters div{{position:relative;width:calc((100% - 30px) / 4)}}
.wtw-play .lu-posters img{{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:8px;box-shadow:0 0 0 2px rgba(255,255,255,.22)}}
.wtw-play .lu-posters .perfect img{{box-shadow:0 0 0 3px var(--good-cc)}}
.wtw-play .lu-posters i{{position:absolute;bottom:-8px;left:50%;translate:-50% 0;font-style:normal;font-size:13px;font-weight:800;color:#fff;background:#16161c;border-radius:999px;padding:2px 7px;box-shadow:0 0 0 1.5px rgba(255,255,255,.25)}}
.wtw-play .lu-posters .perfect i{{background:var(--good-cc);color:#00140c;box-shadow:none}}
.wtw-play .cast-wall img{{object-position:center 20%}}
"""
FIT = """<script>
// The game's own rule: the grid as big as the space allows, 2:3 tiles, three across.
const cc = document.querySelector('.cast'), grid = document.querySelector('.cast-grid')
if (cc && grid) {
  const cs = getComputedStyle(cc)
  const kids = [...cc.children].filter(el => !el.classList.contains('cast-fx') && !el.classList.contains('cast-over'))
  const others = kids.filter(el => el !== grid).reduce((s, el) => s + el.offsetHeight, 0)
  const h = cc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - others - 10 * (kids.length - 1)
  grid.style.width = Math.max(200, Math.min(cc.clientWidth - 32, (h - 16) / 1.5 + 16)) + 'px'
}
// The end screen's posters: four a row, as big as the space allows (two rows for seven).
const box = document.querySelector('.cast-facesbox'), wall = document.querySelector('.lu-posters')
if (box && wall) {
  const H = box.clientHeight - box.querySelector('h2').offsetHeight - 14 - 6 - 10
  const n = wall.children.length, rows = Math.ceil(n / 4)
  const w = Math.min((wall.clientWidth - 6 - 30) / 4, (H - (rows - 1) * 18) / rows / 1.5)
  for (const d of wall.children) d.style.width = Math.floor(w) + 'px'
}
const b = document.querySelector('.cast-bonus')
if (b && grid) { const r = grid.getBoundingClientRect(); b.style.left = (r.left + r.width / 2 - b.offsetWidth / 2) + 'px'; b.style.top = (r.top + r.height / 2 - b.offsetHeight / 2 - 40) + 'px' }
</script>"""


def tile(name, mark=None, picked=False):
    f = FACE[name]
    role = RIGHT.get(name)
    nm = name
    if mark == 'hit': nm = f'{name}<span class="ch">{role}</span>'
    if mark == 'miss': nm = f'<small>MISSED</small>{name}<span class="ch">{role}</span>'
    cls = ' '.join(c for c in ['cast-tile', 'sel' if picked and not mark else '', mark or '', 'locked' if mark else ''] if c)
    tick = '<span class="tick">✓</span>' if (picked and not mark) or mark == 'hit' else '<span class="tick">✕</span>' if mark == 'wrong' else ''
    return f'<button class="{cls}"><span class="pic"><img class="art" src="{IMG}w342{f["img"]}" alt=""><span class="nm">{nm}</span></span>{tick}</button>'


def clock(sec, paused=False, gain=False, low=False):
    dash = 145 * sec / 60
    cls = ' '.join(c for c in ['cast-clock', 'paused' if paused else '', 'gain' if gain else '', 'low' if low else ''] if c)
    return f'<div class="{cls}"><svg viewBox="0 0 54 54"><circle class="trk" cx="27" cy="27" r="23"/><circle class="arc" cx="27" cy="27" r="23" stroke-dasharray="{dash:.1f} 145"/></svg><span>{sec}</span><b class="pause"><s></s><s></s></b></div>'


def game(W, H, top, q, clk, tiles, button, extra='', low=False):
    ask = f'<div class="cast-ask{" low" if low else ""}"><img class="poster" src="{IMG}w185{POSTER["p"]}" alt=""><div class="q">{q}</div>{clk}</div>'
    body = f'<div class="cast">{ask}<div class="cast-grid">{"".join(tiles)}</div>{button}<div class="cast-fx">{extra}</div></div>'
    return shell(W, H, f'<div class="topbar"><button class="hb">{X}</button><div class="gtitle live">{top}</div><button class="hb r">{Q}</button></div>{body}')


def shell(W, H, screen):
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap">
<link rel="stylesheet" href="../../../src/app/play/play.css"><style>{FRAME.format(W=W, H=H)}</style></head><body>
<div class="wtw-play"><div class="app"><div class="inner"><div class="phone arcade" style="--gacc:{ACC}"><div class="screen game-screen">
{screen}
</div></div></div></div></div>{FIT}</body></html>"""


def dots(n): return '<span class="cast-dots">' + ''.join(f'<i{" class=on" if k < n else ""}></i>' for k in range(4)) + '</span>'
def ask_q(n): return f'<span class="ql">Select 4 actors in{dots(n)}</span><b>{POSTER["t"]}</b>'


def states(W, H):
    picks = {'Christian Bale', 'Emily Blunt'}
    yield '1-picking', game(W, H, 'POSTER 1 OF 7 · SCORE 0', ask_q(2), clock(54),
                            [tile(n, picked=n in picks) for n in ORDER], '<button class="cta off">Check</button>')
    picks = {'Christian Bale', 'Emily Blunt', 'Matt Damon', 'Florence Pugh'}
    def mark(n):
        return ('hit' if n in RIGHT else 'wrong') if n in picks else ('miss' if n in RIGHT else 'pass')
    yield '2-checked', game(W, H, 'POSTER 1 OF 7 · SCORE 2', f'{POSTER["t"]}<b>3 of 4 · 1 wrong</b>', clock(49, paused=True),
                            [tile(n, mark(n), n in picks) for n in ORDER], '<button class="cta">Next</button>')
    yield '3-perfect', game(W, H, 'POSTER 1 OF 7 · SCORE 6', f'{POSTER["t"]} · +2 points<b>Perfect grid!</b>', clock(52, paused=True, gain=True),
                            [tile(n, 'hit' if n in RIGHT else 'pass', n in RIGHT) for n in ORDER], '<button class="cta">Next</button>',
                            extra='<div class="cast-bonus" style="position:absolute">+3s</div>')
    picks = {'Emily Blunt', 'Tom Hardy'}
    over = '<div class="cast-over"><div class="big">Time&apos;s up</div><p>What you tapped still counts.</p><button class="cta">See my score</button></div>'
    yield '4-times-up', game(W, H, 'POSTER 6 OF 7 · SCORE 17', f'{POSTER["t"]}<b>1 of 4 · 1 wrong · 3 missed</b>', clock(0, low=True),
                             [tile(n, ('hit' if n in RIGHT else 'wrong') if n in picks else ('miss' if n in RIGHT else 'pass'), n in picks) for n in ORDER],
                             '<button class="cta gone">Check</button>', extra=over, low=True)
    # End screen: a run of all seven that beat the clock.
    run = [('Oppenheimer', 3), ('The Grand Budapest Hotel', 4), ('Love Actually', 2), ('The Dark Knight Rises', 4), ('Little Women', 3), ('Knives Out', 4), ("Ocean's Eleven", 4)]
    faces = [FACE[n]['img'] for n in ['Emily Blunt', 'Matt Damon', 'Florence Pugh', 'Robert Downey Jr.', 'Ralph Fiennes', 'Tilda Swinton', 'Bill Nighy', 'Keira Knightley',
                                       'Christian Bale', 'Anne Hathaway', 'Saoirse Ronan', 'Timothée Chalamet', 'Daniel Craig', 'Ana de Armas', 'George Clooney', 'Julia Roberts']]
    wall = ''.join(f'<img src="{IMG}w185{faces[k % len(faces)]}" alt="">' for k in range(30))
    posters = ''.join(f'<div class="{"perfect" if h == 4 else ""}"><img src="{IMG}w185{TITLE[t]["p"]}" alt=""><i>{h}/4</i></div>' for t, h in run)
    end = (f'<div class="cast-wall"><div>{wall}</div></div>'
           f'<div class="topbar"><button class="hb">{X}</button><div class="gtitle">Line-up</div><button class="hb r">{Q}</button></div>'
           '<div class="cast-end"><div class="cast-scores"><div class="cast-sc"><span>SCORE</span><b>45</b></div>'
           '<div class="cast-sc bt new"><span>BEST</span><b>45</b><small>was 38</small><em>NEW BEST</em></div></div>'
           '<p class="cast-sum">23 from faces · <b>+8</b> perfect grids · <b>+14</b> time</p>'
           '<div class="cast-stats"><div><b class="g">24</b><span>right</span></div><i></i><div><b class="r">1</b><span>wrong</span></div><i></i><div><b class="m">4</b><span>missed</span></div></div>'
           f'<div class="cast-rule"></div><div class="cast-facesbox"><h2>7 posters in 0:32</h2><div class="lu-posters">{posters}</div></div>'
           '<button class="cta">Next round</button></div>')
    yield '5-end', shell(W, H, end)


CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for W, H, suffix in [(412, 772, ''), (375, 667, '-375x667')]:
    for name, html in states(W, H):
        if suffix and name not in ('2-checked', '5-end'): continue
        fn = f'{OUT}/{name}{suffix}'
        open(f'{fn}.html', 'w').write(html)
        subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--window-size={W},{H}', '--force-device-scale-factor=2',
                        '--virtual-time-budget=6000', f'--screenshot={fn}.png', f'file://{fn}.html'], capture_output=True)
        subprocess.run(['sips', '-c', str(H * 2), str(W * 2), '--cropOffset', '0', '0', f'{fn}.png', '--out', f'{fn}.png'], capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', f'{fn}.png', '--out', f'{fn}.jpg'], capture_output=True)
        os.remove(f'{fn}.png')
        print(name + suffix)
