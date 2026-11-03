import React from 'react';

export default function TrafficOrders({state,reach,command,disabled}){
 const edge=state.transportEdges.find(e=>reach.transportEdgeIds.includes(e.id));
 const water=state.waterEdges.find(e=>e.id===edge.waterEdgeId);
 const vessels=state.inTransit.filter(b=>b.status==='travelling'&&b.routeEdgeIds[b.routeIndex]===edge.id);
 const cargo=vessels.reduce((sum,b)=>sum+b.quantity,0);
 const months=Array.from({length:36},(_,i)=>i);
 function issue(schedule,maxLoadClass=reach.maxLoadClass){
   command({type:'SET_PASSAGE',reachId:reach.id,policy:reach.passage,closedUntil:reach.closedUntil,maxLoadClass,schedule});
 }
 return <fieldset id="traffic-orders" disabled={disabled}><legend>本段通航令</legend><p>{water?.controlled?'有闸渠段 · 过闸调平水位，模型按载量计闸耗。':'自流河段 · 顺水通航，不逐船扣水。'} 航程 {edge.travelTicks} 旬，本段在途 {cargo} 单位。</p>
 <label>每月船期 <select id="sailing-days" value={reach.schedule.civil.length} onChange={e=>{const days=months.filter(i=>i%3<Number(e.target.value)/12);issue({civil:days,official:days,trade:days})}}><option value="36">每旬通航</option><option value="24">上、中旬通航</option><option value="12">仅上旬通航</option></select></label>
 <label>商船准入 <select value={reach.schedule.trade.length?'allow':'hold'} onChange={e=>issue({...reach.schedule,trade:e.target.value==='allow'?reach.schedule.civil:[]})}><option value="allow">依船期放行</option><option value="hold">暂缓商船，留道给官民</option></select></label>
 <small>下旬民粮{reach.schedule.civil.includes(state.tick%36)&&!(reach.closedUntil>state.tick)?'可发船':'须候航'}。船期限制新发船，已出发的船继续航行。重设船期会同步官、民、商三类。</small></fieldset>
}
