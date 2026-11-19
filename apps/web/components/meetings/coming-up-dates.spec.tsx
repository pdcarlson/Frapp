import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toast: vi.fn(),
  eventDialog: vi.fn(),
  taskForm: vi.fn(),
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
  useComingUpTracking: () => ({
    tracking: mocks.tracking.current,
    canCreateEvents: mocks.permissions.current.includes("events:create"),
    canManageTasks: mocks.permissions.current.includes("tasks:manage"),
  }),
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-jake" ? "Jake Ruiz" : null),
  }),
  useChapterRoster: () => ({
    data: [{ user_id: "u-jake", display_name: "Jake Ruiz" }],
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
  EventEditorDialog: (props: Record<string, unknown>) => {
    mocks.eventDialog(props);
    return null;
  },
}));

vi.mock("@/components/tasks/task-form", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TaskForm: (props: Record<string, unknown>) => {
    mocks.taskForm(props);
    return null;
  },
}));

const { ComingUpDates } = await import("./coming-up-dates");

// Far enough ahead that the menu offers what to make from them.
const dates = [
  { date: "2099-12-04", text: "Jake Ruiz collects dues" },
  { date: "2099-12-06", text: "Winter formal" },
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
    mocks.eventDialog.mockReset();
    mocks.taskForm.mockReset();
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
    render(<ComingUpDates dates={dates} viewerId="u-me" />);
    expect(
      screen.getByRole("link", { name: "Task · Jake Ruiz" }),
    ).toHaveAttribute("href", "/tasks?task=t-1");
    expect(
      screen.getByRole("link", { name: "On the calendar" }),
    ).toHaveAttribute("href", "/events?event=e-1");
  });

  it("offers an officer the calendar and a task, and opens the day's event", () => {
    mocks.permissions.current = ["events:create", "tasks:manage"];
    render(<ComingUpDates dates={dates} viewerId="u-me" />);
    expect(
      within(openMenu("Jake Ruiz collects dues"))
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
    render(<ComingUpDates dates={dates} viewerId="u-me" />);
    expect(
      within(openMenu("Jake Ruiz collects dues"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy date"]);
  });

  it("opens New event on the day at 7 PM, named with the date's words", () => {
    mocks.permissions.current = ["events:create", "tasks:manage"];
    mocks.tracking.current[1]!.event = null;
    render(<ComingUpDates dates={dates} viewerId="u-me" />);
    fireEvent.click(
      within(openMenu("Winter formal")).getByRole("menuitem", {
        name: "Add to calendar",
      }),
    );
    expect(mocks.eventDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: "create",
        initialName: "Winter formal",
        initialStartAt: "2099-12-06T19:00",
        initialEndAt: "2099-12-06T20:00",
      }),
    );
  });

  it("opens the task form due that day, Who guessed from the words", () => {
    mocks.permissions.current = ["tasks:manage"];
    render(<ComingUpDates dates={dates} viewerId="u-me" />);
    fireEvent.click(
      within(openMenu("Jake Ruiz collects dues")).getByRole("menuitem", {
        name: "Make a task",
      }),
    );
    expect(mocks.taskForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialDraft: expect.objectContaining({
          title: "Jake Ruiz collects dues",
          dueDate: "2099-12-04",
          assigneeId: "u-jake",
        }),
      }),
    );
  });

  it("copies the date written out", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ComingUpDates dates={dates} viewerId="u-me" />);
    fireEvent.click(
      within(openMenu("Winter formal")).getByRole("menuitem", {
        name: "Copy date",
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/December 6(, 2099)?: Winter formal$/),
    );
    await vi.waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({ title: "Date copied" }),
    );
  });
});
