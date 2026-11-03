import { buildScenario, scenarios, chapterAt } from '../trial/scenarios.js';
import { createGame, applyCommand, tick, hashState, preview } from '../core/index.ts';
import { drawRandom } from '../core/rng.ts';

let scenario;
let state;
let seed = 7;
let log = [];
let metrics;
let finished = null;
let climate = '平水';
let logCounter = 0;
const versions = { trial: '两岸试局', ming: '明初漕运', 'sui-tang': '隋前至五代' };

function record(voice, text, kind = 'world', scene = kind, regionId = null) {
  const region = state.regions.find(item => item.id === regionId);
  const inventory = region && state.inventories.find(item => item.id === region.inventoryId);
  const facts = region ? [['地区役负', region.corveeBurden], ['当地仓粮', inventory?.grain ?? 0]]
    : [['国库', state.actors.find(actor=>actor.id==='central')?.treasury ?? 0]];
  const supply = state.ledger.supplyConsumption;
  if (supply && (scene === 'shortage' || scene === 'famine')) facts.push(['应供',supply.requested],['实供',supply.consumed]);
  log.unshift({ id: ++logCounter, tick: state.tick, voice, text, kind, scene, regionId, facts });
  log = log.slice(0, 100);
}

export function startGame(id, gameSeed = 7) {
  scenario = buildScenario(id);
  seed = gameSeed;
  state = createGame(scenario, seed);
  log = [];
  logCounter = 0;
  climate = '平水';
  finished = null;
  metrics = { playerLabor: 0, externalLabor: 0, emptyWarehouseTicks: 0,
    grainDelivered: 0, worstBurden: 0, consecutiveEmpty: 0, years: 0 };
  record('百姓', '愿运道常通，仓粮不绝。请观察各地供需，再决定河工。', 'petition', 'petition', 'b');
  return view();
}

function prepareYear() {
  if (state.scenarioId === 'river-trial' || state.tick % 36 !== 0) return;
  const random = drawRandom(state.rngStates, 'disasters');
  climate = random.value < .2 ? '枯水' : random.value > .85 ? '汛期' : '平水';
  const original = scenario.initial.waterNodes;
  const factor = climate === '枯水' ? .35 : climate === '汛期' ? 1.7 : 1;
  const waterNodes = state.waterNodes.map(node => ({
    ...node,
    seasonalInflow: original.find(item => item.id === node.id).seasonalInflow.map(amount => Math.floor(amount * factor)),
  }));
  const reaches = state.reaches.map((reach, index) => climate === '汛期' && index === 0
    ? { ...reach, damage: Math.min(10000, reach.damage + 300) } : reach);
  state = { ...state, rngStates: random.states, waterNodes, reaches };
  if (state.tick > 0) {
    state = { ...state, reaches: state.reaches.map(reach => reach.id === 'ab'
      ? { ...reach, silt: Math.min(10000, reach.silt + 200) } : reach) };
  }
  settlePolitics();
  record('地方', climate === '枯水' ? '本年枯水，供水减少，通航与灌溉承压。'
    : climate === '汛期' ? '本年汛水增多，主河段出现损伤，请留意有效运力。' : '本年水情平稳。', 'water', ({'枯水':'drought','汛期':'flood','平水':'calm'})[climate], 'a');
}

