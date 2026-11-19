/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  permissions: [] as string[],
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
  setStringAsync: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@repo/hooks", () => ({
  useComingUpTracking: () => mocks.tracking,
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u-jake" ? "Jake Ruiz" : null),
  }),
  useChapterRoster: () => ({ data: [] }),
  usePermissionList: () => mocks.permissions,
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
  NewEventSheet: () => null,
}));

vi.mock("@/components/tasks/new-task-sheet", () => ({
  NewTaskSheet: () => null,
}));

import { ComingUpDates } from "./coming-up-dates";

const dates = [
  { date: "2026-12-04", text: "Dues are due" },
  { date: "2026-12-06", text: "Winter formal" },
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
    mocks.menus = [];
    mocks.permissions = [];
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
    expect(labelsOf("Dues are due")).toEqual([
      "Add to calendar",
      "Make a task",
      "Copy date",
    ]);
    expect(labelsOf("Winter formal")).toEqual([
      "Open the event",
      "Make a task",
      "Copy date",
    ]);
  });

  it("leaves a member only what they can do", () => {
    render();
    expect(labelsOf("Dues are due")).toEqual(["Copy date"]);
  });
});
