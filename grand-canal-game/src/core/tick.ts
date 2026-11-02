import { reduceEvent, SimulationError } from './reducer';
import type { GameState, ScenarioDefinition, TickCompletedEvent, TickStepResult } from './types';

export function tick(state: GameState, scenario: ScenarioDefinition): TickStepResult {
  if (state.scenarioId !== scenario.id || state.scenarioVersion !== scenario.version
      || state.rulesVersion !== scenario.rulesVersion || state.endTick !== scenario.endTick
      || state.calendar.startYear !== scenario.calendar.startYear
      || state.parameters.version !== scenario.parameters.version) {
    throw new SimulationError(state, '', 'Scenario identity/version/calendar mismatch');
  }
  if (state.ending !== null) return { state, events: [] };
  const event: TickCompletedEvent = {
    id: `tick:${state.scenarioId}:${state.tick + 1}`, type: 'TICK_COMPLETED', source: 'system',
    tick: state.tick + 1, causeIds: [], facts: [],
    delta: { fromTick: state.tick, toTick: state.tick + 1, observationEnded: state.tick + 1 === state.endTick },
  };
  // T02/T03 settlement is computed inside the single reducer entry point from
  // the current state and experimental parameters. RNG streams stay untouched
  // until a concrete weather/actor/disaster rule consumes them.
  const next = reduceEvent(state, event);
  return { state: next, events: Object.freeze([event]) };
}
