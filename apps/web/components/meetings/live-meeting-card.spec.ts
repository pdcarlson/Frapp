import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/hooks", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/components/meetings/event-minutes", () => ({
  useMeetingsModuleOn: () => true,
}));

const { liveMeetingFor } = await import("./live-meeting-card");

const hour = 3_600_000;
const now = Date.parse("2026-11-16T19:30:00Z");
const event = (over: Record<string, unknown>) => ({
  id: "e-1",
  name: "Chapter meeting",
  start_time: new Date(now - 0.5 * hour).toISOString(),
  end_time: new Date(now + hour).toISOString(),
  check_in_opens_minutes: 10,
  created_by: "me",
  ...over,
});

/** The live-meeting card goes to the event's creator only (Paul, #5219). */
describe("liveMeetingFor", () => {
  it("finds the viewer's event while its check-in is open", () => {
    expect(
      liveMeetingFor([event({})], "me", new Set(), new Set(), now)?.id,
    ).toBe("e-1");
  });

  it("ignores someone else's event", () => {
    expect(
      liveMeetingFor(
        [event({ created_by: "them" })],
        "me",
        new Set(),
        new Set(),
        now,
      ),
    ).toBeNull();
  });

  it("ignores one with minutes, one waved off, and one not on", () => {
    expect(
      liveMeetingFor([event({})], "me", new Set(["e-1"]), new Set(), now),
    ).toBeNull();
    expect(
      liveMeetingFor([event({})], "me", new Set(), new Set(["e-1"]), now),
    ).toBeNull();
    expect(
      liveMeetingFor(
        [
          event({
            start_time: new Date(now + 2 * hour).toISOString(),
            end_time: new Date(now + 3 * hour).toISOString(),
          }),
        ],
        "me",
        new Set(),
        new Set(),
        now,
      ),
    ).toBeNull();
    // Closed 15 minutes after its end.
    expect(
      liveMeetingFor(
        [
          event({
            start_time: new Date(now - 2 * hour).toISOString(),
            end_time: new Date(now - 0.5 * hour).toISOString(),
          }),
        ],
        "me",
        new Set(),
        new Set(),
        now,
      ),
    ).toBeNull();
  });

  it("shows ten minutes before the start, when check-in opens", () => {
    expect(
      liveMeetingFor(
        [event({ start_time: new Date(now + 5 * 60_000).toISOString() })],
        "me",
        new Set(),
        new Set(),
        now,
      )?.id,
    ).toBe("e-1");
  });
});
