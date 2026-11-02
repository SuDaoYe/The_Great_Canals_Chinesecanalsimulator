import { expect, test } from 'vitest';
import { createGame, tick } from '../../src/core/index';
import type {
  ActorState, Demand, GameState, Inventory, LoadClass, RegionState, ScenarioDefinition,
  TransportEdge, TransportNode,
} from '../../src/core/types';
import { inspect, runTicks } from '../fixtures/inspect';
import { makeScenario } from '../fixtures/scenarios';

const ALL_PERIODS = Array.from({ length: 36 }, (_, index) => index);

function region(id: string): RegionState {
  return {
    id, name: id, actorId: 'central', inventoryId: `stock-${id}`,
    population: 1000, agriculturalCapacity: 0, laborCapacity: 1000,
    subsistenceLabor: 0, agriculturalLabor: 0, corveeBurden: 0,
    localRelations: 0, taxBase: 0,
  };
}
function inventory(id: string, grain: number): Inventory {
  return { id: `stock-${id}`, ownerId: 'central', regionId: id, grain, materials: 0 };
}
function node(id: string, transferCapacity = 1000): TransportNode {
  return { id: `port-${id}`, regionId: id, inventoryId: `stock-${id}`, transferCapacity };
}

// One demand, one directed edge src -> dst (no water, no reaches).
function singleEdgeScenario(opts: {
  requested: number; travelTicks: number; lossRate: number;
  loadClass?: LoadClass; maxLoadClass?: LoadClass; capacity?: number;
  openPeriods?: number[]; edgeAvailable?: boolean; cargo?: 'grain' | 'materials';
}): ScenarioDefinition {
  const base = makeScenario('minimal');
  const actors: ActorState[] = [{
    id: 'central', name: 'central', kind: 'central', regionIds: ['src', 'dst'],
    goals: ['supply'], treasury: 100000, executionCapacity: 10000,
    commitmentIds: [], actionIds: [],
  }];
  const edge: TransportEdge = {
    id: 'e', fromNodeId: 'port-src', toNodeId: 'port-dst', mode: 'canal',
    waterEdgeId: null, capacity: opts.capacity ?? 1000, travelTicks: opts.travelTicks,
    lossRate: opts.lossRate, costPerLoad: 1, maxLoadClass: opts.maxLoadClass ?? 'standard',
    openPeriods: opts.openPeriods ?? [...ALL_PERIODS], waterPerLoad: 0,
    available: opts.edgeAvailable ?? true,
  };
  const demand: Demand = {
    id: 'd1', demandKey: 'supply-src-dst', ownerId: 'central',
    fromNodeId: 'port-src', toNodeId: 'port-dst', purpose: 'civil',
    cargo: opts.cargo ?? 'grain', loadClass: opts.loadClass ?? 'standard',
    requested: opts.requested, fulfilled: 0, reservedInTransit: 0, cancelled: 0,
    deadlineTick: 540, sourceEventId: null, status: 'active',
  };
  return {
    ...base,
    id: 'single-edge', rulesVersion: 'g2-0',
    initial: {
      ...base.initial,
      regions: [region('src'), region('dst')],
      actors,
      inventories: [inventory('src', 10000), inventory('dst', 0)],
      waterNodes: [], waterEdges: [],
      transportNodes: [node('src'), node('dst')],
      transportEdges: [edge],
      reaches: [], projects: [], liabilities: [], commitments: [],
      demands: [demand], inTransit: [], petitions: [],
    },
  };
}

// Physical cargo total, computed independently from the ledger helper.
function cargoTotal(state: GameState): number {
  const inInventories = state.inventories.reduce((sum, item) => sum + item.grain + item.materials, 0);
  const inTransit = state.inTransit
    .filter(batch => batch.status === 'waiting' || batch.status === 'travelling')
    .reduce((sum, batch) => sum + batch.quantity, 0);
  return inInventories + inTransit;
}

test('widening a non-bottleneck does not increase deliveries', () => {
  const a = makeScenario('bottleneck'), b = makeScenario('wider-upstream');
  const x = inspect(runTicks(createGame(a, 2), a, 10));
  const y = inspect(runTicks(createGame(b, 2), b, 10));
  expect(x.totalDelivered).toBeGreaterThan(0);
  expect(y.totalDelivered).toBe(x.totalDelivered);
  expect(y.totalWaterBalanceError).toBe(0);
  expect(y.totalCargoBalanceError).toBe(0);
});

