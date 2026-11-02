import type { DeepReadonly } from './types';

export function isDeepFrozen(value: unknown): boolean {
  return value === null || typeof value !== 'object'
    || (Object.isFrozen(value) && Object.values(value).every(isDeepFrozen));
}

// Skip already-frozen subtrees so advancing long scenarios stays O(1) when
// foundation entities do not change. Only use with owned, plain JSON data.
export function freezeOwned<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeOwned);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
