"""Search for people (2026-11-04): still mock-ups, one JPEG per case.

Type a name ("nolan", "michael douglas") → the person shows in the same list as
titles, round photo instead of a poster → tap → their titles, newest
first → tap a title → the card Search already has. Builds on ../make-mocks.py
(the app's compiled CSS, header, field, keyboard) with the list rows as BUILT
(src/app/search/search.module.css: 40×60 posters, the lead-actors line).
Real TMDB data, fetched 2026-11-04. Run from anywhere:
    python3 docs/prototypes/search/people/make-mocks.py
"""
import importlib.util, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('base', os.path.join(HERE, '..', 'make-mocks.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
R, A, IMG, W, H, X = B.R, B.A, B.IMG, B.W, B.H, B.X

CSS = B.CSS + """
/* as built: search.module.css .row/.thumb/.rowText/.cast */
.slist{grid-template-columns:minmax(0,1fr)}  /* a long line truncates instead of widening the list */
.slist button{gap:10px;padding:6px 8px;min-width:0}
.slist img.poster,.slist .noimg{width:40px;height:60px;border-radius:4px;object-fit:cover;background:#0E0E10;flex:none}
.slist .txt{min-width:0;display:flex;flex-direction:column}
.slist .txt small{display:block}
.slist .txt .cast{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* PEOPLE, new: a person's row: a round photo in the poster's 40px column */
.slist img.face{width:40px;height:40px;margin:10px 0;border-radius:50%;object-fit:cover;object-position:50% 20%;background:#0E0E10;flex:none}
/* PEOPLE, new: the top of a person's page */
.who{display:flex;align-items:center;gap:14px;padding:12px 4px 10px}
.who img{width:64px;height:64px;border-radius:50%;object-fit:cover;object-position:50% 20%;flex:none}
.who b{display:block;font-size:22px;font-weight:700;color:#F2F2F2}
.who small{display:block;margin-top:2px;font-size:14.5px;color:#8A8A8E}
"""
B.CSS = CSS  # page() reads it


def field(text='', caret=True, ph='Search titles and people'):
    car = '<span class="caret"></span>' if caret else ''
    if text:
        body, clr = f'<span>{text}</span>{car}', f'<button class="clear">{X(22, 2)}</button>'
    else:
        body, clr = f'{car}<span class="ph">{ph}</span>', ''
    return f'<div class="sfield"><div class="sinput">{body}</div>{clr}</div>'


def title_row(t, y, tv, poster, line):
    return (f'<button><img class="poster" src="{IMG}w154{poster}" alt=""><span class="txt"><b>{t}</b>'
            f'<small>{y}{" · series" if tv else ""}</small><small class="cast">{line}</small></span></button>')


def person_row(name, role, face, known):
    return (f'<button><img class="face" src="{IMG}w185{face}" alt=""><span class="txt"><b>{name}</b>'
            f'<small>{role}</small><small class="cast">{known}</small></span></button>')


def lst(rows): return f'<div class="slist">{"".join(rows)}</div>'


def screen(body, text='', kb=True, sugs=('', '', ''), h=H, ph=None):
    f = field(text, kb, ph) if ph else field(text, kb)
    view = f'<div class="{R("view")}">{B.header("Search")}<div class="sbox">{f}{body}</div></div>'
    return B.page(view, B.keyboard(sugs) if kb else '', h)


def person_page(name, role, face, rows, h):
    who = f'<div class="who"><img src="{IMG}w185{face}" alt=""><span><b>{name}</b><small>{role}</small></span></div>'
    return screen(who + lst(rows), name, kb=False, h=h)


# ── data: TMDB /search/multi and /person/{id}/combined_credits, 2026-11-04 ──
NOLAN_FACE = '/xuAIuYSmsUzKlUMBFGVZaWsY3DZ.jpg'
DOUGLAS_FACE = '/kVYGPIZowzXLEQfAGUNOqKjAbBb.jpg'
TYPING_NOLAN = [
    person_row('Christopher Nolan', 'Director', NOLAN_FACE, 'Interstellar, Inception, The Dark Knight'),
    title_row('Facing Nolan', 2022, 0, '/9C4yW2qEktOQW6748X6zx6aNz4W.jpg', 'Nolan Ryan, George W. Bush'),
    person_row('Nolan North', 'Actor', '/gb499KZIoBTZnKCGKE4zwzlcfSe.jpg', 'Young Justice, Uncharted, DreamWorks Dragons'),
    person_row('Jeanette Nolan', 'Actor', '/wb9G3heeItXTpXqPy4HlNDMJWrE.jpg', 'The Fox and the Hound, The Rescuers, Psycho'),
    person_row('John Nolan', 'Actor', '/7cxsJPPPxdyLVFMmtvj6uaGSqWW.jpg', 'Batman Begins, The Dark Knight Rises, Following'),
]
TYPING_DOUGLAS = [
    person_row('Michael Douglas', 'Actor', DOUGLAS_FACE, 'Ant-Man, The Game, Ant-Man and the Wasp'),
    person_row('Dylan Michael Douglas', 'Actor', '/5aVC6E3Di56XV1MFdYDiFKIFmbY.jpg', 'Phineas and Ferb, Truths from a Corporate Sellout'),
    title_row('Michael Douglas: The Prodigal Son', 2023, 0, '/dymZxM8vXtudfL6yd4HZYJWS5pC.jpg', 'Barbara Grau, Michael Douglas'),
]
# A person's titles, newest first (Eran, 2026-11-05). Directors: what they
# directed; actors: what they acted in. Left out: no poster, under 10 votes,
# "as himself", documentaries, talk/news/reality, TV guest spots (< 5 episodes).
NOLAN_FILMS = [
    ('The Odyssey', 2026, '/5rhTDKUhPYvpdQIijFIs5VoWsON.jpg', 'Matt Damon, Tom Holland'),
    ('Oppenheimer', 2023, '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', 'Cillian Murphy, Emily Blunt'),
    ('Tenet', 2020, '/rrKH3VhHssGTCfPuaEQkxvEoElv.jpg', 'John David Washington, Robert Pattinson'),
    ('Dunkirk', 2017, '/b4Oe15CGLL61Ped0RAS9JpqdmCt.jpg', 'Fionn Whitehead, Tom Hardy'),
    ('Interstellar', 2014, '/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg', 'Matthew McConaughey, Anne Hathaway'),
    ('The Dark Knight Rises', 2012, '/hr0L2aueqlP2BYUblTTjmtn0hw4.jpg', 'Christian Bale, Gary Oldman'),
    ('Inception', 2010, '/xlaY2zyzMfkhk0HSC5VUwzoZPU1.jpg', 'Leonardo DiCaprio, Joseph Gordon-Levitt'),
    ('The Dark Knight', 2008, '/qJ2tW6WMUDux911r6m7haRef0WH.jpg', 'Christian Bale, Heath Ledger'),
    ('The Prestige', 2006, '/Ag2B2KHKQPukjH7WutmgnnSNurZ.jpg', 'Hugh Jackman, Christian Bale'),
    ('Batman Begins', 2005, '/sPX89Td70IDDjVr85jdSBb4rWGr.jpg', 'Christian Bale, Michael Caine'),
    ('Insomnia', 2002, '/riVXh3EimGO0y5dgQxEWPRy5Itg.jpg', 'Al Pacino, Robin Williams'),
    ('Memento', 2000, '/nzlv62aC0octS5AklAiWpXLX9Z0.jpg', 'Guy Pearce, Carrie-Anne Moss'),
    ('Following', 1999, '/3bX6VVSMf0dvzk5pMT4ALG5A92d.jpg', 'Jeremy Theobald, Alex Haw'),
]
DOUGLAS_ROLES = [
    ('Looking Through Water', 2025, 0, '/Aryl5Y87ynfyrs4U0ktPHJ7XQ5i.jpg', 'William'),
    ('Franklin', 2024, 1, '/a9YV5QCdg95Zp02rKzkVxLxDtUC.jpg', 'Benjamin Franklin'),
    ('Ant-Man and the Wasp: Quantumania', 2023, 0, '/qnqGbB22YJ7dSs4o6M7exTpNxPz.jpg', 'Dr. Hank Pym'),
    ('Green Eggs and Ham', 2019, 1, '/jkbhdhkFS6jhINuNMvGLUCTry69.jpg', 'Guy-Am-I (voice)'),
    ('Avengers: Endgame', 2019, 0, '/jtDv3lCnST0fZRvdYFwR5CVwK2x.jpg', 'Hank Pym'),
    ('The Kominsky Method', 2018, 1, '/vnK8b6bNl1koSthTGbzgMPnh7Ky.jpg', 'Sandy Kominsky'),
    ('Ant-Man and the Wasp', 2018, 0, '/cFQEO687n1K6umXbInzocxcnAQz.jpg', 'Dr. Hank Pym'),
    ('Animal World', 2018, 0, '/kxc25B05Gq4CbCoWbyTFf9iF0wn.jpg', 'Anderson'),
    ('Unlocked', 2017, 0, '/fBDLdEraxCBKGmOPb6pJPYiDQh1.jpg', 'Eric Lasch'),
    ('Ant-Man', 2015, 0, '/rQRnQfUl3kfp78nCWq8Ks04vnq1.jpg', 'Dr. Hank Pym'),
    ('Beyond the Reach', 2014, 0, '/t6m6ICEG7KrnyYQpROISURkuCD5.jpg', 'Madec'),
    ('And So It Goes', 2014, 0, '/bJoWtA8OAIqavlb5mbx3EzvxFUA.jpg', 'Oren Little'),
    ('Last Vegas', 2013, 0, '/9Aht200Eu2jYiE9cEQdFfNDtHl6.jpg', 'Billy'),
]
PAGE_H = 1290  # a person's page, as if scrolled: the whole first 13
PAGE_H2 = 1338  # Douglas's: one title wraps to two lines

CASES = [
    ('p1-search-opens', lambda: screen('', '')),
    ('p2-typing-nolan', lambda: screen(lst(TYPING_NOLAN), 'nolan', sugs=('nolan', 'Nolan', 'Nolans'))),
    ('p3-nolan-page', lambda: person_page('Christopher Nolan', 'Director · 15 films', NOLAN_FACE,
                                          [title_row(t, y, 0, p, c) for t, y, p, c in NOLAN_FILMS], PAGE_H)),
    ('p4-typing-michael-douglas', lambda: screen(lst(TYPING_DOUGLAS), 'michael douglas', sugs=('douglas', 'Douglas', 'Douglas’s'))),
    ('p5-douglas-page', lambda: person_page('Michael Douglas', 'Actor · 54 titles', DOUGLAS_FACE,
                                            [title_row(t, y, tv, p, f'as {c}') for t, y, tv, p, c in DOUGLAS_ROLES], PAGE_H2)),
]

if __name__ == '__main__':
    import sys
    only = sys.argv[1:]
    for name, make in CASES:
        if only and not any(name.startswith(o) for o in only): continue
        fn = f'{HERE}/{name}'
        html = make().replace('href="app.css"', 'href="../app.css"')
        h = next((x for x in (PAGE_H, PAGE_H2) if f'--h:{x}px' in html), H)
        open(f'{fn}.html', 'w').write(html)
        subprocess.run([B.CH, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', f'--window-size={W},{h}',
                        '--force-device-scale-factor=2', '--virtual-time-budget=8000', f'--screenshot={fn}.png', f'file://{fn}.html'], capture_output=True)
        subprocess.run(['sips', '-c', str(h * 2), str(W * 2), '--cropOffset', '0', '0', f'{fn}.png', '--out', f'{fn}.png'], capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', f'{fn}.png', '--out', f'{fn}.jpg'], capture_output=True)
        os.remove(f'{fn}.png')
        print(name)
