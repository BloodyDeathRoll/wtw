"""Renders each group of phones (375x812, 2x) with a label over each and the caption under them -> <n>-<name>.jpg
The Watchlist's pipeline (docs/prototypes/watchlist-v3/render.py), with F7's groups. Run: python3 render.py [group ...]"""
import pathlib, subprocess, os, html, sys
from PIL import Image
HERE = pathlib.Path(__file__).parent.resolve()
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP = pathlib.Path(os.environ.get('TMPDIR', '/tmp')) / 'f7-render'; TMP.mkdir(exist_ok=True)
W, H, G, TOP, CAP = 375, 812, 28, 60, 230

ONLY = sys.argv[1:]
GROUPS = [
 ('1-wording', [('c-stretch-a', 'A · Stretch pick'), ('c-stretch-b', 'B · Not your usual, on purpose'),
                ('c-stretch-c', 'C · Something different, on purpose')],
  'The label’s words: which one? The stretch pick is the 1 in 20 the app puts in on purpose, outside your taste. '
  'All three are true for every stretch pick: the app places it on purpose, and its match is always 40% or less. '
  'The label sits over the title, in the poster circles’ outline on the where-to-watch pill’s shape: no new colour, size or icon. '
  'In all three, the line under the poster is the title’s usual one, and the link says “Why this pick” (the card’s own words when it claims no match), '
  'since 40% isn’t a match. La La Land is the pick the app would make for the test account; the account gets none today (see 2).'),
 ('2-next-to-a-normal-card', [('a-normal', 'A normal card'), ('b-stretch-today', 'A stretch pick today'), ('c-stretch-a', 'Proposed (wording A)')],
  'Left: Django Unchained, on the test account’s For you now, 97%. Middle: a stretch pick as the app would show it today, nothing says it’s on purpose, '
  'so 40% reads as a bad match, and the line is the engine’s raw note (“high critical rating” isn’t always true: the rating it checks is partly the audience’s). '
  'Right: the label, the usual line, “Why this pick”. Found while checking: the test account gets no stretch picks at all, because the app also waits '
  'for 3 chat conversations (it has 0) and for a surer read of your taste in stories than ratings give it. That part is the engine’s, not this card’s.'),
 ('3-sheet', [('d-sheet-today', 'Today: the sheet'), ('d-sheet-new-top', 'Proposed: the sheet'), ('d-sheet-new-end', 'Proposed, scrolled down')],
  'Tap “Why this pick”. Left, today: the Why text opens with the same raw note. Middle: the label sits over the title here too, and the Why text '
  'is the title’s own (who you know in it, then the story). The bars are La La Land’s real ones for the test account: taste low, crowd and Emma Stone high. '
  'Right: “Doesn’t quite fit” already says it in full, as today: “A stretch pick: chosen on purpose from outside what you usually go for.”'),
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
