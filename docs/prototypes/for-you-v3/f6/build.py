"""F6 · "Why it's a match": the Creators bar tells the truth (issue #352, FOR-YOU.md DEC-8).

Built on the Watchlist's mock library (docs/prototypes/watchlist-v3/build.py: the real feed capture
docs/prototypes/nav/cap-feed.html, its tab bar and card page; read, not changed). The capture is the running app with the
test account and stays out of git, and so do the pages built from it (*.html here). RecCard.module.css and the sheet's
CSS (RecommendationsView.module.css .why*) have not changed since the capture; .cardWhy (the card page's breakdown,
added later) is copied below as shipped.

The data is real: the titles are in the test account's live For you batch (2026-11-22), the people are each title's
directors, writers and top-billed cast in the catalogue, and "you loved / liked" is the test account's own ratings
(9: Interstellar, Inception, Avatar (liked), Arcane, Deadpool & Wolverine, The Super Mario Bros. Movie, Chernobyl,
Oppenheimer, Cruella). The Why text is the app's fact-built one (step7-card-reason.ts sheetReason). Only the bar lengths
are a sample: with 9 ratings the account still gets starter picks, which carry no breakdown.
Run: python3 build.py && python3 render.py"""
import pathlib, json
HERE = pathlib.Path(__file__).parent.resolve()
WL = HERE.parent.parent / 'watchlist-v3' / 'build.py'
src = WL.read_text()
lib = {'__file__': str(WL)}
exec(src[:src.index('\nSTATES = {')], lib)          # the Watchlist's CSS, bar(), JS_LIB, without its writer
SRC, CSS, JS_LIB, P = lib['SRC'], lib['CSS'], lib['JS_LIB'], lib['P']
WATCHLIST_COUNT = 28                                # the test account's Watchlist today

X = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
STAR = lib['STAR']

TITLES = {
 'Tenet': dict(year=2020, meta='2h 30m', rating='7.2',
   why='From Christopher Nolan, who made *Interstellar*, which you loved. Armed with only one word - Tenet - and fighting for the '
       'survival of the entire world, the Protagonist journeys through a twilight world of international espionage on a mission '
       'that will unfold in something beyond real time.',
   genre='action, thriller, science fiction', bars=(78, 64, 88),
   people=[('Christopher Nolan', 'Director, writer', 'loved', ['Interstellar', 'Inception', 'Oppenheimer'], [])]),
 'Tenet-mixed': dict(heading='Tenet', year=2020, meta='2h 30m', rating='7.2',
   why='From Christopher Nolan, who made *Interstellar*, which you loved. Armed with only one word - Tenet - and fighting for the '
       'survival of the entire world, the Protagonist journeys through a twilight world of international espionage on a mission '
       'that will unfold in something beyond real time.',
   genre='action, thriller, science fiction', bars=(78, 64, 88),
   # MADE-UP RATINGS for this one case (Eran asked: loved 2, liked 2). The credits are real: Nolan directed and wrote all four.
   people=[('Christopher Nolan', 'Director, writer', 'loved', ['Interstellar', 'Inception'], ['Oppenheimer', 'Dunkirk'])]),
 'Free Guy': dict(year=2021, meta='1h 55m', rating='7.4',
   why='From Shawn Levy, who made *Deadpool & Wolverine*, which you loved. With Ryan Reynolds, who you loved in *Deadpool & '
       'Wolverine*. A bank teller discovers he is actually a background player in an open-world video game, and decides to become '
       'the hero of his own story.',
   genre='comedy, adventure, science fiction', bars=(70, 72, 86),
   people=[('Shawn Levy', 'Director', 'loved', ['Deadpool & Wolverine'], []),
           ('Ryan Reynolds', 'Actor', 'loved', ['Deadpool & Wolverine'], [])]),
 'Avatar: Fire and Ash': dict(year=2025, meta='3h 18m', rating='7.6',
   why='From James Cameron, who made *Avatar*, which you liked. With Sam Worthington, who you liked in *Avatar*. In the wake of '
       'the devastating war against the RDA and the loss of their eldest son, Jake Sully and Neytiri face a new threat on Pandora: '
       'the Ash People, a violent and power-hungry Na\'vi tribe led by the ruthless Varang.',
   genre='science fiction, adventure, fantasy', bars=(66, 74, 80),
   people=[('James Cameron', 'Director, writer', 'liked', ['Avatar'], []),
           ('Sam Worthington', 'Actor', 'liked', ['Avatar'], []),
           ('Zoe Saldaña', 'Actor', 'liked', ['Avatar'], []),
           ('Sigourney Weaver', 'Actor', 'liked', ['Avatar'], [])]),
 'Weapons': dict(year=2025, meta='2h 9m', rating='7.3',
   why='When all but one child from the same class mysteriously vanish on the same night at exactly the same time, a community is '
       'left questioning who or what is behind their disappearance.',
   genre='horror, mystery', bars=(74, 69, 27), people=[]),
}

