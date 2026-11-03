import TrafficOrders from './TrafficOrders.jsx';
import React,{useEffect,useState} from 'react';
const names={candidate:'待勘渠址',active:'行水通航',mothballed:'停养封存',decommissioning:'退役保全',retired:'已废弃'};
export default function CanalWorks({state,selectedEdge,select,command,request,disabled}){
 const reach=state.reaches.find(r=>r.transportEdgeIds.includes(selectedEdge));
 const [kind,setKind]=useState('build'),[grade,setGrade]=useState('small'),[quote,setQuote]=useState(null);
 const candidate=reach?.status==='candidate';
 const parallel=state.reaches.find(r=>r.id!==reach?.id&&r.status==='active'&&r.regionIds.join()===reach?.regionIds.join());
 const choices=candidate?[['build','另开新渠'],...(parallel?[['reroute','开新渠，替代同向旧渠']]:[])]:[['dredge','清淤疏浚'],...(reach?.grade!=='heavy'?[['upgrade','拓宽渠槽']]:[]),...(reach?.grade!=='small'?[['narrow','缩减渠槽']]:[])];
 const action=choices.some(c=>c[0]===kind)?kind:choices[0][0];
 const plan=reach&&{type:'PLAN_PROJECT',projectKind:action,reachIds:[reach.id],sponsorIds:['central'],startTick:state.tick,grade,laborMode:'normal',...(action==='reroute'?{replacesReachId:parallel.id}:{})};
 const key=JSON.stringify([state.revision,plan]);
 useEffect(()=>{let live=true;if(plan)request({type:'preview',command:plan}).then(v=>{if(live)setQuote({key,v})}).catch(()=>{if(live)setQuote(null)});return()=>{live=false}},[key]);
 const preview=quote?.key===key&&quote.v.feasible?quote.v.estimate:null;
 const occupied=reach&&state.projects.find(p=>p.reachIds.includes(reach.id)&&!['operating','cancelled'].includes(p.phase));
 return <section className="card" id="canal-works"><h2>勘渠与营造</h2><p>先勘水源与两端仓口，再征役开槽。试航后才有运力。旧渠可岁修清淤，也可开旁渠分流、待新渠通航后退旧。</p><label>选址或查看旧渠 <select id="canal-site" value={reach?.id??''} onChange={e=>select(state.reaches.find(r=>r.id===e.target.value).transportEdgeIds[0])}><option disabled value="">选择河段</option>{state.reaches.map(r=><option key={r.id} value={r.id}>{r.name==='ab'?'南北旧渠':r.name} · {names[r.status]}</option>)}</select></label>
 {reach&&<><p>{reach.regionIds.map(id=>state.regions.find(r=>r.id===id)?.name.replace(/^a$/,'南仓').replace(/^b$/,'北岸')).join(' → ')}　{names[reach.status]}　淤积 {reach.silt/100}%</p>
 {reach.status==='active'&&<TrafficOrders {...{state,reach,command,disabled}}/>}
 {occupied?<p>工程进度 {occupied.workCompleted} / {occupied.workRequired} · {occupied.phase==='trial'?'试航':'备工与施工'}</p>:['active','candidate'].includes(reach.status)&&<><label>工程 <select value={action} onChange={e=>setKind(e.target.value)}>{choices.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>工量 <select value={grade} onChange={e=>setGrade(e.target.value)}><option value="small">小</option><option value="standard">中</option><option value="heavy">大</option></select></label><p>{preview?'需款 '+preview.treasuryRequired+' · 工量 '+preview.workRequired+' · 粮 '+preview.grainAtSiteRequired:'方案待核或资源不足'}</p><button id="authorize-cut" disabled={!preview||disabled} onClick={()=>command(plan)}>批准{choices.find(c=>c[0]===action)[1]}</button></>}
 {reach.status==='active'&&!occupied&&<><label>养护 <select disabled={disabled} value={reach.maintenance} onChange={e=>command({type:'SET_MAINTENANCE',reachId:reach.id,policy:e.target.value})}><option value="minimum">最低养护</option><option value="standard">常年岁修</option><option value="intensive">加强养护</option></select></label><button disabled={disabled} onClick={()=>command({type:'SET_REACH_STATUS',reachId:reach.id,status:'mothballed'})}>停养封存</button></>}
 {reach.status==='mothballed'&&['active','decommissioning'].map((status,i)=><button key={status} disabled={disabled} onClick={()=>command({type:'SET_REACH_STATUS',reachId:reach.id,status})}>{['复开旧渠','永久退役'][i]}</button>)}</>}</section>
}
