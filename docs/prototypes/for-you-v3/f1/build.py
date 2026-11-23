"""F1 · The 20, with Refresh (issue #349, FOR-YOU.md DEC-1–3): the states the approved JPEGs don't show.

Approved already: 9-refresh-at-the-end.jpg (the end card, chat on) and 10-refresh-at-the-top.jpg (the top line, before and
after Refresh). Their CSS and markup are copied below exactly as the approved mocks drew them
(docs/prototypes/for-you-shelf/build.py, kept on Eran's machine: .mk-top, .mk-btns, .mk-dark, REFRESH, topLine(),
refreshEnd()). Everything else is the app's own: the real feed capture (docs/prototypes/nav/cap-feed.html, the running app
with the test account, out of git) through the Watchlist's mock library (docs/prototypes/watchlist-v3/build.py, read, not
changed), F3's Hide pill as shipped, and today's first-load state (.initialLoading, FingerprintLoader) and error line
(.error) from RecommendationsView.module.css.
Run: python3 build.py && python3 render.py"""
import pathlib
HERE = pathlib.Path(__file__).parent.resolve()
WL = HERE.parent.parent / 'watchlist-v3' / 'build.py'
src = WL.read_text()
lib = {'__file__': str(WL)}
exec(src[:src.index('\nSTATES = {')], lib)          # the Watchlist's CSS, bar(), JS_LIB, without its writer
SRC, CSS, JS_LIB, P = lib['SRC'], lib['CSS'], lib['JS_LIB'], lib['P']
WATCHLIST_COUNT = 4                                 # as in the approved 9 and 10
FP = 'FingerprintLoader-module__MAfjZW__'

EYEOFF = ('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>'
          '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 '
          '10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>')
REFRESH = ('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
           '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>')
