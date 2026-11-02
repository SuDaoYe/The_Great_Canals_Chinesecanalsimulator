import { expect, test } from 'vitest';
import { createGame, tick } from '../../src/core/index';
import type {
  ActorState, GameState, Inventory, ScenarioDefinition, SupplyRule,
  TransportEdge, TransportNode,
} from '../../src/core/types';
import { makeScenario } from '../fixtures/scenarios';

const ALL_PERIODS = Array.from({ length: 36 }, (_, index) => index);

interface SupplyOptions {
  sourceStock: number;
  destStock: number;
  targetStock: number;
  consumptionPerTick: number;
  travelTicks?: number;
  cargo?: 'grain' | 'materials';
}

function region(id: string) {
  return {
    id, name: id, actorId: 'central', inventoryId: `stock-${id}`,
    population: 1000, agriculturalCapacity: 0, laborCapacity: 1000,
    subsistenceLabor: 0, agriculturalLabor: 0, corveeBurden: 0,
    localRelations: 0, taxBase: 0,
  };
}

function stock(id: string, cargo: 'grain' | 'materials', amount: number): Inventory {
  return {
    id: `stock-${id}`, ownerId: 'central', regionId: id,
    grain: cargo === 'grain' ? amount : 0,
    materials: cargo === 'materials' ? amount : 0,
  };
}

function port(id: string): TransportNode {
  return { id: `port-${id}`, regionId: id, inventoryId: `stock-${id}`, transferCapacity: 1000 };
}

function supplyRule(options: SupplyOptions): SupplyRule {
  return {
    id: 'r1', sourceNodeId: 'port-src', destNodeId: 'port-dst', ownerId: 'central',
    purpose: 'civil', cargo: options.cargo ?? 'grain',
    targetStock: options.targetStock, consumptionPerTick: options.consumptionPerTick,
  };
}

function supplyScenario(options: SupplyOptions): ScenarioDefinition {
  const base = makeScenario('minimal');
  const cargo = options.cargo ?? 'grain';
  const actor: ActorState = {
    id: 'central', name: 'central', kind: 'central', regionIds: ['src', 'dst'],
    goals: ['supply'], treasury: 100000, executionCapacity: 10000,
    commitmentIds: [], actionIds: [],
  };
  const edge: TransportEdge = {
    id: 'edge', fromNodeId: 'port-src', toNodeId: 'port-dst', mode: 'canal',
    waterEdgeId: null, capacity: 1000, travelTicks: options.travelTicks ?? 1,
    lossRate: 0, costPerLoad: 0, maxLoadClass: 'standard',
    openPeriods: [...ALL_PERIODS], waterPerLoad: 0, available: true,
  };
  return {
    ...base, id: `supply-${options.targetStock}-${options.consumptionPerTick}`,
    rulesVersion: 'g2-0',
    parameters: { ...base.parameters, supply: { rules: [supplyRule(options)] } },
    initial: {
      ...base.initial,
      regions: [region('src'), region('dst')],
      actors: [actor],
      inventories: [
        stock('src', cargo, options.sourceStock), stock('dst', cargo, options.destStock),
      ],
      waterNodes: [], waterEdges: [],
      transportNodes: [port('src'), port('dst')],
      transportEdges: [edge],
      reaches: [], projects: [], liabilities: [], commitments: [],
      demands: [], inTransit: [], petitions: [],
    },
  };
}

function cargoTotal(state: GameState): number {
  return state.inventories.reduce((sum, item) => sum + item.grain + item.materials, 0)
    + state.inTransit.filter(batch => batch.status === 'waiting' || batch.status === 'travelling')
      .reduce((sum, batch) => sum + batch.quantity, 0);
}

function activeBatches(state: GameState): number {
  return state.inTransit.filter(batch => batch.status === 'waiting' || batch.status === 'travelling').length;
}

function destination(state: GameState, cargo: 'grain' | 'materials'): number {
  return state.inventories.find(item => item.id === 'stock-dst')![cargo];
}

