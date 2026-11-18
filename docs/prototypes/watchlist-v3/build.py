"""Watchlist for the v3 round: mocks of each state, on the real feed capture (docs/prototypes/nav/cap-feed.html, taken from
the running app with the test account on 2026-11-14) plus today's shipped tab bar (TabBar.module.css, NAV_TABS). The
Watchlist is RecommendationsView in watchlist mode, so the capture already carries its CSS (sort bar, saved button).
Extra titles: titles.json (TMDB, fetched 2026-11-17; posters, year, length, rating, where it streams in IL and US).
Run: python3 build.py && python3 render.py"""
import json, pathlib
HERE = pathlib.Path(__file__).parent
SRC = (HERE.parent / 'nav' / 'cap-feed.html').read_text()
TITLES = json.loads((HERE / 'titles.json').read_text())
P = 'RecommendationsView-module__IjrHsa__'

# lucide-react 1.64.0, exactly as TabBar.tsx / RecommendationsView.tsx import them
SPARKLES = '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>'
BOOKMARK = '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>'
GAMEPAD = '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>'
CHAT = '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>'
CHEVRON_DOWN = '<path d="m6 9 6 6 6-6"/>'
STAR = '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'

CSS = """
/* TabBar.module.css, as shipped */
.tb{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;box-sizing:border-box;height:56px;display:flex;padding:4px 4px 0;
  background:rgba(8,8,10,.9);box-shadow:0 -1px 0 rgba(255,255,255,.07)}
.tb a{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#8e8e93;
  font:500 11px/13px Inter,system-ui,sans-serif;letter-spacing:.01em}
.tb a.on{color:#fff}
.tb .ic{position:relative;display:grid;place-items:center;width:24px;height:24px}
.tb svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.tb a.on svg{stroke-width:1.9}
.tb .av{width:24px;height:24px;border-radius:50%;box-sizing:border-box;display:grid;place-items:center;background:#3a3a3e;color:#fff;font:600 11.5px/1 Inter,system-ui,sans-serif}
.tb .badge{position:absolute;top:-5px;left:15px;min-width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;
  padding:0 4.5px;box-sizing:border-box;border-radius:999px;background:#fff;color:#161614;font:700 10.5px/1 Inter,system-ui,sans-serif;box-shadow:0 0 0 1.5px #08080a}
/* NAV_TABS header: no ☰; the chat bubble sits where the back arrow was */
button[aria-label="menu"]{visibility:hidden!important;width:0!important;min-width:0!important;padding:0!important;margin:0!important;border:0!important;overflow:hidden!important}
.%(p)slist{padding-bottom:72px!important}
.%(p)scard{animation:none!important}
/* PROPOSED B: one row per title */
.mk-rows{gap:0!important;padding-top:0!important}
.mk-row{display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid #ffffff12;flex-shrink:0}
.mk-row img{width:58px;height:87px;border-radius:8px;object-fit:cover;flex:none;background:#241b2e}
.mk-rowBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.mk-rowTitle{margin:0;color:#fff;font:600 16.5px/1.2 Inter,system-ui,sans-serif;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mk-row .%(p)scardMeta{gap:4px 12px}
.mk-rowWhere{color:#fff;font:500 13px/1 Inter,system-ui,sans-serif}
.mk-rowWhere.none{color:#ffffff59;font-weight:400}
.mk-ringS{width:42px!important;height:42px!important;box-shadow:0 0 10px var(--rv-yellow)!important}
.mk-ringS .%(p)smatchRingInner{width:38px!important;height:38px!important}
.mk-ringS .%(p)smatchRingPct{font-size:13px!important}
.mk-ringS .%(p)smatchRingSign{font-size:9px!important}
/* PROPOSED: filter chips (the card's own Seen-it chip style, seenChip / seenChipOn), one scrolling row */
.mk-chips{display:flex;gap:6px;padding:4px 16px 12px;overflow-x:auto;scrollbar-width:none;flex-shrink:0}
.mk-chips::-webkit-scrollbar{display:none}
.mk-chips .%(p)sseenChip{flex:none;padding:0 14px}
.mk-chips .%(p)sseenChip b{font-weight:600;color:#fff;margin-left:5px}
.mk-chips .%(p)sseenChipOn b{color:#fff}
/* PROPOSED B2: rows with a bigger poster, no ring column, a star to prioritise */
.mk-row2 img{width:72px;height:108px;border-radius:10px}
.mk-row3{padding:12px 0;gap:16px}.mk-row3 img{width:82px;height:123px;border-radius:10px}
.mk-row2 .mk-rowTitle{font-size:17px}
.mk-rowLine{color:#fff;font:500 13px/1 Inter,system-ui,sans-serif;display:flex;gap:6px;align-items:center}
.mk-rowLine .m{color:var(--rv-yellow);font-weight:600}
.mk-rowLine .d{color:#ffffff59}
.mk-star{flex:none;width:44px;height:44px;border:0;background:none;color:#ffffffb3;display:grid;place-items:center;margin-right:-10px}
.mk-star svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.mk-star.on{color:var(--rv-yellow)}.mk-star.on svg{fill:currentColor}
/* PROPOSED C2: two across, the card's own pill and ring on the poster, name and meta under it */
.mk-grid2{grid-template-columns:repeat(2,1fr)!important;gap:18px 10px!important}
.mk-grid3{gap:28px 18px!important;padding-left:22px!important;padding-right:22px!important}
.mk-grid3 .mk-star{top:192px}
.mk-grid2 .mk-tile{position:relative}
.mk-grid2 .mk-tile img{border-radius:12px}
.mk-grid2 .mk-tile h3{font-size:14px;height:35px;margin-top:2px}
.mk-grid2 .mk-tile .%(p)scardMeta{font-size:12.5px;gap:4px 10px}
.mk-grid2 .%(p)swhereBadge{top:10px;left:10px;height:26px;padding:0 9px;font-size:12px;max-width:calc(100% - 64px)}
.mk-grid2 .%(p)swhereBadge svg{width:14px;height:14px}
.mk-grid2 .mk-ringS{position:absolute;top:8px;right:8px}
.mk-grid2 .mk-star{position:absolute;right:4px;top:206px;width:40px;height:40px;margin:0;border-radius:50%;background:#00000080;backdrop-filter:blur(8px);color:#fff}
.mk-grid2 .mk-star svg{width:20px;height:20px}
.mk-grid2 .mk-star.on{color:var(--rv-yellow)}
/* PROPOSED: the sort folded into the chip row (ArrowUpDown, lucide) */
.mk-chipsWrap{display:flex;align-items:center;flex-shrink:0;position:relative}
.mk-chipsWrap .mk-chips{flex:1;min-width:0;padding-right:136px}
/* PROPOSED: the sort as today's own trigger ("Date Added" + chevron) at the chip row's end, with today's menu */
.mk-sortPill{position:absolute;right:0;top:4px;height:36px;display:flex;align-items:center;padding:0 16px 0 30px;background:linear-gradient(90deg,#0000,#000 26px)}
.mk-sortPill .%(p)ssortTrigger{height:36px;padding:0 12px 0 16px;background:var(--rv-white-10)}
.mk-sortPill .%(p)ssortPanel{top:0;right:0;animation:none}
.mk-sortPill .%(p)ssortPanelHead{height:36px}
/* PROPOSED: the "Why it's a match" breakdown on the card page itself, under Seen it? (RecCard's own why panel) */
.mk-whyGap{margin-top:18px}
.mk-why{border-top:1px solid #ffffff1f;margin-top:18px;padding-top:24px!important;animation:none!important}
.mk-why em{font-style:italic}
/* the empty state's button in the app's primary, not the old blue */
.mk-emptyBtn{flex:0 0 auto!important;width:auto!important;min-width:0!important;align-self:center;padding:13px 26px!important}
.mk-sortBtn{position:absolute;right:0;top:0;bottom:12px;width:66px;border:0;display:grid;place-items:center;color:#fff;
  background:linear-gradient(90deg,transparent,#000 34%);padding:0 10px 0 22px}
.mk-sortBtn span{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--rv-white-10)}
.mk-sortBtn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
/* PROPOSED: a rated title on the list */
.mk-row.seen img{opacity:.55}
.mk-row.seen .mk-rowTitle{color:var(--rv-white-70)}
.mk-rowLine .r{color:#fff}
.mk-div{display:flex;align-items:center;gap:8px;padding:22px 0 6px;color:var(--rv-white-70);font:500 13.5px/1 Inter,system-ui,sans-serif;flex-shrink:0}
.mk-div b{color:#fff;font-weight:600}
.mk-div:after{content:"";flex:1;height:1px;background:#ffffff1f}
/* PROPOSED: swipe a row to remove it */
.mk-swipe{position:relative;overflow:hidden;flex-shrink:0}
.mk-swipe .mk-row{transform:translateX(-104px);background:#000;position:relative;z-index:1;padding-left:0}
.mk-swipe .mk-act{position:absolute;right:0;top:0;bottom:1px;width:104px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  background:var(--rv-white-10);color:#fff;font:500 13px/1 Inter,system-ui,sans-serif;border-radius:12px 0 0 12px}
.mk-swipe .mk-act svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
/* For you's note style, for what's left after Remove */
.mk-note{background:#ffffff12;border-radius:16.5px;flex-shrink:0;display:flex;align-items:center;gap:14px;padding:16px 16px 16px 18px;margin:8px 0}
.mk-note p{margin:0;flex:1;color:#ffffffe0;font:400 14.5px/1.45 Inter,system-ui,sans-serif}
.mk-note p b{font-weight:600;color:#fff}
.mk-note button{flex:0 0 auto;border:0;background:none;color:var(--rv-yellow);font:600 14.5px/1 Inter,system-ui,sans-serif;padding:10px 4px}
/* For you's end-card buttons */
.mk-btns{display:flex;flex-direction:column;gap:10px;width:100%}
.mk-dark{height:50px;width:100%;border:0;border-radius:999px;background:var(--rv-white-10);color:#fff;display:inline-flex;align-items:center;
  justify-content:center;gap:8px;font:500 16px/1 Inter,system-ui,sans-serif}
.mk-dark svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.mk-end{margin-top:14px;flex-shrink:0}
/* the card as a page: the row's star joins the poster's circles */
.mk-starCircle svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.mk-starCircle.on{color:var(--rv-yellow)}.mk-starCircle.on svg{fill:currentColor}
/* PROPOSED C: a wall of posters */
.mk-grid{display:grid!important;grid-template-columns:repeat(3,1fr);gap:14px 10px!important;align-content:start;padding-top:0!important}
.mk-tile{display:flex;flex-direction:column;gap:6px;min-width:0}
.mk-tile img{width:100%;aspect-ratio:2/3;border-radius:10px;object-fit:cover;background:#241b2e;display:block}
.mk-tile h3{margin:0;color:#fff;font:600 12.5px/1.25 Inter,system-ui,sans-serif;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:31px}
.mk-tile span{color:var(--rv-white-70);font:400 11.5px/1 Inter,system-ui,sans-serif;white-space:nowrap}
""".replace('%(p)s', P)

