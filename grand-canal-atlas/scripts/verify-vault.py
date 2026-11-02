"""Check evidence links, immutable note hashes, geographic provenance, and verbatim primary excerpts."""
import hashlib
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'data/atlas.json').read_text(encoding='utf-8'))
manifest=json.loads((ROOT/'data/source-manifest.json').read_text(encoding='utf-8'))
for item in manifest:
    assert hashlib.sha256((ROOT/item['file']).read_bytes()).hexdigest()==item['sha256'],item['id']+' raw drift'
    if 'excerpt' in item:assert hashlib.sha256((ROOT/item['excerpt']).read_bytes()).hexdigest()==item['excerptSha256'],item['id']+' excerpt drift'
for item in json.loads((ROOT/'data/geography-manifest.json').read_text(encoding='utf-8')):
    assert hashlib.sha256((ROOT/item['file']).read_bytes()).hexdigest()==item['sha256'],item['file']+' drift'
for p in list((ROOT/'wiki').glob('*.md'))+[ROOT/'index.md',ROOT/'README.md']:
    text=p.read_text(encoding='utf-8')
    for link in re.findall(r'\]\(([^)]+)\)',text):
        if not link.startswith(('http','mailto:','#')):assert (p.parent/link).exists(),str(p)+': '+link+' missing'
    if p.parent.name=='wiki':assert '> Raw:' in text and '> Status:' in text,p.name+' missing provenance header'
count=0
for canal in data['canals']:
    for m in canal['metrics']:
        if m['raw']:
            p=ROOT/'raw'/f'{m["source"]}-excerpts.md'
            assert p.exists(),m['source']+' missing primary excerpt'
            assert m['raw'] in p.read_text(encoding='utf-8'),m['source']+' quotation mismatch: '+m['raw']
            count+=1
print(f'PASS: {len(manifest)} source hashes, geography hashes, local document links, provenance headers and {count} verbatim primary-evidence excerpts.')
