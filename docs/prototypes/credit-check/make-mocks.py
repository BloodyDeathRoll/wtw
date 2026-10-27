"""Writes the Credit Check still mock-ups into docs/prototypes/credit-check/.
Every 'wrong' poster is asserted to have no credit at all for the actor (TMDB cache)."""
import json, os
OUT = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(OUT, '../../..'))
C = json.load(open(os.path.join(os.environ.get('TMPDIR', '/tmp'), 'wtw-six-cache.json')))
T = {t['title']: t for t in json.load(open(f'{ROOT}/src/app/play/data/titles.json'))}
casts = C['casts']; credits = C['credits']
ACC = '#4d8dff'

def key(t): return f"{t['type']}:{t['tmdb_id']}"
people = {}
for k, cs in casts.items():
    for c in cs: people.setdefault(c['name'], c)

def face(name): return f"https://image.tmdb.org/t/p/w185{people[name]['img']}"
def poster(title): return f"https://image.tmdb.org/t/p/w342{T[title]['poster_path']}"
def role(name, title):
    pid = people[name]['id']
    for c in casts[key(T[title])]:
        if c['id'] == pid:
            r = c['role'].split(' / ')[-1] if 'Cruella' in c['role'] else c['role'].split(' / ')[0]
            return r
    raise SystemExit(f'{name} not in {title}')
def check(name, right, wrong):
    pid = str(people[name]['id']); cred = set(credits[pid])
    for t in right: role(name, t)
    for t in wrong: assert key(T[t]) not in cred, (name, t)

X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
Q = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>'

def page(body, top=True, level=''):
    head = (f'<div class="topbar"><button class="hb">{X}</button><div class="gtitle">Credit Check</div><button class="hb r">{Q}</button></div>'
            f'<div class="glevel">{level}</div>') if top else ''
    return ('<!doctype html><html><head><meta charset="utf-8">'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap">'
            '<link rel="stylesheet" href="../../../src/app/play/play.css"><link rel="stylesheet" href="cc.css"></head>'
            f'<body><div class="wtw-play"><div class="app"><div class="inner"><div class="phone arcade" style="--gacc:{ACC}">'
            f'<div class="screen game-screen">{head}{body}</div></div></div></div></div></body></html>')

def clock(sec, total=60, low=False, paused=False):
    r = 23; circ = 2 * 3.14159 * r; frac = max(0, min(1, sec / total))
    return (f'<div class="clock{" low" if low else ""}"><svg viewBox="0 0 54 54"><circle class="trk" cx="27" cy="27" r="{r}"/>'
            f'<circle class="arc" cx="27" cy="27" r="{r}" stroke-dasharray="{circ * frac:.1f} {circ:.1f}"/></svg>'
            f'<span>{sec}</span>{"<b class=pause><s></s><s></s></b>" if paused else ""}</div>')

def ask(name, sec, q=None, low=False, paused=False, extra=''):
    q = q or f'Select all titles with<b>{name}</b>'
    return (f'<div class="ask{" low" if low else ""}" style="position:relative"><div class="face" style="background-image:url({face(name)})"></div>'
            f'<div class="q{" res" if "res" in extra else ""}">{q}</div>{clock(sec, low=low, paused=paused)}{extra.replace("res", "")}</div>')

def grid(name, order, state):
    """state: title -> '', 'sel', 'hit', 'miss', 'wrong', 'pass', 'flip'"""
    out = []
    for t in order:
        s = state.get(t, '')
        inner = f'<div class="art" style="background-image:url({poster(t)})"></div>'
        if s == 'sel': inner += '<div class="tick">✓</div>'
        if s == 'hit': r = role(name, t); inner += f'<div class="tick">✓</div><div class="role{" long" if len(r) > 13 else ""}">{r}</div>'
        if s == 'wrong': inner += '<div class="tick">✕</div>'
        if s == 'miss': r = role(name, t); inner += f'<div class="role{" long" if len(r) > 13 else ""}"><small>MISSED</small>{r}</div>'
        out.append(f'<div class="tile {s}">{inner}</div>')
    return f'<div class="grid">{"".join(out)}</div>'

def write(fn, html):
    open(f'{OUT}/{fn}.html', 'w').write(html)