test('cargo ledger reconciles with independently summed inventories and transit', () => {
  const scenario = makeScenario('bottleneck');
  const state = runTicks(createGame(scenario, 3), scenario, 6);
  const ledger = state.ledger.cargo;
  expect(ledger.opening + ledger.incoming).toBe(ledger.closing + ledger.outgoing + ledger.consumed);
  expect(ledger.closing).toBe(cargoTotal(state));
  expect(state.ledger.water.opening + state.ledger.water.incoming)
    .toBe(state.ledger.water.closing + state.ledger.water.outgoing + state.ledger.water.consumed);
});

test('a two-edge shipment does not arrive instantly', () => {
  const scenario = makeScenario('bottleneck'); // up (1 tick) + lock (1 tick)
  const initial = createGame(scenario, 4);
  const one = runTicks(initial, scenario, 1);
  expect(one.demands[0]!.fulfilled).toBe(0);
  expect(one.demands[0]!.reservedInTransit).toBe(60);
  const two = runTicks(initial, scenario, 2);
  expect(two.demands[0]!.fulfilled).toBe(0);
  const three = runTicks(initial, scenario, 3);
  expect(three.demands[0]!.fulfilled).toBe(60);
});

test('a demand of 20 with a two-tick journey dispatches once, not twice', () => {
  const scenario = singleEdgeScenario({ requested: 20, travelTicks: 2, lossRate: 0 });
  const initial = createGame(scenario, 5);
  const one = tick(initial, scenario).state;
  expect(one.demands[0]!.reservedInTransit).toBe(20);
  expect(one.demands[0]!.fulfilled).toBe(0);
  const two = tick(one, scenario).state;
  expect(two.demands[0]!.reservedInTransit).toBe(20);
  expect(two.inTransit).toHaveLength(1);
  const three = tick(two, scenario).state;
  expect(three.demands[0]!.fulfilled).toBe(20);
  expect(three.demands[0]!.reservedInTransit).toBe(0);
});

test('loss of five opens exactly five replenishment', () => {
  const scenario = singleEdgeScenario({ requested: 20, travelTicks: 2, lossRate: 2500 });
  let state = createGame(scenario, 6);
  state = tick(state, scenario).state; // dispatch 20
  state = tick(state, scenario).state; // travelling
  state = tick(state, scenario).state; // arrive: lose 5, deliver 15, re-dispatch 5
  const demand = state.demands[0]!;
  expect(demand.fulfilled).toBe(15);
  expect(demand.reservedInTransit).toBe(5);
  expect(demand.fulfilled + demand.reservedInTransit).toBeLessThanOrEqual(demand.requested);
  expect(state.inTransit.some(batch => batch.lost > 0)).toBe(true);
});

test('a heavy demand transships into standard sub-batches on a standard route', () => {
  const scenario = singleEdgeScenario({
    requested: 100, travelTicks: 1, lossRate: 0, loadClass: 'heavy', maxLoadClass: 'standard',
  });
  const state = runTicks(createGame(scenario, 7), scenario, 2);
  expect(state.demands[0]!.loadClass).toBe('heavy');
  expect(state.inTransit.every(batch => batch.loadClass !== 'heavy')).toBe(true);
  expect(state.demands[0]!.fulfilled).toBeGreaterThan(0);
  expect(state.inTransit.some(batch => batch.parentId !== null)).toBe(true);
});

test('cancelling a demand returns goods to the owner at the safe node', () => {
  const scenario = singleEdgeScenario({ requested: 20, travelTicks: 2, lossRate: 0 });
  let state = createGame(scenario, 8);
  state = tick(state, scenario).state; // dispatch 20
  state = { ...state, demands: state.demands.map(demand => ({ ...demand, status: 'cancelled' as const })) };
  state = tick(state, scenario).state; // travelling
  state = tick(state, scenario).state; // arrive -> return to dst (owned by central)
  const dst = state.inventories.find(item => item.regionId === 'dst')!;
  expect(dst.grain).toBe(20);
  expect(state.demands[0]!.reservedInTransit).toBe(0);
  expect(cargoTotal(state)).toBe(10000); // no cargo lost, no duplicate
});

