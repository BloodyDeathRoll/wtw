"""F7 · The stretch pick says it's a stretch (issue #353, FOR-YOU.md DEC-10, PLAN Q-3).

Built on the Watchlist's mock library (docs/prototypes/watchlist-v3/build.py: the real feed capture
docs/prototypes/nav/cap-feed.html, its tab bar and header; read, not changed), the way F6's mocks are. The capture is the
running app with the test account and stays out of git, and so do the pages built from it (*.html here). Since the capture,
two styles touching the card and the sheet shipped: F3's Hide (.wantHide) and F6's people line (.crewWho). Both are copied
below as shipped; nothing else on the card or the sheet changed (git diff of both CSS modules since 2026-11-14).

The data is real, from the engine run read-only for the test account on 2026-11-22 (formula v2, as in production):
- Django Unchained: in the account's live For you batch, 97%, its card line as served.
- La La Land: the first title the engine's stretch rule would take for this account (pool of 342: match under 40%, crowd
  score over 0.7). Its 40%, card lines, sheet text, bars, "What it's like" and "Doesn't quite fit" are what steps 2-7 give
  it when marked as a stretch pick. The account gets no stretch pick today (0 chat sessions, the rule wants 3; and its story
  dimensions are under the 0.4 confidence the rule needs), so this is the one it would get, not one it was served.
Run: python3 build.py && python3 render.py"""
import pathlib, json
HERE = pathlib.Path(__file__).parent.resolve()
WL = HERE.parent.parent / 'watchlist-v3' / 'build.py'
src = WL.read_text()
lib = {'__file__': str(WL)}
exec(src[:src.index('\nSTATES = {')], lib)          # the Watchlist's CSS, bar(), JS_LIB, without its writer
SRC, CSS, JS_LIB, P = lib['SRC'], lib['CSS'], lib['JS_LIB'], lib['P']
STAR = lib['STAR']
WATCHLIST_COUNT = 28                                # the test account's Watchlist today

# lucide-react 1.70.0, as RecommendationsView.tsx / RecCard.tsx import them
EYE_OFF = ('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>'
           '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>'
           '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>'
           '<path d="m2 2 20 20"/>')
TRIANGLE = '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
X = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'

PLOT = ('Mia, an aspiring actress, serves lattes to movie stars in between auditions and Sebastian, a jazz musician, '
        'scrapes by playing cocktail party gigs in dingy bars.')
ENGINE_NOTE = ('Intentional stretch: this title scores lower on your usual narrative complexity preferences. High critical '
               'rating. Accept or reject — both are useful signals.')
TITLES = {
 'Django Unchained': dict(poster='/7oWY8VDWW7thTzWh3OKYRkWUlD5.jpg', year=2012, meta='2h 45m', rating='8.2', match=97,
   card='With Leonardo DiCaprio, who you loved in *Inception*.'),
 'La La Land': dict(poster='/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg', year=2016, meta='2h 9m', rating='7.9', match=40,
   card_today=ENGINE_NOTE,
   card_new='With Emma Stone, who you loved in *Cruella*.',
   why_today=ENGINE_NOTE + ' With Emma Stone, who you loved in *Cruella*. ' + PLOT,
   why_new='With Emma Stone, who you loved in *Cruella*. ' + PLOT,
   bars=(12, 85, 81),
   people=[('Emma Stone', 'Actor', ['Cruella'], ['Poor Things'])],
   like=[('Feels', 'easy to follow, light, talky, slow-burning'), ('Genre', 'comedy, drama, romance'), ('Language', 'English')],
   against=['A stretch pick: chosen on purpose from outside what you usually go for.', 'It’s slower than you usually go for.']),
}
# Q-3: the label's words. Each must hold for every stretch pick: it is placed on purpose (step 5), its match shows 40% or less
# (composite < 0.4; the ring rounds, so it can read 40), and it is well rated (crowd score > 0.7). Nothing more is promised.
WORDS = {'a': 'Stretch pick', 'b': 'Not your usual, on purpose', 'c': 'Something different, on purpose'}