test('real old-inventory consumption creates demand from an initially empty list', () => {
  const scenario = supplyScenario({
    sourceStock: 100, destStock: 10, targetStock: 10, consumptionPerTick: 3, travelTicks: 1,
  });
  let state = createGame(scenario, 21);
  expect(state.demands).toHaveLength(0);

  state = tick(state, scenario).state; // consume old stock; no deficit before transport
  expect(state.demands).toHaveLength(0);
  expect(destination(state, 'grain')).toBe(7);
  expect(state.ledger.cargo.consumed).toBe(3);

  state = tick(state, scenario).state; // stock is now below target; replenish
  expect(state.demands).toHaveLength(1);
  const demand = state.demands[0]!;
  expect(demand.demandKey).toBe('supply:r1');
  expect(demand.id).toBe('demand:supply:r1');
  expect(demand.fromNodeId).toBe('port-src');
  expect(demand.toNodeId).toBe('port-dst');
  expect(demand.ownerId).toBe('central');
  expect(demand.purpose).toBe('civil');
  expect(demand.cargo).toBe('grain');
  expect(demand.loadClass).toBe('standard');
  expect(demand.requested).toBe(3);
  expect(demand.reservedInTransit).toBe(3);
  expect(destination(state, 'grain')).toBe(4);
  expect(state.ledger.cargo.consumed).toBe(3);
});

test('recurring actual consumption renews the same stable demand', () => {
  const scenario = supplyScenario({
    sourceStock: 500, destStock: 10, targetStock: 10, consumptionPerTick: 3, travelTicks: 1,
  });
  let state = createGame(scenario, 22);
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    state = tick(state, scenario).state;
    for (const demand of state.demands) {
      ids.add(demand.id);
      keys.add(demand.demandKey);
    }
    expect(state.ledger.cargo.consumed).toBe(3);
  }
  expect(state.demands).toHaveLength(1);
  expect(ids.size).toBe(1);
  expect(keys.size).toBe(1);
  const demand = state.demands[0]!;
  expect(demand.fulfilled).toBe(12);
  expect(demand.requested - demand.fulfilled - demand.reservedInTransit).toBe(0);
  expect(destination(state, 'grain')).toBe(4);
  expect(cargoTotal(state)).toBe(510 - 18);
});

test('no destination deficit means no demand and no dispatch', () => {
  const scenario = supplyScenario({
    sourceStock: 500, destStock: 20, targetStock: 10, consumptionPerTick: 0, travelTicks: 1,
  });
  let state = createGame(scenario, 23);
  for (let i = 0; i < 3; i += 1) state = tick(state, scenario).state;
  expect(state.demands).toHaveLength(0);
  expect(activeBatches(state)).toBe(0);
  expect(destination(state, 'grain')).toBe(20);
  expect(state.inventories.find(item => item.id === 'stock-src')!.grain).toBe(500);
  expect(state.ledger.cargo.consumed).toBe(0);
});

test('a two-tick journey is not duplicated while the first shipment is in transit', () => {
  const scenario = supplyScenario({
    sourceStock: 1000, destStock: 0, targetStock: 20, consumptionPerTick: 0, travelTicks: 2,
  });
  let state = createGame(scenario, 24);
  state = tick(state, scenario).state;
  expect(state.demands).toHaveLength(1);
  expect(state.demands[0]!.requested).toBe(20);
  expect(state.demands[0]!.reservedInTransit).toBe(20);
  expect(activeBatches(state)).toBe(1);

  state = tick(state, scenario).state; // still in transit, no second request
  expect(state.demands).toHaveLength(1);
  expect(state.demands[0]!.requested).toBe(20);
  expect(state.demands[0]!.reservedInTransit).toBe(20);
  expect(activeBatches(state)).toBe(1);

  state = tick(state, scenario).state; // arrival
  expect(state.demands[0]!.fulfilled).toBe(20);
  expect(state.demands[0]!.reservedInTransit).toBe(0);
  expect(activeBatches(state)).toBe(0);
  expect(destination(state, 'grain')).toBe(20);
});

test('an empty source stock never creates phantom supply', () => {
  const scenario = supplyScenario({
    sourceStock: 0, destStock: 0, targetStock: 50, consumptionPerTick: 0, travelTicks: 1,
  });
  let state = createGame(scenario, 25);
  for (let i = 0; i < 3; i += 1) state = tick(state, scenario).state;
  const demand = state.demands[0]!;
  expect(state.demands).toHaveLength(1);
  expect(demand.requested).toBe(50);
  expect(demand.fulfilled).toBe(0);
  expect(demand.reservedInTransit).toBe(0);
  expect(activeBatches(state)).toBe(0);
  expect(state.inventories.every(item => item.grain === 0 && item.materials === 0)).toBe(true);
  expect(cargoTotal(state)).toBe(0);
});

