import type { ScenarioDefinition } from '../../src/core/types';

// Artificial model units, no historical numerical claims. Labor and stores
// exceed the small dredging budget T02 will define; no action/disaster rules.
export function makeScenario(name: 'minimal'): ScenarioDefinition {
  if (name !== 'minimal') throw new Error(`Fixture not implemented: ${name}`);
  const periods = Array.from({ length: 36 }, (_, i) => i);
  return {
    id: 'minimal', version: '0.1.0', rulesVersion: 'foundation-1',
    calendar: { startYear: 1410 }, endTick: 540,
    initial: {
      regions: ['a', 'b'].map(id => ({
        id, name: id, actorId: 'central', inventoryId: `stock-${id}`,
        population: 1000, agriculturalCapacity: 100, laborCapacity: 100,
        subsistenceLabor: 0, agriculturalLabor: 60, corveeBurden: 0,
        localRelations: 0, taxBase: 100,
      })),
      actors: [{ id: 'central', name: 'central', kind: 'central', regionIds: ['a', 'b'],
        goals: ['supply'], treasury: 10000, executionCapacity: 10000,
        commitmentIds: [], actionIds: [] }],
      inventories: ['a', 'b'].map(id => ({ id: `stock-${id}`, ownerId: 'central',
        regionId: id, grain: 10000, materials: 10000 })),
      waterNodes: ['a', 'b'].map(id => ({ id: `water-${id}`, regionId: id,
        storage: 100, capacity: 1000, level: 1, seasonalInflow: periods.map(() => 0),
        irrigationRequest: 0, evaporation: 0, policy: 'balanced' })),
      waterEdges: [{ id: 'water-ab', fromNodeId: 'water-a', toNodeId: 'water-b',
        capacity: 100, controlled: true, available: true }],
      transportNodes: ['a', 'b'].map(id => ({ id: `port-${id}`, regionId: id,
        inventoryId: `stock-${id}`, transferCapacity: 100 })),
      transportEdges: [{ id: 'transport-ab', fromNodeId: 'port-a', toNodeId: 'port-b',
        mode: 'canal', waterEdgeId: 'water-ab', capacity: 100, travelTicks: 2,
        lossRate: 0, costPerLoad: 1, maxLoadClass: 'standard', openPeriods: periods,
        waterPerLoad: 1, available: true }],
      reaches: [{ id: 'ab', name: 'ab', regionIds: ['a', 'b'], waterEdgeIds: ['water-ab'],
        transportEdgeIds: ['transport-ab'], grade: 'small', status: 'active',
        silt: 1000, damage: 0, maintenance: 'standard', maintenanceLabor: 1,
        maintenanceCost: 1, passage: 'balanced', maxLoadClass: 'standard',
        schedule: { official: [...periods], civil: [...periods], trade: [...periods] },
        closedUntil: null, validPeriod: { fromYear: 1400, untilYearExclusive: null },
        evidenceIds: [] }],
      actions: [], projects: [], liabilities: [], commitments: [], demands: [], inTransit: [], petitions: [],
    },
  };
}