test('closing one edge blocks only the demand routed through it', () => {
  const base = makeScenario('bottleneck');
  const scenario: ScenarioDefinition = {
    ...base, id: 'two-branch', rulesVersion: 'g2-0',
    initial: {
      ...base.initial,
      transportNodes: [node('src'), node('a'), node('b')],
      transportEdges: [
        { id: 'te-a', fromNodeId: 'port-src', toNodeId: 'port-a', mode: 'canal', waterEdgeId: null,
          capacity: 100, travelTicks: 1, lossRate: 0, costPerLoad: 1, maxLoadClass: 'standard',
          openPeriods: [...ALL_PERIODS], waterPerLoad: 0, available: true },
        { id: 'te-b', fromNodeId: 'port-src', toNodeId: 'port-b', mode: 'canal', waterEdgeId: null,
          capacity: 100, travelTicks: 1, lossRate: 0, costPerLoad: 1, maxLoadClass: 'standard',
          openPeriods: [...ALL_PERIODS], waterPerLoad: 0, available: false },
      ],
      inventories: [inventory('src', 10000), inventory('a', 0), inventory('b', 0)],
      regions: [region('src'), region('a'), region('b')],
      actors: [{
        id: 'central', name: 'central', kind: 'central', regionIds: ['src', 'a', 'b'],
        goals: ['supply'], treasury: 100000, executionCapacity: 10000, commitmentIds: [], actionIds: [],
      }],
      demands: [
        { id: 'd-a', demandKey: 'a', ownerId: 'central', fromNodeId: 'port-src', toNodeId: 'port-a',
          purpose: 'civil', cargo: 'grain', loadClass: 'standard', requested: 100, fulfilled: 0,
          reservedInTransit: 0, cancelled: 0, deadlineTick: 540, sourceEventId: null, status: 'active' },
        { id: 'd-b', demandKey: 'b', ownerId: 'central', fromNodeId: 'port-src', toNodeId: 'port-b',
          purpose: 'civil', cargo: 'grain', loadClass: 'standard', requested: 100, fulfilled: 0,
          reservedInTransit: 0, cancelled: 0, deadlineTick: 540, sourceEventId: null, status: 'active' },
      ],
    },
  };
  const state = runTicks(createGame(scenario, 11), scenario, 2);
  const a = state.demands.find(demand => demand.id === 'd-a')!;
  const b = state.demands.find(demand => demand.id === 'd-b')!;
  expect(a.fulfilled + a.reservedInTransit).toBeGreaterThan(0);
  expect(b.fulfilled).toBe(0);
  expect(b.reservedInTransit).toBe(0);
});

test('a water cycle is rejected at scenario creation', () => {
  const base = makeScenario('minimal');
  const cyclic: ScenarioDefinition = {
    ...base, initial: { ...base.initial,
      waterEdges: [
        { id: 'we-a', fromNodeId: 'water-a', toNodeId: 'water-b', capacity: 100, controlled: true, available: true },
        { id: 'we-b', fromNodeId: 'water-b', toNodeId: 'water-a', capacity: 100, controlled: true, available: true },
      ],
      reaches: [], transportEdges: [],
    },
  };
  expect(() => createGame(cyclic, 7)).toThrow(/cycle/);
});

test('shared source releases water to branches without double-consuming it', () => {
  const scenario = makeScenario('shared-water');
  const state = runTicks(createGame(scenario, 9), scenario, 3);
  const ws = state.waterNodes.find(node => node.id === 'ws')!;
  const wa = state.waterNodes.find(node => node.id === 'wa')!;
  const wb = state.waterNodes.find(node => node.id === 'wb')!;
  expect(ws.storage).toBe(0);
  expect(wa.storage + wb.storage).toBe(100); // released into downstream, never duplicated
  const ledger = state.ledger.water;
  expect(ledger.opening + ledger.incoming).toBe(ledger.closing + ledger.outgoing + ledger.consumed);
  expect(ledger.outgoing).toBe(0);
  expect(ledger.consumed).toBe(0);
  const delivered = state.demands.reduce((sum, demand) => sum + demand.fulfilled, 0);
  expect(delivered).toBeLessThanOrEqual(100);
});

