"""Renders each group of phones (375x812, 2x) with a label over each and the caption under them -> <n>-<name>.jpg
Same pipeline as docs/prototypes/for-you-shelf/render.py. Run: python3 render.py [group ...]"""
import pathlib, subprocess, os, html, sys
from PIL import Image
HERE = pathlib.Path(__file__).parent.resolve()
CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP = pathlib.Path(os.environ.get('TMPDIR', '/tmp')) / 'watchlist-render'; TMP.mkdir(exist_ok=True)
W, H, G, TOP, CAP = 375, 812, 28, 60, 150

ONLY = sys.argv[1:]
GROUPS = [
 ('1-shape', [('a-cards', 'A · Today: the For you card'), ('b-rows', 'B · One row per title'), ('c-grid', 'C · A wall of posters')],
  'Alon’s 55 titles, same header and sort bar in all three. A: today, the For you card one-to-one; about 50 screens to the bottom. '
  'B: poster, title, year · length · ★, where to watch, and the match; about 9 screens. Tap a row and the full card opens. '
  'C: posters only, 3 across, the service under each; about 5 screens. Tap a poster for the card.'),
 ('2-shape-with-filters', [('d-rows-chips', 'B · Rows, with filters'), ('e-grid-chips', 'C · Posters with names, with filters')],
  'Both: a filter row on top, in the card’s own chip style, one chip lit; it scrolls sideways. All · Movies · Series, then the four services '
  'TMDB knows for Israel, only those with a title on the list. The counts are placeholders. The sort bar stays under it for now. '
  'B keeps the length; the service line shows only Netflix, HBO Max, Apple TV or Prime Video (Israel), nothing for the rest. '
  'C: name under each poster, always two lines tall so the rows line up, then year and the service.'),
 ('3-bigger', [('f-rows2', 'B2 · Rows: bigger poster, no ring'), ('g-grid2', 'C2 · Two across')],
  'Room per title: today’s card about 650px, C2 about 160, B2 about 125, the 3-across wall about 75. So one screen holds about 1 card, '
  '4 of C2, 5 of B2, 8 of the wall. B2: the match is a gold word on the service line, the star sits where the ring was. '
  'C2: the card’s own service pill and ring on the poster, name and year · length · ★ under it, the star on the poster’s corner. '
  'The Prestige is starred in both; a Starred chip joins the filters.'),
 ('4-air', [('h-rows3', 'B3 · Rows, poster 82×123'), ('i-grid3', 'C3 · Two across, more air')],
  'B3: poster up from 72×108 to 82×123, a little more padding; about 4.1 titles per screen (was 4.8). '
  'C3: posters 158 wide instead of 167, 18px between columns instead of 10, 28px between rows instead of 18; about 3.6 per screen (was 4).'),
 ('5-tap', [('k-sortfold', 'Your list'), ('j1-card-top', 'Tap a title: the card page')],
  'Left: the list. The "Sort by" line is gone and nothing replaces it: the sort is parked (see 12-sort for the plan if it ever comes back). '
  'Right: tapping a row opens the card you know from For you as its own page, Back returns to the list. Everything you do with a title lives here: '
  'the why line, share, trailer, the star (new, top circle), Remove from watchlist, Seen it?, and the breakdown under them (see 11). Nothing was mashed together.'),
 ('11-why-on-card', [('j-card', 'Today: a button opens the sheet'), ('j2-card-why', 'Proposed: the breakdown on the page'), ('j3-card-bars', 'Same page, further down')],
  'Middle and right: the "Why it’s a match" button is gone from the card page; its sheet’s content (Why, Score breakdown, What it’s like, Crew) sits on the page under Seen it?, '
  'in the sheet’s own styles. One tap from the list to everything about a title. The text here is the card’s own line plus the film’s plot; the bars and the crew are a sample, '
  'the real ones come from the saved breakdown. The one-line why stays at the top as the short version; the long one is below.'),
 ('12-sort', [('k2-sortmenu', 'Tap the sort: today’s menu'), ('k3-sortyear', 'Sorted by Year')],
  'PARKED (2026-11-18): the sort is left out of the next round. Kept as the plan to come back to. The pill at the end of the chip row is today’s sort control, label and all: it says what the list is sorted by (Date Added, Year, Rating, Name), and tapping it opens today’s '
  'menu while the list fades back, exactly as today. No up/down arrow: the order inside each sort is fixed as it is today (newest, latest year, highest ★, A to Z). '
  'Right: Year picked, the pill now says Year. A filter and a sort combine: Netflix sorted by Year.'),
 ('13-seen', [('u-seen-chip', 'The Seen chip'), ('v-end-seen', 'The end of the list, with Seen under it')],
  'Left: a Seen chip at the end of the filter row shows only what you’ve rated, your reaction in place of the match. The count (55) keeps counting them: Seen never takes a title off the counter. '
  'Right: the order from top to bottom is your unseen titles, then the end card (one ask: an invite to talk, copy a placeholder), then the "Seen" line and the rated ones. Seen is always last.'),
 ('6-filter', [('k-sortfold', 'All'), ('l-netflix', 'Netflix tapped')],
  'One chip lit at a time. Tap Netflix and the list is only what streams on Netflix in Israel; the header count stays the whole list, the chip count is the part. '
  'Tap All, or the lit chip again, to go back. Services come from TMDB’s Israeli data: Netflix, HBO Max, Apple TV, Prime Video, and only when a title on the list is on one.'),
 ('7-seen', [('m-seen-inplace', 'A · Rated: stays where it was'), ('n-seen-sunk', 'B · Rated: sinks to “Seen” at the end')],
  'You loved Memento from its card. A: today’s rule, the row stays in place; the match line becomes your reaction and the poster dims. '
  'B (chosen): the row keeps its place on the list but moves under a "Seen" line at the very end, so the top of your list is always things you haven’t watched. '
  'Either way nothing leaves by itself: only Remove does that.'),
 ('8-remove', [('o-swipe', 'Swipe a row left'), ('p-removed', 'After Remove')],
  'A shortcut, not the only way: the card page still has Remove from watchlist. Swipe left on a row and Remove shows; tap it and the row folds into a one-line note with Undo, '
  'which stays about 5 seconds, then folds and the list closes the gap. The count goes 55 → 54 everywhere at once (header, All chip, tab badge).'),
 ('9-empty', [('q-empty', 'Nothing saved yet'), ('r-empty-starred', 'Starred, with none')],
  'Left: a new account. Today’s text, with "Go to For you" instead of "Browse recommendations", since that’s the tab’s name now, in the app’s orange primary (today’s button is blue; it goes). No chips. '
  'Right: a filter with nothing behind it says so in one line and the chip stays lit, so you see why the list is empty.'),
 ('10-end', [('s-end', 'The end of the list')],
  'Under the last unseen row: a card in For you’s end-card style, one ask (copy a placeholder). It opens the chat knowing it came from the Watchlist, so the chat can open with '
  '"what’s on your list, or something new?" (copy a placeholder). Shows under All only, when at least three unseen titles are on the list.'),
]

for name, phones, caption in GROUPS:
    if ONLY and name not in ONLY: continue
    n = len(phones)
    PW = max(n * W + (n + 1) * G, 2 * W + 3 * G)  # single phones get the same canvas width as pairs, for room to read
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
