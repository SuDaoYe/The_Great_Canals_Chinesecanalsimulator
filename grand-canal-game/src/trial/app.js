import {buildScenario, scenarios, chapterAt} from './scenarios.js';
let scenario = buildScenario('trial');
import {createGame,applyCommand,tick,hashState,preview} from '../core/index.ts';

const $ = id => document.getElementById(id);
const key = 'canal-river-trial-v1';
const fresh = () => createGame(scenario, 7);
let state = fresh(), journal = [], history = [];
const note = text => { $('status').textContent = text; };
const active = () => state.projects.find(p => !['operating','cancelled'].includes(p.phase));
const proposal = () => ({type:'PLAN_PROJECT',projectKind:'dredge',reachIds:['ab'],grade:$('grade').value,
  laborMode:$('mode').value,startTick:state.tick,sponsorIds:['central']});
function run(s, action) {
  if(action === 'tick') return tick(s,scenario).state;
  const result = applyCommand(s,{expectedRevision:s.revision,commandId:'order-'+s.revision,command:action},scenario);
  if(!result.ok) throw Error(result.error.message);
  return result.state;
}
function act(action) {
  if(state.ending) throw Error('本局已结束。');
  state=run(state,action); journal.push(action);
}
function signal(before,after) {
  if(after.ending) return '观察期结束，编成河工实录。';
  const changedAction = after.actions.find(action => before.actions.find(old => old.id === action.id)?.phase !== action.phase);
  if(changedAction?.kind === 'palace') return changedAction.phase === 'active' ? '皇室营建开始，占用地方劳力与财政。' : changedAction.phase === 'completed' ? '皇室营建结束。' : '皇室发出营建意向，请地方筹措资源。';
  if(changedAction) return ({
    mobilizing:'地方预警：军役将至，请斟酌河工。',active:'朝廷征兵开始，河工与军役共用本地劳力。',completed:'军役结束，征用的劳力重新参与分配。'
  })[changedAction.phase] ?? '军役状态改变。';
  const change=after.projects.find(p=>before.projects.find(old=>old.id===p.id)?.phase!==p.phase);
  if(change) return change.phase==='operating'?'试航结束，疏浚成果生效。':change.phase==='trial'?'工程进入试航。':'河工进入施工阶段。';
  if(after.inventories[1].grain===0 && before.inventories[1].grain>0) return '北岸告急：仓粮已尽，请检查通航。';
  if (chapterAt(before) !== chapterAt(after)) return '时代转入' + chapterAt(after) + '，既有河道与资源负担延续。';
  if (after.parameters.world && after.tick % 36 === 0) return '岁末结算：本年税收归库，人口随粮储条件增长。';
  return '';
}
function advance(count) {
  for(let i=0;i<count && !state.ending;i++) {
    const before=state;act('tick');const message=signal(before,state);
    if(message){history.unshift('第'+state.tick+'旬 · '+message);break;}
  }
}
function render(){
  const reach=state.reaches[0], project=active(), north=state.inventories.find(s=>s.id==='stock-b');
  $('date').textContent=state.ending?(scenario.id === 'river-trial'?'两年河工实录':'观察期河工实录'):(state.calendar.startYear+Math.floor(state.tick/36))+'年 · '+chapterAt(state)+' · 已过 '+state.tick+' / '+state.endTick+' 旬';
  $('metrics').replaceChildren(...[['中央财政',state.actors[0].treasury],['北岸仓粮',north.grain],['在途粮',state.inTransit.filter(b=>['travelling','waiting'].includes(b.status)).reduce((n,b)=>n+b.quantity,0)],['河段淤积',reach.silt],['南仓役负',state.regions[0].corveeBurden],['北岸累计收粮',state.demands.reduce((n,d)=>n+d.fulfilled,0)]].map(([k,v])=>{const e=document.createElement('span'),b=document.createElement('strong');b.textContent=v;e.append(k,b);return e;}));
  $('scenario-note').textContent=scenarios.find(item=>buildScenario(item.id).id===scenario.id)?.description ?? '';
  const lines = state.regions.map(region => {
    const stock = state.inventories.find(item=>item.id===region.inventoryId);
    const element = document.createElement('p');
    element.textContent=region.name+' · 人口 '+region.population+' · 仓粮 '+stock.grain+' · 役负 '+region.corveeBurden;
    return element;
  });
  $('world-report').replaceChildren(...lines);
  $('world-actions').replaceChildren(...state.actions.filter(action=>['mobilizing','active'].includes(action.phase)).map(action=>{
    const line=document.createElement('p');
    line.textContent=(action.kind==='palace'?'皇室营建':'中央军役')+' · '+(action.phase==='active'?'正在征发':'即将动员')+' · 请求劳力 '+action.laborRequest;
    return line;
  }));
  const svg=document.querySelector('svg');
  svg.setAttribute('viewBox','0 0 560 220');
  svg.setAttribute('aria-label','水系示意图，节点状态对应下方地区数据');
  const positions={a:[65,100],b:[280,70],c:[485,35],d:[235,180]};
  const elements=[];
  const node=(tag,attributes,text)=>{
    const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [name,value] of Object.entries(attributes))element.setAttribute(name,String(value));
    if(text)element.textContent=text;
    elements.push(element);
  };
  for(const edge of state.transportEdges) {
    const from=positions[edge.fromNodeId.replace('port-','')],to=positions[edge.toNodeId.replace('port-','')];
    if(!from||!to)continue;
    node('line',{x1:from[0],y1:from[1],x2:to[0],y2:to[1],stroke:'#3d7986','stroke-width':7});
  }
  for(const region of state.regions){
    const [x,y]=positions[region.id];
    const stock=state.inventories.find(item=>item.id===region.inventoryId);
    node('circle',{cx:x,cy:y,r:9,fill:stock.grain<30?'#ac4b38':'#32594d'});
    node('text',{x:x-20,y:y+30,'font-size':16},region.name);
  }
  svg.replaceChildren(...elements);
  if(state.ending) {
    const delivered=state.demands.reduce((sum,demand)=>sum+demand.fulfilled,0);
    const burden=state.regions.reduce((sum,region)=>sum+region.corveeBurden,0);
    const title=burden>5000?'役重民疲':north.grain===0?'民生凋敝':delivered>0?'水运绵延':'守成观望';
    history[0] = '终局评语 · '+title+'。以实际送达、期末缺粮和期末役负评定。';
  }
  const est=preview(state,proposal(),scenario);
  $('estimate').textContent=est.feasible?'预计需托管财政 '+est.estimate.treasuryRequired+'。':'此刻不能启动该工程。';
  $('project').textContent=project?'工程进度 '+project.workCompleted+' / '+project.workRequired+'，'+(project.status==='paused'?'已暂停':'实施中'):'当前无在建工程。';
  $('prayer').textContent=state.ending?'终局记录：河段残淤 '+reach.silt+'，本地役负 '+state.regions[0].corveeBurden+'，北岸余粮 '+north.grain+'。':north.grain<30?'北岸百姓祈告：仓粮不足，请保运道。':state.actions.some(action=>action.phase==='active')?'地方祈告：军役正盛，愿河工缓征。':'北岸百姓祈告：愿南仓之粮依时抵岸。';
  const delivered=state.demands.reduce((sum,demand)=>sum+demand.fulfilled,0);
  const totalBurden=state.regions.reduce((sum,region)=>sum+region.corveeBurden,0);
  const voices=[
    ['中央', '国库现有 '+state.actors[0].treasury+'，军役与营建将按生效时段征用资源。'],
    ['地方', '各地役负合计 '+totalBurden+'，征发和养护共同计入。'],
    ['百姓', north.grain<30?'北岸粮储告急，愿运道早通。':'北岸粮储尚可，愿岁岁有粮。'],
    ['商旅', '当前已送达 '+delivered+'，航程、通航日程和水源决定后续周转。'],
    ['皇室', state.actions.some(action=>action.kind==='palace'&&action.phase==='active')?'营建正进行，请地方筹措劳力与财政。':'营建意向将在局势记录中预警。'],
  ];
  $('voices').replaceChildren(...voices.map(([voice,text])=>{
    const line=document.createElement('p');
    line.textContent=voice+'祈告 · '+text;
    return line;
  }));
  $('history').replaceChildren(...history.slice(0,8).map(line=>{const li=document.createElement('li');li.textContent=line;return li;}));
  $('plan').disabled=!!state.ending||!!project||!est.feasible;
  $('pause').disabled=!project||project.status==='paused'||!!state.ending;
  $('resume').disabled=!project||project.status!=='paused'||!!state.ending;
  for(const id of ['step','advance','open','close']) $(id).disabled=!!state.ending;
}
function bind(id,fn){$(id).onclick=()=>{try{note('');fn();render();}catch(e){note(e.message);}};}
bind('step',()=>advance(1));bind('advance',()=>advance(Math.min(36,state.endTick-state.tick)));
bind('plan',()=>act(proposal()));
for(const [id,status] of [['pause','paused'],['resume','active']])bind(id,()=>act({type:'SET_PROJECT_STATUS',projectId:active().id,status}));
for(const [id,closed] of [['open',false],['close',true]])bind(id,()=>{const r=state.reaches[0];act({type:'SET_PASSAGE',reachId:r.id,policy:r.passage,maxLoadClass:r.maxLoadClass,schedule:r.schedule,closedUntil:closed?state.tick+3:null});note(closed?'已临时封航。':'已恢复通航日程。');});
bind('save',()=>{localStorage.setItem(key,JSON.stringify({version:1,journal,hash:hashState(state)}));note('保存成功。');});
bind('load',()=>{
  const data=JSON.parse(localStorage.getItem(key)??'null');
  if(data?.version!==1||!Array.isArray(data.journal)||data.journal.length>10000)throw Error('没有兼容存档。');
  let next=fresh();const events=[];
  for(const entry of data.journal){if(next.ending)throw Error('存档越过结束时间。');const before=next;next=run(next,entry);if(entry==='tick'){const msg=signal(before,next);if(msg)events.unshift('第'+next.tick+'旬 · '+msg);}}
  if(hashState(next)!==data.hash)throw Error('存档校验失败。');
  state=next;journal=data.journal;history=events;note('已读取存档。');
});
bind('reset',()=>{state=fresh();journal=[];history=[];});
$('grade').onchange=render;$('mode').onchange=render;render();

bind('start-scenario',()=>{scenario=buildScenario($('scenario').value);state=fresh();journal=[];history=[];note('剧本已开始。');});
