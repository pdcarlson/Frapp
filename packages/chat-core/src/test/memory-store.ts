import type { KeyValueStore } from "../adapters";

/**
 * Spec-only in-memory KV. Four copies of this object were a jscpd clone
 * across chat-core specs; lives under `src/test/` so dep-cruiser treats it
 * as unshipped.
 */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}
