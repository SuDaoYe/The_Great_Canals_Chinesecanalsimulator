"""Fetch public-domain Natural Earth geometry, retain hashes, and extract an Asia view."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'raw/geography'
RAW.mkdir(parents=True,exist_ok=True)
BASE='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
NAMES=['ne_50m_land.geojson','ne_50m_rivers_lake_centerlines.geojson','ne_50m_admin_0_countries.geojson']
def get(name):
    p=RAW/name
    if not p.exists():
        req=urllib.request.Request(BASE+name,headers={'User-Agent':'GrandCanalAtlasResearch/1.0'})
        with urllib.request.urlopen(req,timeout=45) as response: content=response.read()
        json.loads(content)
        p.write_bytes(content)
    return name,p.read_bytes()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: items=list(pool.map(get,NAMES))

def points(coords):
    if coords and isinstance(coords[0],(int,float)):yield coords
    else:
        for c in coords:yield from points(c)
def in_view(geometry):
    return any(68<=p[0]<=140 and 12<=p[1]<=57 for p in points(geometry['coordinates']))
def rounded(value):
    if isinstance(value,list):return [rounded(v) for v in value]
    if isinstance(value,float):return round(value,4)
    return value
land=json.loads(items[0][1])
rivers=json.loads(items[1][1])
lands=[dict(type=f['geometry']['type'],coordinates=rounded(f['geometry']['coordinates'])) for f in land['features'] if in_view(f['geometry'])]
rs=[]
for f in rivers['features']:
    p=f['properties']
    # Keep natural rivers only. Do not disguise modern canals as natural historical watercourses.
    if in_view(f['geometry']) and 'canal' not in str(p.get('featurecla','')).lower():
        rs.append(dict(name=p.get('name') or '',rank=p.get('scalerank',5),geometry=dict(type=f['geometry']['type'],coordinates=rounded(f['geometry']['coordinates']))))
countries=json.loads(items[2][1])
locator=[]
for f in countries['features']:
    if f['properties'].get('ADM0_A3') in ['CHN','TWN']:
        locator.append(dict(type=f['geometry']['type'],coordinates=rounded(f['geometry']['coordinates'])))
data=dict(land=lands,locator=locator,rivers=rs,credit='Made with Natural Earth. Public domain. Modern geographic reference; not ancient rivers.',
          source=BASE,accessed='2026-11-02',projection='WGS84 longitude/latitude; local equirectangular display scaled at 35°N')
(ROOT/'dist/assets/geography.js').write_text('window.ATLAS_GEO = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
manifest=[dict(file='raw/geography/'+n,url=BASE+n,sha256=hashlib.sha256(b).hexdigest(),bytes=len(b),license='Public domain',accessed='2026-11-02') for n,b in items]
(ROOT/'data/geography-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Prepared {len(lands)} land geometries, {len(rs)} natural river features; '+str((ROOT/'dist/assets/geography.js').stat().st_size)+' browser bytes.')
