import WaterKey from './WaterKey.jsx';
import OpeningLesson from './OpeningLesson.jsx';
import CanalWorks from './CanalWorks.jsx';
import RiverGuide from './RiverGuide.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { scenarios } from '../trial/scenarios.js';
import './style.css';
import { MapDispatches, DispatchDetail, eventTitle, FieldAlbum, sceneTitles } from './Dispatches.jsx';
import geography from './geography.json';

const worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
let serial = 0;
const waiting = new Map();
worker.onmessage = ({ data }) => {
  const pending = waiting.get(data.requestId);
  if (!pending) return;
  waiting.delete(data.requestId);
  if (data.error) pending.reject(Error(data.error));
  else pending.resolve(data.result);
};
worker.onerror = () => {
  for (const pending of waiting.values()) pending.reject(Error('模拟进程中断，请刷新页面重试。'));
  waiting.clear();
};
function request(payload) {
  return new Promise((resolve, reject) => {
    const requestId = ++serial;
    waiting.set(requestId, { resolve, reject });
    worker.postMessage({ ...payload, requestId });
  });
}
const phaseNames = { planned: '待开工', construction: '施工', trial: '试航', operating: '通航', cancelled: '已取消' };
const labelOffsets = { a: [32, 8], b: [-80, -18], c: [24, 0], d: [32, 18] };
const positions = { a: [95, 235], b: [340, 150], c: [530, 65], d: [345, 350] };

