"""F7 proof: each approved mock (docs/prototypes/for-you-v3/f7) next to the live app at 375 px (Chrome, phone emulation,
2026-11-22, test account, FORMULA_V2 + NAV_TABS as in production, FOR_YOU_V3 on unless noted).

The test account gets no stretch pick from the engine (#416), so for these captures one card was swapped in the browser
only: the first card of the server's answer became La La Land with the engine's own data for it (the same 40%, line,
bars and sheet text as the mock, from steps 2-7 run read-only for the account). The screen code is the PR's; nothing
was saved. Run: python3 compose.py"""
import pathlib
from PIL import Image, ImageDraw, ImageFont
HERE = pathlib.Path(__file__).parent.resolve(); MOCK = HERE.parent / 'f7'
W, H, G, TOP = 375, 812, 28, 60
def phone(jpg, i):                      # the i-th phone of a mock group, at 2x
    x = (G + i * (W + G)) * 2
    return Image.open(MOCK / jpg).crop((x, TOP * 2, x + W * 2, (TOP + H) * 2))
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 36)
PAIRS = [
 ('1-stretch-card', ('2-next-to-a-normal-card.jpg', 2), 'Approved mock', 'live-1-stretch-card.jpg', 'Live: the stretch card'),
 ('2-normal-card', ('2-next-to-a-normal-card.jpg', 0), 'Approved mock: a normal card', 'live-2-normal-card.jpg', 'Live: The Devil Wears Prada'),
 ('3-sheet-top', ('3-sheet.jpg', 1), 'Approved mock', 'live-3-sheet-top.jpg', 'Live: the sheet'),
 ('4-sheet-end', ('3-sheet.jpg', 2), 'Approved mock', 'live-4-sheet-end.jpg', 'Live: scrolled down'),
 ('5-switch-off', ('2-next-to-a-normal-card.jpg', 2), 'Approved mock', 'live-5-stretch-card-switch-off.jpg', 'Live, FOR_YOU_V3 off (the X)'),
]
for name, (mock, i), la, live, lb in PAIRS:
    a = phone(mock, i); b = Image.open(HERE / live).convert('RGB').resize((W * 2, H * 2))
    out = Image.new('RGB', (W * 4 + G * 6, H * 2 + 120), '#f4f1ea'); d = ImageDraw.Draw(out)
    d.text((G * 2, 40), la, fill='#1b1b1b', font=FONT); d.text((W * 2 + G * 4, 40), lb, fill='#1b1b1b', font=FONT)
    out.paste(a, (G * 2, 120)); out.paste(b, (W * 2 + G * 4, 120))
    out.save(HERE / f'proof-{name}.jpg', quality=85); print(name)