CSS_F6 = """
/* the sheet, still: no slide-up, no fade */
.%(p)swhyLayer *, .%(p)swhyLayer{animation:none!important}
/* RecommendationsView.module.css .cardWhy, as shipped (added after the capture) */
.f6-cardWhy{margin-top:18px;padding-top:17.5px;border-top:1px solid rgba(255,255,255,.12)}
.f6-gap{height:18px}
/* PROPOSED: the naming line under the Creators bar: crewName over a crewRole-styled line (no capitalising: it's a sentence) */
.f6-who{text-transform:none!important}
.f6-who em{font-style:italic}
""".replace('%(p)s', P)

JS_F6 = r"""
const TITLES=%(titles)s;
const emph=s=>s.replace(/\*([^*]+)\*/g,'<em>$1</em>');
const sec2=(l,b)=>'<div class="'+R+'whySection"><div class="'+R+'whySectionLabel">'+l+'</div>'+b+'</div>';
const barRow=(l,w)=>'<div class="'+R+'scoreRow"><div class="'+R+'scoreLabel">'+l+'</div><div class="'+R+'scoreTrack"><div class="'+R+'scoreFill" style="width:'+w+'%"></div></div></div>';
const list=a=>a.length<2?a[0]:a.slice(0,-1).join(', ')+' and '+a[a.length-1];
const titlesOf=a=>list(a.map(t=>'<em>'+t+'</em>'));
// A: name the titles. B: count them.
function whoLine(p,style){const [name,role,how,ts,also]=p;const liked=also||[];
  // loved first, then liked; "and" joins the two halves
  const what=style==='count'
    ?(liked.length?how+' '+ts.length+' and liked '+liked.length+' of their titles':how+' '+ts.length+' of their titles')
    :(liked.length?how+' '+titlesOf(ts)+', and liked '+titlesOf(liked):how+' '+titlesOf(ts));
  return '<div class="'+R+'crewInfo"><span class="'+R+'crewName">'+name+'</span><span class="'+R+'crewRole f6-who">'+role+' · you '+what+'</span></div>';}
// today: three bars; the people, if any, in a Crew section at the bottom
function panelToday(t){const d=TITLES[t];const [a,b,c]=d.bars;
  return sec2('Why','<div class="'+R+'whyText">'+emph(d.why)+'</div>')+
    sec2('Score breakdown',barRow('Your taste',a)+barRow('Crowd',b)+barRow('Creators',c))+
    sec2('What it’s like','<dl class="'+R+'storyList"><dt class="'+R+'storyLabel">Genre:</dt><dd class="'+R+'storyValue">'+d.genre+'</dd><dt class="'+R+'storyLabel">Language:</dt><dd class="'+R+'storyValue">English</dd></dl>')+
    sec2('Crew',d.people.length?d.people.map(p=>'<div class="'+R+'crewInfo"><span class="'+R+'crewName">'+p[0]+'</span><span class="'+R+'crewRole">'+p[1]+'</span></div>').join(''):'<div class="'+R+'whyText '+R+'whyTextMuted">No one you follow is in this one.</div>');}
// proposed: the people named right under the Creators bar; nobody = no bar, one quiet line; the Crew section folds into it
function panelNew(t,style){const d=TITLES[t];const [a,b,c]=d.bars;
  const creators=d.people.length?barRow('Creators',c)+d.people.map(p=>whoLine(p,style)).join('')
    :'<div class="'+R+'scoreRow"><div class="'+R+'scoreLabel">Creators</div><div class="'+R+'whyText '+R+'whyTextMuted">Nobody you’ve rated is in this one.</div></div>';
  return sec2('Why','<div class="'+R+'whyText">'+emph(d.why)+'</div>')+
    sec2('Score breakdown',barRow('Your taste',a)+barRow('Crowd',b)+creators)+
    sec2('What it’s like','<dl class="'+R+'storyList"><dt class="'+R+'storyLabel">Genre:</dt><dd class="'+R+'storyValue">'+d.genre+'</dd><dt class="'+R+'storyLabel">Language:</dt><dd class="'+R+'storyValue">English</dd></dl>');}
function panel(t,kind,style){const el=document.createElement('div');el.className=R+'whyPanel';el.innerHTML=kind==='today'?panelToday(t):panelNew(t,style);return el;}
function metaRow(d){return '<div class="'+P+'cardMeta"><span>'+d.year+'</span><span>'+d.meta+'</span><span class="'+P+'metaRating"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="'+P+'metaStar" aria-hidden="true">%(star)s</svg>'+d.rating+'</span></div>';}
// For you's "Why it's a match" sheet over the feed, scrolled so the Score breakdown sits near the top
function sheet(t,kind,style){const d=TITLES[t];const v=document.querySelector('.'+P+'view');
  // the sheet's layer (z-index 100) sits over the tab bar (z-index 20) in the app; the mock's bar is fixed on top, so it steps aside
  document.querySelector('.tb').style.display='none';
  const layer=document.createElement('div');layer.className=P+'whyLayer';
  layer.innerHTML='<div class="'+P+'whyScrim"></div><div class="'+P+'whySheet"><div class="'+P+'whyGrab"></div><div class="'+P+'whySheetHead '+P+'whySheetHeadScrolled"><div class="'+P+'cardTitleBlock"><h2 class="'+P+'heroTitle">'+(d.heading||t)+'</h2>'+metaRow(d)+'</div><button type="button" class="'+P+'headerBtn" aria-label="Close"><svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">%(x)s</svg></button></div><div class="'+P+'whySheetBody"></div></div>';
  v.appendChild(layer);const body=layer.querySelector('.'+P+'whySheetBody');const pn=panel(t,kind,style);body.appendChild(pn);
  const s=pn.querySelectorAll('.'+R+'whySection')[1];body.scrollTop=body.scrollTop+s.getBoundingClientRect().top-body.getBoundingClientRect().top-34;}
// the card page (Watchlist, Seen, Search), scrolled to the breakdown; the page's own title is above, off screen
function cardPageAt(t,kind,style){const first=A()[0].querySelector('h3').textContent;cardPage(first,false);const a=L.querySelector('article');
  q(a,'whyLink').remove();const g=document.createElement('div');g.className='f6-gap';q(a,'watchlistBtn').after(g);
  const w=document.createElement('div');w.className='f6-cardWhy';w.appendChild(panel(t,kind,style));q(a,'heroBody').appendChild(w);
  const s=w.querySelectorAll('.'+R+'whySection')[1];L.scrollTop=L.scrollTop+s.getBoundingClientRect().top-L.getBoundingClientRect().top-120;}
""".replace('%(titles)s', json.dumps(TITLES)).replace('%(star)s', STAR).replace('%(x)s', X)

