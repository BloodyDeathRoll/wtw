"""Taste DNA v2 (#249): one playable page, every piece inlined, for Eran's phone (a private artifact link).

Same markup and CSS as build.py's mocks, driven by a small script: tap a genre to set your call (the row,
its wash and its tile update live), tap a person to see their titles, and switch
between three accounts with the prototype bar at the bottom. Real data (the dump build.py reads, plus TMDB
credits for the people's titles); the output file carries ratings, so it's gitignored.

    python3 play.py <dna-dump.json> <credits.json> <new-user id> <alon id> <profiles.json>   →  play-taste-dna.html
"""
import base64, concurrent.futures as cf, html, json, os, re, sys, urllib.request

dump, credits_path, NEW_ID, ALON_ID, profiles_path = sys.argv[1:6]
sys.argv = ['build.py', dump, NEW_ID, ALON_ID]
import build as B   # noqa: E402  (reuses the mocks' data, CSS and markup helpers)

OUT = os.path.dirname(os.path.abspath(__file__))
CREDITS = json.load(open(credits_path))
PROFILES = json.load(open(profiles_path))
REACT = ('loved', 'liked', 'disliked')
WORDS = {'tone': ('serious', 'funny'), 'energy': ('talky', 'action-packed'), 'pace': ('slow-burning', 'fast'), 'dark': ('light', 'dark'),
         'complex': ('easy-to-follow', 'twisty'), 'fantastic': ('down-to-earth', 'otherworldly'), 'modern': ('classic', 'recent'),
         'indie': ('mainstream', 'off-beat'), 'humor': ('silly', 'dry'), 'commit': ('short', 'long-running'), 'audience': ('kid-friendly', 'grown-up')}


def rated(u): return [r for r in u['ratings'] if r['reaction'] in REACT]


def clear_leans(u):
    rs = rated(u)
    out = []
    for i, s in enumerate(B.SCALES):
        if s in ('humor', 'commit', 'audience'): continue   # these don't read as "<word> stories" in the sentence
        e = max(-1, min(1, u['w'][14 + i] / 0.4))
        sure = sum(1 for r in rs if r['scales'] and abs(r['scales'].get(s) or 0) >= 0.5)
        if min(1, sure / 8) > 0.35 and abs(e) > 0.25: out.append((abs(e), WORDS[s][1 if e > 0 else 0]))
    return [w for _, w in sorted(out, reverse=True)]


def people_of(u):
    groups = []
    seen_roles = {}
    for role, label, one in (('actors', 'Cast', 'Cast'), ('directors', 'Directors', 'Director'), ('writers', 'Writers', 'Writer')):
        lst = []
        for p in u['people'][role]:
            ts = [r for r in rated(u) if p['name'] in (CREDITS.get(r['key']) or {}).get(role, [])]
            if len(ts) < 2: continue
            seen_roles.setdefault(p['name'], []).append(one if one == 'Cast' else one.lower())
            lst.append({'name': p['name'], 'score': p['score'], 'titles': ts})
        lst.sort(key=lambda p: (-p['score'], -len(p['titles'])))
        if lst: groups.append({'role': label, 'list': lst[:5]})
    for g in groups:
        for p in g['list']:
            rl = seen_roles[p['name']]
            p['roles'] = (rl[0].capitalize() + (', ' + ', '.join(rl[1:]) if len(rl) > 1 else ''))
    return groups


def summary(u, groups):
    leans = clear_leans(u)
    if u.get('little') or len(leans) < 2: return None
    best = None
    for gid, label, _, _ in B.GENRES:
        t = B.tally(u, gid); n = sum(t.values())
        if n >= 5:
            key = ((t['loved'] + t['liked']) / n, n)
            if not best or key > best[0]: best = (key, html.unescape(label).lower())
    w0 = u['w'][0]
    crowd = ('You tend to love what everybody loves' if w0 >= .30 else 'You’re sometimes with the crowd, sometimes not' if w0 >= .10
             else 'You don’t go by popularity')
    top = max((p for g in groups for p in g['list'] if g['role'] != 'Cast'), key=lambda p: (round(p['score'], 2), len(p['titles'])), default=None)
    s = f'You go for {leans[0]}, {leans[1]} stories' + (f', with {best[1]} above all' if best else '') + '. ' + crowd
    s += f', and anything {top["name"]} makes.' if top else '.'
    return s


