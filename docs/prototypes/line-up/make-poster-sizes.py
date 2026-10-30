"""Line-up banner poster, bigger (Eran, 2026-10-30): today's 48×72 against +20/25/30/35%,
the faces giving up the room. On the app's real play.css (which now holds Line-up's
rules), at Eran's Pixel 10 Pro size. Run from the repo root:
    python3 docs/prototypes/line-up/make-poster-sizes.py
"""
import json, os, subprocess

OUT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(OUT, '../../..'))
W, H = 412, 772
IMG = 'https://image.tmdb.org/t/p/'
data = json.load(open(f'{REPO}/src/app/play/data/line-up.json'))
t = next(x for x in data['titles'] if x['t'] == 'Kick-Ass')   # the grid Eran played
cells = [(data['faces'][i], r) for i, r in t['grids'][0]]

X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
Q = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>'
FRAME = f"""
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#000}}
.wtw-play{{--font-inter:"Inter";--font-bebas:"Bebas Neue";padding:0!important;position:absolute;inset:0;width:{W}px;height:{H}px}}
.app{{position:absolute;inset:0;background:#000;isolation:isolate;--wtw-rgb:212,155,58}}
.app::before{{content:"";position:absolute;inset:0;z-index:0;background:radial-gradient(120% 60% at 50% 115%,rgba(var(--wtw-rgb),.65) 0%,rgba(var(--wtw-rgb),.22) 35%,transparent 70%),linear-gradient(180deg,#000 50%,rgba(var(--wtw-rgb),.12) 100%)}}
.inner{{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column}}
.wtw-play *,.wtw-play *::before,.wtw-play *::after{{animation:none!important;transition:none!important}}
"""
FIT = """<script>
const cc = document.querySelector('.cast'), grid = document.querySelector('.cast-grid'), cs = getComputedStyle(cc)
const kids = [...cc.children].filter(el => !el.classList.contains('cast-fx'))
const others = kids.filter(el => el !== grid).reduce((s, el) => s + el.offsetHeight, 0)
const h = cc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - others - 10 * (kids.length - 1)
grid.style.width = Math.max(200, Math.min(cc.clientWidth - 32, (h - 16) / 1.5 + 16)) + 'px'
document.title = Math.round(grid.querySelector('.cast-tile').getBoundingClientRect().width)
</script>"""


def tile(f, role, picks):
    if picks is None: mark = ''
    else: mark = ('hit' if role else 'wrong') if f['name'] in picks else ('miss' if role else 'pass')
    nm = f['name'] + (f'<span class="ch">{role}</span>' if mark in ('hit', 'miss') else '')
    if mark == 'miss': nm = '<small>MISSED</small>' + nm
    tick = '<span class="tick">✓</span>' if mark == 'hit' else '<span class="tick">✕</span>' if mark == 'wrong' else ''
    return f'<button class="cast-tile {mark}{" locked" if mark else ""}"><span class="pic"><img class="art" src="{IMG}w342{f["img"]}" alt=""><span class="nm">{nm}</span></span>{tick}</button>'


def page(pw, picks=None):
    """`picks`: the four tapped names, for the checked grid (None = picking)."""
    ph = round(pw * 1.5)
    tiles = ''.join(tile(f, r, picks) for f, r in cells)
    if picks is None:
        q, sec, top, btn = '<span class="ql">Select 4 actors in<span class="cast-dots"><i></i><i></i><i></i><i></i></span></span><b>Kick-Ass</b>', 56, 0, '<button class="cta off">Check</button>'
    else:
        hit = sum(1 for f, r in cells if r and f['name'] in picks)
        wrong, miss = 4 - hit, 4 - hit
        q = f'<span class="qn">Kick-Ass</span><b>{hit} of 4{f" · {wrong} wrong" if wrong else ""}{f" · {miss} missed" if miss > wrong else ""}</b>'
        sec, top, btn = 49, hit - wrong, '<button class="cta">Next</button>'
    ask = (f'<div class="cast-ask" style="grid-template-columns:{max(52, pw)}px minmax(0,1fr) 54px"><img class="cast-poster" style="width:{pw}px;height:{ph}px" src="{IMG}w342{t["p"]}" alt="">'
           f'<div class="q">{q}</div>'
           f'<div class="cast-clock{" paused" if picks else ""}"><svg viewBox="0 0 54 54"><circle class="trk" cx="27" cy="27" r="23"/><circle class="arc" cx="27" cy="27" r="23" stroke-dasharray="{145 * sec / 60:.0f} 145"/></svg><span>{sec}</span><b class="pause"><s></s><s></s></b></div></div>')
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap">
<link rel="stylesheet" href="../../../src/app/play/play.css"><style>{FRAME}</style></head><body>
<div class="wtw-play"><div class="app"><div class="inner"><div class="phone arcade" style="--gacc:#17b3a3"><div class="screen game-screen">
<div class="topbar"><button class="hb">{X}</button><div class="gtitle live">POSTER 1 OF 7 · SCORE {top}</div><button class="hb r">{Q}</button></div>
<div class="cast">{ask}<div class="cast-grid">{tiles}</div>{btn}</div>
</div></div></div></div></div>{FIT}</body></html>"""


CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
TWO_TWO = {'Aaron Taylor-Johnson', 'Nicolas Cage', 'Colin Firth', 'Nicholas Hoult'}          # 2 right, 2 wrong
THREE_ONE = {'Aaron Taylor-Johnson', 'Nicolas Cage', 'Chloë Grace Moretz', 'Colin Firth'}   # 3 right, 1 wrong
for name, pw, picks in [('size-0-today', 48, None), ('size-1-plus20', 58, None), ('size-2-plus25', 60, None), ('size-3-plus30', 62, None), ('size-4-plus35', 65, None),
                        ('size-4-plus35-checked-2right-2wrong', 65, TWO_TWO), ('size-4-plus35-checked-3right-1wrong', 65, THREE_ONE)]:
    fn = f'{OUT}/{name}'
    open(f'{fn}.html', 'w').write(page(pw, picks))
    subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--window-size={W},{H}', '--force-device-scale-factor=2',
                    '--virtual-time-budget=6000', f'--screenshot={fn}.png', f'file://{fn}.html'], capture_output=True)
    subprocess.run(['sips', '-c', str(H * 2), str(W * 2), '--cropOffset', '0', '0', f'{fn}.png', '--out', f'{fn}.png'], capture_output=True)
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', f'{fn}.png', '--out', f'{fn}.jpg'], capture_output=True)
    os.remove(f'{fn}.png')
    dom = subprocess.run([CH, '--headless=new', '--disable-gpu', f'--window-size={W},{H}', '--virtual-time-budget=6000', '--dump-dom', f'file://{fn}.html'], capture_output=True, text=True).stdout
    print(name, f'poster {pw}×{round(pw * 1.5)}', 'faces', dom.split('<title>')[1].split('</title>')[0] if '<title>' in dom else '?', 'px wide')
