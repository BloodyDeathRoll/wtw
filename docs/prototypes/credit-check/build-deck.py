"""Credit Check prototype deck: faces + 3x3 grids from the 980 game titles.

Right posters: titles where the actor is top-6 billed on TMDB (no voice, self or
uncredited roles: those were already filtered out of the cast cache).
Wrong posters: titles where the actor has NO credit at all (their full TMDB
credit list), so the game never calls a cameo or a voice part "wrong".
Writes deck.json next to this file; images are downloaded once into the OS temp
folder and embedded later by build-play.py.

Needs the TMDB cast/credits cache that `npm run build-six-chains` leaves in the OS
temp folder (wtw-six-cache.json).

Run from the repo root: python3 docs/prototypes/credit-check/build-deck.py
"""
import collections, json, math, os, random

ROOT = os.path.dirname(os.path.abspath(__file__))
TMP = os.environ.get('TMPDIR', '/tmp')
C = json.load(open(os.path.join(TMP, 'wtw-six-cache.json')))
titles = json.load(open(os.path.join(ROOT, '../../../src/app/play/data/titles.json')))
T = {f"{t['type']}:{t['tmdb_id']}": t for t in titles if t.get('poster_path')}
casts, credits, gender = C['casts'], C['credits'], C['gender']
rnd = random.Random(2027)

# who is in what (top 6 billed)
people, ins = {}, collections.defaultdict(list)
for k, cs in casts.items():
    if k not in T: continue
    for c in cs[:6]:
        if not c.get('img') or str(c['id']) not in credits: continue
        people[c['id']] = c
        ins[c['id']].append((k, c['role']))

def fame(pid): return sum(math.log10(max(10, T[k]['votes'])) for k, _ in ins[pid])

def tidy(role):
    r = role.replace('(voice)', '').strip()
    parts = [p.strip() for p in r.split(' / ') if p.strip()]
    if not parts: return ''
    # double names: the first one, unless the second is the one people know
    known = {'Mystique', 'Cruella', 'Black Widow', 'Iron Man', 'Hulk', 'Star-Lord', 'Wolverine', 'Mr. Glass', 'Harley Quinn', 'Hawkeye', 'Thor', 'Wasp', 'Gamora', 'Nebula', 'Mad Hatter', 'Captain America', 'Batman', 'White Queen'}
    for p in parts[1:]:
        if p in known: return p
    return parts[0]

RIGHT, PER_SERIES = 4, 2   # Eran, 2026-10-27: always 4 right; at most 2 posters from one series per grid
cands = [p for p in ins if len(ins[p]) >= RIGHT]
cands.sort(key=fame, reverse=True)
popular = sorted(T, key=lambda k: -T[k]['votes'])[:600]

# TMDB's series are narrower than people's sense of a franchise ("X-Men" and
# "Wolverine" are two), so these are grouped by hand. Anything else: its TMDB series.
FRANCHISE = {
    'Marvel': {'collections': ['Ant-Man Collection', 'Black Panther Collection', 'Captain America Collection', 'Captain Marvel Collection', 'Doctor Strange Collection',
                               'Guardians of the Galaxy Collection', 'Iron Man Collection', 'Spider-Man (MCU) Collection', 'The Avengers Collection', 'Thor Collection'],
               'titles': ['Black Widow', 'Eternals', 'Shang-Chi and the Legend of the Ten Rings', 'The Incredible Hulk', 'Hawkeye', 'Loki', 'WandaVision',
                          'The Falcon and the Winter Soldier', 'Moon Knight', 'Ms. Marvel', 'She-Hulk: Attorney at Law', 'Secret Invasion', 'Agatha All Along', 'Thunderbolts*']},
    'X-Men': {'collections': ['X-Men Collection', 'The Wolverine Collection', 'Deadpool Collection'], 'titles': []},
    'DC': {'collections': ['Man of Steel Collection', 'Wonder Woman Collection', 'Aquaman Collection', 'Suicide Squad Collection', 'Shazam! Collection'],
           'titles': ['Batman v Superman: Dawn of Justice', "Zack Snyder's Justice League", 'Justice League', 'The Suicide Squad',
                      'Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn)', 'Black Adam', 'The Flash', 'Peacemaker']},
    'Batman': {'collections': ['Batman Collection', 'The Dark Knight Collection'], 'titles': ['The Batman', 'The Penguin']},
    'Middle-earth': {'collections': ['The Lord of the Rings Collection', 'The Hobbit Collection'], 'titles': ['The Lord of the Rings: The Rings of Power']},
    'Wizarding World': {'collections': ['Harry Potter Collection', 'Fantastic Beasts Collection'], 'titles': []},
    'Spider-Man': {'collections': ['Spider-Man Collection', 'The Amazing Spider-Man Collection', 'Spider-Man: Spider-Verse Collection'], 'titles': []},
    'Star Wars': {'collections': ['Star Wars Collection', 'Star Wars Anthology'], 'titles': ['The Mandalorian', 'Andor', 'Obi-Wan Kenobi', 'Ahsoka', 'The Book of Boba Fett']},
}
BY_COLL = {c: f for f, v in FRANCHISE.items() for c in v['collections']}
BY_TITLE = {t: f for f, v in FRANCHISE.items() for t in v['titles']}

