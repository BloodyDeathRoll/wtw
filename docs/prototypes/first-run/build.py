"""First-run flow mocks (2026-11-08): genres -> learner cards -> This or that -> first feed card.

Each screen is the live app's own markup and compiled CSS (live/*.css, copied from the
dev server) with only the new pieces added in fr.css. Run: python3 build.py, then render.sh.
"""
import json, pathlib, re

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent.parent
TITLES = {(t['title'], t['type']): t for t in json.load(open(ROOT / 'src/app/play/data/titles.json'))}
T = lambda n, ty='movie': TITLES[(n, ty)]
LUCIDE = ROOT / 'node_modules/lucide-react/dist/esm/icons'


def icon(name, size=18, sw=2):
    """A lucide icon (the set the app already uses) as inline SVG."""
    src = (LUCIDE / f'{name}.mjs').read_text()
    alias = re.search(r"export \{ default \} from './([\w-]+)\.mjs'", src)
    if alias:
        return icon(alias.group(1), size, sw)
    els = ''
    for tag, attrs in re.findall(r'\[\s*"(\w+)",\s*\{([^}]*)\}', src):
        a = ' '.join(f'{k}="{v}"' for k, v in re.findall(r'(\w+): "([^"]*)"', attrs) if k != 'key')
        els += f'<{tag} {a}/>'
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{els}</svg>')


HEAD = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + ''.join(f'<link rel="stylesheet" href="live/c{i}.css">' for i in range(1, 5))
        + '<link rel="stylesheet" href="fr.css"></head>')
MENU = ('<div class="WTWApp-module__gS1tAq__userMenuWrap"><button class="WTWApp-module__gS1tAq__hamburgerBtn" aria-label="menu" type="button">'
        '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
        'stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path></svg></button></div>')


def apptop(left=''):
    return (f'<div class="apptop"><div class="tb-l">{left}</div><div class="brand app-brand">'
            f'<img alt="" width="56" height="56" src="../../../public/logo_vector.svg">WTW</div><div class="tb-r">{MENU}</div></div>')


def app(screen, cls='screen'):
    """The live /play page frame, exactly as the dev server renders it (captured 2026-11-08)."""
    return (HEAD + '<body class="inter_3d9c7ff2-module__6cOLqa__variable font-sans"><div class="wtw-play bebas_neue_552af79f-module__pOO-sq__variable">'
            '<div class="WTWApp-module__gS1tAq__page"><div class="WTWApp-module__gS1tAq__app"><canvas class="WTWApp-module__gS1tAq__canvas"></canvas>'
            '<div class="WTWApp-module__gS1tAq__appInner"><div class="phone" style="--gacc: #D49B3A;">'
            f'<div class="{cls}">{screen}</div></div></div></div></div></div></body></html>')


SHARE = ('<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>')


def poster(t, size='w342'):
    tv = '<span class="tvb">SERIES</span>' if t['type'] == 'tv' else ''
    return f'<div class="poster real"><img src="https://image.tmdb.org/t/p/{size}{t["poster_path"]}" alt="">{tv}</div>'


# The first-run progress: one thin bar for the whole set-up (30 ratings + 12 picks = 42 answers),
# the live season bar's look. Under it, the live block bar: this step's name and where you are in it.
SETUP_TOTAL = 42


def progress(done, step, right):
    return (f'<div class="seasonbar quiet" role="progressbar"><span class="sb-bar"><i style="width:{done / SETUP_TOTAL * 100:.1f}%"></i></span></div>'
            f'<div class="blockbar"><span>{step}</span>{right}</div>')


# ── 1 · Genres ───────────────────────────────────────────────────
COL = {'comedy': ('#ffad33', '#ff8a00'), 'drama': ('#a565d8', '#7d3fb5'), 'action': ('#e5533c', '#c0392b'),
       'crime': ('#5b6a7d', '#3d4857'), 'thriller': ('#8e44ad', '#6c2e8a'), 'scifi': ('#3a8fd9', '#1f6fb8'),
       'horror': ('#c0392b', '#962d22'), 'romance': ('#ee2d8f', '#c2186b'), 'anim': ('#1fbf9c', '#13957a'),
       'anime': ('#d42fb0', '#a01488'), 'family': ('#7cc96b', '#4f9a3f'), 'doc': ('#b9a24a', '#8e7b30'), 'war': ('#8b7d62', '#6b5e47')}