# ── posters, inlined ──
def fetch(path):
    try:
        return path, 'data:image/jpeg;base64,' + base64.b64encode(urllib.request.urlopen(f'https://image.tmdb.org/t/p/w92{path}', timeout=20).read()).decode()
    except Exception:
        return path, ''


ACCOUNTS = [('new', 'New user', B.NEW), ('alon', 'Alon', B.ALON), ('little', 'Little data', B.LITTLE)]
paths = {r['poster'] for _, _, u in ACCOUNTS for r in rated(u) if r['poster']}
with cf.ThreadPoolExecutor(8) as ex: POSTERS = dict(ex.map(fetch, sorted(paths)))


def fetch_face(name):
    path = PROFILES.get(name)
    if not path: return name, ''
    try:
        return name, 'data:image/jpeg;base64,' + base64.b64encode(urllib.request.urlopen(f'https://image.tmdb.org/t/p/w185{path}', timeout=20).read()).decode()
    except Exception:
        return name, ''


def t(r): return {'t': r['title'], 'y': r['year'], 'p': r['poster'], 'r': r['reaction']}


data = []
FACES = {}
for key, label, u in ACCOUNTS:
    groups = [] if u.get('little') else people_of(u)
    genres = []
    for gid, glabel, ic, col in B.GENRES:
        ts = sorted((r for r in rated(u) if gid in r['g16']), key=lambda r: -(r['year'] or 0))
        genres.append({'id': gid, 'label': html.unescape(glabel), 'icon': B.icon(ic), 'big': B.icon(ic, 26), 'col': col,
                       'tally': dict(B.tally(u, gid)), 'titles': [t(r) for r in ts]})
    with cf.ThreadPoolExecutor(8) as ex: FACES.update(ex.map(fetch_face, [p['name'] for g in groups for p in g['list']]))
    w0 = u['w'][0]
    data.append({
        'key': key, 'label': label,
        'sub': f'{u["rows"]} ratings' + (f' · {u["pairs"]} picks' if u['pairs'] else '') + ' · updated 13 Nov',
        'summary': summary(u, groups), 'little': bool(u.get('little')), 'scales': B.scale_rows(u),
        'genres': genres, 'calls': B.calls_of(u),
        'crowd': None if u.get('little') else ('You tend to love what everybody loves.' if w0 >= .30 else
                                               'Sometimes you’re with the crowd, sometimes not.' if w0 >= .10 else
                                               'You don’t go by popularity: plenty of crowd favourites leave you cold.'),
        'people': [{'role': g['role'], 'list': [{'name': p['name'], 'roles': p['roles'], 'score': p['score'], 'face': FACES.get(p['name'], ''),
                                                  'titles': [t(r) for r in sorted(p['titles'], key=lambda r: -(r['year'] or 0))]} for p in g['list']]}
                   for g in groups],
    })

def meter(k):
    # a level meter: four rising bars, k of them lit (more bars = more of it in your feed)
    bars = ''.join(f'<rect x="{2.5 + i * 5.25}" y="{20 - (5 + i * 4)}" width="3.5" height="{5 + i * 4}" rx="1" fill="currentColor"'
                   + ('' if i < k else ' fill-opacity=".22"') + '/>' for i in range(4))
    return f'<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">{bars}</svg>'
CALLS = {'never': {'name': 'Never', 'icon': meter(0), 'col': '#ff5a4f'},
         'less': {'name': 'Less', 'icon': meter(1), 'col': '#f0a35e'},
         'neutral': {'name': 'Normal', 'icon': meter(2), 'col': '#b4b4ba'},
         'more': {'name': 'More', 'icon': meter(3), 'col': '#7fdcb0'},
         'much': {'name': 'Much more', 'icon': meter(4), 'col': '#3ddc97'}}
for d in data:
    d['calls'] = {g: c for g, c in d['calls'].items() if c == 'never'}
# Nobody has a More of / Less of yet (it doesn't exist in the app). Example calls on the new user, so the lit rows can be tried:
# Much more and More on two genres it said Love to on the genre screen, Less on one its ratings mostly dislike.
data[0]['calls'].update({'comedy': 'much', 'drama': 'more', 'doc': 'less'})

