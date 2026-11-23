"""F1 proof: each approved mock next to the live app at 375 px (Chrome, phone emulation, 2026-11-22, the test account,
FOR_YOU_V3 + FORMULA_V2 + NAV_TABS + CHAT_MODE=consultant; CHAT_MODE=off for the end card without the chat).
Approved: docs/prototypes/for-you-v3/9-refresh-at-the-end.jpg, 10-refresh-at-the-top.jpg, and the f1/ mocks Eran
approved on #349. Run: python3 compose.py"""
import pathlib
from PIL import Image, ImageDraw, ImageFont
HERE = pathlib.Path(__file__).parent.resolve(); V3 = HERE.parent
W, H, G, TOP = 375, 812, 28, 60
def phone(jpg, x):                      # a phone of a mock at left edge x (1x px), at 2x
    return Image.open(V3 / jpg).crop((x * 2, TOP * 2, (x + W) * 2, (TOP + H) * 2))
PAIR = lambda i: G + i * (W + G)        # the i-th phone of a pair
SINGLE = (2 * W + 3 * G - W) // 2       # a single phone, centred on a pair's width
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 36)
PAIRS = [
 ('1-top', '10-refresh-at-the-top.jpg', PAIR(0), 'live-top-kill-bill-2.jpg', 'Live: top of the 20'),
 ('2-after-refresh', '10-refresh-at-the-top.jpg', PAIR(1), 'live-after-refresh-devil-wears-prada.jpg', 'Live: after Refresh'),
 ('3-end', '9-refresh-at-the-end.jpg', SINGLE, 'live-end-chat.jpg', 'Live: after the last card'),
 ('4-end-no-chat', 'f1/1-end-card-without-chat.jpg', PAIR(1), 'live-end-no-chat.jpg', 'Live: chat off'),
 ('5-loading', 'f1/2-refresh-loading.jpg', PAIR(1), 'live-refresh-loading.jpg', 'Live: Refresh working'),
 ('6-failed', 'f1/3-refresh-failed.jpg', PAIR(1), 'live-refresh-failed.jpg', 'Live: Refresh failed'),
]
for name, mock, x, live, label in PAIRS:
    a = phone(mock, x); b = Image.open(HERE / live).convert('RGB').resize((W * 2, H * 2))
    out = Image.new('RGB', (W * 4 + G * 6, H * 2 + 120), '#f4f1ea'); d = ImageDraw.Draw(out)
    d.text((G * 2, 40), 'Approved mock', fill='#1b1b1b', font=FONT); d.text((W * 2 + G * 4, 40), label, fill='#1b1b1b', font=FONT)
    out.paste(a, (G * 2, 120)); out.paste(b, (W * 2 + G * 4, 120))
    out.save(HERE / f'proof-{name}.jpg', quality=85); print(name)
