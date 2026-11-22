"""F6 proof: each approved mock (docs/prototypes/for-you-v3/f6) next to the live app at 375 px (Chrome, phone emulation,
2026-11-22, test account with 15 ratings, FORMULA_V2 + NAV_TABS as in production). Run: python3 compose.py"""
import pathlib
from PIL import Image, ImageDraw, ImageFont
HERE = pathlib.Path(__file__).parent.resolve(); MOCK = HERE.parent / 'f6'
W, H, G, TOP = 375, 812, 28, 60
def phone(jpg, i):                      # the i-th phone of a mock group, at 2x
    x = (G + i * (W + G)) * 2
    return Image.open(MOCK / jpg).crop((x, TOP * 2, x + W * 2, (TOP + H) * 2))
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 36)
PAIRS = [
 ('1-one-person', '1-one-person.jpg', 1, 'live-1-one-person-dunkirk.jpg', 'Live: Dunkirk'),
 ('2-two', '2-two-or-more.jpg', 0, 'live-2-two-django.jpg', 'Live: Django Unchained'),
 ('2-four', '2-two-or-more.jpg', 1, 'live-2-four-prestige.jpg', 'Live: The Prestige'),
 ('3-nobody', '3-nobody.jpg', 1, 'live-3-nobody-wag-the-dog.jpg', 'Live: Wag the Dog'),
 ('5-loved-and-liked', '5-loved-and-liked.jpg', 0, 'live-5-loved-and-liked-mario-galaxy.jpg', 'Live: The Super Mario Galaxy Movie'),
 ('4-card-one', '4-card-page.jpg', 0, 'live-4-card-one-top-gun.jpg', 'Card page, live: Top Gun: Maverick'),
 ('4-card-two', '4-card-page.jpg', 1, 'live-4-card-two-guardians.jpg', 'Card page, live: Guardians Vol. 3'),
 ('4-card-nobody', '4-card-page.jpg', 2, 'live-4-card-nobody-dune.jpg', 'Card page, live: Dune'),
]
for name, mock, i, live, label in PAIRS:
    a = phone(mock, i); b = Image.open(HERE / live).convert('RGB').resize((W * 2, H * 2))
    out = Image.new('RGB', (W * 4 + G * 6, H * 2 + 120), '#f4f1ea'); d = ImageDraw.Draw(out)
    d.text((G * 2, 40), 'Approved mock', fill='#1b1b1b', font=FONT); d.text((W * 2 + G * 4, 40), label, fill='#1b1b1b', font=FONT)
    out.paste(a, (G * 2, 120)); out.paste(b, (W * 2 + G * 4, 120))
    out.save(HERE / f'proof-{name}.jpg', quality=85); print(name)
