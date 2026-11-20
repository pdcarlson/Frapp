/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  eventSheet: vi.fn(),
  taskSheet: vi.fn(),
  copy: vi.fn(() => Promise.resolve(true)),
  permissions: [] as string[],
  reminders: [] as Array<{
    id: string;
    date: string;
    text: string;
    remind_at: string;
  }>,
  setReminder: vi.fn(),
  clearReminder: vi.fn(),
  menus: [] as Array<{
    title: string;
    actions: Array<{ label: string; run: () => void }>;
  }>,
  tracking: [] as Array<{
    event: { id: string; name: string; start_time: string } | null;
    tasks: Array<{
      id: string;
      title: string;
      due_date: string;
      assignee_id: string;
    }>;
  }>,
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: mocks.copy,
}));

vi.mock("@repo/hooks", () => ({
  useComingUpTracking: () => ({
    tracking: mocks.tracking,
    canCreateEvents: mocks.permissions.includes("events:create"),
    canManageTasks: mocks.permissions.includes("tasks:manage"),
  }),
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-jake" ? "Jake Ruiz" : null),
  }),
  useChapterRoster: () => ({
    data: [{ user_id: "u-jake", display_name: "Jake Ruiz" }],
  }),
  useMeetingDateReminders: () => ({ data: mocks.reminders }),
  useSetMeetingDateReminder: () => ({ mutateAsync: mocks.setReminder }),
  useClearMeetingDateReminder: () => ({ mutateAsync: mocks.clearReminder }),
}));

vi.mock("@/components/item-actions-menu", () => ({
  useItemMenu: () => ({
    handleFor: (menu: (typeof mocks.menus)[number] | null) => {
      if (!menu || menu.actions.length === 0) return null;
      mocks.menus.push(menu);
      return { ...menu, open: vi.fn() };
    },
    element: null,
  }),
}));

vi.mock("@/components/events/new-event-sheet", () => ({
  NewEventSheet: (props: Record<string, unknown>) => {
    mocks.eventSheet(props);
    return null;
  },
}));

vi.mock("@/components/tasks/new-task-sheet", () => ({
  NewTaskSheet: (props: Record<string, unknown>) => {
    mocks.taskSheet(props);
    return null;
  },
}));

import { ComingUpDates } from "./coming-up-dates";

// Far enough ahead that the menu offers what to make from them.
const dates = [
  { date: "2099-12-04", text: "Jake Ruiz collects dues" },
  { date: "2099-12-06", text: "Winter formal" },
];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ComingUpDates meetingId="m-1" dates={dates} viewerId="u-me" />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const labelsOf = (title: string) =>
  mocks.menus
    .filter((menu) => menu.title === title)
    .at(-1)!
    .actions.map((action) => action.label);

describe("ComingUpDates", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.eventSheet.mockReset();
    mocks.taskSheet.mockReset();
    mocks.copy.mockClear();
    mocks.menus = [];
    mocks.permissions = [];
    mocks.reminders = [];
    mocks.setReminder.mockReset().mockResolvedValue({});
    mocks.clearReminder.mockReset().mockResolvedValue(undefined);
    mocks.tracking = [
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

  it("says what already tracks each date, and opens it", () => {
    const tree = render();
    expect(drawnText(tree.root)).toContain("Task · Jake Ruiz");
    expect(drawnText(tree.root)).toContain("On the calendar");
    const chip = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "link" &&
        drawnText(node) === "On the calendar",
    );
    act(() => chip.props.onPress());
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "e-1" },
    });
  });

  it("offers an officer the calendar and a task, as web does", () => {
    mocks.permissions = ["events:create", "tasks:manage"];
    render();
    expect(labelsOf("Jake Ruiz collects dues")).toEqual([
      "Remind me",
      "Add to calendar",
      "Make a task",
      "Copy date",
    ]);
    expect(labelsOf("Winter formal")).toEqual([
      "Remind me",
      "Open the event",
      "Make a task",
      "Copy date",
    ]);
  });

  it("leaves a member only what they can do", () => {
    render();
    expect(labelsOf("Jake Ruiz collects dues")).toEqual([
      "Remind me",
      "Copy date",
    ]);
  });

  const pick = (title: string, label: string) => {
    const action = mocks.menus
      .filter((menu) => menu.title === title)
      .at(-1)!
      .actions.find((entry) => entry.label === label)!;
    act(() => action.run());
  };

  it("opens New event on the day at 7 PM, named with the date's words", () => {
    mocks.permissions = ["events:create"];
    mocks.tracking[1]!.event = null;
    render();
    pick("Winter formal", "Add to calendar");
    const template = mocks.eventSheet.mock.lastCall![0].template;
    expect(template.name).toBe("Winter formal");
    expect(template.start).toEqual(new Date(2099, 11, 6, 19));
    expect(template.end).toEqual(new Date(2099, 11, 6, 20));
  });

  it("opens the task sheet due that day, Who guessed from the words, for one person", () => {
    mocks.permissions = ["tasks:manage"];
    render();
    pick("Jake Ruiz collects dues", "Make a task");
    const props = mocks.taskSheet.mock.lastCall![0];
    expect(props.prefill).toMatchObject({
      title: "Jake Ruiz collects dues",
      who: { kind: "person", userId: "u-jake" },
      due: { kind: "date", date: "2099-12-04" },
    });
    // One person, as web's form: no group to misreport on the chip.
    expect(props.offerGroups).toBeUndefined();
  });

  it("copies the date written out", () => {
    render();
    pick("Winter formal", "Copy date");
    expect(mocks.copy).toHaveBeenCalledWith(
      expect.stringMatching(/December 6(, 2099)?: Winter formal$/),
    );
  });

  it("reminds any reader the evening before, and says so to a screen reader", async () => {
    const { AccessibilityInfo } = await import("react-native");
    const announce = vi
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    render();
    pick("Winter formal", "Remind me");
    expect(mocks.setReminder).toHaveBeenCalledWith({
      date: "2099-12-06",
      text: "Winter formal",
      remindAt: new Date(2099, 11, 5, 18),
    });
    await vi.waitFor(() =>
      expect(announce).toHaveBeenCalledWith(
        "We'll remind you December 5, 6 PM",
      ),
    );
    announce.mockRestore();
  });

  it("shows a set reminder as a chip, and cancels it from the menu", () => {
    mocks.reminders = [
      {
        id: "r-1",
        date: "2099-12-06",
        text: "Winter formal",
        remind_at: new Date(2099, 11, 5, 18).toISOString(),
      },
    ];
    const tree = render();
    expect(drawnText(tree.root)).toContain("Reminder · December 5, 6 PM");
    // Only the event and task chips open anything.
    expect(
      tree.root.findAll(
        (node) =>
          node.props.accessibilityRole === "link" &&
          drawnText(node).startsWith("Reminder"),
      ),
    ).toHaveLength(0);
    expect(labelsOf("Winter formal")[0]).toBe("Cancel reminder");
    pick("Winter formal", "Cancel reminder");
    expect(mocks.clearReminder).toHaveBeenCalledWith("r-1");
  });
});
