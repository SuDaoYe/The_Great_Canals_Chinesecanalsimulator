import { expect, test } from 'vitest';
import { createGame, hashState, tick } from '../../src/core/index';
import { dateAtTick } from '../../src/core/calendar';
import { createRngStates, drawRandom } from '../../src/core/rng';
import { stableSerialize } from '../../src/core/hash';
import { reduceEvent } from '../../src/core/reducer';
import { makeScenario } from '../fixtures/scenarios';
import { inspect, runTicks } from '../fixtures/inspect';

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('same seed reproduces without changing frozen scenario or input state', () => {
  const scenario = freeze(makeScenario('minimal'));
  const scenarioBefore = JSON.stringify(scenario);
  const first = freeze(createGame(scenario, 20261102));
  const before = JSON.stringify(first);
  const a = tick(first, scenario);
  const b = tick(createGame(scenario, 20261102), scenario);
  expect(hashState(a.state)).toBe(hashState(b.state));
  expect(JSON.stringify(first)).toBe(before);
  expect(JSON.stringify(scenario)).toBe(scenarioBefore);
  expect(a.state).not.toBe(first);
  expect(a.state.tick).toBe(1);
  expect(a.state.revision).toBe(1);
  expect(a.events).toHaveLength(1);
  expect(reduceEvent(first, a.events[0]!)).toEqual(a.state);
  expect(inspect(a.state).totalWaterBalanceError).toBe(0);
  expect(inspect(a.state).totalCargoBalanceError).toBe(0);
});

test('new games detach all nested scenario values and round-trip as plain JSON', () => {
  const scenario = makeScenario('minimal');
  const state = createGame(scenario, 7);
  expect(state.regions).not.toBe(scenario.initial.regions);
  expect(state.reaches[0]!.schedule.official).not.toBe(scenario.initial.reaches[0]!.schedule.official);
  expect(JSON.parse(JSON.stringify(state))).toEqual(state);
});

test('tick does not freeze a mutable deserialized input and returns an immutable snapshot', () => {
  const scenario = makeScenario('minimal');
  const mutable = JSON.parse(JSON.stringify(createGame(scenario, 7)));
  const next = tick(mutable, scenario).state;
  expect(Object.isFrozen(mutable.regions)).toBe(false);
  mutable.regions[0].population = 42;
  expect(next.regions[0]!.population).toBe(1000);
  expect(Object.isFrozen(next.regions[0])).toBe(true);
});

test('ledger failure rolls back the tick with a diagnostic instead of repairing it', () => {
  const scenario = makeScenario('minimal');
  const initial = createGame(scenario, 7);
  const corrupt = freeze({ ...initial, ledger: { ...initial.ledger,
    water: { ...initial.ledger.water, closing: 0 } } });
  const before = JSON.stringify(corrupt);
  expect(() => tick(corrupt, scenario)).toThrowError(/Unbalanced ledger/);
  try { tick(corrupt, scenario); } catch (error) {
    expect(error).toHaveProperty('diagnostic.tick', 0);
  }
  expect(JSON.stringify(corrupt)).toBe(before);
});

test('initial entity order does not change simulation hashes', () => {
  const scenario = makeScenario('minimal');
  const reordered = { ...scenario, initial: { ...scenario.initial,
    regions: [...scenario.initial.regions].reverse(), actors: [...scenario.initial.actors].reverse(),
    inventories: [...scenario.initial.inventories].reverse(),
  } };
  expect(hashState(createGame(reordered, 7))).toBe(hashState(createGame(scenario, 7)));
});

test('tick rejects malformed RNG and unsupported pending events without consuming them', () => {
  const scenario = makeScenario('minimal'), initial = createGame(scenario, 7);
  expect(() => tick({ ...initial, rngStates: { ...initial.rngStates, weather: -1 } }, scenario)).toThrow();
  const event = tick(initial, scenario).events[0]!;
  const pending = freeze({ ...initial, pendingEvents: [{ effectiveTick: 1, event }] });
  expect(() => tick(pending, scenario)).toThrow(/Scheduled mechanisms/);
  expect(pending.pendingEvents).toHaveLength(1);
});