# (id, label as in lib/genres.ts, lucide icon, two well-known examples from data/titles.json, state)
GENRES = [
    ('comedy', 'Comedy', 'laugh', [('The Office', 'tv'), ('Barbie', 'movie')], 'love'),
    ('drama', 'Drama', 'drama', [('Titanic', 'movie'), ('The Crown', 'tv')], 'love'),
    ('action', 'Action', 'flame', [('John Wick', 'movie'), ('Gladiator', 'movie')], 'like'),
    ('crime', 'Crime', 'siren', [('Heat', 'movie'), ('Breaking Bad', 'tv')], 'like'),
    ('thriller', 'Thriller & mystery', 'search', [('Gone Girl', 'movie'), ('Sherlock', 'tv')], ''),
    ('scifi', 'Sci-fi & fantasy', 'rocket', [('Inception', 'movie'), ('Dune', 'movie')], 'like'),
    ('horror', 'Horror', 'ghost', [('Get Out', 'movie'), ('The Shining', 'movie')], 'never'),
    ('romance', 'Romance', 'flower-2', [('About Time', 'movie'), ('Amélie', 'movie')], ''),
    ('anim', 'Animation', 'rabbit', [('Up', 'movie'), ('Toy Story', 'movie')], ''),
    ('family', 'Family & kids', 'toy-brick', [('Frozen', 'movie'), ('Moana', 'movie')], ''),
    ('anime', 'Anime', 'origami', [('Naruto', 'tv'), ('Spirited Away', 'movie')], 'never'),
    ('doc', 'Documentary', 'video', [('Free Solo', 'movie'), ('Tiger King', 'tv')], ''),
    ('war', 'War & history', 'swords', [('1917', 'movie'), ('Oppenheimer', 'movie')], ''),
]
for _, _, _, ex, _ in GENRES:      # every example must be a real catalogue title
    for n, ty in ex:
        assert (n, ty) in TITLES, n