def bar(count, active='watchlist'):
    badge = f'<span class="badge">{count}</span>' if count else ''
    on = lambda t: ' class="on"' if t == active else ''
    return ('<nav class="tb">'
            f'<a{on("foryou")}><span class="ic"><svg viewBox="0 0 24 24">{SPARKLES}</svg></span><span>For you</span></a>'
            f'<a{on("watchlist")}><span class="ic"><svg viewBox="0 0 24 24">{BOOKMARK}</svg>{badge}</span><span>Watchlist</span></a>'
            f'<a{on("games")}><span class="ic"><svg viewBox="0 0 24 24">{GAMEPAD}</svg></span><span>Games</span></a>'
            f'<a{on("you")}><span class="ic"><span class="av">S</span></span><span>You</span></a></nav>')

# The card's own service label: src/lib/watch-providers.ts BRANDS order, best-ranked US flatrate (pickWatchProvider).
import re
BRANDS = [('Netflix', r'netflix'), ('Disney+', r'disney'), ('HBO Max', r'hbo|\bmax\b'), ('Hulu', r'hulu'), ('Paramount+', r'paramount'),
          ('Peacock', r'peacock'), ('Apple TV+', r'^apple tv'), ('Crunchyroll', r'crunchyroll'), ('Starz', r'starz'), ('MGM+', r'mgm'),
          ('AMC+', r'\bamc'), ('Shudder', r'shudder'), ('Criterion', r'criterion'), ('MUBI', r'mubi'), ('BritBox', r'britbox'),
          ('Acorn TV', r'acorn'), ('Discovery+', r'discovery'), ('HIDIVE', r'hidive'), ('YouTube TV', r'youtube'), ('Cinemax', r'cinemax'),
          ('Lionsgate+', r'lionsgate'), ('Sundance Now', r'sundance'), ('PBS', r'\bpbs\b'), ('Prime Video', r'prime video|amazon'),
          ('fuboTV', r'fubo'), ('Philo', r'philo'), ('Sling TV', r'sling')]
