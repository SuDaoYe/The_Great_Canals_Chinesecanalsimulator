import type { DeepReadonly, RngStates, RngStream } from './types';

export function createRngStates(seed: number): DeepReadonly<RngStates> {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Seed must be a safe integer');
  // Seed text uses all safe-integer digits (not only the low 32 bits).
  let base = 2166136261;
  for (const char of String(seed)) base = Math.imul(base ^ char.charCodeAt(0), 16777619) >>> 0;
  return Object.freeze({
    weather: (base ^ 0x9e3779b9) >>> 0,
    actors: (base ^ 0x243f6a88) >>> 0,
    disasters: (base ^ 0xb7e15162) >>> 0,
  });
}

export function drawRandom(states: DeepReadonly<RngStates>, stream: RngStream): {
  value: number; states: DeepReadonly<RngStates>;
} {
  for (const value of Object.values(states)) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('Invalid RNG state');
  }
  if (!Object.hasOwn(states, stream)) throw new RangeError('Unknown RNG stream');
  // Mulberry32: state transition is explicit, returned, and isolated by stream.
  const next = (states[stream] + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(next ^ (next >>> 15), next | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  const value = ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  return { value, states: Object.freeze({ ...states, [stream]: next }) };
}