# ── the app's CSS, fonts inlined ──
css = ''
for i in (1, 2, 3):
    c = open(f'{OUT}/assets/app{i}.css').read()
    c = re.sub(r'url\("media/([^"]+)"\)', lambda m: 'url(data:font/woff2;base64,' + base64.b64encode(open(f'{OUT}/assets/media/{m.group(1)}', 'rb').read()).decode() + ')', c)
    c = c.replace('url("wtw-bg.svg")', 'url(data:image/svg+xml;base64,' + base64.b64encode(open(f'{OUT}/assets/wtw-bg.svg', 'rb').read()).decode() + ')')
    css += c
particles = 'data:image/png;base64,' + base64.b64encode(open(f'{OUT}/assets/particles.png', 'rb').read()).decode()

# The mocks' CSS minus the frozen-motion and caption rules, plus the live bits (sheet motion, wash motion, prototype bar).
mock_css = B.CSS.replace('*,*::before,*::after{animation:none!important;transition:none!important}', '')
mock_css = re.sub(r'/\* The explanation under each mock \*/.*', '', mock_css, flags=re.S)
mock_css = re.sub(r'html,body\{[^}]*\}\s*body\{[^}]*\}', '', mock_css)

LIVE_CSS = """
:root{color-scheme:dark;--bar-h:58px}
body{background:#000;color:#fff}
/* the genre screen's wash: in from the left (0.42 s, easing out), back out to the left (0.36 s) */
.gwash{transform:translateX(-100%);transition:transform .36s cubic-bezier(.45,0,.6,1)}
.grow.rated .gwash{transform:translateX(0);transition:transform .42s cubic-bezier(.16,1,.3,1)}
.gline,.glabel{transition:color .2s ease-in,filter .2s ease-in}
.grow.rated .gline,.grow.rated .glabel{transition:color .22s ease-out .2s,filter .22s ease-out .2s}
.grow,.prow{cursor:pointer;-webkit-tap-highlight-color:transparent}
.grow:active{background:rgba(255,255,255,.04)}
.call{transition:transform .18s ease}
.call.pop{animation:pop .3s cubic-bezier(.16,1,.3,1)}
@keyframes pop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
/* the sheet: slides up, scrim fades (played even with reduced motion: this prototype is for judging motion) */
.scrim{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.65);opacity:0;transition:opacity .28s ease}
.scrim.on{opacity:1}
.sheet{position:fixed;left:0;right:0;bottom:0;top:calc(env(safe-area-inset-top,0px) + 88px);z-index:41;max-width:480px;margin:0 auto;
  transform:translateY(100%);transition:transform .38s cubic-bezier(.16,1,.3,1)}
.sheet.on{transform:translateY(0)}
.sheet.closing{transition:transform .26s cubic-bezier(.45,0,.6,1)}
.sbody{overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:calc(40px + env(safe-area-inset-bottom,0px))}
.opt{cursor:pointer;font:inherit;transition:background .15s ease,border-color .15s ease,color .15s ease}
.opt:focus-visible,.grow:focus-visible,.prow:focus-visible,.sclose:focus-visible,.pbar button:focus-visible{outline:2px solid #D49B3A;outline-offset:2px}
.sclose{cursor:pointer}
.does{min-height:40px}
/* the prototype bar: not part of the design */
.pbar{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;align-items:center;gap:8px;
  padding:8px max(12px,env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));
  background:#f4f1ea;color:#1b1b1b;font:500 12px/1.2 Inter,system-ui,sans-serif;border-top:3px solid #D49B3A}
.pbar b{color:#8a5a00;letter-spacing:.06em;font-size:11px;text-transform:uppercase;flex:none}
.pbar .seg2{display:flex;gap:6px;flex:1;min-width:0}
.pbar button{flex:1;min-width:0;height:34px;border-radius:999px;border:1px solid #d9d2c3;background:#fff;color:#1b1b1b;font:inherit;cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px}
.pbar button[aria-pressed="true"]{background:#1b1b1b;color:#fff;border-color:#1b1b1b}
.pad-bottom{height:calc(var(--bar-h) + 24px)}

/* every sheet is 88% of the screen tall (the deep survey drawer's height), whatever it holds; the list scrolls inside */
.sheet{top:auto!important;height:88%;max-height:none}
.sbody{flex:1;min-height:0}
.sbody>*{flex-shrink:0}
.more{align-self:flex-start;height:36px;padding:0 14px;border-radius:999px;border:0;background:rgba(255,255,255,.1);color:#fff;font:inherit;font-size:14px;cursor:pointer}
/* a person's face, as tall as name + line */
.stitle.face{flex-direction:row;align-items:center;gap:14px}
.stitle.face img{width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none;background:#2a2a2d}
.stitle.face .who{display:flex;flex-direction:column;gap:4px;min-width:0}
.prow{grid-template-columns:minmax(0,1fr) 16px}
.seg{grid-template-columns:repeat(5,1fr);gap:5px}
.opt{height:66px;padding:0 2px;text-align:center;line-height:1.15}
.opt svg{width:24px;height:24px}
.does{margin:-4px 0 0;font-size:15px;line-height:1.45;color:#fff;min-height:0}
.stays{margin:-12px 0 0;font-size:13px;color:rgba(255,255,255,.55)}
.pdiv{flex:none;height:6px;border-radius:3px;background:#ffa900;margin:4px 0 6px}
"""

