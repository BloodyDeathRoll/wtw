"""The cards' flow board (2026-11-11): python3 flow.py -> 2-cards-flow.jpg, from the rendered state JPEGs."""
from PIL import Image, ImageDraw, ImageFont
F = '/System/Library/Fonts/Helvetica.ttc'
f = lambda sz, b=False: ImageFont.truetype(F, sz, index=1 if b else 0)
TW, TH, GAP, M = 300, 650, 110, 60
BG, INK, GOLD, SUB = '#f4f1ea', '#1b1b1b', '#8a5a00', '#555'


def thumb(name):
    return Image.open(name).convert('RGB').crop((0, 0, 750, 1624)).resize((TW, TH), Image.LANCZOS)


def holder(lines):
    im = Image.new('RGB', (TW, TH), '#1b1b1e'); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, TW - 1, TH - 1), 18, outline='#D49B3A', width=3)
    for i, l in enumerate(lines):
        w = d.textlength(l, font=f(26, i == 0))
        d.text(((TW - w) / 2, TH // 2 - 40 + i * 36), l, font=f(26, i == 0), fill='#D49B3A' if i == 0 else '#c8c8cc')
    return im


CAPH, LOOP = 70, 70                       # caption block under each screen; room for the loop arrow
ROWH = 50 + TH + CAPH + LOOP + 40
H_EXTRA = 34
W = M * 2 + 5 * TW + 4 * GAP
H = 150 + ROWH * 2 + H_EXTRA
board = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(board)
d.text((M, 40), 'The cards: the whole flow', font=f(44, True), fill=INK)
d.text((M, 96), 'Top: most people. Bottom: someone who has seen few of the titles. Every path ends on the screen before the picks.', font=f(24), fill=SUB)


def arrow(x1, y, x2, label):
    d.line((x1, y, x2 - 14, y), fill=INK, width=4); d.polygon([(x2, y), (x2 - 18, y - 10), (x2 - 18, y + 10)], fill=INK)
    ls = label.split('\n')
    for i, l in enumerate(ls):
        w = d.textlength(l, font=f(19)); d.text(((x1 + x2) / 2 - w / 2, y - 16 - 23 * (len(ls) - i)), l, font=f(19), fill=GOLD)


def row(y0, title, items, arrows):
    d.text((M, y0), title, font=f(30, True), fill=INK)
    ys = y0 + 50
    for i, (im, cap) in enumerate(items):
        x = M + i * (TW + GAP); board.paste(im, (x, ys))
        for j, l in enumerate(cap):
            d.text((x, ys + TH + 12 + j * 26), l, font=f(21, j == 0), fill=INK if j == 0 else SUB)
        if i < len(items) - 1:
            arrow(x + TW + 10, ys + TH // 2, x + TW + GAP - 10, arrows[i])
    return ys


NEXT = holder(['Next screen', 'before the picks', '(part 4, to design)'])
row(150, 'Most people', [
    (thumb('2-card-1-first.jpg'), ['First card', '0 of 30']),
    (thumb('2-card-5-mile10.jpg'), ['After the 10th rating', '"A third of the way", animated']),
    (thumb('2-card-7-eleven.jpg'), ['Next card: back to normal', '"Rate what you\'ve seen"']),
    (thumb('2-card-6-mile20.jpg'), ['After the 20th rating', '"10 more to go", animated']),
    (NEXT, ['After the 30th rating'])],
    ['10 rated', 'any tap', '20 rated', '30 rated'])
ys = row(150 + ROWH, 'Few seen', [
    (thumb('2-card-1-first.jpg'), ['First card', '0 of 30']),
    (thumb('2-msg-1-slow.jpg'), ['10 cards in, 2 or fewer rated', 'Once. "Keep going"']),
    (thumb('2-card-8-few.jpg'), ['Cards again']),
    (thumb('2-msg-2-very-slow.jpg'), ['20 cards in, 4 or fewer rated', 'Once, even without the first']),
    (NEXT, ['"Go to quick picks", or', '30 rated, or 90 cards shown'])],
    ['10 cards,\n≤2 rated', 'Keep going', '20 cards,\n≤4 rated', 'Go to\nquick picks'])
# "Keep looking" loops from the second message back to the cards, below the captions
xm = M + 3 * (TW + GAP) + TW // 2; xc = M + 2 * (TW + GAP) + TW // 2
top = ys + TH + CAPH; yb = top + LOOP - 20
d.line((xm, top, xm, yb), fill=INK, width=4); d.line((xc, yb, xm, yb), fill=INK, width=4); d.line((xc, yb, xc, top + 16), fill=INK, width=4)
d.polygon([(xc, top), (xc - 10, top + 18), (xc + 10, top + 18)], fill=INK)
t = 'Keep looking: cards until 30 rated or 90 shown'
w = d.textlength(t, font=f(19)); d.text(((xm + xc) / 2 - w / 2, yb + 10), t, font=f(19), fill=GOLD)
board.save('2-cards-flow.jpg', quality=88)
print(board.size)
