import { freezeOwned } from './immutable';
import { createRngStates } from './rng';
import { stationaryBalance, validateScenario } from './validation';
import type { GameState, ScenarioDefinition, SimulationEntities } from './types';

const sorted = <T extends { readonly id: string }>(values: readonly T[]): T[] =>
  [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createGame(scenario: ScenarioDefinition, seed: number): GameState {
  validateScenario(scenario);
  const rngStates = createRngStates(seed);
  // JSON-only validation precedes cloning. Never freeze or retain caller data.
  const owned = structuredClone(scenario);
  // Stable IDs determine iteration order, independent of content insertion order.
  const s = owned.initial;
  const initial = {
    regions: sorted(s.regions), actors: sorted(s.actors), actions: sorted(s.actions),
    inventories: sorted(s.inventories), waterNodes: sorted(s.waterNodes), waterEdges: sorted(s.waterEdges),
    transportNodes: sorted(s.transportNodes), transportEdges: sorted(s.transportEdges),
    reaches: sorted(s.reaches), projects: sorted(s.projects), liabilities: sorted(s.liabilities),
    commitments: sorted(s.commitments), demands: sorted(s.demands),
    inTransit: sorted(s.inTransit), petitions: sorted(s.petitions),
  } satisfies SimulationEntities;
  const water = initial.waterNodes.reduce((sum, n) => sum + n.storage, 0);
  const cargo = initial.inventories.reduce((sum, i) => sum + i.grain + i.materials, 0)
    + initial.inTransit.filter(b => b.status === 'waiting' || b.status === 'travelling')
      .reduce((sum, b) => sum + b.quantity, 0);
  return freezeOwned({
    ...initial, scenarioId: owned.id, scenarioVersion: owned.version, rulesVersion: owned.rulesVersion,
    calendar: owned.calendar, endTick: owned.endTick, tick: 0, revision: 0,
    rngStates, appliedCommandIds: [], pendingEvents: [], events: [],
    ledger: { tick: 0, labor: [], water: stationaryBalance(water), cargo: stationaryBalance(cargo) },
    ending: null,
  });
}
