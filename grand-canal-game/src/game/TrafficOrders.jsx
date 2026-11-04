import React from 'react';

export default function TrafficOrders({metrics,state,reach,command,disabled}){
 const edge=state.transportEdges.find(e=>reach.transportEdgeIds.includes(e.id));
 const water=state.waterEdges.find(e=>e.id===edge.waterEdgeId);
 const vessels=state.inTransit.filter(b=>b.status==='travelling'&&b.routeEdgeIds[b.routeIndex]===edge.id);
 const flow=metrics.flows[edge.id];
 const size=reach.grade==='heavy'?1.6:reach.grade==='standard'?1.25:1;
 const cargo=vessels.reduce((sum,b)=>sum+b.quantity,0);
 const months=Array.from({length:36},(_,i)=>i);
 function issue(schedule,maxLoadClass=reach.maxLoadClass){
   command({type:'SET_PASSAGE',reachId:reach.id,policy:reach.passage,closedUntil:reach.closedUntil,maxLoadClass,schedule});
 }
 return <fieldset id="traffic-orders" disabled={disabled}><legend>本段通航令</legend><p>{water?.controlled?'有闸渠段 · 过闸调平水位，模型按载量计闸耗。':'自流河段 · 顺水通航，不逐船扣水。'} 航程 {edge.travelTicks} 旬，本段在途 {cargo} 单位。</p>
 <p>淤积 {reach.silt/100}%：本段每旬河况上限 = ⌊{edge.capacity} × 规格 {size} × 剩余断面 {1-reach.silt/10000} × 完好率 {(1-reach.damage/10000).toFixed(2)}⌋ = {Math.floor(edge.capacity*size*(1-reach.silt/10000)*(1-reach.damage/10000))}。船期、闸水、劳力还可能减少实运。</p>
 <label>本渠运力限额 <select value={metrics.quotas[edge.id]??100} onChange={e=>command({type:'SET_QUOTA',edgeId:edge.id,percent:Number(e.target.value)})}>{[0,25,50,75,100].map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
 <p>上旬实际发船：粮 {flow?.grain??0} · 商货 {flow?.goods??0}　累计发运 {flow?.total??0}</p><label>每月船期 <select id="sailing-days" value={reach.schedule.civil.length} onChange={e=>{const days=months.filter(i=>i%3<Number(e.target.value)/12);issue({civil:days,official:days,trade:reach.schedule.trade.length?days:[]})}}><option value="36">每旬通航</option><option value="24">上、中旬通航</option><option value="12">仅上旬通航</option></select></label>
 <label>商船准入 <select value={reach.schedule.trade.length?'allow':'hold'} onChange={e=>issue({...reach.schedule,trade:e.target.value==='allow'?reach.schedule.civil:[]})}><option value="allow">粮商平级，轮旬优先</option><option value="hold">只运粮（禁商货）</option></select></label>
 <small>下旬民粮{reach.schedule.civil.includes(state.tick%36)&&!(reach.closedUntil>state.tick)?'可发船':'须候航'}。船期限制新发船，已出发的船继续航行。调整船期保留禁商令。</small></fieldset>
}