GB = {'like': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 2.8 1.3 2.5 3L13 9h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.1 20H7"></path></svg>',
      'never': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M5.6 5.6l12.8 12.8"></path></svg>'}
GB['love'] = (  # the live Icon.love / like / never (ui.tsx)
'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21z"></path></svg>')


def grow(g):
    gid, label, ic, ex, st = g
    a, b = COL[gid]
    eg = ' · '.join(n for n, _ in ex)
    btns = ''.join(f'<button class="gbtn gb-{k}" aria-pressed="{"true" if st == k else "false"}">{GB[k]}</button>' for k in ('love', 'like', 'never'))
    return (f'<div class="grow{" rated" if st else ""}"><span class="gname"><i class="gtile" style="background:linear-gradient(150deg,{a},{b})">{icon(ic, 17, 2)}</i>'
            f'<span class="gtext"><span class="glabel">{label}</span><span class="geg">{eg}</span></span></span>{btns}</div>')


nevers = [l for _, l, _, _, s in GENRES if s == 'never']
rated = sum(1 for g in GENRES if g[4])
S = {}
S['1-genres'] = (app(
    apptop() +
    '<div class="setup"><div><h2>How do you feel about…</h2><p class="sub">Tap the ones you have an opinion on. Skip the rest.</p></div>'
    '<div class="grows"><div class="grow ghead"><span></span><span class="gh gh-love">Love</span><span class="gh gh-like">Like</span><span class="gh gh-never">Never</span></div>'
    + ''.join(grow(g) for g in GENRES) + '</div></div>'
    f'<div class="cta-wrap sticky"><button class="cta">Start ({rated} rated)</button><div class="fine">I\'ll never show you {", ".join(nevers)}.</div></div>'),
    '<b>1 · Genres.</b> Today\'s screen plus an icon and two well-known examples per genre. "Never" is the guardrail: never in the cards or the feed.')


# ── 2 · The learner: three versions of the answer buttons ────────
CHIPS3 = [('❤️', 'Loved'), ('👍', 'Liked'), ('👎', 'Disliked')]
EYE_OFF = icon('eye-off', 18, 2)
UNSEEN = f'<button class="unseen ol">{EYE_OFF}Haven&apos;t seen</button>'


def learner(t, rated_n, creator, answers, v):
    return app(
        apptop() + progress(rated_n, 'Rate what you\'ve seen', f'<span class="lcount"><b>{rated_n}</b> of 30</span>') +
        f'<div class="learn {v}">'
        f'<div class="reveal-poster learn-poster">{poster(t, "w500")}<button class="rib"><span>+</span></button><button class="shc">{SHARE}</button></div>'
        f'<h2>{t["title"]}</h2><div class="lmeta">{t["year"]} · {creator}</div><div class="lfill"></div>{answers}</div>',
        cls='screen game-screen')


def tile(e, l, cls=''):
    return f'<button class="ltile {cls}"><span class="seen-emoji">{e}</span><span>{l}</span></button>'


ANS = {
    'a': ('<div class="ltiles three">' + ''.join(tile(e, l) for e, l in CHIPS3) + '</div>'
          f'<button class="lnotseen">{EYE_OFF}Haven\'t seen it</button>'),
    'b': ('<div class="ltiles four">' + ''.join(tile(e, l) for e, l in CHIPS3) + tile('🙈', 'Not seen', 'out') + '</div>'),
    'c': ('<div class="lgrid">' + ''.join(f'<button><span class="seen-emoji">{e}</span>{l}</button>' for e, l in CHIPS3)
          + f'<button class="out">{EYE_OFF}Haven\'t seen</button></div>'),
}
DK = T('The Dark Knight')
S['2a-learner'] = (learner(DK, 6, 'Christopher Nolan', ANS['a'], 'va'),
    '<b>2 · Learner, version A.</b> Three tiles, icon on top. "Haven\'t seen it" is a white text button under them: clearly tappable, clearly not a rating.')
S['2b-learner'] = (learner(DK, 6, 'Christopher Nolan', ANS['b'], 'vb'),
    '<b>2 · Learner, version B.</b> All four answers in one row, icon on top. "Not seen" is outlined, so it reads as the way past, not a fourth rating.')
S['2c-learner'] = (learner(DK, 6, 'Christopher Nolan', ANS['c'], 'vc'),
    '<b>2 · Learner, version C.</b> Two by two: four wide buttons, icon beside the word. "Haven\'t seen" is the outlined one.')


# ── 3 · This or that (the live Duel screen) ──────────────────────
def side(t):
    return (f'<div class="side"><button class="rib"><span>+</span></button><button class="shc">{SHARE}</button>'
            f'<button class="pick">{poster(t)}<div><div class="nm">{t["title"]}</div><div class="yr">{t["year"]}</div></div></button>'
            f'{UNSEEN}</div>')


S['4-this-or-that'] = (app(
    apptop() + progress(30 + 4, 'This or that', '<span class="lcount"><b>4</b> of 12</span>') +
    '<div class="prompt"><h2>Which would you rather watch?</h2><p>Tap a poster.</p></div>'
    f'<div class="duel">{side(T("Pulp Fiction"))}{side(T("Se7en"))}</div>'
    '<div class="actions"><button class="ghost">Love both</button><button class="ghost">Neither</button><button class="ghost">Skip</button></div>'),
    '<b>3 · This or that.</b> The live screen as is; 12 pairs, counted like the cards. Each pair differs on one scale: these two are both 90s crime, one funny, one serious.')


# ── P2-U0 (2026-11-10): the cards, version A as Eran revised it ──
# Taller tiles (more room above the emoji), sitting a little higher. "Haven't seen" is the
# this-or-that's own button (.unseen) with a light outline, no fill, and the struck-out eye
# (Eran picked "outline only"); the pair screen gets the same button. No going back.
CARD_A = ('<div class="ltiles three">' + ''.join(tile(e, l) for e, l in CHIPS3) + '</div>' + UNSEEN)


LONG_TITLE = 32   # characters; past this the title would take 3 lines at 26px on a 360px phone, so it drops to 22px


def card(t, rated_n, meta):
    h = learner(t, rated_n, '', CARD_A, 'va2').replace(f'<div class="lmeta">{t["year"]} · </div>', f'<div class="lmeta">{meta}</div>')
    return h.replace('<h2>', '<h2 class="long">') if len(t['title']) > LONG_TITLE else h


def pair(a, b, n, note='Tap a poster.', done=None):
    p = f'<p class="learned">{note}</p>' if note != 'Tap a poster.' else f'<p>{note}</p>'
    return app(
        apptop() + progress(30 + n - 1 if done is None else done, 'This or that', f'<span class="lcount"><b>{n}</b> of 12</span>') +
        f'<i class="ob-sp1"></i><div class="prompt"><h2>Which would you rather watch?</h2>{p}</div>'
        f'<div class="duel">{side(a)}{side(b)}</div><i class="ob-sp2"></i>'
        '<div class="actions"><button class="ghost">Love both</button><button class="ghost">Neither</button><button class="ghost">Skip</button></div>',
        cls='screen game-screen ob-pair')


S['2-card-1-first'] = (card(T('Interstellar'), 0, '2014 · Christopher Nolan'),
    '<b>Card · the first one.</b> 0 of 30. The count and the bar move only on Loved / Liked / Disliked; "Haven\'t seen" just brings the next card.')
S['2-card-2-movie'] = (card(DK, 12, '2008 · Christopher Nolan'),
    '<b>Card · a movie.</b> Taller tiles, a bit higher. "Haven\'t seen": the this-or-that button, outline only, with the struck-out eye.')
S['2-card-3-series'] = (card(T('Game of Thrones', 'tv'), 13, '2011 · David Benioff, D. B. Weiss'),
    '<b>Card · a series.</b> The poster carries the SERIES tag, as everywhere in Games. Two creators, both named.')
S['2-card-4-long'] = (card(T('The Lord of the Rings: The Fellowship of the Ring'), 21, '2001 · Peter Jackson'),
    '<b>Card · a long title.</b> The name wraps to two lines; the buttons stay where they are.')
S['4-this-or-that'] = (pair(T('Pulp Fiction'), T('Se7en'), 4),
    '<b>This or that.</b> 56px buttons; every button has the onboarding\'s one 16px corner. Spare height split 1 : 2 above and below.')


# ── The cards' in-between messages (P2-U0 part 3, 2026-11-10) ──
# A message takes the place of one card: same top bar and count, the poster slot holds the last few titles they
# hadn't seen (dimmed, struck-out eye), the question and one line; the buttons sit where the tiles were.
def fan(ts):
    return '<div class="lfan">' + ''.join(f'<div class="lfan-p">{poster(t, "w185")}<i>{icon("eye-off", 16, 2)}</i></div>' for t in ts) + '</div>'


def message(rated_n, step, ts, head, line, buttons):
    return app(
        apptop() + progress(rated_n, step, f'<span class="lcount"><b>{rated_n}</b> of 30</span>') +
        f'<div class="learn va2 lmsg-screen"><div class="lmsg">{fan(ts)}<h2>{head}</h2><p>{line}</p></div><div class="lfill"></div>'
        f'<div class="lmsg-btns">{buttons}</div></div>',
        cls='screen game-screen')


UNSEEN3 = [T('Avatar'), T('Fight Club'), T('Deadpool')]
S['2-msg-1-slow'] = (message(2, 'Rate what you\'ve seen', UNSEEN3, 'Lots of new ones?',
    'No problem. Tap “Haven\'t seen” as often as you need. We stop as soon as you\'ve rated 30.',
    '<button class="cta">Keep going</button>'),
    '<b>Message · a slow start.</b> 10 cards in, 2 or fewer rated. Once per run. The posters are the last three they hadn\'t seen.')
S['2-msg-2-very-slow'] = (message(3, 'Rate what you\'ve seen', [T('Joker'), T('Iron Man'), T('Django Unchained')], 'Not seen many of these?',
    'You\'ve rated 3 so far. Keep looking, or go on to 12 quick picks. Those work even with titles you haven\'t seen.',
    '<button class="cta">Keep looking</button><button class="opt">Go to quick picks</button>'),
    '<b>Message · still slow.</b> 20 cards in, 4 or fewer rated. Once per run. "Go to quick picks" goes to the screen before the picks.')

# Milestones (Eran, 2026-11-10): at 10 and 20 rated. On the next card, the step name turns gold and arrives with a
# small animation (rise + fade in, one gold shimmer across the words, one glow on the bar). Any tap brings the next
# card, and with it "Rate what you've seen" again. #t=0.35 freezes the animation at 0.35s (used to make the GIF).
FREEZE = """<script>(function(){var m=/t=([\\d.]+)/.exec(location.hash);if(!m)return;var t=parseFloat(m[1]);
document.querySelectorAll('.lmile,.lmile-bar i').forEach(function(e){var d=getComputedStyle(e).animationDelay.split(',').map(function(x){return (parseFloat(x)-t)+'s'}).join(',');
e.style.setProperty('animation-delay',d,'important');e.style.setProperty('animation-play-state','paused','important')})})()</script>"""


def milestone(t, n, meta, words):
    h = card(t, n, meta).replace("<span>Rate what you've seen</span>", f'<span class="lmile">{words}</span>', 1)
    return h.replace('<div class="seasonbar quiet"', '<div class="seasonbar quiet lmile-bar"', 1).replace('</body>', FREEZE + '</body>')


S['2-card-5-mile10'] = (milestone(T('Forrest Gump'), 10, '1994 · Robert Zemeckis', 'A third of the way'),
    '<b>Card · milestone at 10.</b> The card after the 10th rating. "A third of the way" in gold until the next tap, then "Rate what you\'ve seen" again.')
S['2-card-6-mile20'] = (milestone(T('The Matrix'), 20, '1999 · Lana Wachowski, Lilly Wachowski', '10 more to go'),
    '<b>Card · milestone at 20.</b> The card after the 20th rating. Same arrival, same way back.')


# Flow board only (2026-11-11): plain cards at the counts the flow needs.
S['2-card-7-eleven'] = (card(DK, 11, '2008 · Christopher Nolan'), '<b>Card · the one after the milestone.</b> Back to "Rate what you\'ve seen".')
S['2-card-8-few'] = (card(T('The Shawshank Redemption'), 2, '1994 · Frank Darabont'), '<b>Card · few seen.</b> 2 rated after the first message.')


# ── Part 4 · the screen between the cards and the picks (2026-11-11) ──
# Every way out of the cards lands here (30 rated, 90 shown, "Go to quick picks"). It says what they did, in their
# own numbers and posters (no claims about their taste), and what comes next. The "Next" box is the live .learned-box.
EMO = {'loved': '❤️', 'liked': '👍', 'disliked': '👎'}
# Eran 2026-11-11: no progress bar here (the cards are done); the box says "last step", what to do, and that the
# recommendations come right after. "Seen them or not" waits for the pair rules.
NEXT_BOX = ('<div class="learned-box bnext"><h4><b>Last step:</b> 12 quick picks</h4><ul>'
            '<li>Two titles at a time. Tap the one you&apos;d rather watch.</li>'
            '<li>Then you&apos;re done.</li></ul></div>')


# The row's fades follow the swipe (Eran, 2026-11-11): a right fade only while more posters wait to the right, a left
# fade once some have scrolled out. #s=mid / #s=end puts the mock mid-swipe or at the end, for the JPEGs.
ROW_JS = """<script>(function(){var r=document.currentScript.previousElementSibling;
function upd(){var m=r.scrollWidth-r.clientWidth;r.classList.toggle('fl',r.scrollLeft>2);r.classList.toggle('fr',r.scrollLeft<m-2)}
var h=/s=(mid|end)/.exec(location.hash);if(h){r.style.scrollSnapType='none';r.scrollLeft=h[1]=='end'?1e5:(96+8)*6;r.style.scrollSnapType=''}
r.addEventListener('scroll',upd,{passive:true});upd()})()</script>"""


def between(head, line, wall, badges=False, label='What you loved', mode='row'):
    """mode 'row': every poster in one row that runs off the right edge and fades (swipe to see them all).
       mode 'plus': two rows of 4; past 8, the 8th tile is "+N more"."""
    def tile(t, r):
        return f'<div class="bw-p">{poster(t, "w185")}' + (f'<span class="bw-e">{EMO[r]}</span>' if badges else '') + '</div>'
    if mode == 'row':
        body = f'<div class="brow{" more" if len(wall) > 3 else ""}">' + ''.join(tile(t, r) for t, r in wall) + '</div>' + ROW_JS
    else:
        shown = wall if len(wall) <= 8 else wall[:7]
        extra = '' if len(wall) <= 8 else f'<div class="bw-p bw-more"><b>+{len(wall) - 7}</b><span>more</span></div>'
        body = '<div class="bwall">' + ''.join(tile(t, r) for t, r in shown) + extra + '</div>'
    return app(
        apptop() +
        f'<div class="learn va2 between"><div class="bmid"><h2>{head}</h2><p>{line}</p>'
        + (f'<h4 class="blabel">{label}</h4>{body}' if wall else '') + NEXT_BOX + '</div>'
        '<button class="cta">Start the picks</button></div>',
        cls='screen game-screen')


LOVED17 = [(T(n, ty), 'loved') for n, ty in [
    ('Interstellar', 'movie'), ('Inception', 'movie'), ('The Avengers', 'movie'), ('The Dark Knight', 'movie'), ('Avatar', 'movie'),
    ('Fight Club', 'movie'), ('Deadpool', 'movie'), ('Avengers: Infinity War', 'movie'), ('The Shawshank Redemption', 'movie'),
    ('Pulp Fiction', 'movie'), ('Forrest Gump', 'movie'), ('Guardians of the Galaxy', 'movie'), ("Harry Potter and the Philosopher's Stone", 'movie'),
    ('The Matrix', 'movie'), ('Iron Man', 'movie'), ('Django Unchained', 'movie'), ('Breaking Bad', 'tv')]]
S['3-between-1-thirty'] = (between('That&apos;s 30.', 'You loved 17, liked 9 and disliked 4.', LOVED17),
    '<b>Before the picks · 30 rated</b> (here 17 loved). All 17 in one row that runs off the edge and fades: swipe to see the rest.')
S['3-between-1-thirty-plus'] = (between('That&apos;s 30.', 'You loved 17, liked 9 and disliked 4.', LOVED17, mode='plus'),
    '<b>The other way:</b> two rows of 4; the 8th tile says "+10 more". Tapping it would open the full list.')
S['3-between-2-cap'] = (between('17 rated. That&apos;s enough.', 'You loved 5, liked 8 and disliked 4.', LOVED17[:5]),
    '<b>Before the picks · 90 cards shown, under 30 rated</b> (here 17, 5 loved). Same row.')
S['3-between-3-early'] = (between('3 rated. That&apos;s fine.', 'The picks will do the rest.',
    [(T('Interstellar'), 'loved'), (T('Forrest Gump'), 'loved'), (T('The Shawshank Redemption'), 'liked')], badges=True, label='What you rated'),
    '<b>Before the picks · "Go to quick picks"</b> with a few rated (here 3). Each poster shows their answer; 3 fit, so no fade.')
S['3-between-4-none'] = (between('On to the picks.', 'No ratings yet, and that&apos;s fine: the picks work even with titles you haven&apos;t seen.', []),
    '<b>Before the picks · "Go to quick picks" with nothing rated.</b> No posters; straight to what comes next.')


# ── Part 5 · quick picks (this or that), proposal 2026-11-11 ──
# Step row "Quick picks" with its own bar of 12. One helper button, "Can't decide" (a new pair; whether it
# counts toward the 12 is still open, Eran 2026-11-11). Love both / Neither are gone: the taste model learns only from a picked
# poster. "Haven't seen" (Eran's version, 2026-11-11): two swaps per side, each for a similar title; after the second,
# that side's button is off. Both off: "No more swaps. Go with your gut." No plot pair (qp's pitch= is kept, unused).
# Too tall for the phone (very long titles on a small screen): both posters shrink by the same amount, keeping
# their shape and their left edge, until the last button fits. The columns, titles and buttons keep their width;
# the + and share buttons move with the poster's corner. Titles stop at 3 lines (fr.css), then "…".
FIT_JS = """<script>(function(){var a=document.currentScript.previousElementSibling,S=[].slice.call(document.querySelectorAll('.ob-pair .side'));
if(!S.length)return;var cw=S[0].clientWidth,w=cw;function set(){S.forEach(function(s){var g=(cw-w)+8+'px';s.querySelector('.poster').style.width=w+'px';
s.querySelector('.rib').style.right=g;var h=s.querySelector('.shc');h.style.right=g;h.style.top=(w*1.5-46)+'px'})}
while(a.getBoundingClientRect().bottom>innerHeight+0.5&&w>cw*0.6){w-=2;set()}})()</script>"""


def qside(t, pitch=False, off=False):
    pt = poster(t).replace('class="poster real"', 'class="poster real dim"').replace('</div>', '<span class="qm">?</span></div>', 1) if pitch else poster(t)
    plot = f'<div class="pitch">{t["overview"]}</div>' if pitch else ''
    return (f'<div class="side"><button class="rib"><span>+</span></button><button class="shc">{SHARE}</button>'
            f'<button class="pick">{pt}<div><div class="nm">{t["title"]}</div><div class="yr">{t["year"]}</div></div>{plot}</button>'
            + ('' if pitch else UNSEEN.replace('class="unseen ol"', 'class="unseen ol" disabled') if off else UNSEEN) + '</div>')


def qp(a, b, done, note=None, pitch=False, off=(False, False), line=None):
    head = 'Which sounds better tonight?' if pitch else 'Which would you rather watch?'
    sub = f'<p class="learned">{note}</p>' if note else f'<p>{line or ("Neither seen? Go with your gut." if pitch else "Tap a poster.")}</p>'
    return app(
        apptop() +
        f'<div class="seasonbar quiet" role="progressbar"><span class="sb-bar"><i style="width:{done / 12 * 100:.1f}%"></i></span></div>'
        f'<div class="blockbar"><span>Quick picks</span><span class="lcount"><b>{done}</b> of 12</span></div>'
        f'<i class="ob-sp1"></i><div class="prompt"><h2>{head}</h2>{sub}</div>'
        f'<div class="duel{" pitchd" if pitch else ""}">{qside(a, pitch, off[0])}{qside(b, pitch, off[1])}</div><i class="ob-sp2"></i>'
        '<div class="actions"><button class="ghost">Can&apos;t decide</button></div>' + FIT_JS,
        cls='screen game-screen ob-pair')


S['4-this-or-that'] = (qp(T('Pulp Fiction'), T('Se7en'), 4),
    '<b>Quick picks.</b> Own bar of 12, step "Quick picks". One helper: "Can\'t decide" (a new pair; whether it counts is still open). Love both / Neither are gone.')
S['4-pair-2-swapped'] = (qp(T('Pulp Fiction'), T('The Silence of the Lambs'), 4, note='Swapped in something similar.'),
    '<b>After one "Haven\'t seen".</b> Se7en is swapped for a similar title (here The Silence of the Lambs); the gold line says so. As in the season today.')
S['4-pair-3-last-swap'] = (qp(T('Pulp Fiction'), T('Zodiac'), 4, note='Swapped again: the last swap on this side.', off=(False, True)),
    '<b>A second "Haven\'t seen" on the same side.</b> One more swap (here Zodiac), then that side\'s button is off. The other side still has its two.')
S['4-pair-4-no-swaps'] = (qp(T('Inglourious Basterds'), T('Zodiac'), 4, off=(True, True), line='No more swaps. Go with your gut.'),
    '<b>Both sides used their two swaps.</b> Tap the one that looks better, or "Can\'t decide".')

S['4-pair-5-long-title'] = (qp(T('Eternal Sunshine of the Spotless Mind'), T('Her'), 4),
    '<b>A long title.</b> Up to 3 lines, in full. The "Haven\'t seen" buttons stay level.')
S['4-pair-6-longest'] = (qp(T('Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn)'), T('Pirates of the Caribbean: The Curse of the Black Pearl'), 4),
    '<b>The longest titles in the pool.</b> Titles stop at 3 lines, then "…" (6 of 980). If it\'s still too tall, both posters shrink a little until "Can\'t decide" fits.')


# ── Part 6 · the closing screen — signed off by Eran 2026-11-12 ──
# After the last pick the pair leaves (Flow) and this comes in: the season finale's slow gold rays, the last three
# titles they picked fanned (the middle one, the newest pick, with the pick's gold ring), "It's Showtime" in the poster
# type, "Finding your first matches." and the feed's own fingerprint loader. No progress bar: onboarding is over.
# Fan: picks, newest first; then cards they rated Loved, newest first; never Liked/Disliked/Haven't seen. Fewer than
# three: what there is. None: no fan.
import re as _re
_FP = (ROOT / 'src/modules/session/components/FingerprintLoader.tsx').read_text()
_RIDGES = _re.findall(r'const RIDGE_\w+ =\s*"([^"]+)"', _FP)
FP = ('<div class="FingerprintLoader-module__MAfjZW__loader dfp" role="status" aria-label="Loading" style="--fp-size:66px;--fp-color:#ffffff">'
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      '<g class="FingerprintLoader-module__MAfjZW__track">' + ''.join(f'<path d="{d}"></path>' for d in _RIDGES) + '</g>'
      '<g class="FingerprintLoader-module__MAfjZW__live">' + ''.join(f'<path pathLength="1" d="{d}"></path>' for d in _RIDGES) + '</g></svg></div>')


def fan_of(picks):
    """picks: newest first. Laid out older-left, newest in the middle, next-newest right (two: older, newest)."""
    order = {0: [], 1: [0], 2: [1, 0], 3: [1, 0, 2]}[len(picks)]
    return ('<div class="lfan dpicks">' + ''.join(f'<div class="lfan-p">{poster(picks[i], "w185")}</div>' for i in order) + '</div>') if picks else ''


def showtime(picks, note=None, failed=False):
    # JPEGs: the loader is held fully drawn ("still"); play.py takes that out so it animates
    mid = (('' if failed else '<div class="rays"></div>') + fan_of(picks)
           + f'<h2 class="dbig">{"Almost showtime" if failed else "It&apos;s Showtime"}</h2>'
           + f'<p>{"We couldn&apos;t load your matches." if failed else "Finding your first matches."}</p>'
           + ('' if failed else FP.replace('dfp"', 'dfp still"'))
           + (f'<p class="dnote">{note}</p>' if note else ''))
    return app(apptop() + f'<div class="learn va2 between done d-mix"><div class="bmid">{mid}</div>'
               + ('<button class="cta">Try again</button>' if failed else '') + '</div>', cls='screen game-screen')


PICKS3 = (T('Pulp Fiction'), T('Toy Story'), T('Breaking Bad', 'tv'))   # newest first
S['6-done-1'] = (showtime(PICKS3),
    '<b>Closing screen.</b> Rays, their last three picks (the newest in the middle, gold ring), "It\'s Showtime". At least 1.2 s; the feed comes in when ready (target under 3 s).')
S['6-done-2-slow'] = (showtime(PICKS3, note='Still working. The first time takes a little longer.'),
    '<b>Still waiting after 8 s.</b> One quiet line appears under the loader. Nothing else changes.')
S['6-done-3-failed'] = (showtime(PICKS3, failed=True),
    '<b>It failed</b> (an error, or 30 s without a feed). The rays and the loader stop; "Try again" asks for the feed again. Answers are already saved.')
S['6-done-4-two'] = (showtime(PICKS3[:2]),
    '<b>Only two to show</b> (few picks and no Loved cards). Both, side by side; the newest wears the ring.')
S['6-done-5-none'] = (showtime(()),
    '<b>Nothing to show</b> (no picks, nothing Loved). No fan: rays, "It\'s Showtime" and the loader.')


# ── Part 7 · Skip, proposal 2026-11-12 ──
# The season's own Skip (top-left, `.tb-skip`) with its confirmation sheet (`.sheet.confirm`), reused.
# On the cards it skips the rest of the cards: straight to the screen before the picks (no sheet; that screen
# already says "{n} rated. That's fine."). On the quick picks it ends onboarding, so it asks first.
SKIP = '<button class="tb-skip">Skip</button>'
def with_skip(html):
    return html.replace('<div class="tb-l"></div>', f'<div class="tb-l">{SKIP}</div>', 1)


SKIP_SHEET = ('<div class="sheet-bg"></div><div class="sheet confirm" role="alertdialog"><h3>Skip the picks?</h3>'
              '<p>Your first matches will be less sharp without them. You can keep rating titles in the feed anytime.</p>'
              '<button class="cta">Keep picking</button><button class="opt">Skip</button></div>')


S['7-skip-1-card'] = (with_skip(card(DK, 12, '2008 · Christopher Nolan')),
    '<b>Skip on a card.</b> Top-left, the season\'s own Skip. Tap: the rest of the cards are skipped, straight to the screen before the picks. No "are you sure".')
S['7-skip-2-pair'] = (with_skip(qp(T('Pulp Fiction'), T('Se7en'), 4)),
    '<b>Skip on the quick picks.</b> Same button, same place. It ends onboarding, so it asks first.')
S['7-skip-3-sheet'] = (with_skip(qp(T('Pulp Fiction'), T('Se7en'), 4)).replace('</div></div></div></div></div></body>', SKIP_SHEET + '</div></div></div></div></div></body>', 1),
    '<b>Skip on the quick picks · the sheet.</b> The season\'s "Skip for now?" sheet with new words. "Keep picking" closes it; "Skip" goes to "It\'s Showtime".')

if __name__ == '__main__':   # play.py imports the pieces without rewriting the mocks
    for k, (html, cap) in S.items():
        (HERE / f'{k}.html').write_text(html)
        (HERE / f'{k}.cap').write_text(cap)
    print('built', ', '.join(S))
