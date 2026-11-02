import { dateAtTick } from './calendar';
import { stableSerialize } from './hash';
import type {
  ActorAction, ActorState, BalanceLedger, BalanceParameters, CanalReachState, Commitment, Demand,
  Inventory, LaborParameters, LoadClass, Petition, PreservationLiability, ProjectLaborSource,
  ProjectParameters, ProjectState, RegionState, ScenarioDefinition, ShipmentBatch, TransportEdge,
  TransportNode, WaterEdge, WaterNode,
} from './types';

type Check = (value: unknown, path: string) => void;
function fail(path: string, reason: string): never { throw new TypeError(`${path}: ${reason}`); }
const integer = (min = 0, max = Number.MAX_SAFE_INTEGER): Check => (value, path) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(path, `expected safe integer in ${min}..${max}`);
  }
};
const text: Check = (value, path) => {
  if (typeof value !== 'string' || value.trim().length === 0) fail(path, 'expected nonempty string');
};
const boolean: Check = (value, path) => { if (typeof value !== 'boolean') fail(path, 'expected boolean'); };
const oneOf = (...values: readonly string[]): Check => (value, path) => {
  if (typeof value !== 'string' || !values.includes(value)) fail(path, `expected ${values.join('|')}`);
};
const nullable = (check: Check): Check => (value, path) => { if (value !== null) check(value, path); };
const list = (check: Check): Check => (value, path) => {
  if (!Array.isArray(value)) fail(path, 'expected array');
  value.forEach((item: unknown, i) => check(item, `${path}[${i}]`));
};
const shape = <T>(fields: { [K in keyof T]-?: Check }): Check => (value, path) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object');
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!Object.hasOwn(fields, key)) fail(`${path}.${key}`, 'unknown field');
  for (const [key, check] of Object.entries<Check>(fields)) check(data[key], `${path}.${key}`);
};
const quantity = integer(), rate = integer(0, 10000), multiplier = integer(0, 100000);
const signed = integer(-Number.MAX_SAFE_INTEGER);
const ids = list(text), load = oneOf('small', 'standard', 'heavy');
const periods: Check = (value, path) => {
  list(integer(0, 35))(value, path);
  if (new Set(value as number[]).size !== (value as number[]).length) fail(path, 'duplicate period');
};
const region = shape<RegionState>({
  id: text, name: text, actorId: text, inventoryId: text, population: quantity,
  agriculturalCapacity: quantity, laborCapacity: quantity, subsistenceLabor: quantity,
  agriculturalLabor: quantity, corveeBurden: quantity, localRelations: signed, taxBase: quantity,
});
const actor = shape<ActorState>({
  id: text, name: text, kind: oneOf('central', 'royal', 'local', 'people', 'merchant'),
  regionIds: ids, goals: list(oneOf('supply', 'prestige', 'livelihood', 'trade')),
  treasury: quantity, executionCapacity: rate, commitmentIds: ids, actionIds: ids,
});
const action = shape<ActorAction>({
  id: text, actorId: text, regionIds: ids, kind: oneOf('military', 'palace', 'local_works', 'relief'),
  phase: oneOf('proposed', 'mobilizing', 'active', 'completed', 'cancelled', 'escalated'),
  startTick: quantity, endTick: quantity, laborRequest: quantity, allocationWeight: integer(1),
  commitmentIds: ids, sourceEventId: nullable(text),
});
const inventory = shape<Inventory>({ id: text, ownerId: text, regionId: text, grain: quantity, materials: quantity });
const waterNode = shape<WaterNode>({
  id: text, regionId: text, storage: quantity, capacity: quantity, level: signed,
  seasonalInflow: (v, p) => { list(quantity)(v, p); if ((v as unknown[]).length !== 36) fail(p, 'expected 36 periods'); },
  irrigationRequest: quantity, evaporation: quantity, policy: oneOf('balanced', 'navigation_first', 'irrigation_first'),
});
const waterEdge = shape<WaterEdge>({
  id: text, fromNodeId: text, toNodeId: nullable(text), capacity: quantity, controlled: boolean, available: boolean,
});
const transportNode = shape<TransportNode>({ id: text, regionId: text, inventoryId: text, transferCapacity: quantity });
const transportEdge = shape<TransportEdge>({
  id: text, fromNodeId: text, toNodeId: text, mode: oneOf('canal', 'river', 'land', 'sea'),
  waterEdgeId: nullable(text), capacity: quantity, travelTicks: integer(1), lossRate: rate,
  costPerLoad: quantity, maxLoadClass: load, openPeriods: periods, waterPerLoad: quantity, available: boolean,
});
const reach = shape<CanalReachState>({
  id: text, name: text, regionIds: ids, waterEdgeIds: ids, transportEdgeIds: ids, grade: load,
  status: oneOf('candidate', 'active', 'mothballed', 'decommissioning', 'retired'), silt: rate, damage: rate,
  maintenance: oneOf('minimum', 'standard', 'intensive'), maintenanceLabor: quantity, maintenanceCost: quantity,
  passage: oneOf('balanced', 'official_first', 'civil_first'), maxLoadClass: load,
  schedule: shape({ official: periods, civil: periods, trade: periods }), closedUntil: nullable(integer(1)),
  validPeriod: shape({ fromYear: signed, untilYearExclusive: nullable(signed) }), evidenceIds: ids,
});
const commitment = shape<Commitment>({
  id: text, actorId: text, projectId: nullable(text), regionId: text,
  resource: oneOf('treasury', 'grain', 'materials', 'labor'), amount: quantity,
  consumed: quantity, reserved: quantity, refunded: quantity, fromTick: quantity, untilTick: quantity,
  firmness: oneOf('hard', 'revocable'), status: oneOf('promised', 'escrowed', 'withdrawn', 'fulfilled'),
  sourceEventId: nullable(text),
});
const project = shape<ProjectState>({
  id: text, kind: oneOf('build', 'dredge', 'upgrade', 'reroute'), reachIds: ids, sponsorIds: ids,
  grade: load, laborMode: oneOf('normal', 'urgent'), startTick: quantity, allocationWeight: integer(1),
  phase: oneOf('survey', 'planned', 'construction', 'trial', 'operating', 'cancelled'),
  status: oneOf('active', 'paused', 'cancelled'), workRequired: quantity, workCompleted: quantity,
  grainSpent: quantity, materialsSpent: quantity, treasurySpent: quantity, commitmentIds: ids,
  laborSources: list(shape<ProjectLaborSource>({ regionId: text, requested: quantity, arrived: quantity, arrivalTick: quantity })),
  earliestCompletionTick: nullable(quantity), latestCompletionTick: nullable(quantity),
  trialTicksRemaining: quantity, replacesReachId: nullable(text),
});
const liability = shape<PreservationLiability>({
  id: text, reachId: text, projectId: nullable(text), responsibleActorId: text,
  cause: oneOf('project_cancelled', 'reach_status', 'reroute'),
  minimumLabor: quantity, minimumTreasury: quantity, reservedTreasury: quantity,
  exitWorkRequired: quantity, exitWorkCompleted: quantity, risk: rate,
  status: oneOf('unresolved', 'preserved', 'resolved'),
});
const demand = shape<Demand>({
  id: text, demandKey: text, ownerId: text, fromNodeId: text, toNodeId: text,
  purpose: oneOf('official', 'civil', 'trade'), cargo: oneOf('grain', 'materials'),
  requested: quantity, fulfilled: quantity, reservedInTransit: quantity, cancelled: quantity,
  deadlineTick: quantity, sourceEventId: nullable(text), status: oneOf('active', 'fulfilled', 'expired', 'cancelled'),
});
const shipment = shape<ShipmentBatch>({
  id: text, parentId: nullable(text), demandId: text, ownerId: text, purpose: oneOf('official', 'civil', 'trade'),
  cargo: oneOf('grain', 'materials'), quantity: quantity, lost: quantity, routeEdgeIds: ids,
  routeIndex: quantity, currentNodeId: text, remainingTravelTicks: quantity,
  status: oneOf('waiting', 'travelling', 'delivered', 'lost'),
});
const petition = shape<Petition>({
  id: text, actorId: text, regionId: text, reachIds: ids,
  issueType: oneOf('supply', 'labor', 'water', 'navigation', 'maintenance'), causeRootId: text,
  factIds: ids, eventIds: ids, urgency: rate, deadlineTick: nullable(quantity), affectedPopulation: quantity,
  status: oneOf('open', 'responded', 'resolved'), lastChangedTick: quantity, cooldownUntil: quantity,
});
const preservation = shape<ProjectParameters['preservation'][LoadClass]>({
  minimumTreasuryUnits: quantity, minimumLaborUnits: quantity, exitWorkFractionBp: rate,
});
const projectParameters = shape<ProjectParameters>({
  workUnitsByGrade: shape({ small: quantity, standard: quantity, heavy: quantity }),
  workMultiplierByKindBp: shape({ build: multiplier, dredge: multiplier, upgrade: multiplier, reroute: multiplier }),
  dredgeSiltReductionBpByGrade: shape({ small: rate, standard: rate, heavy: rate }),
  treasuryUnitsPerWork: quantity, grainUnitsPerWork: quantity, materialUnitsPerWork: quantity,
  trialTicks: quantity, completionUncertaintyBp: rate, pausedDamageBpPerTick: rate,
  preservation: shape({ small: preservation, standard: preservation, heavy: preservation }),
});
const laborParameters = shape<LaborParameters>({
  burdenUnitsPerHundredForcedLabor: quantity, burdenRecoveryUnitsPerTick: quantity,
  remoteArrivalTicks: quantity,
  maintenanceMultiplierBp: shape({ minimum: multiplier, standard: multiplier, intensive: multiplier }),
  siltMaintenanceSurchargeBp: multiplier,
  normalProjectLaborUnitsByGrade: shape({ small: quantity, standard: quantity, heavy: quantity }),
  urgentLaborMultiplierBp: multiplier,
});
const balanceParameters = shape<BalanceParameters>({
  version: text, labor: laborParameters, projects: projectParameters,
});
const scenarioCheck = shape<ScenarioDefinition>({
  id: text, version: text, rulesVersion: text, calendar: shape({ startYear: signed }), endTick: integer(1),
  parameters: balanceParameters,
  initial: shape<ScenarioDefinition['initial']>({
    regions: list(region), actors: list(actor), actions: list(action), inventories: list(inventory),
    waterNodes: list(waterNode), waterEdges: list(waterEdge), transportNodes: list(transportNode),
    transportEdges: list(transportEdge), reaches: list(reach), projects: list(project),
    liabilities: list(liability), commitments: list(commitment), demands: list(demand),
    inTransit: list(shipment), petitions: list(petition),
  }),
});

