import trial from './scenario.json';

export const scenarios = [
  { id: 'trial', title: '两岸试局', description: '两年教学试局。' },
  { id: 'ming', title: '明初漕运沙盘 · 1410—1424', description: '十五年漕运经营。地图连接和参数经过玩法抽象。' },
  { id: 'sui-tang', title: '隋前至五代 · 550—979', description: '六阶段长时段沙盘。运河与负担持续继承，政权权属转换仍待完善。' },
];

export function buildScenario(id) {
  const scenario = structuredClone(trial);
  if (id === 'trial') return scenario;
  scenario.id = 'campaign-' + id;
  scenario.calendar.startYear = id === 'ming' ? 1410 : 550;
  scenario.endTick = id === 'ming' ? 540 : 15480;
  scenario.parameters.world = { populationGrowthBp: 100, militaryCostPerTick: 8, palaceCostPerTick: 4 };
  const source = scenario.initial;
  const names = id === 'ming' ? ['江南', '淮安', '京畿', '杭州'] : ['江都', '洛阳', '涿郡', '余杭'];
  const ids = ['a', 'b', 'c', 'd'];
  const region = source.regions[0], stock = source.inventories[0];
  const water = source.waterNodes[0], port = source.transportNodes[0];
  const edge = source.transportEdges[0], channel = source.waterEdges[0], reach = source.reaches[0];
  source.regions = ids.map((id, i) => ({ ...region, id, name: names[i], inventoryId: 'stock-' + id,
    agriculturalCapacity: i === 0 ? 80 : i === 3 ? 30 : 0, taxBase: 80 }));
  source.inventories = ids.map((id, i) => ({ ...stock, id: 'stock-' + id, regionId: id,
    grain: i === 0 ? 10000 : i === 3 ? 5000 : 120 }));
  source.waterNodes = ids.map((id, i) => ({ ...water, id: 'water-' + id, regionId: id,
    capacity: 1000000, storage: i === 0 ? 300 : 100,
    seasonalInflow: Array.from({ length: 36 }, (_, k) => i === 0 ? (k >= 12 && k <= 24 ? 45 : 20) : 0) }));
  source.transportNodes = ids.map(id => ({ ...port, id: 'port-' + id, regionId: id, inventoryId: 'stock-' + id }));
  const links = [['a', 'b'], ['b', 'c'], ['a', 'd']];
  source.waterEdges = links.map(([a, b]) => ({ ...channel, id: 'water-' + a + b, fromNodeId: 'water-' + a, toNodeId: 'water-' + b }));
  source.transportEdges = links.map(([a, b]) => ({ ...edge, id: 'transport-' + a + b,
    fromNodeId: 'port-' + a, toNodeId: 'port-' + b, waterEdgeId: 'water-' + a + b }));
  source.reaches = links.map(([a, b], i) => ({ ...reach, id: a + b, name: names[ids.indexOf(a)] + '—' + names[ids.indexOf(b)],
    regionIds: [a, b], waterEdgeIds: ['water-' + a + b], transportEdgeIds: ['transport-' + a + b],
    silt: i === 0 ? 6000 : 0, validPeriod: { fromYear: scenario.calendar.startYear, untilYearExclusive: null } }));
  scenario.parameters.supply.rules = ['b', 'c'].map((id, i) => ({ id: 'supply-' + id,
    sourceNodeId: 'port-a', destNodeId: 'port-' + id, ownerId: 'central', purpose: 'civil', cargo: 'grain',
    targetStock: i === 0 ? 120 : 80, consumptionPerTick: i === 0 ? 15 : 6 }));
  source.actions = [];
  for (let start = 6; start < scenario.endTick; start += 108) {
    const palace = Math.floor(start / 108) % 2 === 1;
    source.actions.push({ ...trial.initial.actions[0], id: 'world-' + start,
      kind: palace ? 'palace' : 'military', phase: 'proposed', startTick: start,
      endTick: Math.min(start + 12, scenario.endTick), laborRequest: palace ? 25 : 45 });
  }
  source.actors[0].regionIds = ids;
  source.actors[0].actionIds = source.actions.map(action => action.id);
  return scenario;
}

export function chapterAt(state) {
  if (state.scenarioId !== 'campaign-sui-tang') return '';
  const year = state.calendar.startYear + Math.floor(state.tick / 36);
  return year < 581 ? '分流之世' : year < 618 ? '贯通南北' : year < 755 ? '旧渠新用'
    : year < 820 ? '兵乱与财赋' : year < 907 ? '河道与地方' : '多国共水';
}