CSS_F7 = """
.%(p)scard{animation:none!important}
.%(p)swhyLayer *, .%(p)swhyLayer{animation:none!important}
/* RecommendationsView.module.css .wantHide (v3 F3), as shipped */
.%(p)swantHide{flex:0 0 auto;height:50px;display:inline-flex;align-items:center;gap:7px;padding:0 18px;border:0;border-radius:999px;
  background:var(--rv-white-10);color:var(--rv-white-70);font-family:inherit;font-size:15px;font-weight:500;line-height:1;cursor:pointer}
.%(p)swantHide svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
/* RecCard.module.css .crewWho (v3 F6), as shipped */
.f7-crewWho{font-size:13.5px;color:var(--why-muted)}
.f7-crewWho em{font-style:italic}
/* PROPOSED: the label. Nothing new: the poster circles' outline and glass (.trailerCircle: 1px white 35%%, black 35%%,
   blur 10px) on the where-to-watch pill's shape and text (.whereBadge: 30px tall, 10px sides, 13px white). It sits over the
   title, inside .cardTitleBlock, so it never meets the where-to-watch pill or the ring. */
.f7-label{align-self:flex-start;display:inline-flex;align-items:center;height:30px;padding:0 10px;box-sizing:border-box;
  border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.35);backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);font-size:13px;color:#fff;white-space:nowrap;margin-bottom:6px}
""".replace('%(p)s', P).replace('%%', '%')

