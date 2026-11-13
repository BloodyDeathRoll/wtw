"""Packs play.html into one self-contained page for a private Artifact link (Eran plays it on his phone).
Artifacts load nothing from other hosts except Google Fonts, so the app CSS, the background, the logo and every
poster are inlined; Inter and Bebas Neue come from Google Fonts under the same names the app CSS uses.
Out: play-artifact.html, or with MODE=flow play-artifact-flow.html (scratch output, safe to delete; rebuild with `python3 play.py && python3 pack.py`)."""
import base64, json, os, re, urllib.request, pathlib
MODE = os.environ.get('MODE', 'flow')   # the motion; a link's #flow doesn't reach the page on the phone
HERE = pathlib.Path(__file__).parent; ROOT = HERE.parent.parent.parent
html = (HERE / 'play.html').read_text().replace('__MODE__', MODE)
def small(b):   # re-save the poster at quality 72: same pixels size, about half the bytes
    from PIL import Image
    import io
    o = io.BytesIO(); Image.open(io.BytesIO(b)).convert('RGB').save(o, 'JPEG', quality=72, optimize=True, progressive=True); return o.getvalue()
uri = lambda b, mt: f'data:{mt};base64,' + base64.b64encode(b).decode()

css = ''.join((HERE / f'live/c{i}.css').read_text() for i in range(1, 5)) + (HERE / 'fr.css').read_text()
css = re.sub(r'@font-face\s*\{[^}]*\.\./media/[^}]*\}', '', css)            # next/font files aren't in the repo
css = css.replace('url("../../../../public/wtw-bg.svg")', 'url("' + uri((ROOT / 'public/wtw-bg.svg').read_bytes(), 'image/svg+xml') + '")')
html = html.replace('../../../public/logo_vector.svg', uri((ROOT / 'public/logo_vector.svg').read_bytes(), 'image/svg+xml'))   # in the markup and in the screens' data
# each poster once: the screens in the page's data point at it by number (@@IMGn@@), the first card's markup gets it inline
k = html.index('<script>(function(){\nvar D=')
page, data = html[:k], html[k:]
imgs = []
for u in sorted(set(re.findall(r'https://image\.tmdb\.org/t/p/w\d+/[\w.-]+', html))):
    d = uri(small(urllib.request.urlopen(u, timeout=20).read()), 'image/jpeg')
    page = page.replace(u, d)
    if u in data: data = data.replace(u, f'@@IMG{len(imgs)}@@'); imgs.append(d)
html = page + '<script>window.__IMG=' + json.dumps(imgs) + '</script>' + data

head, body = html.split('</head>', 1)
body_tag = re.match(r'\s*<body class="([^"]*)">', body)
inner = body[body_tag.end():].rsplit('</body>', 1)[0]
out = (f'<title>WTW First Run{" Flow" if MODE == "flow" else ""}</title>\n'
       '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bebas+Neue&display=swap">\n'
       f'<style>{css}\nhtml,body{{background:#000;color-scheme:dark}}</style>\n'
       f'<div class="{body_tag.group(1)}">{inner}</div>\n')
name = 'play-artifact-flow.html' if MODE == 'flow' else 'play-artifact.html'
(HERE / name).write_text(out)
print(name, len(out) // 1024, 'KB', '· left outside:', sorted(set(re.findall(r'(?:src|href)="(https?://[^"]+)"', out)))[:3])
