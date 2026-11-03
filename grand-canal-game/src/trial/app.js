import scenario from './scenario.json';
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
  if(before.actions[0].phase!==after.actions[0].phase) return ({
    mobilizing:'地方预警：军役将至，请斟酌河工。',active:'朝廷征兵开始，河工与军役共用本地劳力。',completed:'军役结束，征用的劳力重新参与分配。'
  })[after.actions[0].phase] ?? '军役状态改变。';
  const change=after.projects.find(p=>before.projects.find(old=>old.id===p.id)?.phase!==p.phase);
  if(change) return change.phase==='operating'?'试航结束，疏浚成果生效。':change.phase==='trial'?'工程进入试航。':'河工进入施工阶段。';
  if(after.inventories[1].grain===0 && before.inventories[1].grain>0) return '北岸告急：仓粮已尽，请检查通航。';
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
  $('date').textContent=state.ending?'两年河工实录':'第'+(Math.floor(state.tick/36)+1)+'年 · 已过 '+state.tick+' / 72 旬';
  $('metrics').replaceChildren(...[['中央财政',state.actors[0].treasury],['北岸仓粮',north.grain],['在途粮',state.inTransit.filter(b=>['travelling','waiting'].includes(b.status)).reduce((n,b)=>n+b.quantity,0)],['河段淤积',reach.silt],['南仓役负',state.regions[0].corveeBurden],['北岸累计收粮',state.demands.reduce((n,d)=>n+d.fulfilled,0)]].map(([k,v])=>{const e=document.createElement('span'),b=document.createElement('strong');b.textContent=v;e.append(k,b);return e;}));
  const est=preview(state,proposal(),scenario);
  $('estimate').textContent=est.feasible?'预计需托管财政 '+est.estimate.treasuryRequired+'。':'此刻不能启动该工程。';
  $('project').textContent=project?'工程进度 '+project.workCompleted+' / '+project.workRequired+'，'+(project.status==='paused'?'已暂停':'实施中'):'当前无在建工程。';
  $('prayer').textContent=state.ending?'终局记录：河段残淤 '+reach.silt+'，本地役负 '+state.regions[0].corveeBurden+'，北岸余粮 '+north.grain+'。':north.grain<30?'北岸百姓祈告：仓粮不足，请保运道。':state.actions[0].phase==='active'?'地方祈告：军役正盛，愿河工缓征。':'北岸百姓祈告：愿南仓之粮依时抵岸。';
  $('history').replaceChildren(...history.slice(0,8).map(line=>{const li=document.createElement('li');li.textContent=line;return li;}));
  $('plan').disabled=!!state.ending||!!project||!est.feasible;
  $('pause').disabled=!project||project.status==='paused'||!!state.ending;
  $('resume').disabled=!project||project.status!=='paused'||!!state.ending;
  for(const id of ['step','advance','open','close']) $(id).disabled=!!state.ending;
}
function bind(id,fn){$(id).onclick=()=>{try{note('');fn();render();}catch(e){note(e.message);}};}
bind('step',()=>advance(1));bind('advance',()=>advance(72));
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