test('water exiting the network counts as boundary outflow, not consumption', () => {
  const base = makeScenario('minimal');
  const scenario: ScenarioDefinition = {
    ...base, rulesVersion: 'g2-0', initial: { ...base.initial,
      waterNodes: base.initial.waterNodes.map(node => node.id === 'water-a'
        ? { ...node, storage: 100, capacity: 100, evaporation: 0,
            seasonalInflow: Array.from({ length: 36 }, (_, period) => period === 0 ? 100 : 0) }
        : { ...node, storage: 0, capacity: 100, evaporation: 0 }),
      waterEdges: [
        { id: 'we-out', fromNodeId: 'water-a', toNodeId: null, capacity: 1000, controlled: false, available: true },
      ],
      reaches: [], transportEdges: [],
    },
  };
  const state = runTicks(createGame(scenario, 12), scenario, 1);
  const ledger = state.ledger.water;
  expect(ledger.opening).toBe(100);
  expect(ledger.incoming).toBe(100);
  expect(ledger.outgoing).toBe(100);
  expect(ledger.consumed).toBe(0);
  expect(ledger.closing).toBe(100);
});

test('an empty canal earns no toll revenue', () => {
  const base = makeScenario('bottleneck');
  const scenario: ScenarioDefinition = {
    ...base, rulesVersion: 'g2-0', initial: { ...base.initial, demands: [] },
  };
  const initial = createGame(scenario, 10);
  const before = initial.actors[0]!.treasury;
  const state = runTicks(initial, scenario, 5);
  expect(state.actors[0]!.treasury).toBe(before);
  expect(state.demands).toHaveLength(0);
});

test('a shared edge caps combined flow from two demands', () => {
  const base = makeScenario('bottleneck');
  const scenario: ScenarioDefinition = {
    ...base, rulesVersion: 'g2-0', initial: {
      ...base.initial,
      transportNodes: [node('src'), node('dst')],
      transportEdges: [{
        id: 'shared', fromNodeId: 'port-src', toNodeId: 'port-dst', mode: 'canal', waterEdgeId: null,
        capacity: 60, travelTicks: 1, lossRate: 0, costPerLoad: 1, maxLoadClass: 'standard',
        openPeriods: [...ALL_PERIODS], waterPerLoad: 0, available: true,
      }],
      inventories: [inventory('src', 10000), inventory('dst', 0)],
      regions: [region('src'), region('dst')],
      actors: [{
        id: 'central', name: 'central', kind: 'central', regionIds: ['src', 'dst'],
        goals: ['supply'], treasury: 100000, executionCapacity: 10000, commitmentIds: [], actionIds: [],
      }],
      demands: [
        { id: 'd-a', demandKey: 'a', ownerId: 'central', fromNodeId: 'port-src', toNodeId: 'port-dst',
          purpose: 'civil', cargo: 'grain', loadClass: 'standard', requested: 100, fulfilled: 0,
          reservedInTransit: 0, cancelled: 0, deadlineTick: 540, sourceEventId: null, status: 'active' },
        { id: 'd-b', demandKey: 'b', ownerId: 'central', fromNodeId: 'port-src', toNodeId: 'port-dst',
          purpose: 'civil', cargo: 'grain', loadClass: 'standard', requested: 100, fulfilled: 0,
          reservedInTransit: 0, cancelled: 0, deadlineTick: 540, sourceEventId: null, status: 'active' },
      ],
    },
  };
  const state = runTicks(createGame(scenario, 13), scenario, 1);
  const reserved = state.demands.reduce((sum, demand) => sum + demand.reservedInTransit, 0);
  expect(reserved).toBe(60);
});

test('a season-closed edge dispatches nothing in the closed period', () => {
  const scenario = singleEdgeScenario({
    requested: 20, travelTicks: 1, lossRate: 0, openPeriods: [1, 2, 3],
  });
  const state = tick(createGame(scenario, 14), scenario).state;
  expect(state.demands[0]!.reservedInTransit).toBe(0);
  expect(state.demands[0]!.fulfilled).toBe(0);
});

test('labor is not over-allocated across transport and agriculture', () => {
  const scenario = makeScenario('bottleneck');
  const state = runTicks(createGame(scenario, 15), scenario, 3);
  for (const region of state.regions) {
    const allocated = state.ledger.labor
      .filter(row => row.regionId === region.id)
      .reduce((sum, row) => sum + row.allocated, 0);
    expect(allocated).toBeLessThanOrEqual(region.laborCapacity);
  }
});