export function App({ atlas = false }) {
  const [starts,setStarts]=useState(0);
  const [reading, setReading] = useState(null);
  const [album,setAlbum] = useState({});
  const dispatchOpener=useRef(null);
  function remember(events,reset=false) {
    if (!atlas) return;
    setAlbum(previous=>{
      const next=reset?{}:{...previous};
      for(const event of events) {
        if(sceneTitles[event.scene] && (!next[event.scene] || event.id>next[event.scene].id)) next[event.scene]=event;
      }
      return next;
    });
  }
  function closeDispatch() {
    setReading(null);
    requestAnimationFrame(()=>{
      const origin=dispatchOpener.current;
      if(origin?.isConnected)origin.focus();
      else document.querySelector('.atlas-lenses [aria-pressed=true]')?.focus();
    });
  }
  const [seen,setSeen] = useState(()=>new Set());
  function openDispatch(event) {
    if(!reading)dispatchOpener.current=document.activeElement;
    remember([event]);
    setReading(event);
    setSeen(current=>new Set([...current,event.id]));
  }
  const [lens,setLens] = useState('漕运');
  const [game, setGame] = useState(null);
  const [scenario, setScenario] = useState('ming');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [grade, setGrade] = useState('small');
  const [mode, setMode] = useState('normal');
  const [estimate, setEstimate] = useState(null);
  const [historical, setHistorical] = useState(null);
  const [surveyed,setSurveyed]=useState(null);
  const [selectedEdge,setSelectedEdge]=useState(null);

  const [showHistory, setShowHistory] = useState(true);
  const previewSequence = useRef(0);
  async function perform(payload) {
    setBusy(true); setError('');
    if (payload.type === 'start') {setReading(null);setSeen(new Set());}
    try { const result=await request(payload);setGame(result);if(payload.type==='start'){setStarts(n=>n+1);setSurveyed(null);setSelectedEdge(null);setGrade('small');setMode('normal');setLens('漕运');}remember(result.log,payload.type==='start'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { perform({ type: 'start', id: 'ming', seed: 7 }); }, []);
  const state = game?.state;
  const projectPosition = ([lon,lat]) => [(lon-105)/20*650,(43-lat)/19*430];
  const longCampaign = state?.scenarioId.startsWith('campaign-sui-tang');

  const mapPositions = state?.scenarioId === 'river-trial' ? positions : {
    a:projectPosition([119.4,32.4]), b:projectPosition(longCampaign?[112.45,34.62]:[119.02,33.6]),
    c:projectPosition(longCampaign?[115.97,39.48]:[116.4,39.9]), d:projectPosition([120.15,30.27]),
  };
  const reach = state?.reaches.find(item => item.id === 'ab');
  const project = state?.projects.find(item => item.reachIds.includes('ab') && !['operating', 'cancelled'].includes(item.phase));
  function plan() {
    return { type: 'PLAN_PROJECT', projectKind: 'dredge', reachIds: ['ab'], grade,
      laborMode: mode, startTick: state.tick, sponsorIds: ['central'] };
  }
  useEffect(() => {
    if (!state) return;
    const sequence = ++previewSequence.current;
    request({ type: 'preview', command: plan() }).then(result => {
      if (sequence === previewSequence.current) setEstimate(result);
    }).catch(failure => setError(failure.message));
  }, [state?.revision, state?.scenarioId, grade, mode]);
  if (!state) return <p role={error ? 'alert' : 'status'}>{error || '正在展开河图……'}</p>;
  const year = state.calendar.startYear + Math.floor(state.tick / 36);
  const disabled = busy || !!game.finished;
  const command = value => perform({ type: 'command', command: value });
  const passage = close => command({ type: 'SET_PASSAGE', reachId: reach.id, policy: reach.passage,
    maxLoadClass: reach.maxLoadClass, schedule: reach.schedule, closedUntil: close ? state.tick + 3 : null });
  const metrics = [
    ['中央国库', state.actors.find(actor=>actor.id==='central').treasury],
    ['人口', state.regions.reduce((sum, region) => sum + region.population, 0)],
    ['累计送达', game.metrics.grainDelivered], ['河工征役', game.metrics.playerLabor],
    ['人间征役', game.metrics.externalLabor], ['缺粮旬数', game.metrics.emptyWarehouseTicks],
  ];
  return <>
    <header><div><p className="eyebrow">THE GREAT CANALS · 大运河</p><h1>{atlas?'舆图纪事':'水脉与天下'}</h1>
      <p>天意定河事，人间自有兴衰。</p></div>
      <div className="scenario"><label htmlFor="scenario">展开河图</label>
        <select id="scenario" value={scenario} onChange={event => setScenario(event.target.value)} disabled={busy}>
          {scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select><button id="start-scenario" disabled={busy} onClick={() => perform({ type: 'start', id: scenario, seed: 7 })}>开始剧本</button>
      </div></header>
    {atlas && <p><a href="/atlas.html?practice=ming">正式关实操 · 明初江淮开渠</a>　<a href="/ming-opening.webp" target="_blank" rel="noreferrer">观看开渠操作演示（六步循环）</a></p>}
    {atlas && new URLSearchParams(location.search).get("practice")==="ming" && state.scenarioId==="campaign-ming" ? <OpeningLesson key={starts} {...{state,selectedEdge,surveyed}}/> : atlas && <RiverGuide {...{starts,scenario,lens,state,game,reading,project,grade,mode,estimate,reach,selectedEdge,surveyed}}/>}
    <section className="timebar"><div><strong>{year} 年</strong> · {game.chapter || game.title}
      <small>已结算 {state.tick} / {state.endTick} 旬　／　{game.climate}</small></div>
      <div><button id="advance-one" disabled={disabled} onClick={() => perform({ type: 'advance', limit: 1 })}>推进一旬</button>
        <button className="primary" disabled={disabled} onClick={() => perform({ type: 'advance', limit: 36 })}>
          {busy ? '人间演进中…' : '推进到关键节点'}</button></div></section>
    {error && <p role="alert" className="error">{error}</p>}
    <section className="metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong></div>)}</section>
    {game.finished && <section className="ending"><p>河工总录</p><h2>{game.finished.title}</h2>
      <p>{game.finished.cause}</p><p>{game.finished.world}</p>{atlas && <button onClick={()=>openDispatch({
        id:'summary',kind:'ending',scene:'ending',regionId:null,tick:state.tick,voice:'史官',
        text:game.finished.legacy+' '+game.finished.responsibility,facts:[['累计送达',game.metrics.grainDelivered],['缺粮旬数',game.metrics.emptyWarehouseTicks]],
      })}>展开河工总录</button>}<p>{game.finished.legacy}</p><p>{game.finished.responsibility}</p>
      <button onClick={() => perform({ type: 'start', id: scenario, seed: 7 })}>重开一局</button></section>}
    <main><section className="map-panel"><div className="panel-heading"><h2>{state.scenarioId==="river-trial"?"两岸河图":"河山舆图"}</h2><label hidden={state.scenarioId==="river-trial"}><input type="checkbox" checked={showHistory} onChange={event=>setShowHistory(event.target.checked)}/>历史走廊</label></div>
      {atlas && <nav className="atlas-lenses" aria-label="地图视角">{['漕运','水情','政局'].map(name=><button data-lens={name} key={name} aria-pressed={lens===name} onClick={()=>setLens(name)}>{name}</button>)}</nav>}
      <WaterKey {...{state,selectedEdge}} climate={game.climate} select={setSelectedEdge}/>
      <svg viewBox="0 0 650 430" role={atlas?'group':'img'} aria-label="运河与粮仓示意地图">
        <defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#d8d4c4" strokeWidth=".5"/></pattern></defs>
        <defs><clipPath id="bounds"><rect width="650" height="430"/></clipPath></defs>
        {state.scenarioId !== 'river-trial' && <image href="/hydrography.svg" width="650" height="430"/>}
        {state.scenarioId !== 'river-trial' && showHistory && <g clipPath="url(#bounds)">{geography.canals.map(canal=><path
          key={canal.id} d={canal.path} fill="none" stroke="#a98c61" strokeWidth="3"
          strokeDasharray="5 4" role="button" tabIndex="0" aria-label={'考察'+canal.name}
          onClick={()=>setHistorical(canal)} onKeyDown={event=>{if(event.key==='Enter')setHistorical(canal);}}>
          <title>{canal.name+' · '+canal.dateLabel}</title>
        </path>)}</g>}
        {state.transportEdges.map((edge,index) => {
          const from = mapPositions[edge.fromNodeId.replace('port-', '')], to = mapPositions[edge.toNodeId.replace('port-', '')];
          const reachForEdge=state.reaches.find(item=>item.transportEdgeIds.includes(edge.id));
          const water=state.waterEdges.find(item=>item.id===edge.waterEdgeId);
          const cap=reachForEdge ? Math.floor(edge.capacity*(reachForEdge.grade==='heavy'?1.6:reachForEdge.grade==='standard'?1.25:1)*(1-reachForEdge.silt/10000)*(1-reachForEdge.damage/10000)) : edge.capacity;
          const label=reachForEdge?.status==='candidate'?'待开渠址':reachForEdge?.status!=='active'?'停航':!atlas ? '航程 '+edge.travelTicks+' 旬' : lens==='漕运' ? (reachForEdge?.closedUntil>state.tick ? '临时封航' : '河况上限 '+cap)
            : lens==='水情' ? (water?.controlled?'每载用水 '+edge.waterPerLoad:'自然水道') : (edge.available?'辖境准入':'边界受限');
          return <g key={edge.id}><path className={"painted-course"} role={"button"} tabIndex={0} aria-label={"察看航段 "+edge.id} onClick={()=>setSelectedEdge(edge.id)} onKeyDown={e=>{if(e.key==="Enter")setSelectedEdge(edge.id)}} d={'M'+from[0]+','+from[1]+' Q'+(from[0]+(reachForEdge?.id==='relief'?90:0))+','+to[1]+' '+to[0]+','+to[1]}
            fill="none" style={{stroke:water?.controlled?'#24547b':'#236951',strokeDasharray:reachForEdge?.status==='candidate'?'2 5':water?.controlled?'8 3':'none'}} stroke={atlas && lens==='政局' ? (edge.available?'#777341':'#ad452d') : atlas && lens==='水情' ? '#27688a' : '#4f8793'} strokeWidth={edge.id === 'transport-ab' ? 9 : 5} />
            <text className={"scroll-label"} x={(from[0]+to[0])/2-65} y={(from[1]+to[1])/2-4} dy={reachForEdge?.id==="relief"?21:0} fontSize="12">{index+1} {water?.controlled?"Ⅱ":"≈"} {label}</text></g>;
        })}
        {atlas && state.reaches.filter(r=>r.status==="candidate").map((r,i)=>{
          const [from,to]=r.regionIds.map(id=>mapPositions[id]);
          const x=(from[0]+to[0])/2+60+i*38,y=(from[1]+to[1])/2+28;
          return <g key={r.id} id={"survey-"+r.id} role="button" tabIndex={0} aria-label={"勘选"+r.name} onClick={()=>{setSurveyed(r.id);setSelectedEdge(r.transportEdgeIds[0])}} onKeyDown={e=>{if(e.key==="Enter"){setSurveyed(r.id);setSelectedEdge(r.transportEdgeIds[0])}}} style={{cursor:"pointer"}}><path d={`M${x} ${y} l-35 -22`} stroke="#8a392a"/><rect x={x-12} y={y-14} width="24" height="24" rx="3" fill="#843f31"/><text x={x} y={y+3} textAnchor="middle" style={{fill:"white",stroke:"none"}}>勘</text></g>
        })}
        {state.regions.map(region => {
          const [x, y] = mapPositions[region.id];
          const inventory = state.inventories.find(item => item.id === region.inventoryId);
          const [dx,dy] = labelOffsets[region.id];
          return <g key={region.id}><line x1={x} y1={y} x2={x+dx} y2={y+dy} stroke="#7a8e80"/><circle cx={x} cy={y} r="8" fill={inventory.grain === 0 ? '#ac4c39' : '#345e52'}/>
            <text x={x+dx} y={y+dy} fontSize="16">{region.name === region.id ? ({a:'南仓',b:'北岸'}[region.id] ?? region.name) : region.name}</text>
            <text x={x+dx} y={y+dy+19} fontSize="12">{atlas && lens==='政局' ? '地方关系 '+region.localRelations : atlas && lens==='水情'
              ? '蓄水 '+state.waterNodes.filter(n=>n.regionId===region.id).reduce((sum,n)=>sum+n.storage,0) : '粮 '+inventory.grain}</text></g>;
        })}
        {atlas && <MapDispatches game={game} positions={mapPositions} seen={seen} read={openDispatch}/>}
      </svg>
      {atlas && state.transportEdges.filter(edge=>edge.id===selectedEdge).map(edge=><p className="reach-reading" key={edge.id}>航段勘记　{[edge.fromNodeId,edge.toNodeId].map(id=>{const region=state.regions.find(r=>r.id===id.replace("port-",""));return region?.name===region?.id?({a:"南仓",b:"北岸"}[region?.id]??region?.name):region?.name}).join(" → ")}　·　航程 {edge.travelTicks} 旬　·　每载用水 {edge.waterPerLoad}</p>)}{atlas && <p className="lens-caption">{{
        '漕运':'河况上限由淤积与损伤决定。实际送达还受需求、水量和旅行时间影响。',
        '水情':'节点标出蓄水，航段标出单位载量的过闸用水。下泄的水进入下游。',
        '政局':'节点标出地方关系，航段标出辖境准入状态。跨境限制只影响运输。'
      }[lens]}</p>}
      <div className="regions">{state.regions.map(region => <article key={region.id}><h3>{region.name}</h3>
        <p>人口 {region.population}　役负 {region.corveeBurden}</p>
        <small>税收归属 {region.actorId === 'central' ? '朝廷' : state.actors.find(actor=>actor.id===region.actorId)?.name}
       　地方关系 {region.localRelations}</small></article>)}</div>
      {historical && <article className="history-note"><h3>{historical.name} · {historical.dateLabel}</h3>
        <p>{historical.basins}</p><p>{historical.politics}</p><p>{historical.impact}</p>
        <small>{historical.cost} {historical.uncertainty}</small></article>}
      <p className="caption">{state.scenarioId==="river-trial"?"两岸试局为教学示意。":"岸线、水系据 Natural Earth，山纹据 Terrain Tiles 当代高程绘制。虚线为历史走廊，运营航段为节点间的示意连接。" }</p>
    </section><aside><CanalWorks {...{state,selectedEdge,command,request,disabled}} select={setSelectedEdge}/><section className="card"><h2>河事</h2>
      <p>{reach.name === reach.id ? '南北运道' : reach.name} · 残淤 {reach.silt} · 损伤 {reach.damage}</p>
      <label>疏浚规模 <select id="grade" value={grade} disabled={disabled} onChange={event => setGrade(event.target.value)}>
        <option value="small">小修</option><option value="standard">大修</option><option value="heavy">重修</option></select></label>
      <label>征役 <select id="labor" value={mode} disabled={disabled} onChange={event => setMode(event.target.value)}>
        <option value="normal">常役</option><option value="urgent">加急</option></select></label>
      <p>{estimate?.feasible ? '托管财政 '+estimate.estimate.treasuryRequired : '当前方案不可行'}</p>
      <button id="dredge" disabled={disabled || !!project || !estimate?.feasible} onClick={() => command(plan())}>开工疏浚</button>
      {project && <><p>{phaseNames[project.phase]} · {project.workCompleted}/{project.workRequired}</p>
        <progress value={project.workCompleted} max={project.workRequired}/>
        <button disabled={disabled || !['planned','construction'].includes(project.phase)} onClick={() => command({
          type: 'SET_PROJECT_STATUS', projectId: project.id, status: project.status === 'paused' ? 'active' : 'paused',
        })}>{project.status === 'paused' ? '复工' : '暂停工程'}</button></>}
      <div><button disabled={disabled} onClick={() => passage(true)}>封航三旬</button>
        <button disabled={disabled} onClick={() => passage(false)}>恢复通航</button></div>
    </section><section className="card"><h2>本旬流水账</h2><p>距岁收 {36-state.tick%36} 旬 · 中央辖区基础岁赋 {state.regions.filter(r=>r.actorId==="central").reduce((n,r)=>n+r.taxBase,0)} · 本年预计漕运增收 {Math.floor((game.metrics.grainDelivered-(game.metrics.previousTaxDelivered??0))/10)}</p><small>每年征一次赋。本局每实送 10 单位货物增收 1，军役、营建、养护按旬支出。</small>
      <p>来水 {state.ledger.water.incoming} · 灌溉及蒸散 {state.ledger.water.consumed} · 边界出水 {state.ledger.water.outgoing}</p>
      <p>货物生产 {state.ledger.cargo.incoming} · 实际消耗与损耗 {state.ledger.cargo.consumed}</p>
      {state.ledger.supplyConsumption && <p>口粮应供 {state.ledger.supplyConsumption.requested} · 实供 {state.ledger.supplyConsumption.consumed}</p>}
      <p className="caption">共享水源和狭窄河段决定瓶颈。河工、农业、军役与运输共用地区劳力。实际未足额消费才记为缺粮。</p>
    </section><section className="card"><h2>祭祀与河报</h2>
      <div className="reports">{game.log.slice(0,12).map(item => <article key={item.id}>
        {atlas && <button onClick={()=>openDispatch(item)}>{eventTitle(item)}</button>}<small>第 {item.tick} 旬 · {item.voice}</small><p>{item.text}</p></article>)}</div>
    </section></aside></main>
    {atlas && reading && <DispatchDetail log={game.log} read={openDispatch} event={reading} onClose={closeDispatch} state={state}/>}
    {atlas && <FieldAlbum events={Object.values(album)} read={openDispatch}/>}
    <footer><a href={atlas?'/':'/atlas.html'}>{atlas?'原版河图':'舆图纪事版'}</a> · 一年三十六旬 · 全部数量为游戏抽象单位 · <a href="/trial.html">两岸教学页</a></footer>
  </>;
}
createRoot(document.getElementById('root')).render(<App atlas={document.body.classList.contains('atlas')}/>);

