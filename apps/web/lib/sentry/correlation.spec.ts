import { afterEach, describe, expect, it } from "vitest";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "@/lib/posthog/client";
import { attachPostHogCorrelation } from "./correlation";

const HEX = "a".repeat(64);
const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  bindPostHogAdapterForTests(null);
});

describe("web attachPostHogCorrelation", () => {
  it("attaches the validated hex distinct id and leaves user alone", () => {
    const memory = createMemoryPostHogAdapter();
    memory.setRecording(true);
    bindPostHogAdapterForTests(memory.adapter);
    memory.adapter.identify(HEX);

    const event = attachPostHogCorrelation({
      event_id: "sentry-evt",
      user: { id: HEX },
    } as never);

    expect(event.tags?.posthog_distinct_id).toBe(HEX);
    expect(event.user).toEqual({ id: HEX });
    expect(event.tags?.posthog_distinct_id).not.toBe(UUID);
  });
});
