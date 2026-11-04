import React from 'react';
import {waterSeason} from './waterSeason.js';
export default function WaterKey({state,flows,climate,select,selectedEdge}){
 const season=waterSeason(state.tick);
 return <section id="water-key" className="water-key"><strong>读图　{season.symbol} {season.name} · {season.month}月</strong><span>　年景：{climate}　｜　▽ 枯水　◇ 平水　▲ 丰水</span><p>≈ 青线：自流，不逐船耗水　　Ⅱ 蓝线：有闸，过闸耗水　　勘：可开新渠</p><div>{state.transportEdges.map((e,i)=>{
 const r=state.reaches.find(r=>r.transportEdgeIds.includes(e.id));const gate=state.waterEdges.find(w=>w.id===e.waterEdgeId)?.controlled;
 return <button key={e.id} aria-pressed={selectedEdge===e.id} onClick={()=>select(e.id)}>{i+1}　{gate?'Ⅱ 有闸':'≈ 自流'} · {r.name==='ab'?'南北旧渠':r.name}{r.status==='candidate'?'（待开）':!e.available?'（临时管制）':''}　粮 {flows?.[e.id]?.grain??0} / 商 {flows?.[e.id]?.goods??0}</button>
 })}</div></section>
}