# ── Emma Stone: the main walk-through ─────────────────────
ES = 'Emma Stone'
es_order = ['La La Land', 'The Notebook', 'Zombieland', 'Now You See Me', 'The Help', 'Barbie', 'The Social Network', 'Cruella', 'Drive']
es_right = ['La La Land', 'Zombieland', 'The Help', 'Cruella']
check(ES, es_right, [t for t in es_order if t not in es_right])
picked = ['La La Land', 'The Notebook', 'Zombieland', 'The Help']

write('1-start', page(f'<div class="cc">{ask(ES, 60)}{grid(ES, es_order, {})}<button class="cta off">Check</button></div>', level='SCORE <b>0</b>'))
write('2-selected', page(f'<div class="cc">{ask(ES, 54)}{grid(ES, es_order, {t: "sel" for t in picked})}<button class="cta">Check</button></div>', level='SCORE <b>0</b>'))
mid = {'La La Land': 'hit', 'The Notebook': 'wrong', 'Zombieland': 'flip'}
mid.update({t: 'sel' for t in ['The Help']})
write('3-checking', page(f'<div class="cc">{ask(ES, 52, paused=True)}{grid(ES, es_order, mid)}<button class="cta off">Check</button></div>', level='SCORE <b>0</b>'))
res = {t: ('hit' if t in picked and t in es_right else 'wrong' if t in picked else 'miss' if t in es_right else 'pass') for t in es_order}
write('4-result', page(
    f'<div class="cc">{ask(ES, 52, q="Emma Stone<b>3 of 4 · 1 wrong</b>", paused=True, extra="res")}{grid(ES, es_order, res)}'
    '<div class="tally"><span class="g"><b>3</b> right</span><i>·</i><span class="r"><b>1</b> wrong</span><i>·</i><span class="m"><b>1</b> missed</span></div><button class="cta">Next</button></div>',
    level='SCORE <b>2</b>'))

# ── Hugh Jackman: a perfect grid (+3 seconds) ─────────────
HJ = 'Hugh Jackman'
hj_order = ['The Lord of the Rings: The Fellowship of the Ring', 'The Greatest Showman', 'Star Trek: Picard', 'Logan', 'Inception', 'The Prestige', 'The Hobbit: The Desolation of Smaug', 'Mad Max: Fury Road', 'Prisoners']
hj_right = ['The Greatest Showman', 'Logan', 'The Prestige', 'Prisoners']
check(HJ, hj_right, [t for t in hj_order if t not in hj_right])
write('5-perfect', page(
    f'<div class="cc">{ask(HJ, 37, q="Hugh Jackman<b>Perfect grid!</b>", paused=True, extra="res<span class=bonus>+3s</span>")}'
    f'{grid(HJ, hj_order, {t: ("hit" if t in hj_right else "pass") for t in hj_order})}'
    '<div class="tally"><span class="g"><b>4</b> right</span><i>·</i><span class="g"><b>+3</b> seconds</span></div><button class="cta">Next</button></div>',
    level='SCORE <b>13</b>'))

# ── Natalie Portman: the last ten seconds ─────────────────
NP = 'Natalie Portman'
np_order = ['Thor: Ragnarok', 'Black Swan', 'Kong: Skull Island', 'V for Vendetta', 'The Cabin in the Woods', 'Léon: The Professional', 'The Avengers', 'Annihilation', 'Obi-Wan Kenobi']
np_right = ['Black Swan', 'V for Vendetta', 'Léon: The Professional', 'Annihilation']
check(NP, np_right, [t for t in np_order if t not in np_right])
write('6-last-seconds', page(f'<div class="cc">{ask(NP, 7, low=True)}{grid(NP, np_order, {"Black Swan": "sel", "Thor: Ragnarok": "sel"})}<button class="cta">Check</button></div>', level='SCORE <b>21</b>'))

np_res = {'Black Swan': 'hit', 'Thor: Ragnarok': 'wrong', 'V for Vendetta': 'hit', 'Léon: The Professional': 'miss', 'Annihilation': 'miss'}
np_res.update({t: 'pass' for t in np_order if t not in np_res})
write('7-times-up', page(
    f'<div class="cc">{ask(NP, 0, low=True)}{grid(NP, np_order, np_res)}<button class="cta off">Check</button>'
    '<div class="over"><div class="big">Time&#39;s up</div><p>What you tapped still counts.</p><button class="cta">See my score</button></div></div>',
    level='SCORE <b>22</b>'))