export function validateScenario(scenario: ScenarioDefinition): void {
  stableSerialize(scenario);
  scenarioCheck(scenario, 'scenario');
  dateAtTick(scenario.calendar, scenario.endTick);
  const s = scenario.initial;
  const collections = Object.values(s);
  const allIds = new Set<string>();
  for (const collection of collections) for (const entity of collection) {
    if (allIds.has(entity.id)) fail(entity.id, 'duplicate entity ID');
    allIds.add(entity.id);
  }
  const refs = (values: readonly string[], entities: readonly { readonly id: string }[], path: string) => {
    const existing = new Set(entities.map(e => e.id));
    if (new Set(values).size !== values.length) fail(path, 'duplicate reference');
    for (const id of values) if (!existing.has(id)) fail(path, `unknown reference ${id}`);
  };
  const ref = (id: string | null, entities: readonly { readonly id: string }[], path: string) => {
    if (id !== null) refs([id], entities, path);
  };
  const range = (a: number, b: number, path: string) => { if (a > b) fail(path, 'reversed/oversubscribed range'); };
  for (const r of s.regions) {
    ref(r.actorId, s.actors, r.id); ref(r.inventoryId, s.inventories, r.id);
    range(r.subsistenceLabor, r.laborCapacity, r.id);
  }
  for (const a of s.actors) {
    refs(a.regionIds, s.regions, a.id); refs(a.commitmentIds, s.commitments, a.id); refs(a.actionIds, s.actions, a.id);
  }
  for (const a of s.actions) {
    ref(a.actorId, s.actors, a.id); refs(a.regionIds, s.regions, a.id);
    refs(a.commitmentIds, s.commitments, a.id); range(a.startTick, a.endTick, a.id);
  }
  for (const i of s.inventories) { ref(i.ownerId, s.actors, i.id); ref(i.regionId, s.regions, i.id); }
  for (const n of s.waterNodes) { ref(n.regionId, s.regions, n.id); range(n.storage, n.capacity, n.id); }
  for (const e of s.waterEdges) { ref(e.fromNodeId, s.waterNodes, e.id); ref(e.toNodeId, s.waterNodes, e.id); }
  for (const n of s.transportNodes) { ref(n.regionId, s.regions, n.id); ref(n.inventoryId, s.inventories, n.id); }
  for (const e of s.transportEdges) {
    ref(e.fromNodeId, s.transportNodes, e.id); ref(e.toNodeId, s.transportNodes, e.id);
    ref(e.waterEdgeId, s.waterEdges, e.id);
  }
  for (const r of s.reaches) {
    refs(r.regionIds, s.regions, r.id); refs(r.waterEdgeIds, s.waterEdges, r.id); refs(r.transportEdgeIds, s.transportEdges, r.id);
    if (r.validPeriod.untilYearExclusive !== null && r.validPeriod.fromYear >= r.validPeriod.untilYearExclusive) {
      fail(r.id, 'empty/reversed validity period');
    }
  }
  for (const c of s.commitments) {
    ref(c.actorId, s.actors, c.id); ref(c.projectId, s.projects, c.id); ref(c.regionId, s.regions, c.id);
    range(c.fromTick, c.untilTick, c.id);
    if (c.consumed + c.reserved + c.refunded !== c.amount) fail(c.id, 'commitment does not reconcile');
  }
  for (const p of s.projects) {
    refs(p.reachIds, s.reaches, p.id); refs(p.sponsorIds, s.actors, p.id); refs(p.commitmentIds, s.commitments, p.id);
    ref(p.replacesReachId, s.reaches, p.id); range(p.workCompleted, p.workRequired, p.id);
    for (const l of p.laborSources) { ref(l.regionId, s.regions, p.id); range(l.arrived, l.requested, p.id); }
    if (p.earliestCompletionTick !== null && p.latestCompletionTick !== null) {
      range(p.earliestCompletionTick, p.latestCompletionTick, p.id);
    }
  }
  for (const l of s.liabilities) {
    ref(l.reachId, s.reaches, l.id); ref(l.projectId, s.projects, l.id); ref(l.responsibleActorId, s.actors, l.id);
    range(l.exitWorkCompleted, l.exitWorkRequired, l.id);
  }
  const demandKeys = new Set<string>();
  for (const d of s.demands) {
    ref(d.ownerId, s.actors, d.id); ref(d.fromNodeId, s.transportNodes, d.id); ref(d.toNodeId, s.transportNodes, d.id);
    range(d.fulfilled + d.reservedInTransit + d.cancelled, d.requested, d.id);
    if (demandKeys.has(d.demandKey)) fail(d.id, 'duplicate demand key');
    demandKeys.add(d.demandKey);
  }
  for (const b of s.inTransit) {
    ref(b.parentId, s.inTransit, b.id); ref(b.demandId, s.demands, b.id); ref(b.ownerId, s.actors, b.id);
    ref(b.currentNodeId, s.transportNodes, b.id); refs(b.routeEdgeIds, s.transportEdges, b.id);
    range(b.routeIndex, b.routeEdgeIds.length, b.id);
  }
  for (const p of s.petitions) {
    ref(p.actorId, s.actors, p.id); ref(p.regionId, s.regions, p.id); refs(p.reachIds, s.reaches, p.id);
  }
}

export function stationaryBalance(total: number): BalanceLedger {
  quantity(total, 'ledger total');
  return { opening: total, incoming: 0, outgoing: 0, consumed: 0, closing: total };
}
