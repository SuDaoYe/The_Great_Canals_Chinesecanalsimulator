import type {
  ActorAction, ActorState, BalanceParameters, CanalReachState, Commitment, Demand,
  Inventory, ProjectState, RegionState, ScenarioDefinition, SimulationEntities,
  TransportEdge, TransportNode, WaterEdge, WaterNode,
} from '../../src/core/types';

export type FixtureName = 'minimal' | 'peace' | 'conscription' | 'palace-and-canal'
  | 'bottleneck' | 'wider-upstream' | 'shared-water' | 'crisis' | 'legacy';

// Synthetic coefficients only. They are experimental game units, not measured
// historical labor, grain, money or water values.
function parameters(): BalanceParameters {
  return {
    version: 'g2-0',
    labor: {
      burdenUnitsPerHundredForcedLabor: 50,
      burdenRecoveryUnitsPerTick: 2,
      remoteArrivalTicks: 1,
      maintenanceMultiplierBp: { minimum: 5000, standard: 10000, intensive: 20000 },
      siltMaintenanceSurchargeBp: 50000,
      normalProjectLaborUnitsByGrade: { small: 20, standard: 40, heavy: 60 },
      urgentLaborMultiplierBp: 15000,
    },
    projects: {
      workUnitsByGrade: { small: 240, standard: 480, heavy: 960 },
      workMultiplierByKindBp: { build: 15000, dredge: 10000, upgrade: 12000, reroute: 18000 },
      dredgeSiltReductionBpByGrade: { small: 4000, standard: 7000, heavy: 9000 },
      treasuryUnitsPerWork: 1,
      grainUnitsPerWork: 1,
      materialUnitsPerWork: 1,
      trialTicks: 1,
      completionUncertaintyBp: 2500,
      pausedDamageBpPerTick: 200,
      preservation: {
        small: { minimumTreasuryUnits: 20, minimumLaborUnits: 10, exitWorkFractionBp: 2500 },
        standard: { minimumTreasuryUnits: 40, minimumLaborUnits: 20, exitWorkFractionBp: 2500 },
        heavy: { minimumTreasuryUnits: 60, minimumLaborUnits: 30, exitWorkFractionBp: 2500 },
      },
    },
    // Synthetic abstract water/transport coefficients (not historical values).
    water: {
      navigationMinLevel: 1,
      irrigationPriorityBp: { balanced: 5000, navigation_first: 0, irrigation_first: 10000 },
    },
    transport: {
      maxBatchSizeByClass: { small: 20, standard: 50, heavy: 100 },
      transitLaborPerLoad: 1,
      underfundedMaintenanceDamageBpPerTick: 500,
    },
    // Empty by default: old fixtures keep their exact demand/consumption
    // behavior, while tests may opt in to explicit periodic supply rules.
    supply: { rules: [] },
  };
}

const ALL_PERIODS = Array.from({ length: 36 }, (_, index) => index);

function baseEntities(): SimulationEntities {
  return {
    regions: ['a', 'b'].map(id => ({
      id, name: id, actorId: 'central', inventoryId: `stock-${id}`,
      population: 1000, agriculturalCapacity: 100, laborCapacity: 100,
      subsistenceLabor: 0, agriculturalLabor: 60, corveeBurden: 0,
      localRelations: 0, taxBase: 100,
    })),
    actors: [{ id: 'central', name: 'central', kind: 'central', regionIds: ['a', 'b'],
      goals: ['supply'], treasury: 10000, executionCapacity: 10000,
      commitmentIds: [], actionIds: [] }],
    inventories: ['a', 'b'].map(id => ({
      id: `stock-${id}`, ownerId: 'central', regionId: id, grain: 10000, materials: 10000,
    })),
    waterNodes: ['a', 'b'].map(id => ({
      id: `water-${id}`, regionId: id, storage: 100, capacity: 1000, level: 1,
      seasonalInflow: ALL_PERIODS.map(() => 0), irrigationRequest: 0,
      evaporation: 0, policy: 'balanced',
    })),
    waterEdges: [{ id: 'water-ab', fromNodeId: 'water-a', toNodeId: 'water-b',
      capacity: 100, controlled: true, available: true }],
    transportNodes: ['a', 'b'].map(id => ({
      id: `port-${id}`, regionId: id, inventoryId: `stock-${id}`, transferCapacity: 100,
    })),
    transportEdges: [{ id: 'transport-ab', fromNodeId: 'port-a', toNodeId: 'port-b',
      mode: 'canal', waterEdgeId: 'water-ab', capacity: 100, travelTicks: 2,
      lossRate: 0, costPerLoad: 1, maxLoadClass: 'standard', openPeriods: [...ALL_PERIODS],
      waterPerLoad: 1, available: true }],
    reaches: [makeReach('ab', 4)],
    actions: [], projects: [], liabilities: [], commitments: [], demands: [], inTransit: [], petitions: [],
  };
}

