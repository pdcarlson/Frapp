import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), push: vi.fn() }));

vi.mock("@repo/hooks", () => ({
  useEvents: () => ({ isPending: false, data: [] }),
  useMeetings: () => ({ data: [], refetch: vi.fn() }),
  useRoles: () => ({ data: [] }),
  useMyPermissions: () => ({ data: { permissions: ["events:create"] } }),
  useStartMeeting: () => ({ mutateAsync: mocks.start, isPending: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { StartMinutesPanel } = await import("./start-minutes-panel");

/** Fills in a meeting that never made it onto the calendar. */
function fillNewMeeting(day: string) {
  fireEvent.click(
    screen.getByRole("button", { name: /isn.t on the calendar/i }),
  );
  fireEvent.change(screen.getByLabelText("Meeting name"), {
    target: { value: "Exec meeting" },
  });
  const date = screen.getByLabelText("Date");
  fireEvent.focus(date);
  fireEvent.change(date, { target: { value: day } });
  fireEvent.blur(date);
  fireEvent.change(screen.getByLabelText("Started"), {
    target: { value: "19:00" },
  });
  fireEvent.change(screen.getByLabelText("Ended"), {
    target: { value: "20:00" },
  });
}

/**
 * The day of a meeting that isn't on the calendar is typed the way the rest
 * of the app takes a date ("yesterday", "Nov 4"), not with the browser's
 * own date input (#4504).
 */
describe("StartMinutesPanel, a meeting not on the calendar", () => {
  beforeEach(() => {
    mocks.start.mockReset().mockResolvedValue({ id: "m-1" });
    mocks.push.mockReset();
  });

  it("takes the day in words and starts the minutes for it", async () => {
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fillNewMeeting("yesterday");
    fireEvent.click(screen.getByRole("button", { name: "Start minutes" }));
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    const sent = mocks.start.mock.calls[0]![0];
    expect(sent.new_event.name).toBe("Exec meeting");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(new Date(sent.new_event.start_time).getDate()).toBe(
      yesterday.getDate(),
    );
  });

  it("asks for the day, not the time, when the day can't be read", () => {
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fillNewMeeting("soonish");
    fireEvent.click(screen.getByRole("button", { name: "Start minutes" }));
    expect(
      screen.getByText("Add the day it met, like Tuesday or Nov 4."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Add when it started and ended."),
    ).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
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
  });

  it("opens on what was typed after the page was left, and says so", () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
    fillNewMeeting("yesterday");
    first.unmount();

    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.getByLabelText("Meeting name")).toHaveValue("Exec meeting");
    expect(screen.getByLabelText("Started")).toHaveValue("19:00");
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
    fillNewMeeting("yesterday");
    first.unmount();
    const second = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("Draft restored")).toBeNull();
    expect(screen.queryByLabelText("Meeting name")).toBeNull();
    second.unmount();
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("drops the draft on Cancel", () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fillNewMeeting("yesterday");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    first.unmount();
    render(<StartMinutesPanel open onOpenChange={() => {}} />);
    expect(screen.queryByText("Draft restored")).toBeNull();
  });

  it("drops the draft once the minutes start", async () => {
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fillNewMeeting("yesterday");
    fireEvent.click(screen.getByRole("button", { name: "Start minutes" }));
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
    fillNewMeeting("yesterday");
    fireEvent.click(screen.getByRole("button", { name: "Start minutes" }));
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
  it("puts the draft back when the start fails after the page was left", async () => {
    let fail: (error: Error) => void = () => {};
    mocks.start.mockReset().mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const first = render(<StartMinutesPanel open onOpenChange={() => {}} />);
    fillNewMeeting("yesterday");
    fireEvent.click(screen.getByRole("button", { name: "Start minutes" }));
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