test('seeds differ and drawing weather leaves actors and disasters unchanged', () => {
  const rng = freeze(createRngStates(7));
  const before = JSON.stringify(rng);
  const weather = drawRandom(rng, 'weather');
  expect(weather.value).toBeGreaterThanOrEqual(0);
  expect(weather.value).toBeLessThan(1);
  expect(weather.states.weather).not.toBe(rng.weather);
  expect(weather.states.actors).toBe(rng.actors);
  expect(weather.states.disasters).toBe(rng.disasters);
  expect(drawRandom(weather.states, 'actors')).toEqual({
    ...drawRandom(rng, 'actors'), states: {
      ...drawRandom(rng, 'actors').states, weather: weather.states.weather,
    },
  });
  expect(drawRandom(rng, 'weather')).toEqual(weather);
  expect(JSON.stringify(rng)).toBe(before);
  expect(new Set(Object.values(rng)).size).toBe(3);
  expect(createRngStates(8)).not.toEqual(rng);
  expect(hashState(createGame(makeScenario('minimal'), 8)))
    .not.toBe(hashState(createGame(makeScenario('minimal'), 7)));
});

test.each([0, 1, -1, 20261102, Number.MAX_SAFE_INTEGER])('seed %s reproduces a sequence', seed => {
  let a = createRngStates(seed), b = createRngStates(seed);
  for (let i = 0; i < 20; i += 1) {
    const x = drawRandom(a, 'disasters'), y = drawRandom(b, 'disasters');
    expect(x).toEqual(y); a = x.states; b = y.states;
  }
});

test('seed derivation retains high integer bits', () => {
  expect(createRngStates(7)).not.toEqual(createRngStates(4294967303));
});

test('canonical hash ignores object insertion order but covers simulation fields and queues', () => {
  const state = createGame(makeScenario('minimal'), 9);
  expect(stableSerialize({ z: 1, a: { y: 2, x: '运河' } }))
    .toBe('{"a":{"x":"运河","y":2},"z":1}');
  expect(hashState({ ...state, rngStates: { disasters: state.rngStates.disasters,
    actors: state.rngStates.actors, weather: state.rngStates.weather } })).toBe(hashState(state));
  expect(hashState({ ...state, appliedCommandIds: ['x'] })).not.toBe(hashState(state));
  expect(hashState({ ...state, rulesVersion: 'changed' })).not.toBe(hashState(state));
  const event = tick(state, makeScenario('minimal')).events[0]!;
  expect(hashState({ ...state, pendingEvents: [{ effectiveTick: 1, event }] })).not.toBe(hashState(state));
  expect(hashState({ ...state, inTransit: [] })).toBe(hashState(state));
});

test.each([undefined, NaN, Infinity, -0, 1.5, new Map(), new Date(), () => 1, { bad: undefined }])(
  'stable serialization rejects non-contract value %#', value => {
    expect(() => stableSerialize(value)).toThrow();
  });

test('serialization rejects cycles, sparse arrays and array accessors without executing getters', () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(() => stableSerialize(cycle)).toThrow();
  expect(() => stableSerialize(new Array(1))).toThrow();
  let calls = 0;
  const array = [1];
  Object.defineProperty(array, '0', { enumerable: true, get: () => { calls += 1; return 1; } });
  expect(() => stableSerialize(array)).toThrow();
  expect(calls).toBe(0);
});

test.each([
  [0, { year: 1410, month: 1, period: 1 }],
  [2, { year: 1410, month: 1, period: 3 }],
  [3, { year: 1410, month: 2, period: 1 }],
  [35, { year: 1410, month: 12, period: 3 }],
  [36, { year: 1411, month: 1, period: 1 }],
  [540, { year: 1425, month: 1, period: 1 }],
])('calendar at %i completed ticks', (count, expected) => {
  expect(dateAtTick({ startYear: 1410 }, count)).toEqual(expected);
});

