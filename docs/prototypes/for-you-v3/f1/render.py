"""Renders each group of phones (375x812, 2x) with a label over each and the caption under them -> <n>-<name>.jpg
F1 (#349). Same pipeline as docs/prototypes/watchlist-v3/render.py. Run: python3 render.py [group ...]"""
import pathlib, subprocess, os, html, sys
from PIL import Image
HERE = pathlib.Path(__file__).parent.resolve()
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP = pathlib.Path(os.environ.get('TMPDIR', '/tmp')) / 'f1-render'; TMP.mkdir(exist_ok=True)
W, H, G, TOP, CAP = 375, 812, 28, 60, 170

ONLY = sys.argv[1:]
GROUPS = [
 ('1-end-card-without-chat', [('a-end-chat', 'Approved: chat on'), ('b-end-nochat', 'Chat off, or out of turns today')],
  'Left: the approved end card (9-refresh-at-the-end). Right: when the chat is off or has no turns left today, the card never offers '
  'what won’t answer: Refresh alone, and the text keeps only its first sentence, “Want 20 fresh ones?”. Same card, same sizes.'),
 ('2-refresh-loading', [('e-before', 'You tap Refresh'), ('c-loading', 'While the new 20 are built')],
  'Right: the list gives way to today\u2019s first-load screen, exactly as it is today (“Reading your fingerprint · Finding matches”, '
  'the moving fingerprint), whether you tapped Refresh at the top or on the end card. No new words. Today’s Find more takes a few seconds; '
  'Refresh takes the same. Then the new 20 appear from the top, as in the approved 10-refresh-at-the-top.'),
 ('3-refresh-failed', [('e-before', 'Before'), ('d-failed', 'If Refresh fails')],
  'Your same 20 come back, unchanged, at the top. The top line says “Couldn’t refresh right now” (today’s words when Find more fails, '
  'in today’s error colour) in place of “Your 20 picks”, and Refresh stays beside it to try again. Nothing is lost and nothing moves.'),
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