def canon(raw):
    low = raw.strip().lower()
    for i, (label, pat) in enumerate(BRANDS):
        if re.search(pat, low): return label, i
    return raw.strip(), len(BRANDS)
def pick(names):
    best = None
    for n in names:
        c = canon(n)
        if best is None or c[1] < best[1]: best = c
    return best[0] if best else None
def where_us(t): return pick(t['us'])
IL_FOUR = {'Netflix': 'Netflix', 'Amazon Prime Video': 'Prime Video', 'Apple TV': 'Apple TV', 'HBO Max': 'HBO Max'}
def where_il(t):
    for n in t['il']:
        if n in IL_FOUR: return IL_FOUR[n]
    return None
FIX = {'MINDHUNTER': 'Mindhunter', 'Once Upon a Time in... Hollywood': 'Once Upon a Time... in Hollywood'}
ORDER = ['Once Upon a Time... in Hollywood', 'The Aviator', 'The Prestige', 'The Hateful Eight', 'Memento', 'Kill Bill: Vol. 1',
         'Dunkirk', 'Inglourious Basterds', 'Succession', 'Heat', 'Severance', 'Parasite', 'Oppenheimer', 'The Departed', 'Whiplash',
         'The Bear', 'Blade Runner 2049', 'Arrival', 'No Country for Old Men', 'Sicario', 'Chernobyl', 'Prisoners', 'Nightcrawler', 'Mindhunter']