function settlePolitics() {
  if (state.tick === 0) return;
  const year = state.calendar.startYear + Math.floor(state.tick / 36);
  const annualShortage = metrics.emptyWarehouseTicks - (metrics.lastYearShortage ?? 0);
  metrics.lastYearShortage = metrics.emptyWarehouseTicks;
  const recipients = new Set(scenario.parameters.supply.rules.map(rule =>
    state.transportNodes.find(node => node.id === rule.destNodeId).regionId));
  const regions = state.regions.map(region => {
    const change = annualShortage > 12 && recipients.has(region.id) ? -15 : region.corveeBurden > 1000 ? -8 : 4;
    return { ...region, localRelations: Math.max(-100, Math.min(100, region.localRelations + change)) };
  });
  let actors = [...state.actors];
  if (state.scenarioId.startsWith('campaign-sui-tang') && year >= 755) {
    const unsettled = regions.find(region => region.id === 'c' && region.actorId === 'central'
      && region.localRelations < -20);
    if (unsettled) {
      const central = actors.find(actor => actor.id === 'central');
      const regionalId = 'regional-' + unsettled.id;
      const transfer = Math.floor(central.treasury / 10);
      actors = actors.map(actor => actor.id === central.id
        ? { ...actor, treasury: actor.treasury - transfer,
          regionIds: actor.regionIds.filter(id => id !== unsettled.id) } : actor);
      actors.push({ ...central, id: regionalId, name: year >= 907 ? '北方割据政权' : '地方军镇',
        kind: 'local', regionIds: [unsettled.id], treasury: transfer, actionIds: [], commitmentIds: [] });
      unsettled.actorId = regionalId;
      record('地方', '长期役负与缺粮削弱了中枢约束，北方转由地方政权征税。中央仓储与在途物资继续保有原所有权。', 'politics', 'secession', unsettled.id);
    }
  }
  const transportEdges = state.transportEdges.map(edge => {
    const from = state.transportNodes.find(node => node.id === edge.fromNodeId);
    const to = state.transportNodes.find(node => node.id === edge.toNodeId);
    const a = regions.find(region => region.id === from.regionId);
    const b = regions.find(region => region.id === to.regionId);
    const restricted = a.actorId !== b.actorId && Math.min(a.localRelations, b.localRelations) < -40;
    const original = scenario.initial.transportEdges.find(item => item.id === edge.id);
    if (edge.available && restricted) record('商旅', '跨境通道受地方关系限制，相关货物将等待通行。水网继续按物理连接结算。', 'politics', 'border', b.id);
    return { ...edge, available: original.available && !restricted };
  });
  state = { ...state, regions, actors, transportEdges };
}

function transition(before) {
  for (const action of state.actions) {
    const old = before.actions.find(item => item.id === action.id);
    if (old?.phase === action.phase) continue;
    const subject = action.kind === 'palace' ? '皇室营建' : '中央军役';
    record(action.kind === 'palace' ? '皇室' : '中央',
      subject + (action.phase === 'mobilizing' ? '即将动员。' : action.phase === 'active'
        ? '开始，地方劳力与财政被征用。' : '结束，征用劳力重新参与分配。'), 'action', action.kind + '-' + action.phase, action.regionIds[0]);
  }
  for (const project of state.projects) {
    const old = before.projects.find(item => item.id === project.id);
    if (old?.phase !== project.phase) record('河官', project.phase === 'operating'
      ? '试航完成，工程成果已生效。' : project.phase === 'trial'
        ? '施工完成，进入试航。' : '河工开始施工。', 'project', 'project-' + project.phase, state.reaches.find(r=>project.reachIds.includes(r.id))?.regionIds[0]);
  }
  if (chapterAt(before) !== chapterAt(state)) record('史官',
    '进入「' + chapterAt(state) + '」。沿用实际河道、国库、人口与工程负担。', 'chapter');
}

function tally() {
  for (const row of state.ledger.labor) {
    if (row.activityId.startsWith('project:')) metrics.playerLabor += row.allocated;
    if (row.activityId.startsWith('action:')) metrics.externalLabor += row.allocated;
  }
  const consumed = state.ledger.supplyConsumption;
  const empty = consumed !== undefined && consumed.consumed < consumed.requested;
  if (empty) metrics.emptyWarehouseTicks += 1;
  metrics.consecutiveEmpty = empty ? metrics.consecutiveEmpty + 1 : 0;
  metrics.worstBurden = Math.max(metrics.worstBurden, ...state.regions.map(region => region.corveeBurden));
  metrics.grainDelivered = state.demands.reduce((sum, demand) => sum + demand.fulfilled, 0);
  metrics.years = Math.floor(state.tick / 36);
  if (metrics.consecutiveEmpty === 1) record('百姓', '本旬实际到粮不足，愿保运道。', 'petition', 'shortage');
  if (metrics.consecutiveEmpty === 36) record('地方', '供粮不足已持续一年，地方秩序承压。', 'crisis', 'famine');
  // Completed batch records have no future effect. Keep parents still referenced
  // by a live child, while preserving cumulative fulfillment in demand counters.
  const live = state.inTransit.filter(batch => ['waiting', 'travelling'].includes(batch.status));
  const parents = new Set(live.map(batch => batch.parentId));
  state = { ...state, inTransit: state.inTransit.filter(batch =>
    ['waiting', 'travelling'].includes(batch.status) || parents.has(batch.id)) };
}