function makeReach(id: string, maintenanceLabor: number): CanalReachState {
  return {
    id, name: id, regionIds: ['a', 'b'], waterEdgeIds: ['water-ab'],
    transportEdgeIds: ['transport-ab'], grade: 'small', status: 'active',
    silt: 6000, damage: 0, maintenance: 'standard', maintenanceLabor,
    maintenanceCost: 1, passage: 'balanced', maxLoadClass: 'standard',
    schedule: { official: [...ALL_PERIODS], civil: [...ALL_PERIODS], trade: [...ALL_PERIODS] },
    closedUntil: null, validPeriod: { fromYear: 1400, untilYearExclusive: null }, evidenceIds: [],
  };
}

function makeProject(): ProjectState {
  return {
    id: 'p1', kind: 'dredge', reachIds: ['ab'], sponsorIds: ['central'],
    grade: 'small', laborMode: 'normal', startTick: 0, allocationWeight: 1,
    phase: 'construction', status: 'active', workRequired: 240, workCompleted: 0,
    grainSpent: 0, materialsSpent: 0, treasurySpent: 0,
    commitmentIds: ['commit-p1'],
    laborSources: [{ regionId: 'a', requested: 20, arrived: 20, arrivalTick: 0 }],
    earliestCompletionTick: 13, latestCompletionTick: 17,
    trialTicksRemaining: 0, replacesReachId: null,
  };
}

function makeCommitment(): Commitment {
  return {
    id: 'commit-p1', actorId: 'central', projectId: 'p1', regionId: 'a',
    resource: 'treasury', amount: 240, consumed: 0, reserved: 240, refunded: 0,
    fromTick: 0, untilTick: 540, firmness: 'hard', status: 'escrowed', sourceEventId: null,
  };
}

function workScenario(id: 'peace' | 'conscription'): ScenarioDefinition {
  const entities = baseEntities();
  entities.reaches = [makeReach('ab', 0)];
  entities.projects = [makeProject()];
  entities.commitments = [makeCommitment()];
  const central = entities.actors[0]!;
  entities.actors = [{ ...central, treasury: central.treasury - 240 }];
  if (id === 'conscription') {
    const war: ActorAction = {
      id: 'war-a', actorId: 'central', regionIds: ['a'], kind: 'military',
      phase: 'proposed', startTick: 3, endTick: 9, laborRequest: 40,
      allocationWeight: 1, commitmentIds: [], sourceEventId: null,
    };
    entities.actions = [war];
    entities.actors = entities.actors.map(actor => ({ ...actor, actionIds: ['war-a'] }));
  }
  return {
    id, version: '0.1.0', rulesVersion: 'g2-0', calendar: { startYear: 1410 },
    endTick: 540, parameters: parameters(), initial: entities,
  };
}

function palaceScenario(): ScenarioDefinition {
  const entities = baseEntities();
  entities.regions = entities.regions.map(region => ({
    ...region, agriculturalLabor: 0,
  }));
  entities.reaches = [makeReach('ab', 0)];
  entities.projects = [{
    ...makeProject(),
    laborSources: [{ regionId: 'a', requested: 80, arrived: 80, arrivalTick: 0 }],
    earliestCompletionTick: 4, latestCompletionTick: 5,
  }];
  entities.commitments = [makeCommitment()];
  entities.actors = [
    { ...entities.actors[0]!, treasury: 9760 },
    { id: 'court', name: 'court', kind: 'royal', regionIds: ['a'], goals: ['prestige'],
      treasury: 10000, executionCapacity: 10000, commitmentIds: [], actionIds: ['palace-a'] },
  ];
  entities.actions = [{
    id: 'palace-a', actorId: 'court', regionIds: ['a'], kind: 'palace',
    phase: 'active', startTick: 0, endTick: 540, laborRequest: 80,
    allocationWeight: 1, commitmentIds: [], sourceEventId: null,
  }];
  return {
    id: 'palace-and-canal', version: '0.1.0', rulesVersion: 'g2-0',
    calendar: { startYear: 1410 }, endTick: 540,
    parameters: parameters(), initial: entities,
  };
}