# src/modules/session/components/FingerprintLoader.tsx, as shipped
RIDGES = [
 "M 38.7 76.7 L 36.4 75.6 L 34.2 74.3 L 32.1 72.8 L 30.2 71.2 L 28.4 69.3 L 26.8 67.4 L 25.3 65.2 L 24.1 63.0 L 23.0 60.7 L 22.2 58.3 L 21.6 55.8 L 21.2 53.3 L 21.0 50.7 L 21.1 48.2 L 21.3 45.7 L 21.8 43.2 L 22.5 40.7 L 23.4 38.3 L 24.6 36.0 L 25.9 33.9 L 27.4 31.8 L 29.1 29.9 L 30.9 28.1 L 32.9 26.6 L 35.1 25.1 L 37.3 23.9 L 39.6 22.9 L 42.1 22.1 L 44.5 21.5 L 47.1 21.1 L 49.6 21.0 L 52.2 21.1 L 54.7 21.4 L 57.2 21.9 L 59.6 22.6 L 62.0 23.6 L 64.3 24.8 L 66.4 26.1 L 68.5 27.6 L 70.4 29.4 L 72.1 31.2 L 73.7 33.2 L 75.0 35.4 L 76.2 37.6 L 77.2 40.0 L 78.0 42.4 L 78.5 44.9 L 78.9 47.4 L 79.0 50.0 L 78.9 52.5 L 77.6 54.9 L 76.2 57.0 L 74.6 58.9 L 72.8 60.6 L 71.0 62.1 L 69.1 63.4 L 67.1 64.4 L 65.1 65.1 L 63.1 65.7 L 61.2 66.0",
 "M 31.1 52.3 L 31.0 54.1 L 31.1 55.9 L 31.3 57.7 L 31.7 59.5 L 32.3 61.4 L 33.1 63.1 L 34.1 64.9 L 35.2 66.5 L 36.5 68.1 L 38.0 69.6 L 39.6 71.0 L 41.4 72.2 L 43.3 73.3 L 45.3 74.2 L 47.5 74.9 L 49.7 75.4 L 52.0 75.7 L 54.4 75.8 L 56.8 75.7 L 59.2 75.4",
 "M 33.1 45.8 L 33.6 44.3 L 34.3 43.0 L 35.0 41.6 L 35.9 40.4 L 36.9 39.2 L 37.9 38.2 L 39.1 37.2 L 40.3 36.3 L 41.6 35.6 L 42.9 35.0 L 44.3 34.5 L 45.7 34.1 L 47.1 33.9 L 48.6 33.8 L 50.0 33.8 L 51.4 33.9 L 52.8 34.1 L 54.2 34.4 L 55.5 34.8 L 56.8 35.4 L 58.0 36.1 L 59.2 36.8 L 60.3 37.7 L 61.3 38.7 L 62.3 39.7 L 63.1 40.8 L 63.8 42.0 L 64.5 43.3 L 65.0 44.5 L 65.4 45.9 L 65.7 47.2 L 65.8 48.6 L 65.9 50.0 L 65.8 51.4 L 65.6 52.7 L 65.3 54.1 L 64.8 55.4 L 64.2 56.6 L 63.4 57.7 L 62.6 58.8 L 61.6 59.8 L 60.6 60.6 L 59.6 61.4 L 58.5 62.1 L 57.3 62.6 L 56.1 63.1 L 54.9 63.4 L 53.7 63.6 L 52.4 63.8 L 51.2 63.8 L 50.0 63.7 L 48.8 63.5 L 47.7 63.2 L 46.6 62.8 L 45.5 62.3 L 44.5 61.7 L 43.6 61.0 L 42.8 60.3 L 42.0 59.5 L 41.3 58.7 L 40.7 57.8 L 40.2 56.9 L 39.7 55.9 L 39.4 54.9 L 39.2 53.9 L 39.0 52.9 L 38.9 52.0 L 39.0 51.0 L 39.1 50.0 L 39.3 49.1 L 39.5 48.2 L 39.9 47.3 L 40.3 46.5 L 40.8 45.7 L 41.3 45.0 L 41.9 44.3 L 42.6 43.8 L 43.2 43.2 L 44.0 42.8 L 44.7 42.4 L 45.4 42.1 L 46.2 41.9 L 47.0 41.7 L 47.8 41.7 L 48.5 41.6 L 49.3 41.7 L 50.0 41.8 L 50.7 42.0 L 51.4 42.2 L 52.0 42.5 L 52.6 42.9 L 53.1 43.3 L 53.6 43.7 L 54.1 44.2 L 54.5 44.7 L 54.8 45.2 L 55.1 45.7 L 55.3 46.3 L 55.5 46.8 L 55.6 47.4 L 55.7 47.9 L 55.7 48.5 L 55.7 49.0 L 55.6 49.5 L 55.4 50.0 L 55.3 50.5 L 55.1 50.9 L 54.8 51.3 L 54.5 51.7 L 54.2 52.0 L 53.9 52.3 L 53.6 52.5 L 53.2 52.7 L 52.9 52.9 L 52.5 53.0 L 52.2 53.1 L 51.8 53.1 L 51.5 53.1 L 51.1 53.1 L 50.8 53.1 L 50.5 53.0 L 50.2 52.8 L 50.0 52.7 L 49.8 52.5 L 49.6 52.4",
]
LOADER = ('<div class="%sloader" style="--fp-size:66px;--fp-color:#ffffff"><svg viewBox="0 0 100 100"><g class="%strack">%s</g>'
          '<g class="%slive">%s</g></svg></div>') % (FP, FP, ''.join(f'<path d="{d}"/>' for d in RIDGES), FP,
                                                     ''.join(f'<path pathLength="1" d="{d}"/>' for d in RIDGES))

