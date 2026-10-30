"""Cast Call layout options (2026-10-30): bigger posters with the button in view.

Still mock-ups at Eran's Pixel 10 Pro size (412×772 of usable screen), built on
the app's real play.css and the same grid-sizing rule as the game. Writes HTML
+ JPEG next to this file. Run from the repo root:
    python3 docs/prototypes/cast-call-layout/make-mocks.py
"""
import json, os, subprocess

OUT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(OUT, '../../..'))
W, H = 412, 772
IMG = 'https://image.tmdb.org/t/p/'
data = json.load(open(f'{REPO}/src/app/play/data/cast-call.json'))
T = data['titles']
face = next(f for f in data['faces'] if f['name'] == 'Will Smith')
cells = [(T[i], r) for i, r in face['grids'][0]]
# The result from Eran's screenshot: three right, In the Valley of Elah wrong, Aladdin missed.
picked = {'I, Robot', 'I Am Legend', 'Men in Black II', 'In the Valley of Elah'}

X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
Q = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>'
FRAME = f"""
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000}}
.wtw-play{{--font-inter:"Inter";--font-bebas:"Bebas Neue";padding:0!important;position:absolute;inset:0;width:{W}px;height:{H}px}}
.app{{position:absolute;inset:0;background:#000;isolation:isolate;--wtw-rgb:212,155,58}}
.app::before{{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(120% 60% at 50% 115%,rgba(var(--wtw-rgb),.65) 0%,rgba(var(--wtw-rgb),.22) 35%,transparent 70%),linear-gradient(180deg,#000 50%,rgba(var(--wtw-rgb),.12) 100%)}}
.inner{{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column}}
.wtw-play *,.wtw-play *::before,.wtw-play *::after{{animation:none!important;transition:none!important}}
/* option B: the counter moves into the top bar; the tally line goes (the banner already says "3 of 4") */
.opt-b .gtitle,.opt-c .gtitle{{font-size:22px}}
.opt-b .cast-tally,.opt-c .cast-tally{{display:none}}
/* option C: no Check button; the 4th tap checks, and Next sits in the banner */
.cast-ask .nextpill{{height:48px;padding:0 16px;border:0;border-radius:999px;background:var(--cta-grad);color:#fff;font-weight:700;font-size:17px;white-space:nowrap;box-shadow:0 0 0 2px rgba(0,0,0,.15)}}
.opt-c .cast-ask.res{{grid-template-columns:52px minmax(0,1fr) auto}}
.opt-c .hint{{text-align:center;font-size:13px;color:#a9a9b0;margin-top:-2px}}
"""
FIT = """<script>
// The game's own rule: the grid as big as the space allows, 2:3 posters, three across.
const cc = document.querySelector('.cast'), grid = document.querySelector('.cast-grid')
const cs = getComputedStyle(cc)
const kids = [...cc.children].filter(el => getComputedStyle(el).display !== 'none' && !el.classList.contains('cast-fx'))
const others = kids.filter(el => el !== grid).reduce((s, el) => s + el.offsetHeight, 0)
const h = cc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - others - 10 * (kids.length - 1)
grid.style.width = Math.max(200, Math.min(cc.clientWidth - 32, (h - 16) / 1.5 + 16)) + 'px'
document.title = Math.round(grid.querySelector('.cast-tile').getBoundingClientRect().width) + 'px'
</script>"""


def tile(t, role, state):
    mark = ''
    if state == 'result':
        right, p = role is not None, t['t'] in picked
        mark = 'hit' if p and right else 'wrong' if p else 'miss' if right else 'pass'
    inner = f'<img class="art" src="{IMG}w342{t["p"]}" alt="">'
    if mark == 'hit': inner += f'<span class="tick">✓</span><span class="role{" long" if len(role) > 13 else ""}">{role}</span>'
    if mark == 'wrong': inner += '<span class="tick">✕</span>'
    if mark == 'miss': inner += f'<span class="role mt"><small>MISSED</small><span class="ttl">{t["t"]}</span><span class="ch">{role}</span></span>'
    return f'<button class="cast-tile {mark}">{inner}</button>'


def page(opt, state):
    res = state == 'result'
    title = 'Cast Call' if opt == 'a' else ('FACE 1 OF 7 · SCORE 2' if res else 'FACE 1 OF 7 · SCORE 0')
    level = f'<div class="glevel">FACE <b>1</b> OF 7 · SCORE <b>{2 if res else 0}</b></div>' if opt == 'a' else ''
    q = (f'Will Smith<b>3 of 4{" · 1 wrong" if opt != "a" else ""}</b>' if res
         else 'Select 4 titles with<b>Will Smith</b>')
    if not res: q = '<span class="ql">Select 4 titles with<span class="cast-dots"><i></i><i></i><i></i><i></i></span></span><b>Will Smith</b>'
    clock = f'<div class="cast-clock{" paused" if res else ""}"><svg viewBox="0 0 54 54"><circle class="trk" cx="27" cy="27" r="23"/><circle class="arc" cx="27" cy="27" r="23" stroke-dasharray="{120 if res else 140} 145"/></svg><span>{45 if res else 58}</span><b class="pause"><s></s><s></s></b></div>'
    right = '<button class="nextpill">Next ›</button>' if (opt == 'c' and res) else clock
    ask = f'<div class="cast-ask{" res" if res else ""}"><img class="face" src="{IMG}w185{face["img"]}" alt=""><div class="q">{q}</div>{right}</div>'
    tally = '<div class="cast-tally on"><span class="g"><b>3</b> right</span><i>·</i><span class="r"><b>1</b> wrong</span></div>' if res else '<div class="cast-tally"></div>'
    bottom = '' if opt == 'c' else f'<button class="cta{"" if res else " off"}">{"Next" if res else "Check"}</button>'
    hint = '<div class="hint">Your fourth tap checks the grid.</div>' if (opt == 'c' and not res) else ''
    grid = '<div class="cast-grid">' + ''.join(tile(t, r, state) for t, r in cells) + '</div>'
    body = f'<div class="cast">{ask}{grid}{tally}{hint}{bottom}</div>'
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap">
<link rel="stylesheet" href="../../../src/app/play/play.css"><style>{FRAME}</style></head><body>
<div class="wtw-play opt-{opt}"><div class="app"><div class="inner"><div class="phone arcade" style="--gacc:#4d8dff"><div class="screen game-screen">
<div class="topbar"><button class="hb">{X}</button><div class="gtitle">{title}</div><button class="hb r">{Q}</button></div>{level}{body}
</div></div></div></div></div>{FIT}</body></html>"""


CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for opt in 'abc':
    for state in ('pick', 'result'):
        name = f'{opt}-{state}'
        html = f'{OUT}/{name}.html'
        open(html, 'w').write(page(opt, state))
        png = f'{OUT}/{name}.png'
        subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--window-size={W},{H}', '--force-device-scale-factor=2',
                        '--virtual-time-budget=6000', f'--screenshot={png}', f'file://{html}'], capture_output=True)
        subprocess.run(['sips', '-c', str(H * 2), str(W * 2), '--cropOffset', '0', '0', png, '--out', png], capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out', f'{OUT}/{name}.jpg'], capture_output=True)
        os.remove(png)
        dom = subprocess.run([CH, '--headless=new', '--disable-gpu', f'--window-size={W},{H}', '--virtual-time-budget=6000', '--dump-dom', f'file://{html}'],
                             capture_output=True, text=True).stdout
        print(name, 'poster width:', dom.split('<title>')[1].split('</title>')[0] if '<title>' in dom else '?')
