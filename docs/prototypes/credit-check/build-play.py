"""Builds play.html, the playable Cast Call prototype (was "Credit Check") (a private Artifact page).
Reads deck.json (build-deck.py), downloads each poster/face once (OS temp folder),
shrinks them with sips and embeds them as data URIs. The app's real play.css is
inlined, so the screens match the live games.

Run from the repo root: python3 docs/prototypes/credit-check/build-play.py
"""
import base64, concurrent.futures, json, os, subprocess, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(ROOT, '../../..'))
CACHE = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'wtw-credit-check-img-q60')
os.makedirs(CACHE, exist_ok=True)
deck = json.load(open(os.path.join(ROOT, 'deck.json')))

need = {}
for d in deck:
    need['f' + d['img']] = ('w185', d['img'], 150)
    for c in d['cells']:
        need['p' + c['p']] = ('w342', c['p'], 240)

def fetch(item):
    key, (size, path, width) = item
    out = os.path.join(CACHE, key.replace('/', '_'))
    if not os.path.exists(out):
        raw = out + '.raw'
        urllib.request.urlretrieve(f'https://image.tmdb.org/t/p/{size}{path}', raw)
        subprocess.run(['sips', '-Z', str(int(width * 1.5)), '-s', 'format', 'jpeg', '-s', 'formatOptions', '60', raw, '--out', out],
                       check=True, capture_output=True)
        os.remove(raw)
    return key, 'data:image/jpeg;base64,' + base64.b64encode(open(out, 'rb').read()).decode()

with concurrent.futures.ThreadPoolExecutor(12) as ex:
    IMG = dict(ex.map(fetch, need.items()))

bg = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(REPO, 'public/wtw-bg.svg'), 'rb').read()).decode()
play_css = open(os.path.join(REPO, 'src/app/play/play.css')).read()
game_css = open(os.path.join(ROOT, 'play.css.part')).read().replace('__BG__', bg)
game_js = open(os.path.join(ROOT, 'play.js.part')).read()
slim = [{'id': d['id'], 'name': d['name'], 'f': 'f' + d['img'], 'tier': d['tier'],
         'cells': [{'t': c['t'], 'p': 'p' + c['p'], 'r': c['r']} for c in d['cells']]} for d in deck]

html = f'''<title>Cast Call</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap">
<style>{play_css}</style>
<style>{game_css}</style>
<div class="wtw-play"><div class="app"><div class="inner"><div class="phone arcade" style="--gacc:#4d8dff"><div class="screen game-screen" id="scr"></div></div></div></div></div>
<script>const DECK={json.dumps(slim, ensure_ascii=False)};const IMG={json.dumps(IMG)};</script>
<script>{game_js}</script>
'''
open(os.path.join(ROOT, 'play.html'), 'w').write(html)
print(f'{len(deck)} faces, {len(IMG)} images, {len(html) / 1e6:.1f} MB')
