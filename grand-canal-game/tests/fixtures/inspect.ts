import { tick } from '../../src/core/index';
import type { GameState, ScenarioDefinition } from '../../src/core/types';

export function runTicks(state: GameState, scenario: ScenarioDefinition, count: number): GameState {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid tick count');
  for (let i = 0; i < count; i += 1) state = tick(state, scenario).state;
  return state;
}
export interface TestMetrics {
  populationByRegion: Record<string, number>;
  laborCapacityByRegion: Record<string, number>;
  laborAllocatedByRegion: Record<string, number>;
  burdenByRegion: Record<string, number>;
  projectWork: number; totalDelivered: number;
  totalWaterBalanceError: number; totalCargoBalanceError: number; futureMaintenance: number;
}
export function inspect(state: GameState): TestMetrics {
  const water = state.ledger.water, cargo = state.ledger.cargo;
  return {
    populationByRegion: Object.fromEntries(state.regions.map(r => [r.id, r.population])),
    laborCapacityByRegion: Object.fromEntries(state.regions.map(r => [r.id, r.laborCapacity])),
    laborAllocatedByRegion: Object.fromEntries(state.regions.map(r => [r.id,
      state.ledger.labor.filter(l => l.regionId === r.id).reduce((sum, l) => sum + l.allocated, 0)])),
    burdenByRegion: Object.fromEntries(state.regions.map(r => [r.id, r.corveeBurden])),
    projectWork: state.projects.reduce((sum, p) => sum + p.workCompleted, 0),
    totalDelivered: state.demands.reduce((sum, d) => sum + d.fulfilled, 0),
    totalWaterBalanceError: water.opening + water.incoming - water.outgoing - water.consumed - water.closing,
    totalCargoBalanceError: cargo.opening + cargo.incoming - cargo.outgoing - cargo.consumed - cargo.closing,
    futureMaintenance: state.reaches.filter(r => r.status !== 'retired').reduce((sum, r) => sum + r.maintenanceCost, 0)
      + state.liabilities.filter(l => l.status !== 'resolved').reduce((sum, l) => sum + l.minimumTreasury, 0),
  };
}