STATES = {
  # (tab, js)
  'a-today-one':     ('foryou', "sheet('Tenet','today');"),
  'a-new-one':       ('foryou', "sheet('Tenet','new');"),
  'a-new-one-count': ('foryou', "sheet('Tenet','new','count');"),
  'e-mixed':         ('foryou', "sheet('Tenet-mixed','new');"),
  'e-mixed-count':   ('foryou', "sheet('Tenet-mixed','new','count');"),
  'b-new-two':       ('foryou', "sheet('Free Guy','new');"),
  'b-new-four':      ('foryou', "sheet('Avatar: Fire and Ash','new');"),
  'c-today-nobody':  ('foryou', "sheet('Weapons','today');"),
  'c-new-nobody':    ('foryou', "sheet('Weapons','new');"),
  'd-card-one':      ('watchlist', "header(%d);cardPageAt('Tenet','new');" % WATCHLIST_COUNT),
  'd-card-two':      ('watchlist', "header(%d);cardPageAt('Free Guy','new');" % WATCHLIST_COUNT),
  'd-card-nobody':   ('watchlist', "header(%d);cardPageAt('Weapons','new');" % WATCHLIST_COUNT),
}

for key, (tab, js) in STATES.items():
    script = f'<script>setTimeout(()=>{{{JS_LIB}\n{JS_F6}\n{js}}},300)</script>'
    html = SRC.replace('</head>', f'<style>{CSS}{CSS_F6}</style></head>', 1).replace('</body>', lib['bar'](WATCHLIST_COUNT, tab) + script + '</body>', 1)
    (HERE / f'{key}.html').write_text(html)
    print(key)