def series(k):
    t = T[k]
    return BY_TITLE.get(t['title']) or BY_COLL.get(t.get('collection')) or t.get('collection') or k

def grid(pid, tier):
    cred = set(credits[str(pid)])
    mine = sorted(ins[pid], key=lambda kr: -T[kr[0]]['votes'])
    # easy faces: their best-known titles first; others: any of them
    pool = mine[:8] if tier == 'easy' else mine[:]
    rnd.shuffle(pool)
    if tier == 'easy': pool += [m for m in mine if m not in pool]
    cells, names, per = [], set(), collections.Counter()
    def fits(k):
        return T[k]['title'] not in names and per[series(k)] < PER_SERIES
    def add(k, r):
        cells.append({'k': k, 'r': r}); names.add(T[k]['title']); per[series(k)] += 1
    for k, r in pool:
        if len([c for c in cells if c['r'] is not None]) == RIGHT: break
        if fits(k): add(k, tidy(r))
    if len(cells) < RIGHT: return None        # nearly everything they're in is one series
    years = [T[c['k']]['year'] for c in cells]
    def ok(k): return k not in cred and T[k]['poster_path'] and fits(k)
    # co-stars' titles: the tempting wrong answers
    co = collections.Counter()
    for k, _ in mine:
        for c in casts[k][:6]:
            if c['id'] == pid: continue
            for k2, _ in ins.get(c['id'], []):
                if k2 not in cred: co[k2] += 1
    n_co = {'easy': 1, 'medium': 3, 'hard': 9 - RIGHT}[tier]
    tempting = [k for k, _ in co.most_common(25)]
    rnd.shuffle(tempting)
    for k in tempting:
        if len(cells) >= RIGHT + n_co: break
        if ok(k): add(k, None)
    # the rest: well-known titles from around the same years
    mid = sum(years) / len(years)
    rest = [k for k in popular if abs(T[k]['year'] - mid) < (25 if tier == 'easy' else 12)]
    rnd.shuffle(rest)
    for k in rest:
        if len(cells) >= 9: break
        if ok(k): add(k, None)
    assert len(cells) == 9, people[pid]['name']
    for c in cells:
        if c['r'] is None: assert c['k'] not in cred
    assert max(collections.Counter(series(c['k']) for c in cells).values()) <= PER_SERIES
    rnd.shuffle(cells)
    for c in cells:
        t = T[c['k']]; c['t'] = t['title']; c['y'] = t['year']; c['p'] = t['poster_path']
    return cells

# 60 faces, about half women, in fame order, split in three tiers
# (women and men are tiered separately: one fame list put nearly every woman in "hard")
def first(pids, n, tier_of):
    out, dropped = [], []
    for p in pids:
        if len(out) == n: break
        g = grid(p, tier_of(len(out)))
        (out.append((p, tier_of(len(out)), g)) if g else dropped.append(people[p]['name']))
    return out, dropped
W, dw = first([p for p in cands if gender.get(str(p)) == 1], 27, lambda i: ['easy', 'medium', 'hard'][i // 9])
M, dm = first([p for p in cands if gender.get(str(p)) == 2], 33, lambda i: ['easy', 'medium', 'hard'][i // 11])
print('dropped (one series):', ', '.join(dw + dm) or 'none')
deck = []
for tier in ['easy', 'medium', 'hard']:
    for pid, t, g in W + M:
        if t == tier:
            p = people[pid]
            deck.append({'id': pid, 'name': p['name'], 'img': p['img'], 'tier': t, 'cells': g})
json.dump(deck, open(os.path.join(ROOT, 'deck.json'), 'w'), ensure_ascii=False, indent=0)
print(len(deck), 'faces;', sum(1 for d in deck if gender.get(str(d['id'])) == 1), 'women')
for d in deck:
    rs = [c['t'] + (f" ({c['r']})" if c['r'] else '') for c in d['cells'] if c['r'] is not None]
    ws = [c['t'] for c in d['cells'] if c['r'] is None]
    print(f"{d['tier'][:4]} {d['name']:<22} RIGHT {' | '.join(rs)}\n{'':27} wrong {' | '.join(ws)}")