# ── End screen ────────────────────────────────────────────
missed = [(ES, 'Cruella'), (NP, 'Léon: The Professional'), (NP, 'Annihilation'), ('Tom Cruise', 'Oblivion'), ('Samuel L. Jackson', 'Unbreakable'),
          ('Jennifer Lawrence', 'mother!'), ('Leonardo DiCaprio', 'Gangs of New York'), ('Scarlett Johansson', 'Lucy')]
for n, t in missed: role(n, t)
extra = [('Tom Cruise', 'Edge of Tomorrow'), ('Tom Cruise', 'Top Gun: Maverick'), ('Samuel L. Jackson', 'Pulp Fiction'), ('Samuel L. Jackson', 'Django Unchained'),
         ('Jennifer Lawrence', 'The Hunger Games'), ('Jennifer Lawrence', 'Silver Linings Playbook'), ('Leonardo DiCaprio', 'Inception'), ('Leonardo DiCaprio', 'Titanic'),
         ('Scarlett Johansson', 'Jojo Rabbit'), ('Scarlett Johansson', 'The Avengers')]
for n, t in extra: role(n, t)
# the wall only shows titles the run's faces really were in
wall_titles = list(dict.fromkeys(es_right + hj_right + np_right + [t for _, t in missed] + [t for _, t in extra]))
wall_titles = (wall_titles * 2)[:30]
wall = ''.join(f'<i style="background-image:url({poster(t)})"></i>' for t in wall_titles)
mp = ''.join(f'<div class="mp" style="background-image:url({poster(t)})"><button class="rib"><span>+</span></button><div class="who" style="background-image:url({face(n)})"></div></div>' for n, t in missed)
write('8-end', page(
    f'<div class="wall"><div>{wall}</div></div>'
    '<div class="gover"><div class="bigscore">22</div><span class="best">NEW BEST</span><h2>9 faces in a minute</h2>'
    '<p class="sub">26 right · 4 wrong · 8 missed</p>'
    '<button class="cta">Next round</button></div>', level='FINAL SCORE'))

# ── Intro + lobby ─────────────────────────────────────────
write('0b-intro', page(
    '<div class="gintro"><div class="gbadge">✓</div><h2>Prove you&#39;re a fan. Beat the clock.</h2><ol class="rules">'
    '<li>You get a face and nine posters. Tap every movie or show they were in.</li>'
    '<li>Each right one wins you a point. Each wrong one loses a point. Missing one costs nothing.</li>'
    '<li>Get them all right and you win 3 extra seconds.</li>'
    '<li>You have one minute. Beat your best score.</li></ol><button class="cta">Start</button></div>', level='BEST <b>22</b>'))

cards = [('↕', '#ffd23d', 'Higher or Lower', 'Which one has the higher rating? Keep the streak alive.', '<span class="pips"><i class="on"></i><i></i><i></i><i></i><i></i><span>Level 2 of 5 · best 9</span></span>', 'Play', ''),
         ('6', '#4fc3f7', 'Six Degrees', 'Six actors, five films. Put the chain in order.', '<span class="pips"><span>3 chains played · best 4 of 5</span></span>', 'Play', ''),
         ('✓', ACC, 'Credit Check', 'A face, nine posters, one minute. Find every one they were in.', '<span class="pips"><span>New</span></span>', 'Play', ' new'),
         ('B', '#7b8cff', 'The Bet<span class="gkind">I GUESS YOU</span>', 'I guess your rating before you give it.', '<span class="pips"><i></i><i></i><i></i><i></i><i></i><span>Level 1 of 5</span></span>', 'Play', '')]
cl = ''.join(f'<button class="gcard{c}" style="--ga:{a}"><span class="gi">{i}</span><span style="min-width:0"><b>{n}</b><span class="d">{d}</span>{p}</span><span class="go">{g}</span></button>' for i, a, n, d, p, g, c in cards)
open(f'{OUT}/0a-lobby.html', 'w').write(
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Bebas+Neue&display=swap">'
    '<link rel="stylesheet" href="../../../src/app/play/play.css"><link rel="stylesheet" href="cc.css"></head><body><div class="wtw-play"><div class="app"><div class="inner">'
    f'<div class="lobby-top">WTW</div><div class="phone arcade" style="--gacc:#8f7bff"><div class="screen"><div class="lobby"><div class="lobby-hero"><div class="big">Games</div>'
    '<p>Beat your own best. Every game also teaches me a little more about your taste.</p></div>'
    f'<div class="glist" style="display:grid;gap:10px">{cl}</div></div></div></div></div></div></div></body></html>')
print('ok')
