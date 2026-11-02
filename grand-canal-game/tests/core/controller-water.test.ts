import { expect, test } from 'vitest';
import { createGame } from '../../src/core/index';
import { beginWater } from '../../src/core/water';
import { makeScenario } from '../fixtures/scenarios';

test('the first settlement uses year-period zero for seasonal inflow', () => {
  const base = makeScenario('minimal');
  const scenario = {
    ...base,
    initial: { ...base.initial, waterNodes: base.initial.waterNodes.map((node, index) => ({
      ...node, storage: 0, evaporation: 0, irrigationRequest: 0,
      seasonalInflow: Array.from({ length: 36 }, (_, period) => index === 0 && period === 0 ? 11 : 0),
    })) },
  };
  expect(beginWater(createGame(scenario, 7), 1).incoming).toBe(11);
});

import { tick } from '../../src/core/index';

test('a demand cannot take stock owned by another actor without a transfer', () => {
  const base = makeScenario('bottleneck');
  const central = base.initial.actors[0]!;
  const scenario = { ...base, initial: { ...base.initial,
    actors: [...base.initial.actors, { ...central, id: 'other', name: 'other', regionIds: [] }],
    inventories: base.initial.inventories.map(stock => stock.id === 'stock-src' ? { ...stock, ownerId: 'other' } : stock),
  } };
  const before = createGame(scenario, 7);
  const after = tick(before, scenario).state;
  expect(after.inventories.find(stock => stock.id === 'stock-src')!.grain)
    .toBe(before.inventories.find(stock => stock.id === 'stock-src')!.grain);
  expect(after.demands[0]!.reservedInTransit).toBe(0);
});

test('unfunded transport cannot pass a toll charged by another actor', () => {
  const base = makeScenario('bottleneck');
  const central = base.initial.actors[0]!;
  const scenario = { ...base, initial: { ...base.initial,
    actors: [{ ...central, treasury: 0 }, { ...central, id: 'other', name: 'other', regionIds: ['src'] }],
    regions: base.initial.regions.map(region => region.id === 'src' ? { ...region, actorId: 'other' } : region),
  } };
  const before = createGame(scenario, 7);
  const after = tick(before, scenario).state;
  expect(after.demands[0]!.reservedInTransit).toBe(0);
  expect(after.inventories.find(stock => stock.id === 'stock-src')!.grain)
    .toBe(before.inventories.find(stock => stock.id === 'stock-src')!.grain);
});

test('cancelled cargo stays at its next safe node instead of teleporting to a distant owned stock', () => {
  const base = makeScenario('bottleneck');
  const central = base.initial.actors[0]!;
  const scenario = { ...base, initial: { ...base.initial,
    actors: [...base.initial.actors, { ...central, id: 'other', name: 'other', regionIds: [] }],
    inventories: base.initial.inventories.map(stock => stock.id === 'stock-mid' ? { ...stock, ownerId: 'other' } : stock),
  } };
  const first = tick(createGame(scenario, 7), scenario).state;
  const cancelled = { ...first, demands: first.demands.map(demand => ({ ...demand, status: 'cancelled' as const })) };
  const outsideMid = (state: typeof first) => state.inventories
    .filter(stock => stock.regionId !== 'mid').reduce((sum, stock) => sum + stock.grain, 0);
  const after = tick(cancelled, scenario).state;
  expect(outsideMid(after)).toBe(outsideMid(first));
  const atMidOwned = after.inventories.filter(stock => stock.regionId === 'mid' && stock.ownerId === 'central')
    .reduce((sum, stock) => sum + stock.grain, 0);
  const heldAtMid = after.inTransit.filter(batch => batch.currentNodeId === 'port-mid' && batch.ownerId === 'central'
    && (batch.status === 'waiting' || batch.status === 'travelling')).reduce((sum, batch) => sum + batch.quantity, 0);
  expect(atMidOwned + heldAtMid).toBeGreaterThan(0);
});

test('a closed controlled water edge blocks its transport instead of becoming free passage', () => {
  const base = makeScenario('shared-water');
  const scenario = { ...base, initial: { ...base.initial,
    waterEdges: base.initial.waterEdges.map(edge => edge.id === 'we-a' ? { ...edge, available: false } : edge),
  } };
  const after = tick(createGame(scenario, 7), scenario).state;
  expect(after.demands.find(demand => demand.id === 'd-a')!.reservedInTransit).toBe(0);
});

test('preventive maintenance pays its fiscal cost even when the canal is undamaged', () => {
  const base = makeScenario('minimal');
  const withCost = (cost: number) => ({ ...base, initial: { ...base.initial,
    reaches: base.initial.reaches.map(reach => ({ ...reach, damage: 0, silt: 0,
      maintenanceLabor: 1, maintenanceCost: cost })),
  } });
  const free = withCost(0), paid = withCost(3);
  const a = tick(createGame(free, 7), free).state;
  const b = tick(createGame(paid, 7), paid).state;
  expect(a.actors.find(actor => actor.id === 'central')!.treasury
    - b.actors.find(actor => actor.id === 'central')!.treasury).toBe(3);
});
