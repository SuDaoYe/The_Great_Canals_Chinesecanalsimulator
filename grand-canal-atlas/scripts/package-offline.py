"""Package a single local HTML file without fetch, modules, CDN, or sibling dependencies."""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
dist=ROOT/'dist'
html=(dist/'index.html').read_text(encoding='utf-8')
css=(dist/'assets/style.css').read_text(encoding='utf-8')
html=html.replace('<link rel="stylesheet" href="assets/style.css">','<style>\n'+css+'\n</style>')
scripts=[]
for name in ['data.js','geography.js','core.js','app.js']:
    tag=f'<script defer src="assets/{name}"></script>'
    assert tag in html,name+' missing from HTML'
    html=html.replace(tag,'')
    content=(dist/'assets'/name).read_text(encoding='utf-8')
    content=re.sub('</script',r'<\\/script',content,flags=re.I)
    scripts.append('<script>\n'+content+'\n</script>')
html=html.replace('href="./index.html"','href="大运河历史地图.html"')
html=html.replace('</body>','\n'.join(scripts)+'\n</body>')
target=ROOT/'大运河历史地图.html'
target.write_text(html,encoding='utf-8')
assert not re.search(r'<script[^>]+src=',html), 'Offline HTML must have no external scripts'
assert '<link rel="stylesheet"' not in html, 'Offline HTML must have no external stylesheet'
print(f'Packaged standalone HTML: {target.name} ({target.stat().st_size:,} bytes).')