function transportRegion(id: string): RegionState {
  return {
    id, name: id, actorId: 'central', inventoryId: `stock-${id}`,
    population: 1000, agriculturalCapacity: 0, laborCapacity: 1000,
    subsistenceLabor: 0, agriculturalLabor: 0, corveeBurden: 0,
    localRelations: 0, taxBase: 0,
  };
}

function corridorInventory(id: string, grain: number): Inventory {
  return { id: `stock-${id}`, ownerId: 'central', regionId: id, grain, materials: 0 };
}

// bottleneck vs wider-upstream: identical supply, demand and a 60/tick lock edge;
// only the upstream edge capacity differs (100 vs 180), so widening the
// non-bottleneck cannot raise deliveries. Water is intentionally absent.
function corridorEntities(upstreamCapacity: number): SimulationEntities {
  const regionIds = ['src', 'mid', 'dst'];
  const actors: ActorState[] = [{
    id: 'central', name: 'central', kind: 'central', regionIds,
    goals: ['supply'], treasury: 100000, executionCapacity: 10000,
    commitmentIds: [], actionIds: [],
  }];
  const transportNodes: TransportNode[] = regionIds.map(id => ({
    id: `port-${id}`, regionId: id, inventoryId: `stock-${id}`, transferCapacity: 1000,
  }));
  const transportEdges: TransportEdge[] = [
    { id: 'up', fromNodeId: 'port-src', toNodeId: 'port-mid', mode: 'canal',
      waterEdgeId: null, capacity: upstreamCapacity, travelTicks: 1, lossRate: 0,
      costPerLoad: 1, maxLoadClass: 'standard', openPeriods: [...ALL_PERIODS],
      waterPerLoad: 0, available: true },
    { id: 'lock', fromNodeId: 'port-mid', toNodeId: 'port-dst', mode: 'canal',
      waterEdgeId: null, capacity: 60, travelTicks: 1, lossRate: 0,
      costPerLoad: 1, maxLoadClass: 'standard', openPeriods: [...ALL_PERIODS],
      waterPerLoad: 0, available: true },
  ];
  const demands: Demand[] = [{
    id: 'd1', demandKey: 'supply-src-dst', ownerId: 'central',
    fromNodeId: 'port-src', toNodeId: 'port-dst', purpose: 'civil', cargo: 'grain',
    loadClass: 'standard', requested: 1000, fulfilled: 0, reservedInTransit: 0,
    cancelled: 0, deadlineTick: 540, sourceEventId: null, status: 'active',
  }];
  return {
    regions: regionIds.map(transportRegion),
    actors, actions: [],
    inventories: [corridorInventory('src', 10000), corridorInventory('mid', 0), corridorInventory('dst', 0)],
    waterNodes: [], waterEdges: [], transportNodes, transportEdges,
    reaches: [], projects: [], liabilities: [], commitments: [],
    demands, inTransit: [], petitions: [],
  };
}