page_shell = (f'<div class="inter_3d9c7ff2-module__6cOLqa__variable font-sans"><div class="{B.A("page")}"><div class="{B.A("app")}">'
              f'<img class="particles" src="{particles}" alt="">'
              f'<div class="{B.A("appInner")}"><main class="{B.D("page")}" id="main">'
              f'<header class="{B.D("header")}"><button type="button" class="{B.D("backBtn")}" aria-label="Back">{B.BACK}</button>'
              f'<div class="{B.D("headerTitleBlock")}"><h1 class="{B.D("title")}">My taste</h1><p class="{B.D("subtitle")}" id="sub"></p></div>'
              f'<div class="{B.A("userMenuWrap")}"><button class="{B.A("hamburgerBtn")}" type="button" aria-label="Menu">{B.MENU}</button></div></header>'
              f'<div class="{B.D("container")}" id="content"></div><div class="pad-bottom"></div></main></div></div></div></div>'
              '<div class="scrim" id="scrim" hidden></div><div class="sheet" id="sheet" hidden role="dialog" aria-modal="true"></div>'
              '<div class="pbar"><b>Prototype</b><div class="seg2" id="accts"></div></div>')

JS = r"""
const D = c => c.split(' ').map(x => 'dna-module__DPj9xq__' + x).join(' ');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MARK = {loved:['❤️','Loved'], liked:['👍','Liked'], disliked:['👎','Disliked']};
const ORDER = ['never','less','neutral','more','much'];
const SHOW = 20;   // titles shown in a sheet before "Show all"
const DOES = {
  never: g => `I never want to see ${g} in my feed.`,
  less: g => `I want to see less ${g} in my feed.`,
  neutral: g => `Let my ratings decide how much ${g} I see.`,
  more: g => `I want to see more ${g} in my feed.`,
  much: g => `I want to see a lot more ${g} in my feed.`};
const STAYS = k => k === 'neutral' ? 'The more you rate, the better it gets.' : 'Stays until you change it.';
let acc = DATA[0], calls = {};

function says(t, call) {
  const lv = t.loved||0, li = t.liked||0, di = t.disliked||0, n = lv+li+di;
  if (!n) return [call === 'never' ? 'Hidden from your feed' : 'Nothing rated yet', true];
  if (n < 3) return [`Only ${n} rated so far`, true];
  if (lv === n) return [`Loved all ${n}`, false];
  if (!di) return [`Enjoyed all ${n}`, false];
  const s = di / n;
  if (s <= .25) return [`Mostly enjoyed · ${n} titles`, false];
  if (s >= .6) return [`Mostly disliked · ${n} titles`, false];
  return [`Mixed · ${n} titles`, false];
}
const psays = ts => `from ${ts.length} titles`;
const section = (title, body, id='') =>
  `<section class="${D('section')}"${id ? ` id="${id}"` : ''}><div class="${D('sectionHead')}"><h2 class="${D('sectionTitle')} ${D('sectionTitleAccent')}">${title}</h2></div>${body}</section>`;
const tile = (k, pop) => k && k !== 'neutral' ? `<span class="call${pop ? ' pop' : ''}" style="--cc:${CALLS[k].col}" title="${CALLS[k].name}">${CALLS[k].icon}</span>` : '<span></span>';

function rowHtml(g) {
  const call = calls[g.id], [txt, thin] = says(g.tally, call), lit = call && call !== 'neutral';
  return `<div class="grow${lit ? ' rated' : ''}" id="g-${g.id}" style="--gc:${g.col}" role="button" tabindex="0" aria-label="${esc(g.label)}">
    <i class="gwash"></i><i class="gline">${g.icon}</i>
    <div class="gtext"><div class="glabel">${esc(g.label)}</div><div class="gsays${thin ? ' thin' : ''}">${txt}</div></div>
    <span class="slot">${tile(call)}</span><span class="chev">${CHEV}</span></div>`;
}
function render() {
  calls = Object.assign({}, acc.calls);
  document.getElementById('sub').textContent = acc.sub;
  let h = section('In short', acc.summary ? `<p class="summary">${esc(acc.summary)}</p>`
                  : '<p class="quiet" style="font-size:16px">Still getting to know you. Every title you rate sharpens this page.</p>');
  h += section('How you like it', acc.scales);
  let ph = '';
  acc.people.forEach((g, gi) => {
    ph += `<div class="${D('group')}"><div class="${D('groupHead')}"><span class="${D('groupName')}">${g.role}</span></div>` +
      g.list.map((p, pi) => `<div class="prow" role="button" tabindex="0" data-g="${gi}" data-p="${pi}"><div><div class="pname">${esc(p.name)}</div>
        <div class="pfrom">${psays(p.titles)}</div></div><span class="chev">${CHEV}</span></div>`).join('') + '</div>';
  });
  if (!ph) ph = '<p class="quiet">Rate a few titles you’ve seen and we’ll spot the cast, directors and writers you keep coming back to.</p>';
  h += section('People who pull you in', ph);
  h += section('Genres', '<p class="quiet" style="margin:-4px 0 4px">Your ratings decide how often each genre shows up in your feed, and that keeps changing as you rate. '
       + 'Want more or less of one? Tap it and pick. Your pick stays until you change it. Bars on a genre show your pick; no bars means your ratings decide.</p>'
       + `<div class="grows">${acc.genres.map(rowHtml).join('')}</div>`, 'genres');
  document.getElementById('content').innerHTML = h;
  document.querySelectorAll('.grow').forEach(el => {
    const open = () => openGenre(el.id.slice(2));
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  document.querySelectorAll('.prow').forEach(el => {
    const open = () => openPerson(acc.people[+el.dataset.g].list[+el.dataset.p]);
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  document.querySelectorAll('#accts button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === acc.key));
}

function updateRow(g) {
  const el = document.getElementById('g-' + g.id), call = calls[g.id], [txt, thin] = says(g.tally, call);
  el.classList.toggle('rated', !!call && call !== 'neutral');
  el.querySelector('.slot').innerHTML = tile(call, true);
  const s = el.querySelector('.gsays'); s.textContent = txt; s.classList.toggle('thin', thin);
}

const titleRow = r => [r].map(r => `<div class="trow"><img src="${POSTERS[r.p] || ''}" alt=""><div class="tinfo"><div class="tname">${esc(r.t)}</div>
  <div class="tyear">${r.y || ''}</div></div><span class="mark"><span class="e">${MARK[r.r][0]}</span>${MARK[r.r][1]}</span></div>`).join('');
function titleRows(ts) {
  if (ts.length <= SHOW + 5) return ts.map(titleRow).join('');
  return ts.slice(0, SHOW).map(titleRow).join('') + `<button type="button" class="more" data-rest="1">Show all ${ts.length}</button>`;
}
function wireMore(ts) {
  const b = document.querySelector('#sheet .more');
  if (b) b.addEventListener('click', () => { b.insertAdjacentHTML('beforebegin', ts.slice(SHOW).map(titleRow).join('')); b.remove(); });
}

let lastFocus = null;
function openSheet(inner, col) {
  const sh = document.getElementById('sheet'), sc = document.getElementById('scrim');
  lastFocus = document.activeElement;
  sh.innerHTML = `<div class="grab"></div>${inner}`;
  sh.style.setProperty('--gc', col || '#D49B3A');
  sh.hidden = false; sc.hidden = false;
  sh.classList.remove('closing');
  requestAnimationFrame(() => requestAnimationFrame(() => { sh.classList.add('on'); sc.classList.add('on'); }));
  sh.querySelector('.sclose').addEventListener('click', closeSheet);
  setTimeout(() => sh.querySelector('.sclose').focus({preventScroll: true}), 50);
}
function closeSheet() {
  const sh = document.getElementById('sheet'), sc = document.getElementById('scrim');
  if (sh.hidden) return;
  sh.classList.add('closing'); sh.classList.remove('on'); sc.classList.remove('on');
  setTimeout(() => { sh.hidden = true; sc.hidden = true; if (lastFocus) lastFocus.focus({preventScroll: true}); }, 280);
}
document.getElementById('scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function openGenre(id) {
  const g = acc.genres.find(x => x.id === id), cur = calls[id] || 'neutral';
  const seg = ORDER.map(k => `<button type="button" class="opt${k === cur ? ' on' : ''}" data-k="${k}" style="--cc:${CALLS[k].col}" aria-pressed="${k === cur}">${CALLS[k].icon}<span>${CALLS[k].name}</span></button>`).join('');
  const ts = g.titles.length ? `<p class="sub2">What you rated</p>${titleRows(g.titles)}` : '<p class="sub2">What you rated</p><p class="quiet">Nothing yet. Rate a few and they’ll show up here.</p>';
  openSheet(`<div class="shead"><div class="stitle"><h2><i>${g.big}</i>${esc(g.label)}</h2><div class="smeta" id="smeta">${says(g.tally, cur)[0]}</div></div>
    <button class="sclose" aria-label="Close">${X}</button></div>
    <div class="sbody"><p class="ask">How much ${esc(g.label)} do you want?</p><div class="seg">${seg}</div>
    <p class="does" id="does">${DOES[cur](esc(g.label))}</p><p class="stays" id="stays">${STAYS(cur)}</p>${ts}</div>`, g.col);
  document.querySelectorAll('#sheet .opt').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (k === 'neutral') delete calls[id]; else calls[id] = k;
    document.querySelectorAll('#sheet .opt').forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', o === b); });
    document.getElementById('does').textContent = DOES[k](g.label);
    document.getElementById('stays').textContent = STAYS(k);
    document.getElementById('smeta').textContent = says(g.tally, calls[id])[0];
    updateRow(g);
  }));
  wireMore(g.titles);
}
function openPerson(p) {
  const face = p.face ? `<img src="${p.face}" alt="">` : '';
  openSheet(`<div class="shead"><div class="stitle${face ? ' face' : ''}">${face}<div class="who"><h2>${esc(p.name)}</h2><div class="smeta">${p.roles} · ${psays(p.titles)}</div></div></div>
    <button class="sclose" aria-label="Close">${X}</button></div><div class="sbody"><div class="pdiv"></div>${titleRows(p.titles)}</div>`);
  wireMore(p.titles);
}

document.getElementById('accts').innerHTML = DATA.map(a => `<button type="button" data-k="${a.key}">${esc(a.label)}</button>`).join('');
document.querySelectorAll('#accts button').forEach(b => b.addEventListener('click', () => {
  acc = DATA.find(a => a.key === b.dataset.k); closeSheet(); render(); document.getElementById('main').scrollTop = 0;
}));
document.documentElement.classList.add('dark');
render();
"""

page = ('<title>Taste DNA v2</title>\n'
        f'<style>{css}\n{mock_css}\n{LIVE_CSS}</style>\n'
        + page_shell
        + '<script>const DATA = ' + json.dumps(data, ensure_ascii=False) + ';\nconst POSTERS = ' + json.dumps(POSTERS)
        + ';\nconst CALLS = ' + json.dumps(CALLS) + ';\nconst CHEV = ' + json.dumps(B.CHEV) + ';\nconst X = ' + json.dumps(B.X) + ';\n'
        + JS + '</script>\n')
open(f'{OUT}/play-taste-dna.html', 'w').write(page)
print('play-taste-dna.html', round(len(page) / 1e6, 2), 'MB;', len(POSTERS), 'posters;',
      [(d['key'], d['summary']) for d in data])