CSS_F1 = """
/* the approved mocks' end card and top line (for-you-shelf/build.py), unchanged */
.mk-top{display:flex;align-items:center;justify-content:space-between;flex-shrink:0;padding:0 4px 0 6px;margin-bottom:-4px}
.mk-top span{color:var(--rv-white-70);font:500 13.5px/1 Inter,system-ui,sans-serif}
.mk-top button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:10px 0;color:var(--rv-yellow);font:600 14.5px/1 Inter,system-ui,sans-serif}
.mk-top svg,.mk-ic{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mk-btns .mk-ic{width:18px;height:18px;stroke-width:2}
/* F3's Hide, as shipped (.wantHide) */
.mk-hide{flex:0 0 auto;height:50px;padding:0 18px;border:0;border-radius:999px;background:var(--rv-white-10);color:var(--rv-white-70);
  display:inline-flex;align-items:center;gap:7px;font:500 15px/1 Inter,system-ui,sans-serif}
.mk-hide svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
/* PROPOSED: Refresh failed — the top line's words in today's error line colour (.error, #ff8b8b) */
.mk-top span.mk-err{color:#ff8b8b}
/* the loader, held at one frame (the app animates it) */
.%(fp)slive path{animation:none!important;stroke-dashoffset:.35!important;opacity:1!important}
""".replace('%(p)s', P).replace('%(fp)s', FP)

JS_F1 = r"""
const REFRESH='%(refresh)s';
function hideBtn(a){const x=q(a,'wantX');if(!x)return;const b=document.createElement('button');b.className='mk-hide';
  b.innerHTML='<svg viewBox="0 0 24 24">%(eyeoff)s</svg>Hide';x.replaceWith(b);}
A().forEach(hideBtn);
function topLine(err){const d=document.createElement('div');d.className='mk-top';
  d.innerHTML=(err?'<span class="mk-err">Couldn’t refresh right now</span>':'<span>Your 20 picks</span>')+'<button><svg viewBox="0 0 24 24">'+REFRESH+'</svg>Refresh</button>';L.prepend(d);}
const chatSvg=()=>document.querySelector('button[aria-label="Ask WTW"] svg').innerHTML;
function card(html){const d=document.createElement('div');d.className=P+'card '+P+'nudge';d.innerHTML=html;return d;}
// the approved end card; chat=false is PROPOSED: Refresh alone, the text's first sentence alone
function refreshEnd(chat){return card('<span class="'+P+'nudgeEyebrow">That’s your 20 picks</span><p class="'+P+'nudgeText">'+
  (chat?'Want 20 fresh ones? Or tell me what you’re in the mood for, and I’ll look for it.':'Want 20 fresh ones?')+'</p><div class="mk-btns">'+
  '<button type="button" class="'+P+'watchlistBtn '+P+'watchlistBtnPrimary"><svg class="mk-ic" viewBox="0 0 24 24">'+REFRESH+'</svg>Refresh</button>'+
  (chat?'<button type="button" class="mk-dark"><svg viewBox="0 0 24 24">'+chatSvg()+'</svg>Tell me what you want</button>':'')+'</div>');}
// PROPOSED: Refresh in progress = today's first-load state, in the list's place (header and tab bar stay)
function loading(){const d=document.createElement('div');d.className=P+'initialLoading';
  d.innerHTML='<span class="'+P+'loadingEyebrow">Reading your fingerprint</span><span class="'+P+'loadingTitle">Finding matches</span>%(loader)s';
  L.replaceWith(d);}
""".replace('%(refresh)s', REFRESH).replace('%(eyeoff)s', EYEOFF).replace('%(loader)s', LOADER.replace("'", "\\'"))

STATES = {
  'a-end-chat':   "T('Kill Bill').after(refreshEnd(true));L.scrollTop=L.scrollHeight;",
  'b-end-nochat': "T('Kill Bill').after(refreshEnd(false));L.scrollTop=L.scrollHeight;",
  'c-loading':    "loading();",
  'd-failed':     "topLine(true);L.scrollTop=0;",
  'e-before':     "topLine(false);L.scrollTop=0;",
}

for key, js in STATES.items():
    script = f'<script>setTimeout(()=>{{{JS_LIB}\n{JS_F1}\n{js}}},300)</script>'
    html = SRC.replace('</head>', f'<style>{CSS}{CSS_F1}</style></head>', 1).replace('</body>', lib['bar'](WATCHLIST_COUNT, 'foryou') + script + '</body>', 1)
    (HERE / f'{key}.html').write_text(html)
    print(key)
