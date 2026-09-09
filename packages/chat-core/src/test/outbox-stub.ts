import { vi } from "vitest";
import type { OutboxRow, OutboxStore } from "../adapters";

/**
 * Spec-only Dexie stand-in. Lives under `src/test/` so dep-cruiser treats it
 * as unshipped (`not-to-dev-dep`) while both chat-core spec files share one
 * body — three copies of this object were a jscpd clone.
 */
export function stubOutbox(overrides: Partial<OutboxStore> = {}): OutboxStore {
  return {
    enqueue: vi.fn().mockImplementation(
      async (row): Promise<OutboxRow> => ({
        attempts: 0,
        status: "queued",
        queuedAt: Date.now(),
        ...row,
      }),
    ),
    dequeue: vi.fn().mockResolvedValue(undefined),
    requeue: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    bumpAttempt: vi.fn().mockResolvedValue(undefined),
    listQueued: vi.fn().mockResolvedValue([]),
    listForChannel: vi.fn().mockResolvedValue([]),
    clearDraft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
