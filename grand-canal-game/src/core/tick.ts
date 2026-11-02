import { freezeOwned } from './immutable';
import { reduceEvent, SimulationError } from './reducer';
import type { DomainEvent, GameState, ScenarioDefinition, StepResult } from './types';

export function tick(state: GameState, scenario: ScenarioDefinition): StepResult {
  if (state.scenarioId !== scenario.id || state.scenarioVersion !== scenario.version
      || state.rulesVersion !== scenario.rulesVersion || state.endTick !== scenario.endTick
      || state.calendar.startYear !== scenario.calendar.startYear) {
    throw new SimulationError(state, '', 'Scenario identity/version/calendar mismatch');
  }
  if (state.ending !== null) return { state, events: [] };
  const event: DomainEvent = {
    id: `tick:${state.scenarioId}:${state.tick + 1}`, type: 'TICK_COMPLETED', source: 'system',
    tick: state.tick + 1, causeIds: [], facts: [],
    delta: { fromTick: state.tick, toTick: state.tick + 1, observationEnded: state.tick + 1 === state.endTick },
  };
  // T01 advances time only. RNG streams are consumed by future concrete rules,
  // never by a placeholder weather/personality calculation.
  const next = reduceEvent(state, event);
  return { state: next, events: freezeOwned([event]) };
}
