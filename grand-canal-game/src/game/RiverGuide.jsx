import React,{useEffect,useState} from 'react';

const targets=['#scenario','#start-scenario','.map-panel svg','[data-lens="水情"]','[data-lens="漕运"]','#grade','#grade','#labor','#dredge','#advance-one','.metrics'];
const titles=['展开河图','进入两岸试局','认出两座粮仓','查过闸用水','查运力','试算大修','改回小修','看谁出工','批准第一项河工','让人间走一旬','读本旬结果'];
export default function RiverGuide({starts,scenario,lens,state,game,project,grade,mode,estimate,reach}){
 const [step,S]=useState(-2),[origin,O]=useState(starts),[base,B]=useState(null);
 const active=step>=0;
 const treasury=state.actors.find(a=>a.id==='central').treasury;
 const snapshot=()=>({treasury,tick:state.tick,labor:game.metrics.playerLabor,delivery:game.metrics.grainDelivered});
 function begin(){O(starts);S(scenario==='trial'?1:0)}
 useEffect(()=>{
 if(!active)return;
 if(step<2&&starts!==origin){O(starts);if(state.scenarioId==='river-trial'){B(snapshot());S(2)}else S(0);return}
 if(step>=2&&starts!==origin){O(starts);if(state.scenarioId==='river-trial'){B(snapshot());S(2)}else S(-2);return}
 if(step===0&&scenario==='trial')S(1);
 if(step===1&&scenario!=='trial')S(0);
 if(step===3&&lens==='水情'||step===4&&lens==='漕运'||step===5&&grade==='standard'||step===6&&grade==='small'||step===8&&project||step===9&&state.tick>base.tick)S(step+1);
 },[step,scenario,starts,lens,grade,project,state.tick]);
 useEffect(()=>{
 if(!active)return;
 const el=document.querySelector(targets[step]);if(!el)return;
 el.classList.add('lesson-target');el.scrollIntoView({block:'center'});
 return ()=>el.classList.remove('lesson-target');
 },[step]);
 if(!active)return <section className="lesson-invite"><strong>初掌河图 · 两岸试局</strong>　从一船漕粮开始，亲手治一次河。 <button onClick={begin}>{step===-2?'进入新手引导':'重看新手引导'}</button></section>;
 const price=estimate?.feasible?estimate.estimate.treasuryRequired:'—';
 const notes=['点击发光的「展开河图」下拉框，选择「两岸试局」。','点击「开始剧本」，从教学局第一旬学起。这会替换当前局面。',
 '明代经运河北运漕粮，供应京师。两岸试局用南仓、北岸缩演这道难题；这两座粮仓是教学设定。找出地图两端的粮数：'+state.inventories.map(i=>i.grain).join('、')+'。仓中有粮，不等于粮已送达。',
 '点「水情」。节点显示蓄水，受控航段会标出每载用水；水量也会限制船运。',
 '点回「漕运」，读航段旁的河况上限。它是通行能力，实际送达还要等船走完航程。',
 '打开「疏浚规模」，选「大修」。这里只估价，不会扣钱。',
 '大修当前预算：'+price+'。记住这个数，再选「小修」，比较两种方案。',
 '小修预算：'+price+'；中央国库：'+treasury+'。征役栏选「常役」。河工与农业、军役争用劳力；这次先用常役，避免加急。',
 '点「开工疏浚」。先记国库 '+treasury+'、河工累计征役 '+game.metrics.playerLabor+'。批准工程和实际出工是两个时点。',
 '工程已立项。点真正的「推进一旬」，让河工、运输与口粮消耗一起结算。',
 '从立项前到第 '+state.tick+' 旬：国库 '+base?.treasury+' → '+treasury+'；河工征役 '+base?.labor+' → '+game.metrics.playerLabor+'；累计送达 '+base?.delivery+' → '+game.metrics.grainDelivered+'。'+(game.metrics.grainDelivered===base?.delivery?'本段时间没有新增送达，船在途中不会计入。':'送达增加，说明已有货物抵达。')+' 接下来观察残淤（当前 '+reach.silt+'）与工程进度，决定继续施工还是暂停。'];
 return <aside className="lesson-coach" aria-label="两岸操作引导"><small>两岸试局　{step+1} / {titles.length}</small><h3>{titles[step]}</h3><p aria-live="polite">{notes[step]}</p>
 {step===2&&<button onClick={()=>S(3)}>已找到粮仓，查水情</button>}
 {step===7&&<button disabled={mode!=='normal'} onClick={()=>{B(snapshot());S(8)}}>使用常役，准备开工</button>}
 {step===10&&<button onClick={()=>S(-1)}>完成引导，自由治河</button>}
 <button onClick={()=>S(-1)}>退出引导</button></aside>;
}

