import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";

const mockActivity = vi.fn();
const mockInvalidate = vi.fn();
const mockNetwork = vi.fn(() => ({ isOffline: false }));
const mockModuleGate = vi.fn<() => ((module: string) => boolean) | undefined>(
  () => undefined,
);
const mockPermissions = vi.fn(() => ({
  data: { permissions: [] as string[] },
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    // The row model is the real one (`activityGroups` and its tables).
    ACTIVITY_FILTERS: actual.ACTIVITY_FILTERS,
    ACTIVITY_SECTION_NAMES: actual.ACTIVITY_SECTION_NAMES,
    activityBadgeIsAsk: actual.activityBadgeIsAsk,
    activityGroups: actual.activityGroups,
    activityKeys: actual.activityKeys,
    activityNeedsYouHeadline: actual.activityNeedsYouHeadline,
    activityNextUpLine: actual.activityNextUpLine,
    activitySummary: actual.activitySummary,
    useNowDate: actual.useNowDate,
    useActiveChapterId: () => "chap-1",
    useActivity: () => mockActivity(),
    useMyPermissions: () => mockPermissions(),
  };
});
// The chapter's module switch, unknown here: every tile shows.
vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGate: () => mockModuleGate(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "me", isLoading: false }),
}));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => mockNetwork(),
}));
/*
  The panel is stubbed to its contract: which row it was handed, and the two
  callbacks. What the cards do inside it is chat's own tests' business; what
  this page owes is opening the right row and reacting to close and acted.
*/
vi.mock("./activity-panel", () => ({
  ActivityPanel: ({
    row,
    onClose,
    onActed,
  }: {
    row: ActivityRow | null;
    onClose: (key?: string) => void;
    onActed: () => void;
  }) =>
    row ? (
      <div data-testid="panel">
        <span>{`panel:${row.title}`}</span>
        <button onClick={() => onClose()}>close</button>
        <button onClick={() => onClose("some-other-row")}>late close</button>
        <button onClick={() => onClose(row.key)}>settled close</button>
        <button onClick={onActed}>acted</button>
      </div>
    ) : null,
}));

// The link row's actions are its own spec's (`activity-link-row.spec.tsx`);
// this page owes drawing one per link, with Remove only for an officer.
vi.mock("./activity-link-row", () => ({
  useActivityLinkActions: () => ({}),
  ActivityLinkRow: ({
    row,
    canRemove,
  }: {
    row: ActivityRow;
    canRemove: boolean;
  }) => <li>{`link:${row.title}:${canRemove ? "officer" : "member"}`}</li>,
}));

const { ActivityPage } = await import("./activity-page");

const task = {
  id: "t1",
  title: "Book the venue",
  due_date: "2099-01-01",
  status: "TODO",
  stored_status: "TODO",
  assignee_id: "me",
  assignee_name: "Me",
  created_by: "officer",
  created_by_name: "Olive",
  point_reward: null,
  completed_at: null,
  confirmed_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
};
const poll = {
  message_id: "p1",
  channel_id: "c1",
  channel_name: "general",
  channel_type: "PUBLIC",
  sender_id: "officer",
  question: "Formal venue?",
  option_count: 2,
  closes_at: "2099-01-01T00:00:00.000Z",
  closed_at: null,
  is_closed: false,
  has_voted: false,
  created_at: "2026-11-01T00:00:00.000Z",
  message: {},
};
const data = (overrides: Record<string, unknown> = {}) => ({
  needs_you: {
    tasks: [task],
    task_confirmations: [],
    hours_approvals: [],
    polls: [poll],
  },
  coming_up: [],
  links: [],
  made_by_you: {
    polls: [],
    tasks: [],
    events: [],
  },
  needs_you_count: 2,
  unavailable: [],
  ...overrides,
});
const loaded = (overrides: Record<string, unknown> = {}) => ({
  data: data(overrides),
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockNetwork.mockReturnValue({ isOffline: false });
  mockPermissions.mockReturnValue({ data: { permissions: [] } });
});

