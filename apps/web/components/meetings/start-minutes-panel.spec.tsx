import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  push: vi.fn(),
  permissions: { current: ["events:create"] as string[] },
  events: { current: [] as Array<Record<string, unknown>> },
  meetings: { current: [] as Array<Record<string, unknown>> },
}));

vi.mock("@repo/hooks", () => ({
  useEvents: () => ({ isPending: false, data: mocks.events.current }),
  useMeetings: () => ({
    isPending: false,
    data: mocks.meetings.current,
    refetch: vi.fn(),
  }),
  useRoles: () => ({ data: [] }),
  useMyPermissions: () => ({
    data: { permissions: mocks.permissions.current },
  }),
  useStartMeeting: () => ({ mutateAsync: mocks.start, isPending: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { StartMinutesPanel } = await import("./start-minutes-panel");

const hour = 3_600_000;

/** A meeting from yesterday: on the list, and picked when the panel opens. */
function yesterdaysMeeting() {
  const now = Date.now();
  return {
    id: "e-1",
    name: "Exec meeting",
    start_time: new Date(now - 24 * hour).toISOString(),
    end_time: new Date(now - 23 * hour).toISOString(),
  };
}

/** Picks No meeting and files the minutes as Committee: a form worth keeping. */
function pickNoMeeting() {
  fireEvent.click(screen.getByRole("button", { name: /No meeting/ }));
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  fireEvent.click(screen.getByRole("radio", { name: "Committee" }));
}

/**
 * Minutes with no meeting (Paul, 2026-11-20): written or recorded now, and
 * linked to their meeting later. One row in the list, never a second form.
 */
describe("StartMinutesPanel, no meeting", () => {
  beforeEach(() => {
    mocks.start.mockReset().mockResolvedValue({ id: "m-1" });
    mocks.push.mockReset();
    mocks.permissions.current = ["meetings:record"];
    mocks.events.current = [];
    mocks.meetings.current = [];
    localStorage.clear();
  });

  it("opens on No meeting when nothing is on the calendar, and starts unlinked", async () => {
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /No meeting/, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText("Link one later")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    const sent = mocks.start.mock.calls[0]![0];
    expect(sent).toEqual({ meeting_type: "other", other_label: null });
    await vi.waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/meetings/m-1"),
    );
  });

  it("is a row under the calendar's meetings, picked by a press", async () => {
    mocks.events.current = [yesterdaysMeeting()];
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Exec meeting/, pressed: true }),
    ).toBeInTheDocument();
    pickNoMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(mocks.start.mock.calls[0]![0]).toEqual({
      meeting_type: "committee",
      other_label: null,
    });
  });

  it("never asks for a meeting's name or day", () => {
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/isn.t on the calendar/)).toBeNull();
  });
});

