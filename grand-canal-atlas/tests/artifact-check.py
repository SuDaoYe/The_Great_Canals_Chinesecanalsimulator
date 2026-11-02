"""Verify standalone delivery and exported SVG without needing browser file:// access."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
class BundleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts=[]
        self.in_script=False
        self.external=[]
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if tag=='script':
            if 'src' in values:self.external.append(values['src'])
            self.scripts.append('')
            self.in_script=True
        if tag=='link' and values.get('rel')=='stylesheet':self.external.append(values.get('href'))
    def handle_endtag(self,tag):
        if tag=='script':self.in_script=False
    def handle_data(self,data):
        if self.in_script:self.scripts[-1]+=data

p=BundleParser()
p.feed((ROOT/'大运河历史地图.html').read_text(encoding='utf-8'))
assert len(p.scripts)==4 and not p.external, 'Standalone HTML must contain four inline scripts and no external dependencies'
for script in p.scripts:
    result=subprocess.run(['node','--check'],input=script.encode('utf-8'),capture_output=True)
    assert result.returncode==0,result.stderr.decode('utf-8','replace')
ns={'s':'http://www.w3.org/2000/svg'}
svg=ET.parse(ROOT/'exports/历代运河叠加总图.svg').getroot()
assert len(svg.findall('.//s:g[@data-canal]',ns))==29
assert not svg.findall('.//s:image',ns), 'SVG must not depend on external images'
assert (ROOT/'exports/历代叠加-网页预览.png').stat().st_size>10000
print('PASS: standalone HTML dependencies, four inline script syntax checks, valid SVG with 29 engineering records, and preview PNG.')