describe("ActivityPage", () => {
  it("draws Needs you first, with each row's badge, and no Files chip (#4291)", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Needs you",
      "Coming up",
      "Links",
      "Made by you",
    ]);
    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByText("Book the venue")).toBeInTheDocument();
    expect(within(needs).getByText("Vote")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Files" })).toBeNull();
    expect(
      screen.getByText("No events in the next two weeks."),
    ).toBeInTheDocument();
  });

  it("narrows to one kind under a chip, and leaves out the groups with nothing of it", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Polls" }));

    expect(screen.getByRole("button", { name: "Polls" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Formal venue?")).toBeInTheDocument();
    expect(screen.queryByText("Book the venue")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Coming up" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Made by you" })).toBeNull();
  });

  it("lists open polls only, and keeps closed ones behind Archived polls (#4258)", () => {
    mockActivity.mockReturnValue(
      loaded({
        made_by_you: {
          polls: [
            {
              ...poll,
              message_id: "m1",
              question: "Open one",
              sender_id: "me",
            },
            {
              ...poll,
              message_id: "m2",
              question: "Closed one",
              sender_id: "me",
              is_closed: true,
              closed_at: "2026-11-02T00:00:00.000Z",
            },
          ],
          tasks: [],
          events: [],
        },
      }),
    );
    render(<ActivityPage />);

    const made = screen.getByRole("region", { name: "Made by you" });
    expect(within(made).getByText("Open one")).toBeInTheDocument();
    expect(within(made).queryByText("Closed one")).toBeNull();
    const toggle = within(made).getByRole("button", {
      name: "Archived polls (1)",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const archive = within(made).getByRole("list", { name: "Archived polls" });
    expect(within(archive).getByText("Closed one")).toBeInTheDocument();
    expect(within(archive).getByText("Closed")).toBeInTheDocument();

    // A closed poll opens its card, with its result, like any other row.
    fireEvent.click(
      within(archive).getByRole("button", { name: /Closed one/ }),
    );
    expect(screen.getByTestId("panel")).toHaveTextContent("panel:Closed one");
  });

  it("keeps Made by you under the Polls chip while every posted poll is closed, for its archive", () => {
    mockActivity.mockReturnValue(
      loaded({
        made_by_you: {
          polls: [
            {
              ...poll,
              message_id: "m-closed",
              question: "All done",
              sender_id: "me",
              is_closed: true,
              closed_at: "2026-11-02T00:00:00.000Z",
            },
          ],
          tasks: [],
          events: [],
        },
      }),
    );
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Polls" }));

    const made = screen.getByRole("region", { name: "Made by you" });
    expect(
      within(made).getByRole("button", { name: "Archived polls (1)" }),
    ).toBeInTheDocument();
  });

  it("moves a poll to the archive when its time runs out while the page is open", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
      mockActivity.mockReturnValue(
        loaded({
          made_by_you: {
            polls: [
              {
                ...poll,
                message_id: "m-soon",
                question: "Closing soon",
                sender_id: "me",
                closes_at: "2026-11-11T12:00:20.000Z",
              },
            ],
            tasks: [],
            events: [],
          },
        }),
      );
      render(<ActivityPage />);
      const made = screen.getByRole("region", { name: "Made by you" });
      expect(within(made).getByText("Closing soon")).toBeInTheDocument();

      // One tick of the shared clock, past the closing time, with no re-read.
      act(() => {
        vi.advanceTimersByTime(31_000);
      });

      expect(within(made).queryByText("Closing soon")).toBeNull();
      expect(
        within(made).getByRole("button", { name: "Archived polls (1)" }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a section could not be loaded instead of calling it empty", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [],
          task_confirmations: [],
          hours_approvals: [],
          polls: [],
        },
        unavailable: ["polls"],
      }),
    );
    render(<ActivityPage />);

    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(within(needs).getByText(/Couldn't load polls/)).toBeInTheDocument();
    expect(
      within(needs).queryByText("Nothing is waiting on you."),
    ).not.toBeInTheDocument();
  });

  it("opens the row it was asked for in the panel", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
  });

  it("keeps the panel open when the row has left the list after an action", () => {
    mockActivity.mockReturnValue(loaded());
    const { rerender } = render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    // The vote landed: the re-read no longer lists the poll under Needs you.
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [task],
          task_confirmations: [],
          hours_approvals: [],
          polls: [],
        },
      }),
    );
    rerender(<ActivityPage />);

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Formal venue\?/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the list and the open panel when a re-read fails", () => {
    mockActivity.mockReturnValue(loaded());
    const { rerender } = render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    mockActivity.mockReturnValue({
      ...loaded(),
      isError: true,
      error: new Error("503"),
    });
    rerender(<ActivityPage />);

    expect(screen.getByText("Book the venue")).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load your activity"),
    ).not.toBeInTheDocument();
  });

  it("shows the error page only when there is nothing to show", () => {
    mockActivity.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("503"),
      refetch: vi.fn(),
    });
    render(<ActivityPage />);

    expect(screen.getByText("Couldn't load your activity")).toBeInTheDocument();
  });

  it("re-reads once when the panel is closed by hand, and once when an action settles", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(mockInvalidate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));
    fireEvent.click(screen.getByRole("button", { name: "acted" }));
    fireEvent.click(screen.getByRole("button", { name: "settled close" }));
    expect(screen.queryByTestId("panel")).toBeNull();
    // `acted` re-read; the settled close did not read a second time.
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
  });

  it("does not close the open row when another row's action answers late", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Formal venue\?/ }));

    fireEvent.click(screen.getByRole("button", { name: "late close" }));

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
  });

  it("lists sign-up links in their own group, with Remove only for a channels:manage holder", () => {
    const link = {
      id: "l1",
      url: "https://forms.gle/abc",
      host: "forms.gle",
      message_id: "m1",
      thread_root_id: null,
      channel_id: "c1",
      channel_name: "rush",
      channel_type: "PUBLIC",
      posted_by: "olive",
      posted_by_name: "Olive",
      posted_at: "2026-11-10T15:00:00.000Z",
    };
    mockActivity.mockReturnValue(loaded({ links: [link] }));
    const { unmount } = render(<ActivityPage />);

    const links = screen.getByRole("region", { name: "Links" });
    expect(
      within(links).getByText("link:Google Form:member"),
    ).toBeInTheDocument();
    unmount();

    mockPermissions.mockReturnValue({
      data: { permissions: ["channels:manage"] },
    });
    render(<ActivityPage />);
    expect(screen.getByText("link:Google Form:officer")).toBeInTheDocument();
  });

  it("leads with how much needs the member and a tile per ask, and a tile sets its chip", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    expect(screen.getByText("2 things need you")).toBeInTheDocument();
    const tiles = screen.getByRole("group", { name: "Needs you by kind" });
    // A member: no confirm or approve tile.
    expect(
      within(tiles)
        .getAllByRole("button")
        .map((tile) => tile.textContent),
    ).toEqual(["1Your tasks", "1Polls to vote on"]);

    fireEvent.click(
      within(tiles).getByRole("button", { name: /Polls to vote on/ }),
    );
    expect(screen.getByRole("button", { name: "Polls" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("Book the venue")).not.toBeInTheDocument();

    // Pressing the lit tile again clears it.
    fireEvent.click(
      within(tiles).getByRole("button", { name: /Polls to vote on/ }),
    );
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("gives an officer the confirm and approve tiles", () => {
    mockPermissions.mockReturnValue({
      data: { permissions: ["tasks:manage", "service:approve"] },
    });
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);
    const tiles = screen.getByRole("group", { name: "Needs you by kind" });
    expect(
      within(tiles).getByRole("button", { name: /To confirm/ }),
    ).toBeInTheDocument();
    expect(
      within(tiles).getByRole("button", { name: /Hours to approve/ }),
    ).toBeInTheDocument();
  });

  it("says the member is all caught up when nothing waits on them", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [],
          task_confirmations: [],
          hours_approvals: [],
          polls: [],
        },
        needs_you_count: 0,
      }),
    );
    render(<ActivityPage />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it("draws an ask as the action, apart from a status badge", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [{ ...task, status: "OVERDUE", stored_status: "TODO" }],
          task_confirmations: [],
          hours_approvals: [],
          polls: [poll],
        },
      }),
    );
    render(<ActivityPage />);
    const vote = screen.getByText("Vote");
    expect(vote.className).toContain("bg-accent-subtle");
    const overdue = screen.getByText("Overdue");
    expect(overdue.className).not.toContain("bg-accent-subtle");
  });

  it("splits Made by you by kind, and holds a long kind behind Show all", () => {
    mockActivity.mockReturnValue(
      loaded({
        made_by_you: {
          polls: [],
          tasks: [1, 2, 3, 4, 5].map((n) => ({
            ...task,
            id: `m${n}`,
            title: `Assigned ${n}`,
          })),
          events: [],
        },
      }),
    );
    render(<ActivityPage />);
    const made = screen.getByRole("region", { name: "Made by you" });
    const part = within(made).getByRole("group", {
      name: /Tasks you assigned/,
    });
    expect(within(part).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(within(part).getByRole("button", { name: "Show all 5" }));
    expect(within(part).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(part).getByRole("button", { name: "Show fewer" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("draws an event with its date beside it", () => {
    mockActivity.mockReturnValue(
      loaded({
        coming_up: [
          {
            id: "e1",
            name: "Chapter meeting",
            location: "Great Room",
            start_time: "2099-01-01T19:00:00.000Z",
            end_time: "2099-01-01T20:00:00.000Z",
            attendance: "optional",
            point_value: 0,
            check_in_opens_minutes: 10,
            check_in_open: false,
            checked_in: null,
          },
        ],
      }),
    );
    render(<ActivityPage />);
    const coming = screen.getByRole("region", { name: "Coming up" });
    expect(
      within(coming).getByTestId("activity-date-block"),
    ).toBeInTheDocument();
    // The block is decoration; the detail still says the day in words.
    expect(
      within(coming).getByText(/^Jan 1, 2099 · .* · Great Room$/),
    ).toBeInTheDocument();
  });

  it("dims a tile with nothing waiting, and shows no tile for a module that is off", () => {
    mockModuleGate.mockReturnValue((module) => module !== "polls");
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [],
          task_confirmations: [],
          hours_approvals: [],
          polls: [poll],
        },
      }),
    );
    render(<ActivityPage />);
    const tiles = screen.getByRole("group", { name: "Needs you by kind" });
    expect(within(tiles).getAllByRole("button")).toHaveLength(1);
    expect(
      within(tiles).getByRole("button", { name: /Your tasks/ }).className,
    ).toContain("opacity-60");
    mockModuleGate.mockReturnValue(undefined);
  });

  it("narrows to the confirmations alone from the To confirm tile, under a lit Tasks chip", () => {
    mockPermissions.mockReturnValue({
      data: { permissions: ["tasks:manage"] },
    });
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [task],
          task_confirmations: [{ ...task, id: "c1", title: "Done by Ada" }],
          hours_approvals: [],
          polls: [],
        },
      }),
    );
    render(<ActivityPage />);
    const tiles = screen.getByRole("group", { name: "Needs you by kind" });
    fireEvent.click(within(tiles).getByRole("button", { name: /To confirm/ }));

    expect(
      within(tiles).getByRole("button", { name: /To confirm/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(tiles).getByRole("button", { name: /Your tasks/ }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Done by Ada")).toBeInTheDocument();
    expect(screen.queryByText("Book the venue")).not.toBeInTheDocument();

    // Your tasks switches to itself (the Tasks chip) rather than clearing.
    fireEvent.click(within(tiles).getByRole("button", { name: /Your tasks/ }));
    expect(
      within(tiles).getByRole("button", { name: /Your tasks/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(tiles).getByRole("button", { name: /To confirm/ }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Book the venue")).toBeInTheDocument();
  });

  it("never says caught up when part of Needs you could not be read", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [],
          task_confirmations: [],
          hours_approvals: [],
          polls: [],
        },
        needs_you_count: 0,
        unavailable: ["tasks"],
      }),
    );
    render(<ActivityPage />);
    expect(
      screen.getByText("Some of what needs you couldn't load"),
    ).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up")).toBeNull();
    const tiles = screen.getByRole("group", { name: "Needs you by kind" });
    expect(
      within(tiles).getByRole("button", { name: /Couldn't load.*Your tasks/ }),
    ).toBeInTheDocument();
  });
});