describe("StartMinutesPanel docked (#4593)", () => {
  it("opens in place of the Meetings page beside chat, and goes back with the arrow", () => {
    const onOpenChange = vi.fn();
    render(
      <div data-tool-column="">
        <div data-tool-page="" />
        <StartMinutesPanel open onOpenChange={onOpenChange} />
      </div>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const region = screen.getByRole("region", { name: "New minutes" });
    expect(region.parentElement).toHaveAttribute("data-tool-column");
    fireEvent.click(screen.getByRole("button", { name: "Back to meetings" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/**
 * Leaving mid-form keeps the draft (Paul, 2026-11-13, #4593): no "are you
 * sure", and the form opens on what was typed next time.
 */
describe("StartMinutesPanel keeps its draft (#4593)", () => {
  beforeEach(() => {
    mocks.start.mockReset().mockResolvedValue({ id: "m-1" });
    mocks.push.mockReset();
    mocks.events.current = [yesterdaysMeeting()];
    mocks.meetings.current = [];
    localStorage.clear();
  });

  it("opens on what was typed after the page was left, and says so", () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
    pickNoMeeting();
    first.unmount();

    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /No meeting/, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Type: Committee/)).toBeInTheDocument();
    expect(screen.getByText("Draft restored")).toBeInTheDocument();
  });

  it("keeps nothing for a form opened and left untouched", () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    first.unmount();
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("starts over on Discard", () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    pickNoMeeting();
    first.unmount();
    const second = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("Draft restored")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Exec meeting/, pressed: true }),
    ).toBeInTheDocument();
    second.unmount();
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("drops the draft on Cancel", () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    pickNoMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    first.unmount();
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("drops the draft once the minutes start", async () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    pickNoMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    first.unmount();
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("doesn't pull the officer to the new minutes once they have left the page, nor offer them again", async () => {
    let land: (value: { id: string }) => void = () => {};
    mocks.start.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    const first = render(
      <StartMinutesPanel open onOpenChange={onOpenChange} />,
    );
    pickNoMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    first.unmount();
    // Back before it lands: nothing to start a second time.
    const second = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
    second.unmount();
    land({ id: "m-1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("StartMinutesPanel keeps a draft whose start failed (#4593)", () => {
  beforeEach(() => {
    mocks.events.current = [yesterdaysMeeting()];
    mocks.meetings.current = [];
    localStorage.clear();
  });

  it("puts the draft back when the start fails after the page was left", async () => {
    let fail: (error: Error) => void = () => {};
    mocks.start.mockReset().mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    pickNoMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    first.unmount();
    fail(new Error("offline"));
    await vi.waitFor(() => {
      const view = render(<StartMinutesPanel open onOpenChange={() => {}} />);
      const restored = screen.queryByText("Draft restored");
      view.unmount();
      expect(restored).not.toBeNull();
    });
  });
});

/** One question at a time (#5219): the likely meeting comes picked. */
describe("StartMinutesPanel picks the meeting", () => {
  beforeEach(() => {
    mocks.start.mockReset().mockResolvedValue({ id: "m-1" });
    mocks.push.mockReset();
    mocks.permissions.current = ["meetings:record"];
    localStorage.clear();
  });

  it("opens on the meeting that is on now and starts it in one press", async () => {
    const now = Date.now();
    mocks.events.current = [
      {
        id: "e-old",
        name: "Exec meeting",
        start_time: new Date(now - 72 * hour).toISOString(),
        end_time: new Date(now - 71 * hour).toISOString(),
      },
      {
        id: "e-now",
        name: "Chapter meeting",
        start_time: new Date(now - 0.25 * hour).toISOString(),
        end_time: new Date(now + hour).toISOString(),
      },
    ];
    mocks.meetings.current = [];
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Chapter meeting/, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Type: Chapter/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(mocks.start.mock.calls[0]![0]).toMatchObject({
      event_id: "e-now",
      meeting_type: "chapter",
    });
  });

  it("skips meetings that already have minutes", () => {
    const now = Date.now();
    mocks.events.current = [
      {
        id: "e-done",
        name: "Chapter meeting",
        start_time: new Date(now - 24 * hour).toISOString(),
        end_time: new Date(now - 23 * hour).toISOString(),
      },
      {
        id: "e-exec",
        name: "Exec meeting",
        start_time: new Date(now - 48 * hour).toISOString(),
        end_time: new Date(now - 47 * hour).toISOString(),
      },
    ];
    mocks.meetings.current = [{ id: "m-9", event_id: "e-done" }];
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Exec meeting/, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Type: Exec/)).toBeInTheDocument();
  });

  it("shows five meetings, and the rest behind Show older", () => {
    const now = Date.now();
    mocks.events.current = Array.from({ length: 8 }, (_, i) => ({
      id: `e-${i}`,
      name: `Meeting ${i}`,
      start_time: new Date(now - (i + 1) * 24 * hour).toISOString(),
      end_time: new Date(now - (i + 1) * 24 * hour + hour).toISOString(),
    }));
    mocks.meetings.current = [];
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Meeting 7/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(
      screen.getByRole("button", { name: /Meeting 7/ }),
    ).toBeInTheDocument();
  });

  it("prefers the meeting about to start over the newest past one", () => {
    const now = Date.now();
    mocks.events.current = [
      {
        id: "e-past",
        name: "Exec meeting",
        start_time: new Date(now - 24 * hour).toISOString(),
        end_time: new Date(now - 23 * hour).toISOString(),
        check_in_opens_minutes: 10,
      },
      {
        id: "e-soon",
        name: "Chapter meeting",
        start_time: new Date(now + 5 * 60_000).toISOString(),
        end_time: new Date(now + hour).toISOString(),
        check_in_opens_minutes: 10,
      },
    ];
    mocks.meetings.current = [];
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Chapter meeting/, pressed: true }),
    ).toBeInTheDocument();
  });

  it("reaches back 120 days, five rows at a time", () => {
    const now = Date.now();
    const day = 24 * hour;
    mocks.events.current = [1, 2, 3, 4, 5, 100, 130].map((ago) => ({
      id: `e-${ago}`,
      name: `Meeting ${ago}`,
      start_time: new Date(now - ago * day).toISOString(),
      end_time: new Date(now - ago * day + hour).toISOString(),
    }));
    mocks.meetings.current = [];
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Meeting 5\D/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Meeting 100/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(
      screen.getByRole("button", { name: /Meeting 100/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Meeting 130/ })).toBeNull();
  });

  it("states the type in one line, and shows the Standards note only on Change", () => {
    const now = Date.now();
    mocks.events.current = [
      {
        id: "e-1",
        name: "Chapter meeting",
        start_time: new Date(now - 24 * hour).toISOString(),
        end_time: new Date(now - 23 * hour).toISOString(),
      },
    ];
    mocks.meetings.current = [];
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Standards/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText(/Standards/)).toBeInTheDocument();
  });

  it("moves its pick past a meeting someone else already started", async () => {
    const now = Date.now();
    mocks.events.current = [
      {
        id: "e-new",
        name: "Chapter meeting",
        start_time: new Date(now - 24 * hour).toISOString(),
        end_time: new Date(now - 23 * hour).toISOString(),
      },
      {
        id: "e-old",
        name: "Exec meeting",
        start_time: new Date(now - 48 * hour).toISOString(),
        end_time: new Date(now - 47 * hour).toISOString(),
      },
    ];
    mocks.meetings.current = [];
    mocks.start
      .mockReset()
      .mockRejectedValue(
        Object.assign(new Error("taken"), { code: "meeting.already_started" }),
      );
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Write minutes" }));
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Exec meeting/, pressed: true }),
      ).toBeInTheDocument(),
    );
  });
});
