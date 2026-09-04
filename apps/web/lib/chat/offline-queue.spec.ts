import { describe, expect, it } from "vitest";
import type { OutboxStore } from "@repo/chat-core/adapters";
import { dexieOutboxStore } from "./offline-queue";

describe("dexieOutboxStore", () => {
  it("is an OutboxStore imported from the adapters subpath, not the package barrel", () => {
    const store: OutboxStore = dexieOutboxStore;
    expect(Object.keys(store).sort()).toEqual(
      [
        "bumpAttempt",
        "clearDraft",
        "dequeue",
        "enqueue",
        "listForChannel",
        "listQueued",
        "markFailed",
        "requeue",
      ].sort(),
    );
  });
});