CAP_META = {'The Prestige': '2h 10m'}  # the capture's card says 2h 10m; TMDB says 2h 11m today. Keep the row and the card agreeing.
MATCH = {'Once Upon a Time... in Hollywood': 97, 'The Aviator': 97, 'The Prestige': 97, 'The Hateful Eight': 96, 'Memento': 94, 'Kill Bill: Vol. 1': 94}
byname = {FIX.get(t['title'], t['title']): t for t in TITLES}
ITEMS = []
for i, name in enumerate(ORDER):
    t = byname[name]
    ITEMS.append(dict(title=name, year=t['year'], meta=CAP_META.get(name, t['meta']), rating=f"{t['rating']:.1f}", poster=t['poster'],
                      where=where_il(t), match=MATCH.get(name, 96 - i // 2)))
ITEMS_JS = json.dumps(ITEMS)

JS_LIB = """
const P='%(p)s', L=document.querySelector('.'+P+'list');
const A=()=>[...L.querySelectorAll('article')];
const T=t=>A().find(a=>a.querySelector('h3').textContent.startsWith(t));
const q=(el,k)=>el.querySelector('.'+P+k);
const ITEMS=%(items)s;
// header: the chat bubble replaces the back arrow; the Movies/Series/Both picker gives way to "Watchlist (N)"
{const b=document.querySelector('button[aria-label="back"]');b.setAttribute('aria-label','Ask WTW');b.querySelector('svg').innerHTML='%(chat)s';}
function header(n){const tp=document.querySelector('.'+P+'typePicker');const s=document.createElement('span');s.className=P+'headerTitle';s.textContent='Watchlist ('+n+')';tp.replaceWith(s);}
// today's sort bar, exactly as RecommendationsView renders it in watchlist mode
function sortBar(label){const d=document.createElement('div');d.className=P+'sortBar';
  d.innerHTML='<span class="'+P+'sortLabel">Sort by</span><div class="'+P+'sortMenu"><button type="button" class="'+P+'sortTrigger" aria-expanded="false" aria-haspopup="menu"><span>'+label+'</span><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">%(chev)s</svg></button></div>';
  document.querySelector('.'+P+'content').before(d);}
// a saved card: yellow "Remove from watchlist", no X (the Watchlist has none)
function save(a){const row=q(a,'wantRow'),b=q(row,'watchlistBtn');b.classList.add(P+'watchlistBtnSaved');
  b.querySelector('span').textContent='Remove from watchlist';b.querySelector('svg').setAttribute('fill','currentColor');row.replaceWith(b);}
const star='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="'+P+'metaStar" aria-hidden="true">%(star)s</svg>';
function meta(it){return '<div class="'+P+'cardMeta"><span>'+it.year+'</span><span>'+it.meta+'</span><span class="'+P+'metaRating">'+star+it.rating+'</span></div>';}
function ring(it){return '<div class="'+P+'matchRing mk-ringS" role="img" aria-label="'+it.match+'% match"><div class="'+P+'matchRingInner"><span><span class="'+P+'matchRingPct">'+it.match+'</span><span class="'+P+'matchRingSign">%</span></span></div></div>';}
function chips(list){const d=document.createElement('div');d.className='mk-chips';
  d.innerHTML=list.map(([l,n,on])=>'<button type="button" class="'+P+'seenChip'+(on?' '+P+'seenChipOn':'')+'">'+l+(n?'<b>'+n+'</b>':'')+'</button>').join('');
  document.querySelector('.'+P+'content').before(d);}
const CHIPS2=[['All',55,1],['Starred',3,0],['Movies',35,0],['Series',20,0],['Netflix',7,0],['HBO Max',5,0],['Apple TV',3,0],['Prime Video',4,0]];
const CHIPS=[['All',55,1],['Movies',35,0],['Series',20,0],['Netflix',7,0],['HBO Max',5,0],['Apple TV',3,0],['Prime Video',4,0]];
function rows(items){L.innerHTML='';L.classList.add('mk-rows');for(const it of items){const d=document.createElement('div');d.className='mk-row';
  d.innerHTML='<img src="https://image.tmdb.org/t/p/w185'+it.poster+'" alt=""><div class="mk-rowBody"><h3 class="mk-rowTitle">'+it.title+'</h3>'+meta(it)+
  (it.where?'<span class="mk-rowWhere">'+it.where+'</span>':'')+'</div>'+ring(it);L.appendChild(d);}}
const PIN='<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>';
const STAR_BTN=on=>'<button type="button" class="mk-star'+(on?' on':'')+'" aria-label="'+(on?'Starred':'Star')+'"><svg viewBox="0 0 24 24">%(star)s</svg></button>';
const PILL={'Netflix':'<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" class="'+P+'whereIcon"><rect width="24" height="24" rx="5" fill="#000"/><path d="M8 4h2.6l3.4 9.2V4H16.6v16h-2.6L10.6 10.8V20H8z" fill="#E50914"/></svg>'};
function rows2(items,starred,cls){L.innerHTML='';L.classList.add('mk-rows');for(const it of items){const d=document.createElement('div');d.className='mk-row mk-row2 '+(cls||'');
  const on=starred.includes(it.title);
  d.innerHTML='<img src="https://image.tmdb.org/t/p/w185'+it.poster+'" alt=""><div class="mk-rowBody"><h3 class="mk-rowTitle">'+it.title+'</h3>'+meta(it)+
  '<span class="mk-rowLine">'+(it.where?'<span>'+it.where+'</span><span class="d">·</span>':'')+'<span class="m">'+it.match+'% match</span></span></div>'+STAR_BTN(on);L.appendChild(d);}}
function grid2(items,starred,cls){L.innerHTML='';L.classList.add('mk-grid');L.classList.add('mk-grid2');if(cls)L.classList.add(cls);for(const it of items){const d=document.createElement('div');d.className='mk-tile';
  const on=starred.includes(it.title);
  const pill=it.where?'<div class="'+P+'whereBadge">'+(PILL[it.where]||'')+'<span>'+it.where+'</span></div>':'';
  d.innerHTML='<img src="https://image.tmdb.org/t/p/w342'+it.poster+'" alt="">'+pill+ring(it)+STAR_BTN(on)+'<h3>'+it.title+'</h3>'+meta(it);L.appendChild(d);}}
const SORT_ICON='<svg viewBox="0 0 24 24"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>';
const CHEV='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">%(chev)s</svg>';
const CHEV_UP='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
const SORTS=['Date Added','Year','Rating','Name'];
function chipsSort(list,sort,open){if(!sort){chips(list);const c=document.querySelector('.mk-chips');const on=c.querySelector('.'+P+'seenChipOn');if(on&&on.offsetLeft+on.offsetWidth>c.clientWidth-20)c.scrollLeft=on.offsetLeft-16;return;}chips(list);const c=document.querySelector('.mk-chips');const w=document.createElement('div');w.className='mk-chipsWrap';c.replaceWith(w);w.appendChild(c);
  const s=document.createElement('div');s.className='mk-sortPill';
  s.innerHTML='<div class="'+P+'sortMenu"><button type="button" class="'+P+'sortTrigger" aria-haspopup="menu" aria-expanded="'+(!!open)+'" aria-label="Sort by: '+sort+'"><span>'+sort+'</span>'+CHEV+'</button>'+
    (open?'<div class="'+P+'sortPanel"><button type="button" class="'+P+'sortPanelHead"><span>'+sort+'</span>'+CHEV_UP+'</button><div role="menu" class="'+P+'sortOptions">'+
      SORTS.map(o=>'<button type="button" role="menuitemradio" class="'+P+'sortOption'+(o===sort?' '+P+'sortOptionActive':'')+'">'+o+'</button>').join('')+'</div></div>':'')+'</div>';
  w.appendChild(s);if(open)document.querySelector('.'+P+'content').classList.add(P+'contentDimmed');
  const on=c.querySelector('.'+P+'seenChipOn');if(on&&on.offsetLeft+on.offsetWidth>c.clientWidth-140)c.scrollLeft=on.offsetLeft-16;}
const CHIPS3=[['All',55,1],['Starred',3,0],['Movies',35,0],['Series',20,0],['Netflix',7,0],['HBO Max',5,0],['Apple TV',3,0],['Prime Video',4,0],['Seen',2,0]];
const lit=(list,name,n)=>list.map(([l,c])=>[l,l===name&&n!=null?n:c,l===name?1:0]);
// RecCard's own why panel, as the sheet shows it: WHY, SCORE BREAKDOWN, WHAT IT'S LIKE, CREW
const R='RecCard-module__4UCK-G__';
const sec=(l,b)=>'<div class="'+R+'whySection"><div class="'+R+'whySectionLabel">'+l+'</div>'+b+'</div>';
function whyPanel(){const d=document.createElement('div');d.className=R+'whyPanel mk-why';d.innerHTML=
  sec('Why','<div class="'+R+'whyText">From Christopher Nolan, who made <em>Interstellar</em>, which you loved. Two rival stage magicians in Victorian London, played by Hugh Jackman and Christian Bale, go to ruinous lengths to outdo each other’s signature trick.</div>')+
  sec('Score breakdown',[['Crew',72],['Narrative',90],['Mood & pace',66],['Reviews',84],['Recency',30]].map(([l,w])=>'<div class="'+R+'scoreRow"><div class="'+R+'scoreLabel">'+l+'</div><div class="'+R+'scoreTrack"><div class="'+R+'scoreFill" style="width:'+w+'%"></div></div></div>').join(''))+
  sec('What it’s like','<dl class="'+R+'storyList"><dt class="'+R+'storyLabel">Genre:</dt><dd class="'+R+'storyValue">drama, mystery, science fiction</dd><dt class="'+R+'storyLabel">Language:</dt><dd class="'+R+'storyValue">English</dd></dl>')+
  sec('Crew','<div class="'+R+'crewInfo"><span class="'+R+'crewName">Christopher Nolan</span><span class="'+R+'crewRole">Director</span></div><div class="'+R+'crewInfo"><span class="'+R+'crewName">Christian Bale</span><span class="'+R+'crewRole">Actor</span></div>');
  return d;}
// the card page with the breakdown on it: no "Why it's a match" button (nothing left to open); scroll to an element
function cardPageWhy(title,starred,to){cardPage(title,starred);const a=L.querySelector('article');q(a,'whyLink').remove();q(a,'watchlistBtn').classList.add('mk-whyGap');q(a,'heroBody').appendChild(whyPanel());
  if(to==='seen')L.scrollTop=q(a,'seenIt').offsetTop-L.offsetTop-14;else if(to==='bars')L.scrollTop=a.querySelectorAll('.'+R+'whySection')[1].offsetTop-L.offsetTop-14;else L.scrollTop=0;}
const EMO={loved:'❤️ Loved',liked:'👍 Liked',disliked:'👎 Disliked'};
function rowEl(it,starred,rated){const d=document.createElement('div');d.className='mk-row mk-row2 mk-row3'+(rated?' seen':'');
  const line=rated?'<span class="r">'+EMO[rated]+'</span>':(it.where?'<span>'+it.where+'</span><span class="d">·</span>':'')+'<span class="m">'+it.match+'% match</span>';
  d.innerHTML='<img src="https://image.tmdb.org/t/p/w185'+it.poster+'" alt=""><div class="mk-rowBody"><h3 class="mk-rowTitle">'+it.title+'</h3>'+meta(it)+
  '<span class="mk-rowLine">'+line+'</span></div>'+STAR_BTN(starred.includes(it.title));return d;}
function rows3(items,starred,rated){L.innerHTML='';L.classList.add('mk-rows');for(const it of items)L.appendChild(rowEl(it,starred,rated[it.title]));}
function divider(n){const d=document.createElement('div');d.className='mk-div';d.innerHTML='Seen <b>'+n+'</b>';return d;}
function swipe(it){const w=document.createElement('div');w.className='mk-swipe';w.appendChild(rowEl(it,[],null));
  const a=document.createElement('div');a.className='mk-act';a.innerHTML='<svg viewBox="0 0 24 24"><path d="m17 17 5 5"/><path d="M19 7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v15l7-4 7 4V7"/><path d="m22 17-5 5"/></svg>Remove';w.appendChild(a);return w;}
function note(it){const d=document.createElement('div');d.className='mk-note';d.innerHTML='<p>Removed. <b>'+it.title+'</b> is off your Watchlist.</p><button>Undo</button>';return d;}
function endCard(n){const d=document.createElement('div');d.className=P+'card '+P+'nudge mk-end';d.innerHTML='<span class="'+P+'nudgeEyebrow">That\u2019s your list</span><p class="'+P+'nudgeText">Need help deciding? Let\u2019s talk it over.</p><div class="mk-btns"><button type="button" class="'+P+'watchlistBtn '+P+'watchlistBtnPrimary"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+document.querySelector('button[aria-label="Ask WTW"] svg').innerHTML+'</svg>Let\u2019s talk</button></div>';return d;}
function emptyState(text,btn){L.innerHTML='';const d=document.createElement('div');d.className=P+'emptyState';d.innerHTML='<span class="'+P+'muted">'+text+'</span>'+(btn?'<button type="button" class="'+P+'watchlistBtn '+P+'watchlistBtnPrimary mk-emptyBtn">'+btn+'</button>':'');L.appendChild(d);}
function cardPage(title,starred){const b=document.querySelector('button[aria-label="Ask WTW"]');b.setAttribute('aria-label','back');b.querySelector('svg').innerHTML='<path d="m15 18-6-6 6-6"/>';
  document.querySelector('.'+P+'headerTitle').textContent='';const a=T(title);save(a);
  const c=q(a,'heroCircles');const st=document.createElement('button');st.type='button';st.className=P+'trailerCircle mk-starCircle'+(starred?' on':'');st.innerHTML='<svg viewBox="0 0 24 24">%(star)s</svg>';c.prepend(st);
  L.innerHTML='';L.appendChild(a);L.scrollTop=0;}
function grid(items){L.innerHTML='';L.classList.add('mk-grid');for(const it of items){const d=document.createElement('div');d.className='mk-tile';
  d.innerHTML='<img src="https://image.tmdb.org/t/p/w342'+it.poster+'" alt=""><h3>'+it.title+'</h3><span>'+it.year+(it.where?' · '+it.where:'')+'</span>';L.appendChild(d);}}
""".replace('%(p)s', P).replace('%(items)s', ITEMS_JS).replace('%(chat)s', CHAT).replace('%(chev)s', CHEVRON_DOWN).replace('%(star)s', STAR)

STATES = {
    # Q1: the shape of the list. A = today, B = rows, C = a poster wall
    'a-cards': (55, "header(55);sortBar('Date Added');A().forEach(save);L.scrollTop=0;"),
    'b-rows': (55, "header(55);sortBar('Date Added');rows(ITEMS);L.scrollTop=0;"),
    'c-grid': (55, "header(55);sortBar('Date Added');grid(ITEMS);L.scrollTop=0;"),
    # Q1 again: names next to the posters in both, and a filter row on top (the sort bar stays under it)
    'd-rows-chips': (55, "header(55);chips(CHIPS);sortBar('Date Added');rows(ITEMS);L.scrollTop=0;"),
    'e-grid-chips': (55, "header(55);chips(CHIPS);sortBar('Date Added');grid(ITEMS);L.scrollTop=0;"),
    # Q1, third pass: bigger posters in the rows, no ring column; the grid at two across; a star on both
    'f-rows2': (55, "header(55);chips(CHIPS2);sortBar('Date Added');rows2(ITEMS,['The Prestige']);L.scrollTop=0;"),
    'g-grid2': (55, "header(55);chips(CHIPS2);sortBar('Date Added');grid2(ITEMS,['The Prestige']);L.scrollTop=0;"),
    # Q1, fourth pass: rows at about 4 per screen; the grid a touch smaller with more air between posters
    'h-rows3': (55, "header(55);chips(CHIPS2);sortBar('Date Added');rows2(ITEMS,['The Prestige'],'mk-row3');L.scrollTop=0;"),
    # The flows, on rows
    'j-card': (55, "header(55);cardPage('The Prestige',true);"),
    'k-sortfold': (55, "header(55);chipsSort(CHIPS3);rows3(ITEMS,['The Prestige'],{});L.scrollTop=0;"),
    'l-netflix': (55, "header(55);chipsSort(lit(CHIPS3,'Netflix',3));rows3(ITEMS.filter(i=>i.where==='Netflix'),[],{});L.scrollTop=0;"),
    'm-seen-inplace': (55, "header(55);chipsSort(CHIPS3);rows3(ITEMS,['The Prestige'],{'Memento':'loved'});L.scrollTop=300;"),
    'n-seen-sunk': (55, "header(55);chipsSort(CHIPS3);const un=ITEMS.filter(i=>!['Memento','Kill Bill: Vol. 1'].includes(i.title));rows3(un,['The Prestige'],{});L.appendChild(divider(2));for(const t of ['Memento','Kill Bill: Vol. 1'])L.appendChild(rowEl(ITEMS.find(i=>i.title===t),[],t==='Memento'?'loved':'liked'));L.scrollTop=L.scrollHeight;"),
    'o-swipe': (55, "header(55);chipsSort(CHIPS3);rows3(ITEMS,['The Prestige'],{});L.children[1].replaceWith(swipe(ITEMS[1]));L.scrollTop=0;"),
    'p-removed': (54, "header(54);chipsSort([['All',54,1],['Starred',3,0],['Movies',34,0],['Series',20,0],['Netflix',7,0],['HBO Max',5,0],['Apple TV',3,0],['Prime Video',4,0],['Seen',2,0]]);rows3(ITEMS,['The Prestige'],{});L.children[1].replaceWith(note(ITEMS[1]));L.scrollTop=0;"),
    'q-empty': (0, "header(0);emptyState('Nothing saved yet. Tap \u201cAdd to Watchlist\u201d on a pick to keep it here.','Go to For you');"),
    'r-empty-starred': (55, "header(55);chipsSort(lit(CHIPS3,'Starred',0));emptyState('Nothing starred yet. Star a title and it stays at the top of your list.',null);"),
    's-end': (55, "header(55);chipsSort(CHIPS3);rows3(ITEMS.slice(-3),[],{});L.appendChild(endCard(55));L.scrollTop=L.scrollHeight;"),
    # Round 3: the breakdown on the card page; the sort as a labelled pill; a Seen chip; the end card's place; orange empty buttons
    'j1-card-top': (55, "header(55);cardPageWhy('The Prestige',true,'top');"),
    'j2-card-why': (55, "header(55);cardPageWhy('The Prestige',true,'seen');"),
    'j3-card-bars': (55, "header(55);cardPageWhy('The Prestige',true,'bars');"),
    'k2-sortmenu': (55, "header(55);chipsSort(CHIPS3,'Date Added',true);rows3(ITEMS,['The Prestige'],{});L.scrollTop=0;"),
    'k3-sortyear': (55, "header(55);chipsSort(CHIPS3,'Year');const by=[...ITEMS].sort((a,b)=>b.year-a.year);rows3(by,['The Prestige'],{});L.scrollTop=0;"),
    'u-seen-chip': (55, "header(55);chipsSort(lit(CHIPS3,'Seen'));rows3([],[],{});for(const t of ['Memento','Kill Bill: Vol. 1'])L.appendChild(rowEl(ITEMS.find(i=>i.title===t),[],t==='Memento'?'loved':'liked'));L.scrollTop=0;"),
    'v-end-seen': (55, "header(55);chipsSort(CHIPS3);const un=ITEMS.filter(i=>!['Memento','Kill Bill: Vol. 1'].includes(i.title));rows3(un.slice(-2),[],{});L.appendChild(endCard(53));L.appendChild(divider(2));for(const t of ['Memento','Kill Bill: Vol. 1'])L.appendChild(rowEl(ITEMS.find(i=>i.title===t),[],t==='Memento'?'loved':'liked'));L.scrollTop=L.scrollHeight;"),
    'i-grid3': (55, "header(55);chips(CHIPS2);sortBar('Date Added');grid2(ITEMS,['The Prestige'],'mk-grid3');L.scrollTop=0;"),
}

for key, (count, js) in STATES.items():
    script = f'<script>setTimeout(()=>{{{JS_LIB}\n{js}}},300)</script>'
    html = SRC.replace('</head>', f'<style>{CSS}</style></head>', 1).replace('</body>', bar(count) + script + '</body>', 1)
    (HERE / f'{key}.html').write_text(html)
    print(key)
