import { expect, test } from 'vitest';
import { createGame } from '../../src/core/index';
import { generateSupplyDemands } from '../../src/core/supply';
import { makeScenario } from '../fixtures/scenarios';

const rule = { id: 'r', sourceNodeId: 'port-src', destNodeId: 'port-dst', ownerId: 'central',
  purpose: 'civil' as const, cargo: 'grain' as const, targetStock: 20, consumptionPerTick: 1 };

test('another owners in-transit goods do not cover the local owners supply deficit', () => {
  const base = makeScenario('bottleneck');
  const existing = { ...base.initial.demands[0]!, id: 'other-demand', demandKey: 'other', ownerId: 'other',
    requested: 20, reservedInTransit: 20 };
  const scenario = { ...base, parameters: { ...base.parameters, supply: { rules: [rule] } }, initial: {
    ...base.initial,
    actors: [...base.initial.actors, { ...base.initial.actors[0]!, id: 'other', name: 'other', regionIds: [] }],
    demands: [existing], inTransit: [{ id: 'other-batch', parentId: null, demandId: existing.id, ownerId: 'other',
      purpose: 'civil' as const, cargo: 'grain' as const, loadClass: 'standard' as const,
      quantity: 20, lost: 0, routeEdgeIds: ['up', 'lock'], routeIndex: 0, currentNodeId: 'port-src',
      remainingTravelTicks: 1, status: 'travelling' as const }],
  } };
  const generated = generateSupplyDemands(createGame(scenario, 7));
  expect(generated.find(demand => demand.demandKey === 'supply:r')?.requested).toBe(20);
});

test('overlapping replenishment rules cannot independently book the same inventory deficit', () => {
  const base = makeScenario('bottleneck');
  const scenario = { ...base, parameters: { ...base.parameters, supply: {
    rules: [rule, { ...rule, id: 'same-target-again' }],
  } } };
  expect(() => createGame(scenario, 7)).toThrow();
});