test('consumption runs after same-tick arrival instead of consuming phantom stock', () => {
  const scenario = supplyScenario({
    sourceStock: 100, destStock: 0, targetStock: 10, consumptionPerTick: 5, travelTicks: 1,
  });
  let state = createGame(scenario, 26);
  state = tick(state, scenario).state; // dispatch, nothing has arrived yet
  expect(state.demands[0]!.reservedInTransit).toBe(10);
  expect(destination(state, 'grain')).toBe(0);
  expect(state.ledger.cargo.consumed).toBe(0);

  state = tick(state, scenario).state; // arrive 10, then consume 5
  expect(state.demands[0]!.fulfilled).toBe(10);
  expect(destination(state, 'grain')).toBe(5);
  expect(state.ledger.cargo.consumed).toBe(5);
  expect(cargoTotal(state)).toBe(95);
});

test('unmet consumption is not booked as phantom consumed cargo', () => {
  const scenario = supplyScenario({
    sourceStock: 100, destStock: 2, targetStock: 0, consumptionPerTick: 5, travelTicks: 1,
  });
  let state = createGame(scenario, 28);
  expect(state.demands).toHaveLength(0);
  state = tick(state, scenario).state;
  expect(destination(state, 'grain')).toBe(0);
  expect(state.ledger.cargo.consumed).toBe(2); // demand was 5, only 2 existed
  expect(state.ledger.cargo.closing).toBe(cargoTotal(state));
  expect(cargoTotal(state)).toBe(100); // 102 opening minus the 2 actually eaten
});

test('consumed materials reconcile independent inventories and the cargo ledger', () => {
  const scenario = supplyScenario({
    sourceStock: 1000, destStock: 5, targetStock: 20,
    consumptionPerTick: 7, travelTicks: 1, cargo: 'materials',
  });
  let state = createGame(scenario, 27);
  const initialTotal = cargoTotal(state);
  let consumedTotal = 0;
  for (let i = 0; i < 8; i += 1) {
    const before = cargoTotal(state);
    const previousClosing = state.ledger.cargo.closing;
    state = tick(state, scenario).state;
    const ledger = state.ledger.cargo;
    expect(ledger.opening).toBe(previousClosing);
    expect(ledger.opening + ledger.incoming).toBe(ledger.closing + ledger.outgoing + ledger.consumed);
    expect(ledger.closing).toBe(cargoTotal(state));
    expect(before + ledger.incoming - ledger.consumed).toBe(cargoTotal(state));
    expect(ledger.consumed).toBeGreaterThan(0); // consumption is real, not a zero placeholder
    consumedTotal += ledger.consumed;
  }
  expect(consumedTotal).toBe(initialTotal - cargoTotal(state));
  expect(destination(state, 'materials')).toBeGreaterThan(0);
});

test('invalid supply rules are rejected at scenario creation', () => {
  const base = supplyScenario({
    sourceStock: 100, destStock: 0, targetStock: 10, consumptionPerTick: 1,
  });
  const valid = (base.parameters.supply as { rules: readonly SupplyRule[] }).rules[0]!;
  const withRules = (rules: readonly SupplyRule[], initial = base.initial): ScenarioDefinition => ({
    ...base, parameters: { ...base.parameters, supply: { rules } }, initial,
  });
  const otherStock = base.initial.inventories.map(item => item.id === 'stock-src'
    ? { ...item, ownerId: 'other' } : item);
  const otherActor: ActorState = {
    ...base.initial.actors[0]!, id: 'other', name: 'other', regionIds: [],
  };

  expect(() => createGame(withRules([{ ...valid, sourceNodeId: 'missing' }]), 7)).toThrow();
  expect(() => createGame(withRules([{ ...valid, destNodeId: 'missing' }]), 7)).toThrow();
  expect(() => createGame(withRules([{ ...valid, ownerId: 'missing' }]), 7)).toThrow();
  expect(() => createGame(withRules([valid, { ...valid }]), 7)).toThrow(/duplicate/);
  expect(() => createGame(withRules([{ ...valid, targetStock: -1 }]), 7)).toThrow();
  expect(() => createGame(withRules([{ ...valid, consumptionPerTick: 1.5 }]), 7)).toThrow();
  expect(() => createGame(withRules([{ ...valid, sourceNodeId: 'port-dst' }]), 7)).toThrow();
  expect(() => createGame(withRules([valid],
    { ...base.initial, actors: [...base.initial.actors, otherActor], inventories: otherStock }), 7))
    .toThrow(/owned/);
});
