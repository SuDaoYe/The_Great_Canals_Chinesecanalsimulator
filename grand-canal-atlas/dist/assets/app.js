(function () {
  'use strict';
  const D = window.ATLAS_DATA, G = window.ATLAS_GEO, C = window.AtlasCore;
  const $ = id => document.getElementById(id);
  if (!D || !G || !C) {
    $('detail-content').textContent = '地图资料未载入。请保留 assets 文件夹与 index.html 的相对位置，然后重新打开。';
    return;
  }
  const sourceById = new Map(D.sources.map(s=>[s.id,s]));
  const eraById = new Map(D.eras.map(e=>[e.id,e]));
  const state = {era:'sui',mode:'network',onlyNew:false,query:'',selected:'tongji',view:'corridor'};
  let view = [500,245,255,230], toastTimer, dragging = null, moved = false;
  const fullView = [0,0,1000,720], corridorView = [500,245,255,230];
  const svg = $('atlas-map'), dialog = $('info-dialog');
  let returnFocus = null;
  const esc = value => String(value).replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  function element(tag, attrs={}, parent) {
    const el = document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
    if(parent) parent.appendChild(el);
    return el;
  }
  function geometryPath(g) {
    const ring = r => C.linePath(r)+'Z';
    if(g.type==='Polygon') return g.coordinates.map(ring).join(' ');
    if(g.type==='MultiPolygon') return g.coordinates.map(p=>p.map(ring).join(' ')).join(' ');
    if(g.type==='LineString') return C.linePath(g.coordinates);
    if(g.type==='MultiLineString') return g.coordinates.map(C.linePath).join(' ');
    return '';
  }
  function mapText(parent,text,coord,cls,extra={}) {
    const [x,y]=C.project(coord);
    const t=element('text',{x,y,class:cls,...extra},parent);t.textContent=text;return t;
  }
  function prepareBase() {
    for(const g of G.land) element('path',{d:geometryPath(g),class:'land','fill-rule':'evenodd'},$('land-layer'));
    for(const g of G.locator || []) element('path',{d:geometryPath(g),class:'locator','fill-rule':'evenodd'},$('locator-layer'));
    for(let lon=80;lon<=130;lon+=10) element('path',{d:C.linePath([[lon,15],[lon,56]]),class:'gridline'},$('graticule-layer'));
    for(let lat=20;lat<=50;lat+=10) element('path',{d:C.linePath([[72,lat],[138,lat]]),class:'gridline'},$('graticule-layer'));
    for(const r of G.rivers) {
      const line=element('path',{d:geometryPath(r.geometry),class:'river','stroke-width':r.rank<=2?1.5:.8},$('natural-layer'));
      const title=element('title',{},line);title.textContent=(r.name||'天然河流')+' · 现代河道参照';
    }
    // Supplements are teaching schematics, not Natural Earth measured features.
    const supplements=[
      ['淮河',[[113.3,32.45],[114.4,32.35],[115.4,32.6],[116.6,32.66],[117.7,32.85],[118.5,33.3],[119.0,33.6]]],
      ['渭河',[[104.6,35.2],[105.6,34.65],[106.7,34.4],[107.6,34.4],[108.7,34.35],[109.8,34.55],[110.3,34.6]]],
      ['湘江',[[110.7,25.7],[111.1,26.5],[112.2,27],[112.9,27.8],[113,28.3],[112.8,29.1]]],
      ['钱塘江',[[118.5,29.6],[119.4,29.5],[119.9,30],[120.2,30.2],[120.7,30.25],[121.25,30.35]]]
    ];
    for(const [name,coords] of supplements) {
      const p=element('path',{d:C.linePath(coords),class:'river','stroke-width':1.1,'stroke-dasharray':'2 2'},$('natural-layer'));
      element('title',{},p).textContent=name+' · 补充位置示意，非测绘';
    }
    const labels=[['黄河（现代参照）',[111.1,35.6]],['长江',[115.8,30.3]],['淮河（示意）',[116,32.4]],['渭河（示意）',[108.3,34.7]],['湘江（示意）',[111.7,27.5]],['钱塘江（示意）',[119.6,29.8]]];
    for(const [t,p] of labels)mapText($('natural-layer'),t,p,'river-label');
    [['青藏高原',[89,32]],['四川盆地',[104,30]],['关中',[108.5,35.7]],['华北平原',[115,38.6]],['江南',[119.1,29.5]],['岭南',[111,23.5]]].forEach(([t,p])=>mapText($('terrain-labels'),t,p,'terrain-text'));
    [['渤海',[119.6,38.5]],['黄海',[123,35]],['东海',[125,28]],['南海',[114,19]],['台湾',[121,23.5]]].forEach(([t,p])=>mapText($('terrain-labels'),t,p,'sea-text'));
  }
  const historicalRoutes={
    north:[[113.4,34.9],[114.1,35.5],[114.7,35.9],[115.4,36.3],[116.2,36.9],[117.2,37.5],[118.1,38]],
    south:[[113.4,34.9],[114.3,34.9],[115.5,34.7],[116.6,34.5],[117.3,34.3],[118.1,34.0],[118.9,33.6],[119.7,33.8],[120.3,34.15]],
    modern:[[113.4,34.9],[114.4,35.0],[115.2,35.6],[116.1,36.3],[117.0,36.7],[117.8,37.2],[118.5,37.7],[119.1,37.8]]
  };
  function renderHistoric() {
    const layer=$('historic-layer');layer.replaceChildren();
    const era=eraById.get(state.era);
    let keys=state.mode==='all'?['north','south','modern']:era.id==='modern'?['modern']:era.id==='qing'?['south','modern']:era.start>=1127?['south']:['north'];
    const names={north:'1128年前北流方向（多次迁徙）',south:'1128／1194—1855年南流方向',modern:'1855年后北徙方向（后世亦有决徙）'};
    keys.forEach((k,i)=>{
      const path=element('path',{d:C.linePath(historicalRoutes[k]),class:'historic-river',opacity:keys.length>1?.7:1,'stroke-dasharray':k==='modern'?'2 4':'7 4'},layer);
      element('title',{},path).textContent=names[k]+'；时期示意，不是唯一固定河槽。来源S25。';
      const pos=k==='south'?[118.1,34.8]:k==='north'?[115.2,37.4]:[117.4,38.1];
      mapText(layer,k==='south'?'黄河夺淮方向（示意）':k==='north'?'古黄河北流方向（示意）':'1855北徙方向（示意）',pos,'river-label',{fill:'#987637','font-size':4.6});
    });
    layer.hidden=!$('layer-historic').checked;
    layer.style.display=$('layer-historic').checked?'':'none';
  }
  const capitalForEra={early:'扬州',qin:'长安／西安',han:'长安／西安',division:null,sui:'洛阳',tang:'长安／西安','north-song':'汴京／开封','south-song':'临安／杭州',yuan:'大都／北京',ming:'大都／北京',qing:'大都／北京',modern:null};
  const labelOffsets={
    '大都／北京':[-4,-7],'通州':[6,2],'南旺':[-24,3],'济宁':[5,5],'淮安／清口':[-36,-4],
    '扬州':[-20,-3],'镇江':[5,7],'绍兴':[-11,10],'宁波':[5,3],'汴京／开封':[5,-5],
    '临安／杭州':[-32,0],'苏州':[5,2],'长安／西安':[-8,9],'徐州':[-20,7],'临清':[-20,-5]
  };
  function renderCities() {
    const layer=$('cities-layer');layer.replaceChildren();
    const major=new Set(['长安／西安','大都／北京','汴京／开封','扬州','临安／杭州','兴安／灵渠']);
    const rect=svg.getBoundingClientRect();
    const scale=Math.max(.2,Math.min(rect.width/view[2],rect.height/view[3]));
    for(const city of D.cities) {
      if(view[2]>650 && !major.has(city.name))continue;
      const pos=C.project([city.lon,city.lat]);
      const g=element('g',{},layer);
      const capital=state.mode!=='all' && capitalForEra[state.era]===city.name;
      // The early-period highlight is a canal origin, not a claim that Yangzhou was the Wu capital.
      const isCapital=capital && state.era!=='early';
      element('circle',{cx:pos[0],cy:pos[1],r:(isCapital?3:2)/scale,class:isCapital?'city-capital':'city-circle'},g);
      const off=labelOffsets[city.name]||[5,-4];
      const label=element('text',{x:pos[0]+off[0]/scale,y:pos[1]+off[1]/scale,class:'city-label'+(isCapital?' major':''),style:`font-size:${(isCapital?11.5:9.5)/scale}px`},g);
      label.textContent=city.name;
      element('title',{},g).textContent=city.name+' · 现代城市位置参照；同名古城可能迁址';
    }
  }
  function filtered() {
    const base=C.visibleCanals(D,state.era,state.mode==='all'?'all':state.onlyNew?'new':'network');
    const q=state.query.trim().toLocaleLowerCase();
    return q?base.filter(c=>[c.name,c.basins,c.politics,c.dateLabel,eraById.get(c.era).name].join(' ').toLocaleLowerCase().includes(q)):base;
  }
  function renderCanals(list) {
    const layer=$('canals-layer');layer.replaceChildren();
    const sorted=[...list].sort((a,b)=>Number(a.id===state.selected)-Number(b.id===state.selected));
    for(const c of sorted) {
      const color=eraById.get(c.era).color;
      const inherited=state.mode!=='all' && c.era!==state.era;
      const selected=c.id===state.selected;
      const group=element('g',{'class':'canal-group','data-canal':c.id,style:`--route:${color}`},layer);
      const d=C.linePath(c.coords);
      if(!inherited||selected)element('path',{d,class:'canal-halo'},group);
      element('path',{d,class:'canal-line'+(inherited?' inherited':'')+(selected?' selected':'')},group);
      const hit=element('path',{d,class:'canal-hit'},group);
      element('title',{},hit).textContent=`${c.name} · ${c.dateLabel} · ${c.kind}（线路示意）`;
      hit.addEventListener('click',()=>{if(!moved)selectCanal(c.id,false);});
      if(selected){
        const p=C.project(c.coords[Math.floor(c.coords.length/2)]);
        element('circle',{cx:p[0],cy:p[1],r:2.4,class:'selected-pin'},group);
      }
    }
    layer.style.display=$('layer-canals').checked?'':'none';
  }
  function renderList(list) {
    const box=$('route-list');box.replaceChildren();
    $('route-count').textContent=`${list.length} 项`;
    for(const c of list){
      const b=document.createElement('button');b.className='route-item'+(c.id===state.selected?' active':'');
      b.style.setProperty('--route',eraById.get(c.era).color);b.setAttribute('aria-pressed',String(c.id===state.selected));
      b.innerHTML=`<span class="route-dot" aria-hidden="true"></span><span><strong>${esc(c.name)}</strong><small>${esc(eraById.get(c.era).name)} · ${esc(c.kind)}</small></span>`;
      b.addEventListener('click',()=>selectCanal(c.id,true));box.append(b);
    }
    if(!list.length){
      const p=document.createElement('p');p.className='route-empty';p.textContent='本期没有符合条件的水道。可清空搜索，或在历代水道中查找。';box.append(p);
      if(state.mode!=='all'){
        const b=document.createElement('button');b.className='route-item';b.textContent='在历代水道中查找';b.addEventListener('click',()=>setMode('all'));box.append(b);
      }
    }
  }
  function metricHTML(m){
    const value=typeof m.value==='number'?m.value.toLocaleString('zh-CN'):m.value;
    return `<div class="metric"><div class="metric-head"><span>${esc(m.label)}</span><strong>${esc(value)}<small>${esc(m.unit)}</small></strong></div><p>${esc(m.scope)}</p><details><summary>口径与证据 · ${esc(m.source)}</summary><p>${esc(m.caveat)}</p>${m.raw?`<blockquote>${esc(m.raw)}</blockquote>`:''}<button class="source-link" data-source="${esc(m.source)}">查看来源与核读范围</button></details></div>`;
  }
  function renderDetail(){
    const c=D.canals.find(c=>c.id===state.selected), box=$('detail-content');
    if(!c){box.innerHTML='<div class="detail-eyebrow">工程档案</div><h2>循水寻迹</h2><p>当前筛选没有匹配条目。清空搜索或切换时代，查看工程与史料。</p>';return;}
    box.innerHTML=`<div class="detail-eyebrow"><span>卷二 · 工程档案</span><button id="locate-detail">定位水道</button></div>
      <h2>${esc(c.name)}</h2><p class="detail-date">${esc(c.dateLabel)}</p>
      <div class="detail-badges"><span>${esc(eraById.get(c.era).name)}</span><span>${esc(c.kind)}</span><span>路线示意</span></div>
      <p class="detail-water">${esc(c.basins)}</p>
      <section class="detail-section"><h3>为何营建</h3><p>${esc(c.politics)}</p><h3>改变了什么</h3><p>${esc(c.impact)}</p></section>
      <section class="detail-section"><h3>工程代价与数量</h3>${c.metrics.map(metricHTML).join('')}<div class="unknown-cost"><b>${c.metrics.length?'指标须按原单位理解':'尚无可用的量化成本'}</b>${esc(c.cost)}</div></section>
      <section class="detail-section evidence-note"><h3>史料与空间限制</h3><p>${esc(c.uncertainty)}</p><p>线由文献途经点连接；非河槽复原，不据此测算长度。</p></section>
      <section class="detail-section"><h3>证据出处</h3><div class="source-links">${c.sources.map(id=>`<button class="source-link" data-source="${esc(id)}"><span>${esc(id)}</span>${esc(sourceById.get(id).title)}</button>`).join('')}</div></section>
      <div class="detail-actions"><button id="download-record">保存本条资料</button><button id="show-disputes">阅读核对记录</button></div>`;
    $('locate-detail').addEventListener('click',()=>focusCanal(c));
    $('download-record').addEventListener('click',()=>download(`${c.id}-research.json`,JSON.stringify({canal:c,sources:c.sources.map(id=>sourceById.get(id))},null,2),'application/json'));
    $('show-disputes').addEventListener('click',showDisputes);
    box.querySelectorAll('[data-source]').forEach(b=>b.addEventListener('click',()=>showSources(b.dataset.source)));
  }
  function selectCanal(id,focus){
    state.selected=id;const c=D.canals.find(c=>c.id===id);
    renderCanals(filtered());renderList(filtered());renderDetail();
    if(focus&&c)focusCanal(c);
  }
  function renderTimeline(){
    const box=$('era-timeline');box.replaceChildren();
    for(const e of D.eras){
      const b=document.createElement('button');b.dataset.era=e.id;b.className=e.id===state.era?'active':'';
      b.setAttribute('aria-pressed',String(e.id===state.era));
      b.innerHTML=`${esc(e.name)}<small>${e.start<0?'前'+(-e.start):e.start}—${e.end<0?'前'+(-e.end):e.end}</small>`;
      b.addEventListener('click',()=>setEra(e.id));box.append(b);
    }
  }
  function render(){
    const e=eraById.get(state.era), all=state.mode==='all';
    const list=filtered();if(!list.some(c=>c.id===state.selected))state.selected=list[0]?.id||null;
    $('mode-network').classList.toggle('active',!all);$('mode-all').classList.toggle('active',all);
    $('mode-network').setAttribute('aria-pressed',String(!all));$('mode-all').setAttribute('aria-pressed',String(all));
    $('only-new').disabled=all;
    $('era-years').textContent=all?'前486年起 · 代表性工程跨期汇览':`${C.formatYear(e.start)}—${C.formatYear(e.end)}`;
    $('map-heading').textContent=all?'历代运河 · 山河叠图':`${e.name} · ${e.title}`;
    $('era-title').textContent=all?'同一片山河，不同的营造':e.title;
    $('era-summary').textContent=all?'颜色表示条目中的营建或改治时期；同一走廊可有多代工程。叠加用于比较地理格局，不表示所有线路曾同时存在或通航。':e.summary;
    $('era-symbol').textContent=all?'叠':e.name.substring(0,1);
    $('era-symbol').style.color=all?'#9c7c4266':e.color+'66';
    $('map-warning').textContent=D.mapWarning;
    $('dynasty-legend').hidden=!all;
    $('map-key').innerHTML=all?'<span><i class="sample natural"></i>现代天然参照</span><span><i class="sample ancient"></i>古黄河方向</span><span>运河按营建时代着色</span>':'<span><i class="sample natural"></i>天然参照</span><span><i class="sample built"></i>本期工程</span><span><i class="sample inherited"></i>沿用走廊</span>';
    $('dynasty-legend').innerHTML=D.eras.filter(e=>D.canals.some(c=>c.era===e.id)).map(e=>`<span style="--route:${e.color}"><i></i>${esc(e.name)}</span>`).join('');
    $('era-prev').disabled=D.eras[0].id===state.era;$('era-next').disabled=D.eras.at(-1).id===state.era;
    renderTimeline();renderHistoric();renderCities();renderCanals(list);renderList(list);renderDetail();
    const current=$('era-timeline').querySelector('.active');
    if(current){const box=$('era-timeline');box.scrollLeft=current.offsetLeft-box.offsetLeft-box.clientWidth/2+current.clientWidth/2;}
  }
  function setEra(id){
    state.era=id;if(state.mode==='all')state.mode='network';state.query='';$('route-search').value='';
    state.selected=D.canals.find(c=>c.era===id)?.id||C.visibleCanals(D,id,'network')[0]?.id;
    render();setCamera(state.view==='country'?fullView:corridorView,state.view);
  }
  function setMode(mode){
    state.mode=mode;render();setCamera(mode==='all'?fullView:corridorView,mode==='all'?'country':'corridor');
  }
  function setCamera(next,name='custom'){
    view=next.map(Number);state.view=name;svg.setAttribute('viewBox',view.join(' '));
    $('map-scope').textContent=name==='country'?'全国总览':name==='corridor'?'运河走廊':'局部查阅';
    $('focus-country').classList.toggle('active',name==='country');$('focus-corridor').classList.toggle('active',name==='corridor');
    renderCities();
  }
  function focusCanal(c){
    const ps=c.coords.map(C.project),xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]);
    const width=Math.max(180,Math.max(...xs)-Math.min(...xs)+105),height=Math.max(170,Math.max(...ys)-Math.min(...ys)+105);
    const center=[(Math.max(...xs)+Math.min(...xs))/2,(Math.max(...ys)+Math.min(...ys))/2];
    setCamera([center[0]-width/2,center[1]-height/2,width,height]);
  }
  function zoom(factor,anchor){
    const width=Math.min(1300,Math.max(65,view[2]*factor)),ratio=width/view[2];
    const height=view[3]*ratio,point=anchor||[view[0]+view[2]/2,view[1]+view[3]/2];
    setCamera([point[0]-(point[0]-view[0])*ratio,point[1]-(point[1]-view[1])*ratio,width,height]);
  }
  function localPoint(event){
    const point=new DOMPoint(event.clientX,event.clientY),matrix=svg.getScreenCTM();
    return matrix?point.matrixTransform(matrix.inverse()):null;
  }
  function toast(message){
    clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;
    toastTimer=setTimeout(()=>$('toast').hidden=true,3200);
  }
  function download(name,text,type){
    const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已生成文件：'+name);
  }
  function openDialog(title,html){
    if(!dialog.open)returnFocus=document.activeElement;
    $('dialog-title').textContent=title;$('dialog-body').innerHTML=html;
    if(!dialog.open)dialog.showModal();
    dialog.scrollTop=0;$('dialog-close').focus();
  }
  function sourceHTML(s){return `<article class="source-card" id="source-${esc(s.id)}"><h3>${esc(s.id)} · ${esc(s.title)}</h3><div class="source-meta">${esc(s.publisher)}<br>${esc(s.kind)} · ${esc(s.checked)} · 检索于 ${esc(s.accessed)}</div><p>${esc(s.supports)}</p><p class="source-warning">${esc(s.note)}</p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">打开原始来源</a></article>`;}
  function showSources(id){
    const subset=id?[sourceById.get(id)].filter(Boolean):D.sources;
    openDialog(id?'来源与核读范围':`史料登记 · ${D.sources.length} 条`,`${id?'':`<p>古籍转录、学术研究、机构说明分开登记。“检索摘要已核”仅表示相关事实在检索结果中可见；不等于已经阅读完整文献。资料库保存核读笔记与必要原文，不是版权网页全文镜像。</p><p>核读截止 ${D.updated}。本版为代表性研究集，非中国全部运河普查。</p><p><button id="dialog-disputes">查看争议与核对记录</button></p>`}${subset.map(sourceHTML).join('')}`);
    $('dialog-disputes')?.addEventListener('click',showDisputes);
  }
  function showDisputes(){
    openDialog('核对记录 · 保留分歧',D.disputes.map(d=>`<article class="source-card"><h3>${esc(d.title)}</h3><p>${esc(d.decision)}</p><p>${d.sources.map(id=>`<button data-source="${esc(id)}">${esc(id)}</button>`).join('　')}</p></article>`).join(''));
    $('dialog-body').querySelectorAll('[data-source]').forEach(b=>b.addEventListener('click',()=>showSources(b.dataset.source)));
  }
  function showGuide(){
    openDialog('读图说明 · 先识水，再观渠',`
      <p>这是一部面向游戏前期研究的中国运河地图集，收录 ${D.canals.length} 项代表性工程，涉及 ${D.eras.length} 个历史阶段。主线为大运河，兼收灵渠、关中漕渠与胶莱运河。它还不是历朝精确历史水文GIS。</p>
      <h3>三种观察方式</h3><ul><li><b>时代水网：</b>本期工程用实线，文献支持的沿用走廊用淡虚线。可勾选“仅看本期工程”，其中也包括扩浚和复修。</li><li><b>历代叠加：</b>在全国地理参照上同屏显示各时期工程，颜色按本条工程营建时期；同槽可能叠线，可通过水道索引逐项选择。</li><li><b>全国／走廊／局部：</b>使用地图按钮，或滚轮缩放、拖动平移；选择水道后可定位。地图键盘支持＋／−、方向键和 Home 复位。</li></ul>
      <h3>天然河流不是古代原始水系</h3><p>底图使用 Natural Earth 公有领域数据，海岸、陆地、国家区域轮廓和天然河流是现代定位参照，不表示古代疆域。未绘历代行政边界。淮河、渭河、湘江和钱塘江的补充虚线仅为位置示意。城市标点是现代位置，古城可能迁址。</p>
      <p>古代黄河下游另以金色虚线展示北流、南流夺淮和1855年后北徙方向。1128—1194是长期变动，不表示瞬间切换；清代同时出现南流和北徙，是因为两种格局先后发生于同一朝代。</p>
      <h3>空间精度与未知数据</h3><p>全部历史人工河线均由文献途经点手工连接，是区域示意，不能据图测距或作为考古河槽。尚未精确重建古海岸、湖岸、黄河各次决徙与全部天然支流。图上空白不意味着该地没有运河。</p>
      <p>工程卡中的人、工、石、斤、楮币缗／锭各自保留原单位，未知造价留空。史载征发不是死亡人数；漕粮额征不是实际运抵；通水不是通航；叠加线路不能相加当现存里程。</p>
      <h3>资料与复用</h3><p>右上“下载资料”导出完整JSON；“保存本条资料”导出工程及来源；“导出地图”保存带图例与限制说明的SVG。上级本地文件夹内另有Markdown专题、CSV、核查记录和底图哈希。全部网页资源本地可用，阅读外部原文时才需联网。</p>
      <p>Made with Natural Earth. 地理数据为公有领域。<a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">数据与许可</a></p>`);
  }
  function showEvents(){
    const events=state.mode==='all'?D.events:D.events.filter(e=>e.era===state.era);
    openDialog(state.mode==='all'?'跨期事件年表':`${eraById.get(state.era).name} · 事件与转折`,events.length?events.map(e=>`<div class="event-row"><strong>${esc(C.formatYear(e.year))}</strong><div><h3>${esc(e.name)}</h3><p>${esc(e.text)}</p>${e.sources.map(id=>`<button data-source="${id}">${id}</button>`).join('　')}</div></div>`).join(''):'<p>本期资料以维护与区域水网为主，尚未纳入精确纪年的独立事件。这不表示该阶段没有工程或航运活动。</p>');
    $('dialog-body').querySelectorAll('[data-source]').forEach(b=>b.addEventListener('click',()=>showSources(b.dataset.source)));
  }
  function exportSVG(){
    const clone=svg.cloneNode(true);clone.removeAttribute('tabindex');clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    // Wrap the map in an independent page so labels/limitations and era legend survive export.
    const outer=document.createElementNS('http://www.w3.org/2000/svg','svg');
    outer.setAttribute('xmlns','http://www.w3.org/2000/svg');outer.setAttribute('viewBox','0 0 1400 1080');outer.setAttribute('width','1400');outer.setAttribute('height','1080');
    element('rect',{width:1400,height:1080,fill:'#f1ead8'},outer);
    const title=element('text',{x:40,y:50,'font-size':28,'font-family':'SimSun, serif',fill:'#253a36'},outer);title.textContent=$('map-heading').textContent;
    const subtitle=element('text',{x:40,y:78,'font-size':13,fill:'#6c7165'},outer);subtitle.textContent=$('era-years').textContent+' · 河山通鉴 · '+D.updated;
    // Computed presentation survives file:// stylesheet restrictions and makes the export standalone.
    const originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
    const props=['fill','fill-rule','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','opacity','font-size','font-family','font-weight','letter-spacing','paint-order','vector-effect','display'];
    originals.forEach((original,i)=>{const computed=getComputedStyle(original);for(const prop of props)copies[i].style.setProperty(prop,computed.getPropertyValue(prop));});
    clone.setAttribute('x','25');clone.setAttribute('y','100');clone.setAttribute('width','1350');clone.setAttribute('height','825');clone.setAttribute('role','img');
    clone.style.width='1350px';clone.style.height='825px';
    outer.appendChild(clone);
    let y=953;
    if(state.mode==='all'){
      D.eras.filter(e=>D.canals.some(c=>c.era===e.id)).forEach((e,i)=>{
        const x=40+(i%6)*220, yy=y+Math.floor(i/6)*23;
        element('path',{d:`M${x} ${yy-4}h20`,stroke:e.color,'stroke-width':3},outer);
        element('text',{x:x+27,y:yy,'font-size':12,fill:'#253a36'},outer).textContent=e.name;
      });y+=50;
    }else{
      element('text',{x:40,y,'font-size':12,fill:'#253a36'},outer).textContent='青色：现代天然河流参照　金色虚线：历史黄河方向示意　实线：本期工程　淡虚线：沿用走廊';y+=25;
    }
    element('text',{x:40,y:y+6,'font-size':12,fill:'#6c7165'},outer).textContent='文献途经点示意，非考古/测绘复原；叠加不代表同时通航。原始天然水系尚未完整复原。';
    element('text',{x:40,y:y+28,'font-size':11,fill:'#6c7165'},outer).textContent='Made with Natural Earth (public domain). 现代区域轮廓只用于定位，不表示历代疆域。来源与统计口径见随附资料库。';
    download('大运河-'+(state.mode==='all'?'历代叠加':eraById.get(state.era).name)+'.svg',new XMLSerializer().serializeToString(outer),'image/svg+xml;charset=utf-8');
  }
  $('mode-network').addEventListener('click',()=>setMode('network'));
  $('mode-all').addEventListener('click',()=>setMode('all'));
  $('only-new').addEventListener('change',e=>{state.onlyNew=e.target.checked;render();});
  $('route-search').addEventListener('input',e=>{state.query=e.target.value;const list=filtered();if(!list.some(c=>c.id===state.selected))state.selected=list[0]?.id||null;renderCanals(list);renderList(list);renderDetail();});
  [['natural','natural-layer'],['historic','historic-layer'],['canals','canals-layer'],['cities','cities-layer']].forEach(([id,layer])=>$("layer-"+id).addEventListener('change',e=>$(layer).style.display=e.target.checked?'':'none'));
  $('focus-country').addEventListener('click',()=>setCamera(fullView,'country'));
  $('focus-corridor').addEventListener('click',()=>setCamera(corridorView,'corridor'));
  $('reset-map').addEventListener('click',()=>setCamera(state.mode==='all'?fullView:corridorView,state.mode==='all'?'country':'corridor'));
  $('zoom-in').addEventListener('click',()=>zoom(.75));$('zoom-out').addEventListener('click',()=>zoom(1.333));
  $('era-prev').addEventListener('click',()=>{const i=D.eras.findIndex(e=>e.id===state.era);if(i>0)setEra(D.eras[i-1].id);});
  $('era-next').addEventListener('click',()=>{const i=D.eras.findIndex(e=>e.id===state.era);if(i<D.eras.length-1)setEra(D.eras[i+1].id);});
  $('guide-open').addEventListener('click',showGuide);$('sources-open').addEventListener('click',()=>showSources());$('events-open').addEventListener('click',showEvents);
  $('dialog-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus();});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  $('download-json').addEventListener('click',()=>download('大运河-历史资料库.json',JSON.stringify(D,null,2),'application/json;charset=utf-8'));
  $('export-svg').addEventListener('click',exportSVG);
  svg.addEventListener('wheel',e=>{e.preventDefault();const point=localPoint(e);zoom(e.deltaY>0?1.12:.89,point?[point.x,point.y]:undefined);},{passive:false});
  svg.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;const p=localPoint(e);if(!p)return;
    dragging={id:e.pointerId,point:[p.x,p.y],view:[...view],client:[e.clientX,e.clientY],captured:false};moved=false;
  });
  svg.addEventListener('pointermove',e=>{
    if(!dragging||e.pointerId!==dragging.id)return;
    if(!moved&&Math.hypot(e.clientX-dragging.client[0],e.clientY-dragging.client[1])<5)return;
    if(!dragging.captured){svg.setPointerCapture(e.pointerId);dragging.captured=true;}
    moved=true;svg.classList.add('dragging');
    const p=localPoint(e);if(!p)return;
    const nx=view[0]+dragging.point[0]-p.x,ny=view[1]+dragging.point[1]-p.y;
    setCamera([Math.max(-200,Math.min(1200-view[2]/3,nx)),Math.max(-180,Math.min(850-view[3]/3,ny)),view[2],view[3]]);
  });
  const stopDrag=e=>{if(dragging&&e.pointerId===dragging.id){if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);dragging=null;svg.classList.remove('dragging');}};
  svg.addEventListener('pointerup',stopDrag);svg.addEventListener('pointercancel',stopDrag);svg.addEventListener('lostpointercapture',()=>{dragging=null;svg.classList.remove('dragging');});
  svg.addEventListener('keydown',e=>{
    const step=view[2]*.08;
    if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))e.preventDefault();
    if(e.key==='+'||e.key==='=')zoom(.8);else if(e.key==='-')zoom(1.25);
    else if(e.key==='ArrowLeft')setCamera([view[0]-step,view[1],view[2],view[3]]);
    else if(e.key==='ArrowRight')setCamera([view[0]+step,view[1],view[2],view[3]]);
    else if(e.key==='ArrowUp')setCamera([view[0],view[1]-step,view[2],view[3]]);
    else if(e.key==='ArrowDown')setCamera([view[0],view[1]+step,view[2],view[3]]);
    else if(e.key==='Home')$('reset-map').click();
  });
  $('source-count').textContent=D.sources.length;
  new ResizeObserver(()=>renderCities()).observe($('map-stage'));
  prepareBase();render();setCamera(corridorView,'corridor');
})();
