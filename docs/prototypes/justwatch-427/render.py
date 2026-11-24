"""#427 mocks: the JustWatch credit, before and after, on each screen it shows.
raw/*.jpg are 2x captures of the running app at 375px wide (localhost:3000, test account, 2026-11-24), the "after" ones
with the change applied in the page: 11px, white at 35%, and the line pushed to the bottom of the page. The tab bar's
avatar is masked. The share page was captured signed out, without its scripts (so without the moving stars behind it).
Same sheet layout as docs/prototypes/watchlist-v3/render.py. Run: python3 render.py"""
import pathlib, subprocess, os, html
from PIL import Image, ImageDraw
HERE = pathlib.Path(__file__).parent.resolve()
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP = pathlib.Path(os.environ.get('TMPDIR', '/tmp')) / 'jw427-render'; TMP.mkdir(exist_ok=True)
W, G, TOP, CAP = 375, 28, 60, 170

SHEETS = [
 ('1-for-you', '1-foryou', 812,
  'For you, scrolled to the end of the 20. Before: 12px, white at 45%, about 40px above the tab bar. '
  'After: 11px, white at 35%, the last thing on the page, 16px above the tab bar. The space above it is unchanged.'),
 ('2-watchlist', '2-watchlist', 812,
  'Watchlist, all 35, scrolled to the end. Same change: one point smaller, one shade greyer, and 16px above the tab bar '
  'instead of 32. "That’s everything we found." stays where it is.'),
 ('3-watchlist-short', '3-watchlist-short', 812,
  'A short Watchlist (the Starred filter, 3 titles). Before: the line floats right under "That’s everything we found." '
  'After: it drops to the bottom of the page, 16px above the tab bar, and the empty space sits above it.'),
 ('4-card-page', '4-card', 812,
  'A card page (Dune, opened from the Watchlist), scrolled to the end. Before: 14px under the card, 32px above the tab bar. '
  'After: 16px under the card, 16px above the tab bar. On a card shorter than the screen it would drop to the bottom too.'),
 ('5-search-card', '5-search-card', 812,
  'Search’s card page (Slow Horses), scrolled to the end. Search has no tab bar. '
  'Before: 32px above the bottom of the screen. After: 16px above it, and smaller and greyer.'),
 ('6-share-page', '6-share', 812,
  'The public share page /t/… (Slow Horses, signed out, as a friend sees it), scrolled to the end. Before: 26px under the card, 24px above the bottom, a little past the first screen. '
  'After: about 17px under the card, 24px above the bottom of the screen; the page now fits on one screen.'),
 ('7-share-page-taller-phone', '7-share-tall', 915,
  'The same share page on a taller phone (375×915), where today the line floats mid-screen with empty space under it. '
  'After: it sits at the bottom of the screen, 24px above the edge.'),
]

def masked(src, has_tabs):
    im = Image.open(src).convert('RGB')
    if has_tabs:  # the You tab's avatar (24px circle centred at 325,778 in 1x points)
        d = ImageDraw.Draw(im)
        d.ellipse((650 - 26, 1556 - 26, 650 + 26, 1556 + 26), fill=(58, 58, 62))
    out = TMP / pathlib.Path(src).name
    im.save(out, quality=95)
    return out

for name, key, h, caption in SHEETS:
    tabs = key[0] in '1234'
    PW = 2 * W + 3 * G
    PH = TOP + h + CAP
    imgs = [(masked(HERE / 'raw' / f'{key}-{s}.jpg', tabs), lbl) for s, lbl in (('before', 'Today'), ('after', 'Proposed'))]
    cols = ''.join(
        f'<div class="col" style="left:{G + i * (W + G)}px"><div class="l">{html.escape(lbl)}</div>'
        f'<img src="file://{p}"></div>' for i, (p, lbl) in enumerate(imgs))
    page = f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600&display=swap"><style>
html,body{{margin:0;width:{PW}px;height:{PH}px;background:#f4f1ea;overflow:hidden;font-family:Inter,system-ui,sans-serif}}
.col{{position:absolute;top:0;width:{W}px}}.l{{height:{TOP}px;display:flex;align-items:center;font:600 18px/1.2 Inter;color:#1b1b1b}}
img{{display:block;width:{W}px;height:{h}px;border-radius:18px;box-shadow:0 0 0 1px rgba(0,0,0,.12)}}
.cap{{position:absolute;left:{G}px;right:{G}px;top:{TOP + h + 16}px;font:500 16px/1.5 Inter;color:#1b1b1b}}
</style></head><body>{cols}<div class="cap">{html.escape(caption)}</div></body></html>'''
    (TMP / 'page.html').write_text(page)
    png = TMP / 'o.png'
    subprocess.run([CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={TMP}/prof',
                    f'--window-size={PW},{PH + 200}', '--force-device-scale-factor=2', '--allow-file-access-from-files',
                    '--virtual-time-budget=6000', f'--screenshot={png}', f'file://{TMP}/page.html'],
                   stderr=subprocess.DEVNULL, check=True)
    im = Image.open(png).convert('RGB').crop((0, 0, PW * 2, PH * 2))
    out = HERE / f'{name}.jpg'
    im.save(out, quality=88)
    print(out.name, im.size)
