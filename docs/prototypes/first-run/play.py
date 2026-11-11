"""A playable run of the first-run design (Eran, 2026-11-11): 5 cards → the screen before the picks → 5 quick picks.
Every screen is the signed-off mock from build.py, so it looks exactly like the JPEGs; this file only wires the taps.
Shortened on purpose: the cards stop after 5 shown (not 30 rated / 90 shown), the picks after 5 picks or 8 pairs
(not 12 / 18). The counters still read "of 30" / "of 12", as on the real screens.
Swaps are close to, not the same as, the season's replaceSide: same type, a shared genre, well known, similar scales.
Out: play.html (open it through the prototypes server, e.g. http://localhost:4173/docs/prototypes/first-run/play.html)."""
import json
from build import (HERE, TITLES, T, app, card, between, qp, qside, poster, EMO, LONG_TITLE)

CARDS = [T('Interstellar'), T('Titanic'), T('Game of Thrones', 'tv'), T('The Hangover'), T('Spirited Away')]
PAIRS = [(T('Pulp Fiction'), T('Se7en')), (T('The Notebook'), T('Pride & Prejudice')), (T('Toy Story'), T('Shrek')),
         (T('Mad Max: Fury Road'), T('John Wick')), (T('Breaking Bad', 'tv'), T('Stranger Things', 'tv')),
         (T('Get Out'), T('A Quiet Place')), (T('La La Land'), T('The Greatest Showman')), (T('The Office', 'tv'), T('Friends', 'tv'))]
MAX_PICKS, MAX_PAIRS = 5, 8

used = {t['id'] for t in CARDS} | {t['id'] for a, b in PAIRS for t in (a, b)}
def similar(o, other):
    best, bs = None, -1e9
    for c in TITLES.values():
        if c['id'] in used or c['type'] != o['type'] or not set(c['genres']) & set(o['genres']) or c['id'] == other['id']: continue
        s = c['pop'] * 1.4 - sum(abs(c['scales'].get(k, 0) - o['scales'].get(k, 0)) for k in o['scales']) * 0.4
        if s > bs: best, bs = c, s
    used.add(best['id'])
    return best
CHAINS = []
for a, b in PAIRS:
    ca, cb = [a], [b]
    for _ in range(2): ca.append(similar(ca[-1], b)); cb.append(similar(cb[-1], a))
    CHAINS.append([ca, cb])

def inner(html):   # the screen inside the live page frame
    return html.split('<div class="phone" style="--gacc: #D49B3A;">', 1)[1].rsplit('</div></div></div></div></div></body>', 1)[0]
def meta(t): return f'{t["year"]} · {", ".join(t["creators"])}' if t.get('creators') else str(t['year'])

frag = {}
for i, t in enumerate(CARDS):
    for n in range(i + 1): frag[f'card-{i}-{n}'] = inner(card(t, n, meta(t)))
frag['between-none'] = inner(between('On to the picks.', 'No ratings yet, and that&apos;s fine: the picks work even with titles you haven&apos;t seen.', []))
some = inner(between('@@H@@', 'The picks will do the rest.', [(CARDS[0], 'loved')] * 4, badges=True, label='What you rated'))
i, j = some.index('<div class="brow more">'), some.index('</div><script>', some.index('<div class="brow more">'))
# the row's posters are filled in by the page; keep everything else exactly as built
frag['between-some'] = some[:i] + '<div class="brow">@@ROW@@' + some[j:]
for d in range(MAX_PICKS):
    h = inner(qp(CARDS[0], CARDS[1], d))
    a0, b0 = qside(CARDS[0]), qside(CARDS[1])
    frag[f'pair-{d}'] = h.replace(a0 + b0, '@@DUEL@@').replace('<p>Tap a poster.</p>', '@@SUB@@')
tiles, sides, names = {}, {}, {}
for t in CARDS:
    for r in EMO: tiles[f'{t["id"]}|{r}'] = f'<div class="bw-p">{poster(t, "w185")}<span class="bw-e">{EMO[r]}</span></div>'
for ch in CHAINS:
    for t in ch[0] + ch[1]: sides[t['id']] = qside(t); sides[t['id'] + '|off'] = qside(t, off=True); names[t['id']] = t['title']
data = {'frag': frag, 'tiles': tiles, 'sides': sides, 'names': names, 'cards': [t['id'] for t in CARDS],
        'chains': [[[t['id'] for t in s] for s in ch] for ch in CHAINS], 'maxPicks': MAX_PICKS, 'maxPairs': MAX_PAIRS}

