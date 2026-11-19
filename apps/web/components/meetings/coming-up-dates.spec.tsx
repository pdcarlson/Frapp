import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toast: vi.fn(),
  permissions: { current: [] as string[] },
  tracking: {
    current: [] as Array<{
      event: { id: string; name: string; start_time: string } | null;
      tasks: Array<{
        id: string;
        title: string;
        due_date: string;
        assignee_id: string;
      }>;
    }>,
  },
}));

vi.mock("@repo/hooks", () => ({
  useComingUpTracking: () => mocks.tracking.current,
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-jake" ? "Jake Ruiz" : null),
  }),
  useChapterRoster: () => ({ data: [] }),
  useMyPermissions: () => ({
    data: { permissions: mocks.permissions.current },
  }),
  useCreateTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/components/chat/deferred-panels", () => ({
  EventEditorDialog: () => null,
}));

const { ComingUpDates } = await import("./coming-up-dates");

const dates = [
  { date: "2026-12-04", text: "Dues are due" },
  { date: "2026-12-06", text: "Winter formal" },
];

function openMenu(text: string) {
  const trigger = screen.getByRole("button", { name: `More for ${text}` });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
}

describe("ComingUpDates", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.toast.mockReset();
    mocks.permissions.current = [];
    mocks.tracking.current = [
      {
        event: null,
        tasks: [
          {
            id: "t-1",
            title: "Collect dues",
            due_date: "2026-12-04",
            assignee_id: "u-jake",
          },
        ],
      },
      {
        event: {
          id: "e-1",
          name: "Winter formal",
          start_time: "2026-12-06T19:00:00Z",
        },
        tasks: [],
      },
    ];
  });

  it("says what already tracks each date, linked to it", () => {
    render(<ComingUpDates meetingId="m-1" dates={dates} viewerId="u-me" />);
    expect(
      screen.getByRole("link", { name: "Task · Jake Ruiz" }),
    ).toHaveAttribute("href", "/tasks?task=t-1");
    expect(
      screen.getByRole("link", { name: "On the calendar" }),
    ).toHaveAttribute("href", "/events?event=e-1");
  });

  it("offers an officer the calendar and a task, and opens the day's event", () => {
    mocks.permissions.current = ["events:create", "tasks:manage"];
    render(<ComingUpDates meetingId="m-1" dates={dates} viewerId="u-me" />);
    expect(
      within(openMenu("Dues are due"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Add to calendar", "Make a task", "Copy date"]);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    const menu = openMenu("Winter formal");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Open the event" }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/events?event=e-1");
  });

  it("leaves a member only what they can do", () => {
    render(<ComingUpDates meetingId="m-1" dates={dates} viewerId="u-me" />);
    expect(
      within(openMenu("Dues are due"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy date"]);
  });
});