test('540 is an atomic ending boundary and further ticks are a no-op', () => {
  const scenario = makeScenario('minimal');
  const before = freeze(runTicks(createGame(scenario, 7), scenario, 539));
  expect(before.ending).toBeNull();
  const result = tick(before, scenario);
  expect(result.state.tick).toBe(540);
  expect(result.state.ending).toEqual({ reason: 'observation_end', tick: 540 });
  expect(result.events[0]!.delta.observationEnded).toBe(true);
  expect(tick(result.state, scenario)).toEqual({ state: result.state, events: [] });
  expect(tick(result.state, scenario).state).toBe(result.state);
});

test('custom 550..980 scenario reaches 15480 without hardcoded Ming boundaries', () => {
  const scenario = { ...makeScenario('minimal'), calendar: { startYear: 550 }, endTick: 15480 };
  const initial = createGame(scenario, 7);
  const a = runTicks(initial, scenario, 15480);
  const b = runTicks(runTicks(initial, scenario, 540), scenario, 14940);
  expect(a.tick).toBe(15480);
  expect(a.ending?.tick).toBe(15480);
  expect(dateAtTick(scenario.calendar, a.tick)).toEqual({ year: 980, month: 1, period: 1 });
  expect(hashState(a)).toBe(hashState(b));
});

test('failed scenario/tick/event validation leaves the entire input untouched', () => {
  const scenario = makeScenario('minimal');
  const state = freeze(createGame(scenario, 7));
  const before = JSON.stringify(state);
  expect(() => tick(state, { ...scenario, version: 'other' })).toThrow();
  const event = tick(state, scenario).events[0]!;
  expect(() => reduceEvent(state, { ...event, delta: { ...event.delta, toTick: 2 } })).toThrow();
  expect(() => reduceEvent(state, { ...event, delta: { ...event.delta, observationEnded: true } })).toThrow();
  expect(JSON.stringify(state)).toBe(before);
});

test.each([
  { endTick: -1 }, { endTick: 0 }, { endTick: 1.5 }, { version: '' },
  { calendar: { startYear: NaN } }, { calendar: { startYear: Number.MAX_SAFE_INTEGER } },
])('rejects invalid scenario header %#', patch => {
  expect(() => createGame({ ...makeScenario('minimal'), ...patch }, 7)).toThrow();
});

test('rejects duplicate IDs, dangling references, bad quantities and schedules', () => {
  const scenario = makeScenario('minimal'), initial = scenario.initial;
  const invalid = [
    { ...initial, regions: [initial.regions[0]!, initial.regions[0]!] },
    { ...initial, waterEdges: [{ ...initial.waterEdges[0]!, toNodeId: 'missing' }] },
    { ...initial, regions: [{ ...initial.regions[0]!, population: -1 }, initial.regions[1]!] },
    { ...initial, transportEdges: [{ ...initial.transportEdges[0]!, travelTicks: 0 }] },
    { ...initial, reaches: [{ ...initial.reaches[0]!, schedule: { official: [0, 0], civil: [], trade: [] } }] },
    { ...initial, reaches: [{ ...initial.reaches[0]!, closedUntil: 0 }] },
    { ...initial, waterNodes: initial.waterNodes.map(n => ({ ...n, storage: 1001 })) },
  ];
  for (const data of invalid) expect(() => createGame({ ...scenario, initial: data }, 7)).toThrow();
});

test.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid seed %s', seed => {
  expect(() => createGame(makeScenario('minimal'), seed)).toThrow();
});

test('rejects missing/extra fields and non-JSON scenario values', () => {
  const scenario = makeScenario('minimal');
  expect(() => createGame({ ...scenario, initial: { ...scenario.initial, projects: undefined } } as never, 7)).toThrow();
  expect(() => createGame({ ...scenario, unexpected: true } as never, 7)).toThrow();
});
