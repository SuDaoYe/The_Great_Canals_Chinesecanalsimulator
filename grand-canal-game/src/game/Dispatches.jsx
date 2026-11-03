import React, {useEffect, useRef} from 'react';

const sheets = [
  [['petition','临水祈粮'],['drought','泥岸露底'],['flood','汛水压堤'],['calm','平水行舟'],['shortage','仓廪告急'],['famine','岁荒陈情']],
  [['military-mobilizing','征书抵村'],['military-active','军队渡河'],['military-completed','征人还乡'],['palace-mobilizing','宫苑勘基'],['palace-active','役夫上梁'],['palace-completed','落架散工']],
  [['dredge','丈水定工'],['paused','河工暂歇'],['active','役夫复工'],['close','闭河候船'],['open','解缆放行'],['project-construction','清淤开槽']],
  [['project-trial','轻舟试水'],['project-operating','漕舟通行'],['secession','地方接印'],['border','商舟候关'],['chapter','交接河图'],['ending','河工总录']],
];
sheets.push([['collapse','民生凋敝'],['burden','役重民疲'],['stasis','守成观望'],['prosperity','水运济民'],['mixed','兴废之间'],['tax','岁收入册']]);
export const sceneTitles = Object.fromEntries(sheets.flat());
const entries = new Map(Object.entries(sceneTitles));
export const eventTitle = event => entries.get(event.scene) ?? event.voice+'来报';
const advice = {
  annual:'岁收依各地税收归属入库。留意维持通航的日常支出与军役开支。',
  command:'下一次推进将按新的河令结算。可比较执行前后的运量、役负与仓粮。',
  action:'军役和营建与河工共用地方劳力。动员期间留意工程实际进度。',
  water:'来水会约束闸口的通航批次。检查水量账与受粮地区的实供。',
  project:'施工完成后仍须试航，投入运营才会改变河段能力。',
  politics:'税收归属和跨境通行会随地方关系变化，货物仍按原所有权记账。',
  crisis:'连续供应不足会威胁本局。先看实供与应供的差，再查沿途的水量和运力。',
  petition:'百姓关心本旬能否吃到粮。已经在途的货物需抵达后才能消费。',
  chapter:'回看上个阶段留下的役负、财力与运道，再决定下一次河令。',
  ending:'将河工与外部征用分开看，比较民生结果和留下的河道。',
};
export function MapDispatches({game,positions,read,seen}) {

  const groups = new Map();
  for(const event of game.log.filter(e=>!seen.has(e.id) && (e.scene!=='calm' || e===game.log[0]))) {
    const key=event.regionId || 'realm';
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(event);
  }
  return <g className="map-dispatches">{[...groups].map(([key,items])=>{
    const [x,y]=positions[key] || [112,48];
    const left=Math.max(5,Math.min(x-55,520)),top=Math.max(5,y-52);
    const label=eventTitle(items[0]);
    return <React.Fragment key={key}>
      {key!=='realm' && <path d={`M${left+50} ${top+24} L${x} ${y}`} stroke="#794421" pointerEvents="none"/>}
      <g data-kind={items[0].kind} role="button" tabIndex={0} aria-label={'展开'+label} onClick={()=>read(items[0])}
        onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();read(items[0]);}}}>
      <rect x={left} y={top} width="112" height="24" rx="3"/>
      <text x={left+7} y={top+16}>{label}{items.length>1?'　+'+(items.length-1):'　›'}</text>
    </g></React.Fragment>;
  })}</g>;
}
export function DispatchDetail({event,state,log,read,onClose}) {
  const ref=useRef(null);
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return ()=>dialog.close();},[]);
  const art=entries.get(event.scene);
  const siblings=log.filter(e=>e.regionId===event.regionId);
  const index=siblings.findIndex(item=>item.id===event.id);
  const place=state.regions.find(r=>r.id===event.regionId)?.name ?? '全域';
  return <dialog ref={ref} className="dispatch-dialog" aria-labelledby="dispatch-title" onCancel={onClose}
    onClick={e=>{if(e.target===ref.current)onClose();}}><article>
    <button className="dispatch-dismiss" aria-label="关闭河报" onClick={onClose}>×</button>
    {art && <img className="dispatch-image" src={'/cg/'+event.scene+'.jpg'} alt={art+' · 写实场景演绎'}/>}
    <div className="dispatch-copy"><small>{place}　／　第 {event.tick} 旬　／　{event.voice}</small>
      <h2 id="dispatch-title">{eventTitle(event)}</h2><p>{event.text}</p>
      <dl className="dispatch-facts">{event.facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>)}</dl>
      <p className="dispatch-hint">{advice[event.kind]}</p>
      {index>=0 && siblings.length>1 && <nav aria-label="同地河报">
        <button disabled={index===0} onClick={()=>read(siblings[index-1])}>较新一报</button>
        <span>{index+1} / {siblings.length}</span>
        <button disabled={index===siblings.length-1} onClick={()=>read(siblings[index+1])}>较早一报</button>
      </nav>}
      <button autoFocus onClick={onClose}>返回河图</button></div></article></dialog>;
}

export function FieldAlbum({events,read}) {
  return <details className="field-album"><summary>本局画录　{events.length} / {entries.size}</summary>
    <div className="album-grid">{events.map(event=><button key={event.scene} onClick={()=>read(event)}
      aria-label={'翻阅画录：'+eventTitle(event)}>
      <img loading="lazy" src={'/cg/'+event.scene+'.jpg'} alt=""/>
      <span>{eventTitle(event)}</span><small>第 {event.tick} 旬</small>
    </button>)}</div>
  </details>;
}
