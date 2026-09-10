import { afterEach, describe, expect, it } from "vitest";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "../posthog/client";
import { attachPostHogCorrelation } from "./correlation";

const EMAIL = "treasurer@chapter.example.edu";
const ANON_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  bindPostHogAdapterForTests(null);
});

describe("landing attachPostHogCorrelation", () => {
  it("deletes user and never attaches the anonymous distinct id", () => {
    const memory = createMemoryPostHogAdapter();
    memory.setRecording(true);
    memory.setDistinctId(ANON_UUID);
    bindPostHogAdapterForTests(memory.adapter);

    const event = attachPostHogCorrelation({
      event_id: "sentry-evt",
      user: { id: ANON_UUID, email: EMAIL },
      tags: { posthog_distinct_id: ANON_UUID },
    } as never);

    expect(event.user).toBeUndefined();
    expect(event.tags?.posthog_distinct_id).toBeUndefined();
    expect(JSON.stringify(event.tags)).not.toContain(ANON_UUID);
    expect(JSON.stringify(event.tags)).not.toContain(EMAIL);
  });
});
