import React,{useEffect,useState} from 'react';

export default function OpeningLesson({state,selectedEdge,surveyed,teaching=false,onFinish}){
  const [dismissed,setDismissed]=useState(false);
  const [scheduledAt,setScheduledAt]=useState(null);
  const reach=state.reaches.find(r=>r.id==='relief');
  const edge=reach.transportEdgeIds[0];
  const project=state.projects.find(p=>p.reachIds.includes(reach.id)&&p.phase!=='cancelled');
  const selected=selectedEdge===edge && (surveyed===reach.id || reach.status==="active");
  const scheduled=reach.schedule.civil.length===24;
  useEffect(()=>{if(scheduled&&scheduledAt===null)setScheduledAt(state.tick)},[scheduled,state.tick,scheduledAt]);
  const stages=[
    ['在河图上勘选复渠',teaching?'在地图上点击发光的「勘」签，勘选南仓东汊。≈ 表示拟建自流渠，尚未开工。':'江南要向淮安供粮。点地图上沿岸复渠的「勘」签；≈ 表示拟建自流渠。','#survey-relief'],
    ['核对预算并发令','在下方「勘渠与营造」看需款、工量和口粮。保留「另开新渠」，点「批准另开新渠」。','#authorize-cut'],
    ['看着河工竣工','点「推进到关键节点」。征役、施工与试航需要时间；每次停下后可继续推进。','.timebar .primary'],
    ['给新渠排船期','新渠已经通航。到「本段通航令」，将每月通航改为「上、中旬通航」。民粮与其他船货都会按新的船期候航。','#sailing-days'],
    ['核对调度结果','点「推进一旬」，让船期生效，再看当旬能否发船和本段在途粮数。','#advance-one'],
    ['实操完成',teaching?'已学会勘址、开渠、排船期。明初正式关使用同一套控件。':'此后可继续经营明初全局，或改为每旬通航，比较解限后的送达量。','#traffic-orders']
  ];
  const step=!selected?0:!project?1:reach.status!=='active'?2:!scheduled?3:scheduledAt===null||state.tick<=scheduledAt?4:5;
  const [title,hint,selector]=stages[step];
  useEffect(()=>{if(dismissed)return;const el=document.querySelector(selector);el?.classList.add('lesson-target');el?.scrollIntoView({block:'center'});return()=>el?.classList.remove('lesson-target')},[selector,dismissed]);
  if(dismissed)return null;
  return <aside className="lesson-coach" aria-live="polite"><small>{teaching?"两岸试局 · 开渠通航":"明初漕运 · 江淮复渠实操"}　第 {step+1} / 6 步</small><h3>{title}</h3><p>{hint}</p>{teaching&&state.tick>=3&&<p>水报：{state.tick<12?'上游减水，旧渠闸耗和新渠浅水会以不同方式限制发运。':'上游来水已恢复。'} {state.tick>=23&&(state.tick<26?'政报：北岸临检，只能经东汊新发船。':'政报：临检已解除，两渠可按各自通航令发船。')}</p>}{step===2&&<p>已完工量 {project.workCompleted} / {project.workRequired}</p>}{teaching&&step===5&&<a href="/atlas.html?practice=ming">进入明初正式关</a>}<button onClick={()=>{setDismissed(true);onFinish?.()}}>{step===5?'继续经营':'退出指引'}</button></aside>
}