function ending() {
  const collapse = metrics.consecutiveEmpty >= 108;
  if (!state.ending && !collapse) return;
  const useful = state.reaches.filter(reach => reach.status === 'active' && reach.damage < 8000);
  const ratio = metrics.playerLabor / Math.max(1, metrics.externalLabor + metrics.playerLabor);
  const title = collapse ? '民生凋敝' : metrics.worstBurden > 5000 && ratio > .6
    ? '役重民疲' : metrics.grainDelivered === 0 ? '守成观望'
      : metrics.emptyWarehouseTicks < Math.max(12, state.tick * .1) ? '水运济民' : '兴废之间';
  finished = {
    title, cause: collapse ? '主要受粮地区连续三年供粮不足，观察提前结束。' : '抵达本剧本观察期末。',
    world: metrics.emptyWarehouseTicks + ' 旬未能足额供应口粮，累计送达 ' + metrics.grainDelivered + '。',
    legacy: useful.length + ' 段河道仍可用，未决保全责任 ' +
      state.liabilities.filter(item => item.status !== 'resolved').length + ' 项。',
    responsibility: '河工实际征役 ' + metrics.playerLabor + '，人间军役与营建征役 ' + metrics.externalLabor + '。',
  };
  const scene = { '民生凋敝':'collapse', '役重民疲':'burden', '守成观望':'stasis',
    '水运济民':'prosperity','兴废之间':'mixed' }[title];
  record('史官', finished.cause+' '+finished.world+' '+finished.responsibility, 'ending', scene);
}

export function advanceGame(limit = 36) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 360) throw Error('推进范围须为 1—360 旬。');
  for (let index = 0; index < limit && !finished; index += 1) {
    const beforeState = state;
    const beforeLog = [...log];
    const beforeClimate = climate;
    const beforeMetrics = { ...metrics };
    const beforeCounter = logCounter;
    try {
      const oldHead = log[0]?.id;
      prepareYear();
      const before = state;
      state = tick(state, scenario).state;
      transition(before);
      tally();
      if(state.parameters.world && state.tick % 36 === 0) {
        const tax = state.regions.reduce((sum,region)=>sum+region.taxBase,0);
        record('户部','岁收结算，各地按税收归属合计入账 '+tax+' 财政单位。','annual','tax');
      }
      ending();
      if (log[0]?.id !== oldHead || state.tick % 36 === 0 || finished) break;
    } catch (error) {
      state = beforeState; log = beforeLog; climate = beforeClimate; metrics = beforeMetrics; logCounter = beforeCounter;
      throw error;
    }
  }
  return view();
}

export function commandGame(command) {
  if (finished) throw Error('本局已经结束。');
  const result = applyCommand(state, {
    expectedRevision: state.revision, commandId: 'order-' + state.revision, command,
  }, scenario);
  if (!result.ok) throw Error(result.error.message);
  state = result.state;
  const scene = command.type === 'SET_PASSAGE' ? (command.closedUntil ? 'close' : 'open')
    : command.type === 'SET_PROJECT_STATUS' ? command.status : command.projectKind || command.type;
  const project = state.projects.find(item => item.id === command.projectId);
  const reachId = command.reachId ?? command.reachIds?.[0] ?? project?.reachIds[0];
  const label = {
    dredge:'财政已托管，实际进度取决于工地粮料与本旬劳力。',
    paused:'河工已暂停，完成的工作量保留。',active:'河工恢复，后续按实际配额推进。',
    close:'河段临时关闭，船队按通航日程等待。',open:'临时关闭已解除，船队仍受闸水与运力限制。',
  }[scene] ?? '投入与影响计入实际账本。';
  record('河官', '运河方案已执行。'+label, 'command', scene,
    state.reaches.find(item => item.id === reachId)?.regionIds[0]);
  return view();
}

export function previewGame(command) {
  return preview(state, command, scenario);
}

export function view() {
  return { state, metrics: { ...metrics }, log: [...log], finished, climate,
    title: scenarios.find(item => 'campaign-' + item.id === scenario.id)?.title ?? versions[scenario.id.replace('campaign-', '')] ?? '两岸试局',
    chapter: chapterAt(state), hash: hashState(state) };
}

export { scenarios };
