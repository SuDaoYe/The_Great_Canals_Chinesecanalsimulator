import trial from './scenario.json';

export const scenarios = [
  { id: 'trial', title: '两岸试局', description: '两年教学试局。' },
  { id: 'ming', title: '明初漕运沙盘 · 1410—1424', description: '十五年漕运经营。地图连接和参数经过玩法抽象。' },
  { id: 'sui-tang', title: '隋前至五代 · 550—979', description: '六阶段长时段沙盘。运河与负担持续继承，政权权属转换仍待完善。' },
];

scenarios.push(...[[550,'分流之世'],[581,'贯通南北'],[618,'旧渠新用'],[755,'兵乱与财赋'],[820,'河道与地方'],[907,'多国共水']].map(([year,title])=>({
  id:'sui-tang-'+year,title:year+'年 · '+title,
  description:'独立章节采用合成初态。连续长局保留已发生的河工与资源后果。',
})));

function withCanalSites(scenario, teaching) {
  const initial = scenario.initial;
  const sites = teaching ? [['relief','南仓东汊','a','b',1]] :
    [['relief','沿岸复渠','a','b',1],['inland','北向联运渠','a','c',3]];
  for (const [id,name,from,to,travelTicks] of sites) {
    const waterId='water-'+id, edgeId='transport-'+id;
    initial.waterEdges.push({...initial.waterEdges[0],id:waterId,controlled:id!=='relief',fromNodeId:'water-'+from,toNodeId:'water-'+to});
    initial.transportEdges.push({...initial.transportEdges[0],id:edgeId,waterEdgeId:waterId,fromNodeId:'port-'+from,toNodeId:'port-'+to,travelTicks,waterPerLoad:id==='relief'?0:1,costPerLoad:0});
    initial.reaches.push({...initial.reaches[0],id,name,status:'candidate',grade:'standard',silt:0,damage:0,regionIds:[from,to],waterEdgeIds:[waterId],transportEdgeIds:[edgeId]});
  }
  return scenario;
}

export function buildScenario(id) {
  const scenario = structuredClone(trial);
  if (id === 'trial') { scenario.initial.regions[0].laborCapacity=240; scenario.parameters.world={populationGrowthBp:50,militaryCostPerTick:8,palaceCostPerTick:4}; return withCanalSites(scenario,true); }
  scenario.id = 'campaign-' + id;
  scenario.calendar.startYear = id === 'ming' ? 1410 : 550;
  scenario.endTick = id === 'ming' ? 540 : 15480;
  const chapterStart = Number(id.split('-').at(-1));
  if (id.startsWith('sui-tang-') && Number.isInteger(chapterStart)) {
    const nextYear = ({550:581,581:618,618:755,755:820,820:907,907:980})[chapterStart];
    if (!nextYear) throw Error('未知章节。');
    scenario.calendar.startYear = chapterStart;
    scenario.endTick = (nextYear - chapterStart) * 36;
  }
  scenario.parameters.world = { populationGrowthBp: 100, militaryCostPerTick: 8, palaceCostPerTick: 4 };
  const source = scenario.initial;
  const names = id === 'ming' ? ['江南', '淮安', '京畿', '杭州'] : ['江都', '洛阳', '涿郡', '余杭'];
  const ids = ['a', 'b', 'c', 'd'];
  const region = source.regions[0], stock = source.inventories[0];
  const water = source.waterNodes[0], port = source.transportNodes[0];
  const edge = source.transportEdges[0], channel = source.waterEdges[0], reach = source.reaches[0];
  source.regions = ids.map((id, i) => ({ ...region, id, name: names[i], inventoryId: 'stock-' + id,
    agriculturalCapacity: i === 0 ? 80 : i === 3 ? 30 : 0,
    agriculturalLabor: i === 0 || i === 3 ? 60 : 0, laborCapacity: i === 0 ? 400 : 100, taxBase: 80 }));
  source.inventories = ids.map((id, i) => ({ ...stock, id: 'stock-' + id, regionId: id,
    grain: i === 0 ? 10000 : i === 3 ? 5000 : 120,
    materials: scenario.id === 'campaign-ming' ? 10000 : 100000 }));
  source.waterNodes = ids.map((id, i) => ({ ...water, id: 'water-' + id, regionId: id,
    capacity: 1000000, storage: i === 0 ? 300 : 100,
    seasonalInflow: Array.from({ length: 36 }, (_, k) => i === 0 ? (k >= 12 && k <= 24 ? 120 : 60) : 0) }));
  source.transportNodes = ids.map(id => ({ ...port, id: 'port-' + id, regionId: id, inventoryId: 'stock-' + id }));
  const links = [['a', 'b'], ['b', 'c'], ['a', 'd']];
  source.waterEdges = links.map(([a, b]) => ({ ...channel, id: 'water-' + a + b, controlled:b!=='d', fromNodeId: 'water-' + a, toNodeId: 'water-' + b }));
  source.transportEdges = links.map(([a, b]) => ({ ...edge, id: 'transport-' + a + b,
    fromNodeId: 'port-' + a, toNodeId: 'port-' + b, waterEdgeId: 'water-' + a + b, waterPerLoad:b==='d'?0:1 }));
  source.reaches = links.map(([a, b], i) => ({ ...reach, id: a + b, name: names[ids.indexOf(a)] + '—' + names[ids.indexOf(b)],
    regionIds: [a, b], waterEdgeIds: ['water-' + a + b], transportEdgeIds: ['transport-' + a + b],
    silt: i === 0 ? 6000 : 0, validPeriod: { fromYear: scenario.calendar.startYear, untilYearExclusive: null } }));
  scenario.parameters.supply.rules = ['b', 'c'].map((id, i) => ({ id: 'supply-' + id,
    sourceNodeId: 'port-a', destNodeId: 'port-' + id, ownerId: 'central', purpose: 'civil', cargo: 'grain',
    targetStock: i === 0 ? 120 : 80, consumptionPerTick: i === 0 ? 35 : 16 }));
  source.actions = [];
  for (let start = 6; start < scenario.endTick; start += 108) {
    const palace = Math.floor(start / 108) % 2 === 1;
    source.actions.push({ ...trial.initial.actions[0], id: 'world-' + start,
      kind: palace ? 'palace' : 'military', phase: 'proposed', startTick: start,
      endTick: Math.min(start + 12, scenario.endTick), laborRequest: palace ? 25 : 45 });
  }
  source.actors[0].regionIds = ids;
  source.actors[0].actionIds = source.actions.map(action => action.id);
  return withCanalSites(scenario,false);
}

export function chapterAt(state) {
  if (!state.scenarioId.startsWith('campaign-sui-tang')) return '';
  const year = state.calendar.startYear + Math.floor(state.tick / 36);
  return year < 581 ? '分流之世' : year < 618 ? '贯通南北' : year < 755 ? '旧渠新用'
    : year < 820 ? '兵乱与财赋' : year < 907 ? '河道与地方' : '多国共水';
}