// shared-water: one source node feeding two controlled locks. Each passing batch
// releases waterPerLoad from the shared source to its branch, so the two
// branches can never each consume the whole inflow.
function sharedWaterEntities(): SimulationEntities {
  const regionIds = ['src', 'a', 'b'];
  const actors: ActorState[] = [{
    id: 'central', name: 'central', kind: 'central', regionIds,
    goals: ['supply'], treasury: 100000, executionCapacity: 10000,
    commitmentIds: [], actionIds: [],
  }];
  const waterNodes: WaterNode[] = [
    { id: 'ws', regionId: 'src', storage: 100, capacity: 1000, level: 1,
      seasonalInflow: ALL_PERIODS.map(() => 0), irrigationRequest: 0, evaporation: 0, policy: 'balanced' },
    { id: 'wa', regionId: 'a', storage: 0, capacity: 1000, level: 1,
      seasonalInflow: ALL_PERIODS.map(() => 0), irrigationRequest: 0, evaporation: 0, policy: 'balanced' },
    { id: 'wb', regionId: 'b', storage: 0, capacity: 1000, level: 1,
      seasonalInflow: ALL_PERIODS.map(() => 0), irrigationRequest: 0, evaporation: 0, policy: 'balanced' },
  ];
  const waterEdges: WaterEdge[] = [
    { id: 'we-a', fromNodeId: 'ws', toNodeId: 'wa', capacity: 1000, controlled: true, available: true },
    { id: 'we-b', fromNodeId: 'ws', toNodeId: 'wb', capacity: 1000, controlled: true, available: true },
  ];
  const transportNodes: TransportNode[] = regionIds.map(id => ({
    id: `port-${id}`, regionId: id, inventoryId: `stock-${id}`, transferCapacity: 1000,
  }));
  const transportEdges: TransportEdge[] = [
    { id: 'te-a', fromNodeId: 'port-src', toNodeId: 'port-a', mode: 'canal',
      waterEdgeId: 'we-a', capacity: 100, travelTicks: 1, lossRate: 0,
      costPerLoad: 1, maxLoadClass: 'standard', openPeriods: [...ALL_PERIODS],
      waterPerLoad: 1, available: true },
    { id: 'te-b', fromNodeId: 'port-src', toNodeId: 'port-b', mode: 'canal',
      waterEdgeId: 'we-b', capacity: 100, travelTicks: 1, lossRate: 0,
      costPerLoad: 1, maxLoadClass: 'standard', openPeriods: [...ALL_PERIODS],
      waterPerLoad: 1, available: true },
  ];
  const makeDemand = (id: string, toPort: string, key: string): Demand => ({
    id, demandKey: key, ownerId: 'central', fromNodeId: 'port-src', toNodeId: toPort,
    purpose: 'civil', cargo: 'grain', loadClass: 'standard', requested: 100, fulfilled: 0,
    reservedInTransit: 0, cancelled: 0, deadlineTick: 540, sourceEventId: null, status: 'active',
  });
  return {
    regions: regionIds.map(transportRegion),
    actors, actions: [],
    inventories: [corridorInventory('src', 10000), corridorInventory('a', 0), corridorInventory('b', 0)],
    waterNodes, waterEdges, transportNodes, transportEdges,
    reaches: [], projects: [], liabilities: [], commitments: [],
    demands: [makeDemand('d-a', 'port-a', 'supply-a'), makeDemand('d-b', 'port-b', 'supply-b')],
    inTransit: [], petitions: [],
  };
}

export function makeScenario(name: FixtureName): ScenarioDefinition {
  switch (name) {
    case 'minimal':
      return {
        id: 'minimal', version: '0.1.0', rulesVersion: 'g2-0',
        calendar: { startYear: 1410 }, endTick: 540,
        parameters: parameters(), initial: baseEntities(),
      };
    case 'peace':
    case 'conscription':
      return workScenario(name);
    case 'palace-and-canal':
      return palaceScenario();
    case 'bottleneck':
      return {
        id: 'bottleneck', version: '0.1.0', rulesVersion: 'g2-0',
        calendar: { startYear: 1410 }, endTick: 540,
        parameters: parameters(), initial: corridorEntities(100),
      };
    case 'wider-upstream':
      return {
        id: 'wider-upstream', version: '0.1.0', rulesVersion: 'g2-0',
        calendar: { startYear: 1410 }, endTick: 540,
        parameters: parameters(), initial: corridorEntities(180),
      };
    case 'shared-water':
      return {
        id: 'shared-water', version: '0.1.0', rulesVersion: 'g2-0',
        calendar: { startYear: 1410 }, endTick: 540,
        parameters: parameters(), initial: sharedWaterEntities(),
      };
    default:
      throw new Error(`Fixture not implemented yet: ${name}`);
  }
}
