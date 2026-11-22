"""Renders each group of phones (375x812, 2x) with a label over each and the caption under them -> <n>-<name>.jpg
Same pipeline as docs/prototypes/watchlist-v3/render.py (copied, not changed). Run: python3 render.py [group ...]"""
import pathlib, subprocess, os, html, sys
from PIL import Image
HERE = pathlib.Path(__file__).parent.resolve()
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP = pathlib.Path(os.environ.get('TMPDIR', '/tmp')) / 'f6-render'; TMP.mkdir(exist_ok=True)
W, H, G, TOP, CAP = 375, 812, 28, 60, 170

ONLY = sys.argv[1:]
GROUPS = [
 ('1-one-person', [('a-today-one', 'Today'), ('a-new-one', 'Proposed')],
  'Tenet, on For you’s “Why it’s a match” sheet. Today the Creators bar has no words, and the person sits at the bottom under Crew. '
  'Proposed: the Crew section goes; the person is named right under the Creators bar, with what you rated of theirs. '
  'Christopher Nolan made Interstellar, Inception and Oppenheimer, and the test account loved all three: two are named, the third is \u201cand 1 more\u201d. Bar lengths are a sample.'),
 ('2-two-or-more', [('b-new-two', 'Two people'), ('b-new-four', 'Four people')],
  'Everyone you rated is named, strongest first, each on their own line, never cut short. Free Guy: Shawn Levy and Ryan Reynolds, '
  'both from Deadpool & Wolverine, which the test account loved. Avatar: Fire and Ash: James Cameron and three of its stars, all from Avatar, '
  'which it liked. Bar lengths are a sample.'),
 ('3-nobody', [('c-today-nobody', 'Today'), ('c-new-nobody', 'Proposed')],
  'Weapons: nobody the test account rated is in it. Today the Creators bar still shows a short sliver (it measures the title against the '
  'rest of the batch, so it’s never empty) and Crew says “No one you follow is in this one.” Proposed: no bar, one quiet line where it was, '
  'and no Crew section.'),
 ('4-card-page', [('d-card-one', 'One person'), ('d-card-two', 'Two people'), ('d-card-nobody', 'Nobody')],
  'The same three cases on a title’s card page (Watchlist, Seen, Search), which shows the breakdown on the page itself. It’s the same piece '
  'of the app, so it changes in the same way, in the same words. Scrolled down to the Score breakdown; the title’s poster is above.'),
 ('5-loved-and-liked', [('e-mixed', 'Loved 2, liked 2'), ('e-many', 'Loved 3, liked 3')],
  'Loved first, then liked, in one line, at most two titles in each, the best known first; the rest is \u201cand 1 more\u201d. '
  'These ratings are made up to show the cases (the test account has no one like this); the credits are real, Nolan made all six.'),
]

for name, phones, caption in GROUPS:
    if ONLY and name not in ONLY: continue
    n = len(phones)
    PW = max(n * W + (n + 1) * G, 2 * W + 3 * G)
    x0 = (PW - (n * W + (n - 1) * G)) // 2
    PH = TOP + H + CAP
    cols = ''.join(
        f'<div class="col" style="left:{x0 + i * (W + G)}px"><div class="l">{html.escape(lbl)}</div>'
        f'<iframe src="file://{HERE}/{key}.html"></iframe></div>' for i, (key, lbl) in enumerate(phones))
    page = f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600&display=swap"><style>
html,body{{margin:0;width:{PW}px;height:{PH}px;background:#f4f1ea;overflow:hidden;font-family:Inter,system-ui,sans-serif}}
.col{{position:absolute;top:0;width:{W}px}}.l{{height:{TOP}px;display:flex;align-items:center;font:600 18px/1.2 Inter;color:#1b1b1b}}
iframe{{display:block;width:{W}px;height:{H}px;border:0;border-radius:18px;background:#000;box-shadow:0 0 0 1px rgba(0,0,0,.12)}}
.cap{{position:absolute;left:{G}px;right:{G}px;top:{TOP + H + 18}px;font:500 17px/1.5 Inter;color:#1b1b1b}}
</style></head><body>{cols}<div class="cap">{html.escape(caption)}</div></body></html>'''
    (TMP / 'page.html').write_text(page)
    png = TMP / 'o.png'
    subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={TMP}/prof',
                    f'--window-size={PW},{PH + 200}', '--force-device-scale-factor=2', '--allow-file-access-from-files',
                    '--virtual-time-budget=8000', f'--screenshot={png}', f'file://{TMP}/page.html'],
                   stderr=subprocess.DEVNULL, check=True)
    im = Image.open(png).convert('RGB')
    im = im.crop((0, 0, PW * 2, min(im.height, PH * 2)))
    out = HERE / f'{name}.jpg'
    im.save(out, quality=88)
    print(out.name, im.size)
