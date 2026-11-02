import { freezeOwned, isDeepFrozen } from './immutable';
import type { DeepReadonly, DomainEvent, GameState } from './types';

export class SimulationError extends Error {
  readonly diagnostic: Readonly<{ tick: number; eventId: string; reason: string }>;
  constructor(state: GameState, eventId: string, reason: string) {
    super(`Tick ${state.tick} rejected: ${reason}`);
    this.name = 'SimulationError';
    this.diagnostic = Object.freeze({ tick: state.tick, eventId, reason });
  }
}

// The only transition writer. Validation happens before constructing a candidate;
// a thrown error leaves the caller's stable snapshot and RNG untouched.
export function reduceEvent(state: GameState, event: DeepReadonly<DomainEvent>): GameState {
  const reject = (reason: string): never => { throw new SimulationError(state, event.id, reason); };
  if (state.ending !== null) reject('Cannot reduce an event after ending');
  if (!Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick >= state.endTick
      || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision === Number.MAX_SAFE_INTEGER) {
    reject('Invalid time/revision boundary');
  }
  if (event.type !== 'TICK_COMPLETED' || event.source !== 'system'
      || event.id !== `tick:${state.scenarioId}:${state.tick + 1}`
      || event.tick !== state.tick + 1 || event.delta.fromTick !== state.tick
      || event.delta.toTick !== state.tick + 1 || event.causeIds.length !== 0 || event.facts.length !== 0
      || event.delta.observationEnded !== (event.tick === state.endTick)) {
    reject('Invalid foundation event');
  }
  if (state.pendingEvents.length !== 0) reject('Scheduled mechanisms are not implemented in T01');
  if (Object.keys(state.rngStates).length !== 3
      || !['weather', 'actors', 'disasters'].every(key => Object.hasOwn(state.rngStates, key))
      || !Object.values(state.rngStates).every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) {
    reject('Invalid RNG states');
  }
  const water = state.ledger.water, cargo = state.ledger.cargo;
  for (const balance of [water, cargo]) {
    if (!Object.values(balance).every(v => Number.isSafeInteger(v) && v >= 0)
        || balance.opening + balance.incoming !== balance.closing + balance.outgoing + balance.consumed) {
      reject('Unbalanced ledger');
    }
  }
  // Reuse immutable subtrees; detach mutable imported snapshots before freezing.
  const owned = isDeepFrozen(state) ? state : structuredClone(state);
  return freezeOwned({
    ...owned, tick: event.tick, revision: state.revision + 1,
    // Only the latest transaction is retained; no unbounded fake chronicle.
    events: [structuredClone(event)],
    ledger: { tick: event.tick, labor: [],
      water: { opening: water.closing, incoming: 0, outgoing: 0, consumed: 0, closing: water.closing },
      cargo: { opening: cargo.closing, incoming: 0, outgoing: 0, consumed: 0, closing: cargo.closing } },
    ending: event.delta.observationEnded ? { reason: 'observation_end', tick: event.tick } : null,
  });
}
