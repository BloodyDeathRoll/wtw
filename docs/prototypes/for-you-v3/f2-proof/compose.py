"""F2 proof: the approved mock's two phones next to the live app at 375 px (phone emulation, 2026-11-22, the test
account, FOR_YOU_V3 + FORMULA_V2 + NAV_TABS + CHAT_MODE=consultant), each after a hop to the Watchlist and back.
Approved: docs/prototypes/for-you-v3/1-during-a-visit.jpg. Run: python3 compose.py"""
import pathlib
from PIL import Image, ImageDraw, ImageFont
HERE = pathlib.Path(__file__).parent.resolve(); V3 = HERE.parent
W, H, G = 375, 812, 28
MOCK = Image.open(V3 / '1-during-a-visit.jpg').convert('RGB')
def phone(left):                        # a phone of the mock, its left edge at `left` (mock px), at 2x
    return MOCK.crop((left, 120, left + W * 2, 120 + H * 2))
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 36)
PAIRS = [
 ('1-added', 56, 'live-added-after-hop.jpg', 'Live: you added it, after a tab hop'),
 ('2-rated', 862, 'live-rated-after-hop.jpg', 'Live: you rated it, after a tab hop'),
]
for name, left, live, label in PAIRS:
    a = phone(left); b = Image.open(HERE / live).convert('RGB').resize((W * 2, H * 2))
    out = Image.new('RGB', (W * 4 + G * 6, H * 2 + 120), '#f4f1ea'); d = ImageDraw.Draw(out)
    d.text((G * 2, 40), 'Approved mock', fill='#1b1b1b', font=FONT); d.text((W * 2 + G * 4, 40), label, fill='#1b1b1b', font=FONT)
    out.paste(a, (G * 2, 120)); out.paste(b, (W * 2 + G * 4, 120))
    out.save(HERE / f'proof-{name}.jpg', quality=85); print(name)