JS_F7 = r"""
const TITLES=%(titles)s;
const emph=s=>s.replace(/\*([^*]+)\*/g,'<em>$1</em>');
const label=w=>w?'<span class="f7-label">'+w+'</span>':'';
// the feed's first card becomes title t; kind 'today' | 'new'; w = the label's words (new only)
function card(t,kind,w){const d=TITLES[t];const a=A()[0];
  q(a,'posterImg').src='https://image.tmdb.org/t/p/w500'+d.poster;
  const wb=q(a,'whereBadge');if(wb)wb.remove();             // neither title streams on the four services in Israel
  q(a,'matchRing').setAttribute('aria-label',d.match+'% match');q(a,'matchRingPct').textContent=d.match;
  const tb=q(a,'cardTitleBlock');q(tb,'heroTitle').textContent=t;
  const m=q(tb,'cardMeta').children;m[0].textContent=d.year;m[1].textContent=d.meta;m[2].lastChild.textContent=d.rating;
  if(kind==='new'&&w)tb.insertAdjacentHTML('afterbegin',label(w));
  a.querySelectorAll('button[aria-label^="Share"],button[aria-label^="Play"]').forEach(b=>b.setAttribute('aria-label',b.getAttribute('aria-label').replace(/Once Upon a Time\.\.\. in Hollywood/,t)));
  q(a,'heroReason').innerHTML=emph(d.card||(kind==='new'?d.card_new:d.card_today));
  // a stretch pick's link: "Why this pick", the string the card already uses when it makes no match claim
  q(a,'whyLink').querySelector('span').textContent=(kind==='new'&&d.card_new)?'Why this pick':'Why it’s a match';
  // F3: Hide where the X was
  const x=q(a,'wantX');const h=document.createElement('button');h.type='button';h.className=P+'wantHide';
  h.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">%(eyeoff)s</svg>Hide';x.replaceWith(h);
  L.scrollTop=0;}
const sec7=(l,b,warn)=>'<div class="'+R+'whySection"><div class="'+R+(warn?'whySectionLabelWarn':'whySectionLabel')+'">'+l+'</div>'+b+'</div>';
const barRow=(l,v)=>'<div class="'+R+'scoreRow"><div class="'+R+'scoreLabel">'+l+'</div><div class="'+R+'scoreTrack"><div class="'+R+'scoreFill" style="width:'+v+'%"></div></div></div>';
const titlesOf=a=>a.map(x=>'<em>'+x+'</em>').join(' and ');
function who(p){const [name,role,loved,liked]=p;
  return '<div class="'+R+'crewInfo"><span class="'+R+'crewName">'+name+'</span><span class="f7-crewWho">'+role+' · you loved '+titlesOf(loved)+(liked.length?', and liked '+titlesOf(liked):'')+'</span></div>';}
// WhyPanel as v3 F6 ships it, for a v2 payload with bars
function panel(t,kind){const d=TITLES[t];const [a,b,c]=d.bars;
  return sec7('Why','<div class="'+R+'whyText">'+emph(kind==='new'?d.why_new:d.why_today)+'</div>')+
    sec7('Score breakdown',barRow('Your taste',a)+barRow('Crowd',b)+barRow('Creators',c)+d.people.map(who).join(''))+
    sec7('What it’s like','<dl class="'+R+'storyList">'+d.like.map(([l,v])=>'<dt class="'+R+'storyLabel">'+l+':</dt><dd class="'+R+'storyValue">'+v+'</dd>').join('')+'</dl>')+
    sec7('Doesn’t quite fit',d.against.map(s=>'<div class="'+R+'negRow"><span class="'+R+'negIcon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%(tri)s</svg></span><span>'+s+'</span></div>').join(''),true);}
function metaRow(d){return '<div class="'+P+'cardMeta"><span>'+d.year+'</span><span>'+d.meta+'</span><span class="'+P+'metaRating"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="'+P+'metaStar" aria-hidden="true">%(star)s</svg>'+d.rating+'</span></div>';}
// For you's "Why it's a match" sheet over the card; at = 'top' | 'end'
function sheet(t,kind,w,at){card(t,kind,w);const d=TITLES[t];const v=document.querySelector('.'+P+'view');
  document.querySelector('.tb').style.display='none';     // the sheet (z 100) covers the tab bar (z 20) in the app
  const layer=document.createElement('div');layer.className=P+'whyLayer';
  layer.innerHTML='<div class="'+P+'whyScrim"></div><div class="'+P+'whySheet"><div class="'+P+'whyGrab"></div><div class="'+P+'whySheetHead'+(at==='end'?' '+P+'whySheetHeadScrolled':'')+'"><div class="'+P+'cardTitleBlock">'+(kind==='new'?label(w):'')+'<h2 class="'+P+'heroTitle">'+t+'</h2>'+metaRow(d)+'</div><button type="button" class="'+P+'headerBtn" aria-label="Close"><svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">%(x)s</svg></button></div><div class="'+P+'whySheetBody"></div></div>';
  v.appendChild(layer);const body=layer.querySelector('.'+P+'whySheetBody');const pn=document.createElement('div');pn.className=R+'whyPanel';
  pn.innerHTML=panel(t,kind);body.appendChild(pn);if(at==='end')body.scrollTop=body.scrollHeight;}
""".replace('%(titles)s', json.dumps(TITLES)).replace('%(star)s', STAR).replace('%(x)s', X).replace('%(eyeoff)s', EYE_OFF).replace('%(tri)s', TRIANGLE)

W = WORDS
STATES = {
  'a-normal':         "card('Django Unchained','today');",
  'b-stretch-today':  "card('La La Land','today');",
  'c-stretch-a':      "card('La La Land','new',%s);" % json.dumps(W['a']),
  'c-stretch-b':      "card('La La Land','new',%s);" % json.dumps(W['b']),
  'c-stretch-c':      "card('La La Land','new',%s);" % json.dumps(W['c']),
  'd-sheet-today':    "sheet('La La Land','today',null,'top');",
  'd-sheet-new-top':  "sheet('La La Land','new',%s,'top');" % json.dumps(W['b']),
  'd-sheet-new-end':  "sheet('La La Land','new',%s,'end');" % json.dumps(W['b']),
}

for key, js in STATES.items():
    script = f'<script>setTimeout(()=>{{{JS_LIB}\n{JS_F7}\n{js}}},300)</script>'
    html = SRC.replace('</head>', f'<style>{CSS}{CSS_F7}</style></head>', 1).replace('</body>', lib['bar'](WATCHLIST_COUNT, 'foryou') + script + '</body>', 1)
    (HERE / f'{key}.html').write_text(html)
    print(key)
