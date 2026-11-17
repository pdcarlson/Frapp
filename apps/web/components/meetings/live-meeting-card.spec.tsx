import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: { current: ["meetings:record"] as string[] },
  events: { current: [] as Array<Record<string, unknown>> },
  start: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useEvents: () => ({ data: mocks.events.current }),
  useMeetings: () => ({ isPending: false, data: [], refetch: vi.fn() }),
  useMyPermissions: () => ({
    data: { permissions: mocks.permissions.current },
  }),
  useStartMeeting: () => ({ mutateAsync: mocks.start, isPending: false }),
  useViewerUserId: () => "me",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/components/meetings/event-minutes", () => ({
  useMeetingsModuleOn: () => true,
}));

const { LiveMeetingCard, liveMeetingFor } = await import("./live-meeting-card");

const hour = 3_600_000;

/** The card in the nav's foot (#5219), as its creator sees it. */
describe("LiveMeetingCard", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.permissions.current = ["meetings:record"];
    mocks.start.mockReset().mockResolvedValue({ id: "m-1" });
    mocks.push.mockReset();
    const now = Date.now();
    mocks.events.current = [
      {
        id: "e-1",
        name: "Chapter meeting",
        start_time: new Date(now - 0.25 * hour).toISOString(),
        end_time: new Date(now + hour).toISOString(),
        check_in_opens_minutes: 10,
        created_by: "me",
      },
    ];
  });

  it("starts the minutes in one press", async () => {
    render(<LiveMeetingCard />);
    expect(screen.getByText("Chapter meeting is on")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start minutes" }));
    await vi.waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/meetings/m-1"),
    );
    expect(mocks.start).toHaveBeenCalledWith({
      event_id: "e-1",
      meeting_type: "chapter",
    });
  });

  it("shows nothing to a creator who can't start minutes", () => {
    mocks.permissions.current = [];
    render(<LiveMeetingCard />);
    expect(screen.queryByText("Chapter meeting is on")).toBeNull();
  });

  it("stays gone for that event after Not now", () => {
    const first = render(<LiveMeetingCard />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Chapter meeting is on")).toBeNull();
    first.unmount();
    render(<LiveMeetingCard />);
    expect(screen.queryByText("Chapter meeting is on")).toBeNull();
  });
});

const fixedNow = Date.parse("2026-11-16T19:30:00Z");
const event = (over: Record<string, unknown>) => ({
  id: "e-1",
  name: "Chapter meeting",
  start_time: new Date(fixedNow - 0.5 * hour).toISOString(),
  end_time: new Date(fixedNow + hour).toISOString(),
  check_in_opens_minutes: 10,
  created_by: "me",
  ...over,
});

/** The live-meeting card goes to the event's creator only (Paul, #5219). */
describe("liveMeetingFor", () => {
  it("finds the viewer's event while its check-in is open", () => {
    expect(
      liveMeetingFor([event({})], "me", new Set(), new Set(), fixedNow)?.id,
    ).toBe("e-1");
  });

  it("ignores someone else's event", () => {
    expect(
      liveMeetingFor(
        [event({ created_by: "them" })],
        "me",
        new Set(),
        new Set(),
        fixedNow,
      ),
    ).toBeNull();
  });

  it("ignores one with minutes, one waved off, and one not on", () => {
    expect(
      liveMeetingFor([event({})], "me", new Set(["e-1"]), new Set(), fixedNow),
    ).toBeNull();
    expect(
      liveMeetingFor([event({})], "me", new Set(), new Set(["e-1"]), fixedNow),
    ).toBeNull();
    expect(
      liveMeetingFor(
        [
          event({
            start_time: new Date(fixedNow + 2 * hour).toISOString(),
            end_time: new Date(fixedNow + 3 * hour).toISOString(),
          }),
        ],
        "me",
        new Set(),
        new Set(),
        fixedNow,
      ),
    ).toBeNull();
    // Closed 15 minutes after its end.
    expect(
      liveMeetingFor(
        [
          event({
            start_time: new Date(fixedNow - 2 * hour).toISOString(),
            end_time: new Date(fixedNow - 0.5 * hour).toISOString(),
          }),
        ],
        "me",
        new Set(),
        new Set(),
        fixedNow,
      ),
    ).toBeNull();
  });

  it("shows ten minutes before the start, when check-in opens", () => {
    expect(
      liveMeetingFor(
        [event({ start_time: new Date(fixedNow + 5 * 60_000).toISOString() })],
        "me",
        new Set(),
        new Set(),
        fixedNow,
      )?.id,
    ).toBe("e-1");
  });
});