JS = """<script>(function(){
var D=__DATA__, ph=document.querySelector('.phone'), S;
/* Motion (Eran 2026-11-11): one motion for the card and the pair. Only the title moves: poster (+ and share), name, year.
   Top bar, count, question and buttons stay still; the bar slides to its new length.
   The old title leaves while the new one is already arriving (they overlap), so there is never a black frame.
   Depth: old sinks back to 94% with a 6px blur and fades (320 ms); new settles from 105% (4px blur) to 100% (480 ms, starts 90 ms in).
   Flow: old drifts 48px left and fades; new drifts in from 48px right. Reduce motion: crossfade only.
   Flow is the one (Eran, 2026-11-11); Depth stays for comparison: MODE=depth in pack.py, or #depth on play.html.
   This demo plays the motion even when the phone asks for less (Android "Remove animations"), so Eran can judge it;
   the end screen says whether it asked. The real app honours the setting with a plain crossfade (RM). */
var MODE='__MODE__'==='depth'||/depth/.test(location.hash)?'depth':'flow', ASK=matchMedia('(prefers-reduced-motion: reduce)').matches, RM=false, busy=false, KEEP=false;
var EIN='cubic-bezier(.16,1,.3,1)', EOUT='cubic-bezier(.4,0,.2,1)';
// "out" has only an end frame, so it starts from wherever the element is (the picked poster's 103%, the other's dim)
function kf(out){if(RM)return out?[{opacity:0}]:[{opacity:0},{opacity:1}];
  if(MODE==='flow')return out?[{opacity:0,transform:'translateX(-48px)'}]:[{opacity:0,transform:'translateX(48px)'},{opacity:1,transform:'translateX(0)'}];
  return out?[{opacity:0,transform:'scale(.94)',filter:'blur(6px)'}]:[{opacity:0,transform:'scale(1.05)',filter:'blur(4px)'},{opacity:1,transform:'scale(1)',filter:'blur(0px)'}]}
function parts(s,cross,k){
  if(cross)return {els:[].slice.call(s.children).filter(function(e){return !e.classList.contains('apptop')&&e.tagName!=='SCRIPT'}),c:s};
  if(s.querySelector('.learn-poster'))return {els:[].slice.call(s.querySelectorAll('.learn-poster,.learn h2,.lmeta')),c:s.querySelector('.learn-poster'),lag:[0,50,50]};
  var r=k==null?s.querySelector('.duel'):s.querySelectorAll('.duel .side')[k];
  return {els:[].slice.call(r.querySelectorAll('.pick,.rib,.shc')),c:k==null?r:r.querySelector('.poster')}}
function play(p,out){var c=p.c&&p.c.getBoundingClientRect();
  return Promise.all(p.els.map(function(e,i){
    if(c){var b=e.getBoundingClientRect();e.style.transformOrigin=(c.left+c.width/2-b.left)+'px '+(c.top+c.height/2-b.top)+'px'}
    var d=RM?(out?200:260):(out?320:480),dl=out?(p.wait||0):(RM?60:90)+((p.lag&&p.lag[i])||0),a=e.animate(kf(out),{duration:d,easing:out?EOUT:EIN,delay:dl,fill:out?'forwards':'backwards'});
    // never let a paused animation clock (a hidden tab) freeze the taps: move on after its own time anyway
    return Promise.race([a.finished,new Promise(function(r){setTimeout(function(){a.finish();r()},d+dl+80)})])}))}
/* Pick on a pair (Eran 2026-11-11), one smooth motion, about 0.7 s: the other poster slides across to the picked one
   (under it when the left is picked, on top of it when the right is picked) and stops 8px short, so a sliver still
   shows; without stopping, the two then leave the screen to the left together, fading at the very end.
   The names and years fade in the first ~0.2 s, so only the posters stack. The picked poster keeps its gold ring; the
   other one isn't dimmed. The next pair drifts in from the right as the two leave. */
var PEEK=12, SLIDE=600, EXIT_AT=450, EXIT=390, STACK=EXIT_AT+EXIT, NEXT_AT=760;
// Two beats (Eran, 2026-11-11: slower): the slide across (600 ms, easing out), and at 75% of it the exit left
// (390 ms, speeding up; Eran: once the two are together the point is made, so get out fast). The two are added
// together, so the pile never stops. The pile fades over its last fifth; the next pair starts arriving at 0.76 s.
// On the last pick the next screen (and the old question and buttons) wait until the pair is gone.
// The fade is its own animation: added together, a fade does nothing (1 + 0 is still 1), which left the posters
// visible after they left and made them flash on the phone.
function stackOut(s,pk){var sides=[].slice.call(s.querySelectorAll('.duel .side')),L=sides[0].getBoundingClientRect(),R=sides[1].getBoundingClientRect();
  var gap=R.left-L.left-PEEK, exit=L.right+24, all=[];
  sides[pk].style.position='relative';sides[pk].style.zIndex='3';sides[1-pk].style.position='relative';sides[1-pk].style.zIndex='1';
  function wait(a,t){all.push(Promise.race([a.finished,new Promise(function(r){setTimeout(function(){a.finish();r()},t+80)})]))}
  sides.forEach(function(side,i){
    [].slice.call(side.querySelectorAll('.pick,.rib,.shc')).forEach(function(e){
      if(i===1)wait(e.animate([{transform:'translateX(0)'},{transform:'translateX('+(-gap)+'px)'}],{duration:RM?0:SLIDE,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'}),SLIDE);
      wait(e.animate([{transform:'translateX(0)'},{transform:'translateX('+(-exit)+'px)'}],
        {duration:RM?0:EXIT,delay:RM?0:EXIT_AT,easing:'cubic-bezier(.45,0,.75,.4)',fill:'both',composite:'add'}),STACK);
      wait(e.animate([{opacity:1},{offset:.8,opacity:1},{opacity:0}],{duration:RM?0:STACK,fill:'forwards'}),STACK)});
    // the names and years fade early, so they never print over each other while the posters stack
    wait(side.querySelector('.pick').children[1].animate([{opacity:1},{offset:.22,opacity:0},{opacity:0}],{duration:RM?0:STACK,fill:'forwards'}),STACK)});
  return Promise.all(all).then(function(){s.style.display='none'})}   // gone for good, even if the phone ran behind
function go(render,cross,k,hold,pk){if(busy)return;busy=true;setTimeout(function(){
  var old=ph.querySelector('.screen'),op=parts(old,cross,k),ob=old.querySelector('.sb-bar i'),ow=ob&&ob.style.width;
  // lift the old screen out of the page, exactly where it is; only its moving parts stay visible
  var r=old.getBoundingClientRect(),pr=ph.getBoundingClientRect();if(getComputedStyle(ph).position==='static')ph.style.position='relative';
  Object.assign(old.style,{position:'absolute',left:(r.left-pr.left)+'px',top:(r.top-pr.top)+'px',width:r.width+'px',height:r.height+'px',margin:'0',visibility:'hidden',pointerEvents:'none',zIndex:'2'});
  op.els.forEach(function(e){e.style.visibility='visible'});
  KEEP=true;render();KEEP=false;
  var ns=[].slice.call(ph.querySelectorAll('.screen')).pop(),np=parts(ns,cross,k),nb=ns.querySelector('.sb-bar i');
  if(nb&&ow&&!cross&&nb.style.width!==ow)nb.animate([{width:ow},{width:nb.style.width}],{duration:RM?0:480,easing:EIN});
  var sub=ns.querySelector('.prompt p');if(k!=null&&sub)sub.animate([{opacity:0},{opacity:1}],{duration:400,easing:EIN,fill:'backwards'});
  var outs;if(pk!=null){var duel=old.querySelector('.duel');op.els=op.els.filter(function(e){return e!==duel&&!duel.contains(e)}).concat([].slice.call(duel.querySelectorAll('.unseen')));   // the buttons fade with the question
    if(cross){op.wait=STACK-120;np.lag=np.els.map(function(){return STACK-90})}else np.lag=np.els.map(function(){return NEXT_AT-90});
    outs=[stackOut(old,pk),play(op,true)]}else outs=[play(op,true)];
  Promise.all(outs.concat([play(np,false)])).then(function(){old.remove();busy=false})},hold||0)}
function reset(){S={ci:0,rated:[],pi:0,picks:[],pairs:0,lv:[0,0],note:''};showCard()}
function put(h){if(window.__IMG)h=h.replace(/@@IMG(\\d+)@@/g,function(m,i){return window.__IMG[i]});
  if(!KEEP)ph.innerHTML='';var t=document.createElement('div');t.innerHTML=h;
  [].slice.call(t.childNodes).forEach(function(n){ph.appendChild(n);if(n.querySelectorAll)n.querySelectorAll('script').forEach(function(o){var x=document.createElement('script');x.textContent=o.textContent;o.replaceWith(x)})})}
function showCard(){S.phase='card';put(D.frag['card-'+S.ci+'-'+S.rated.length])}
function nextCard(){S.ci++;if(S.ci<D.cards.length)showCard();else showBetween()}
function showBetween(){S.phase='between';var n=S.rated.length;
  if(!n){put(D.frag['between-none']);return}
  var row=S.rated.map(function(r){return D.tiles[r[0]+'|'+r[1]]}).join('');
  put(D.frag['between-some'].replace('@@H@@',n+' rated. That&apos;s fine.').replace('@@ROW@@',row).replace('<div class="brow">','<div class="brow'+(n>3?' more':'')+'">'))}
function chain(){return D.chains[S.pi%D.chains.length]}
function showPair(){S.phase='pair';var c=chain(),off=[S.lv[0]>=2,S.lv[1]>=2];
  var duel=[0,1].map(function(k){var id=c[k][S.lv[k]];return D.sides[id+(off[k]?'|off':'')]}).join('');
  var sub=S.note?'<p class="learned">'+S.note+'</p>':(off[0]&&off[1]?'<p>No more swaps. Go with your gut.</p>':'<p>Tap a poster.</p>');
  put(D.frag['pair-'+S.picks.length].replace('@@DUEL@@',duel).replace('@@SUB@@',sub))}
function pairsOver(){return S.picks.length>=D.maxPicks||S.pairs+1>=D.maxPairs}
function nextPair(){S.pairs++;S.pi++;S.lv=[0,0];S.note='';
  if(S.picks.length>=D.maxPicks||S.pairs>=D.maxPairs)showEnd();else showPair()}
function showEnd(){S.phase='end';var list=S.picks.map(function(id){return D.names[id]}).join(', ');
  put('<div class="screen game-screen"><div class="learn va2 between"><div class="bmid"><h2>End of the demo</h2>'+
  '<p>'+S.picks.length+' picks in '+S.pairs+' pairs'+(list?': '+list+'.':'.')+'</p><p>The closing screen is the next thing we design.</p>'+
  '<p>Motion: '+(MODE==='flow'?'Flow':'Depth')+'. '+(ASK?'Your phone asks for less motion (Remove animations is on); this demo plays it anyway.':'Your phone doesn&apos;t ask for less motion.')+'</p></div>'+
  '<button class="cta">Play again</button></div></div>')}
ph.addEventListener('click',function(e){var b=e.target.closest('button');if(!b||b.disabled||busy)return;
  if(S.phase==='card'){var id=D.cards[S.ci],last=S.ci+1>=D.cards.length;
    if(b.classList.contains('ltile')){S.rated.push([id,b.lastElementChild.textContent.trim().toLowerCase()]);go(nextCard,last)}
    else if(b.classList.contains('unseen'))go(nextCard,last)}
  else if(S.phase==='between'){if(b.classList.contains('cta'))go(showPair,true)}
  else if(S.phase==='pair'){var sides=[].slice.call(ph.querySelectorAll('.ob-pair .side'));
    if(b.classList.contains('pick')){var k=sides.indexOf(b.closest('.side'));S.picks.push(chain()[k][S.lv[k]]);
      b.classList.add('chosen');go(nextPair,pairsOver(),null,0,k)}
    else if(b.classList.contains('unseen')){var k=sides.indexOf(b.closest('.side'));
      go(function(){S.lv[k]++;S.note=S.lv[k]===1?'Swapped in something similar.':'Swapped again: the last swap on this side.';
        if(S.lv[0]>=2&&S.lv[1]>=2)S.note='';showPair()},false,k)}
    else if(b.classList.contains('ghost'))go(nextPair,pairsOver())}
  else if(S.phase==='end'){if(b.classList.contains('cta'))go(reset,true)}});
reset()})()</script>"""

# start from the first card's full page, then let the script take over the .phone
html = card(CARDS[0], 0, meta(CARDS[0]))
html = html.replace('</body>', JS.replace('__DATA__', json.dumps(data).replace('</', '<\\/')) + '</body>')
(HERE / 'play.html').write_text(html)
print('play.html', len(html) // 1024, 'KB ·', ' / '.join(f'{c[0][0]["title"]} → {c[0][1]["title"]} → {c[0][2]["title"]}' for c in CHAINS[:2]))
