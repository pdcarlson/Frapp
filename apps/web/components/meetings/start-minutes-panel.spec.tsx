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
