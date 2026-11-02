import type { GameState } from './types';

// Canonical JSON: lexical UTF-16 object keys, ordered arrays, integer numbers.
// Reject lossy JSON conversions (undefined, non-finite numbers, class instances).
export function stableSerialize(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isSafeInteger(item) && !Object.is(item, -0)) return JSON.stringify(item);
    if (typeof item !== 'object') throw new TypeError('Expected plain integer JSON data');
    if (ancestors.has(item)) throw new TypeError('Cyclic JSON data');
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Expected plain JSON object');
    }
    if (Object.getOwnPropertySymbols(item).length !== 0) throw new TypeError('Symbol property');
    ancestors.add(item);
    let result: string;
    if (Array.isArray(item)) {
      // Inspect descriptors rather than invoking user getters/iterators. map
      // would skip holes; JSON.stringify would silently drop extra properties.
      if (prototype !== Array.prototype || Object.getOwnPropertyNames(item).length !== item.length + 1) {
        throw new TypeError('Non-plain/extended array');
      }
      const parts: string[] = [];
      for (let i = 0; i < item.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('Sparse/non-data array');
        parts.push(encode(descriptor.value));
      }
      result = `[${parts.join(',')}]`;
    } else {
      const record = item as Record<string, unknown>;
      const keys = Object.getOwnPropertyNames(record).sort();
      result = `{${keys.map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Non-data property');
        return `${JSON.stringify(key)}:${encode(record[key])}`;
      }).join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}

// FNV-1a 64 over UTF-8. Pure browser/Worker-safe diagnostic checksum, not a
// cryptographic authenticity guarantee. No node:crypto, clock or platform I/O.
export function hashState(state: GameState): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(stableSerialize(state))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
