import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";

const mockActivity = vi.fn();
const mockChapterId = vi.fn(() => "chap-1");
const mockArchive = vi.fn<
  () => {
    isPending: boolean;
    isError?: boolean;
    data?: unknown;
    refetch?: () => void;
  }
>(() => ({ isPending: true }));
const mockInvalidate = vi.fn();
/**
 * How many times the page re-read its list. Each re-read also re-reads the
 * standing (This semester, on the profile since #5779) and the Archive, so
 * counting every invalidation would triple.
 */
const listRereads = () =>
  mockInvalidate.mock.calls.filter(
    ([options]) =>
      Array.isArray(options?.queryKey) && options.queryKey[0] === "activity",
  ).length;
const standingRereads = () =>
  mockInvalidate.mock.calls.filter(([options]) =>
    JSON.stringify(options?.queryKey ?? "").includes("standing"),
  ).length;
const mockMarkRead = vi.fn();
const mockNetwork = vi.fn(() => ({ isOffline: false }));
const mockModuleGate = vi.fn<() => ((module: string) => boolean) | undefined>(
  () => undefined,
);
const mockPermissions = vi.fn(() => ({
  data: { permissions: [] as string[] },
}));
// The member's arrangement (#5520): nothing saved, so the role's default,
// unless a test saves one.
const mockLayout = vi.fn<
  () => {
    data?: { card_order: string[]; hidden_cards: string[]; saved: boolean };
    isSuccess?: boolean;
    isPending?: boolean;
  }
>(() => ({ data: { card_order: [], hidden_cards: [], saved: false } }));
const mockSaveLayout = vi.fn();
const mockResetLayout = vi.fn();

const eventsNow = vi.hoisted(() => ({
  value: { events: [] as unknown[], now: Date.now() },
}));
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    // The model is the real one: the week, the agenda, the review queue and
    // Running (`activity-agenda.ts`, `activity-rows.ts`). Only the reads are
    // stood in for.
    ACTIVITY_GLYPH_NAV: actual.ACTIVITY_GLYPH_NAV,
    // The Now card's read (#5777): nothing on unless a test says so.
    useEventsOnNow: () => eventsNow.value,
    withoutEvents: actual.withoutEvents,
    nowCardEventIds: actual.nowCardEventIds,
    eventNowState: actual.eventNowState,
    ACTIVITY_ARCHIVE_EMPTY: actual.ACTIVITY_ARCHIVE_EMPTY,
    ACTIVITY_ARCHIVE_SECTION_NAMES: actual.ACTIVITY_ARCHIVE_SECTION_NAMES,
    activityArchiveGroups: actual.activityArchiveGroups,
    ACTIVITY_REVIEW_OPEN_LIMIT: actual.ACTIVITY_REVIEW_OPEN_LIMIT,
    ACTIVITY_REVIEW_ROW_LIMIT: actual.ACTIVITY_REVIEW_ROW_LIMIT,
    ACTIVITY_SHOW_EVERYTHING: actual.ACTIVITY_SHOW_EVERYTHING,
    ACTIVITY_TO_DO_EMPTY: actual.ACTIVITY_TO_DO_EMPTY,
    ACTIVITY_WEEK_HINT: actual.ACTIVITY_WEEK_HINT,
    activityCouldNotLoad: actual.activityCouldNotLoad,
    activityNarrowedNote: actual.activityNarrowedNote,
    activityAgenda: actual.activityAgenda,
    activityAwake: actual.activityAwake,
    activityRowSnoozable: actual.activityRowSnoozable,
    activitySnoozedRows: actual.activitySnoozedRows,
    activitySnoozeOptions: actual.activitySnoozeOptions,
    useActivitySnoozeWake: () => undefined,
    useActivitySnooze: () => ({
      snooze: mockSnooze,
      unsnooze: mockUnsnooze,
      isPending: false,
    }),
    activityBadgeIsAsk: actual.activityBadgeIsAsk,
    activityGroups: actual.activityGroups,
    activityFaceStack: actual.activityFaceStack,
    activityReview: actual.activityReview,
    activityReviewQueue: actual.activityReviewQueue,
    activityRowAction: actual.activityRowAction,
    activityWeekSummary: actual.activityWeekSummary,
    findActivityTaskRow: actual.findActivityTaskRow,
    activityArchiveKeys: actual.activityArchiveKeys,
    activityKeys: actual.activityKeys,
    activityStandingKeys: actual.activityStandingKeys,
    useNowDate: actual.useNowDate,
    useActiveChapterId: () => mockChapterId(),
    useActivity: () => mockActivity(),
    useActivityArchive: () => mockArchive(),
    useActivityUnread: () => ({ markRead: mockMarkRead }),
    useMyPermissions: () => mockPermissions(),
    ACTIVITY_CARD_COPY: actual.ACTIVITY_CARD_COPY,
    ACTIVITY_NOW_CARD_COPY: actual.ACTIVITY_NOW_CARD_COPY,
    activityCardRole: actual.activityCardRole,
    arrangeActivityCards: actual.arrangeActivityCards,
    canHideActivityCard: actual.canHideActivityCard,
    hideActivityCard: actual.hideActivityCard,
    moveActivityCard: actual.moveActivityCard,
    sameActivityArrangement: actual.sameActivityArrangement,
    showActivityCard: actual.showActivityCard,
    useActivityLayout: () => ({
      isSuccess: true,
      isPending: false,
      ...mockLayout(),
    }),
    useSaveActivityLayout: () => ({ mutate: mockSaveLayout }),
    useResetActivityLayout: () => ({ mutate: mockResetLayout }),
    activityDetailParts: actual.activityDetailParts,
    // The roster knows the officer only: anyone else has left.
    useActivityFaces: () => (id: string) =>
      id === "officer"
        ? {
            name: "Olive Officer",
            avatarUrl: "https://photos.example/olive.png",
            tint: { fill: "rgb(1, 2, 3)", text: "rgb(4, 5, 6)" },
          }
        : null,
  };
});
const mockSnooze = vi.fn(() => Promise.resolve());
const mockUnsnooze = vi.fn(() => Promise.resolve());
// `?review=<taskId>` from a "submitted a task" notification.
let mockSearch = new URLSearchParams();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearch,
  usePathname: () => "/activity",
  useRouter: () => ({ replace: mockReplace }),
}));
// The chapter's module switches, unknown here unless a test sets them.
vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGate: () => mockModuleGate(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
const mockUser = vi.fn(() => ({
  userId: "me" as string | null,
  isLoading: false,
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => mockUser(),
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

/** The chapter's plan: `state.allowed` false refuses the row actions. */
const mockGate = vi.fn(() => ({
  allowed: true,
  isOffline: false,
  isPending: false,
  state: { allowed: true },
}));
vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => mockGate(),
}));
const mockActed = vi.fn();
// The button itself is tested in `activity-row-action.spec.tsx`; the gate
// rule (`activity-row-action-gate.ts`) is the real one.
vi.mock("./activity-row-action", () => ({
  ActivityRowActionButton: ({
    row,
    action,
    onActed,
  }: {
    row: ActivityRow;
    action: string;
    onActed: (row: ActivityRow) => Promise<unknown>;
  }) => (
    <button
      type="button"
      onClick={() => {
        mockActed(action, row.key);
        void onActed(row);
      }}
    >{`act:${action}:${row.title}`}</button>
  ),
}));
// The reminder row's actions are its own spec's
// (`activity-reminder-row.spec.tsx`); this page owes drawing one in To do.
vi.mock("./activity-reminder-row", () => ({
  useActivityReminderActions: () => ({}),
  ActivityReminderRow: ({ row }: { row: ActivityRow }) => (
    <li>{`reminder:${row.title}`}</li>
  ),
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
  mockLayout.mockReturnValue({
    data: { card_order: [], hidden_cards: [], saved: false },
  });
  mockSaveLayout.mockClear();
  mockResetLayout.mockClear();
  vi.useRealTimers();
  vi.clearAllMocks();
  mockSearch = new URLSearchParams();
  mockModuleGate.mockReturnValue(undefined);
  mockUser.mockReturnValue({ userId: "me", isLoading: false });
  mockNetwork.mockReturnValue({ isOffline: false });
  mockPermissions.mockReturnValue({ data: { permissions: [] } });
  mockChapterId.mockReturnValue("chap-1");
  window.localStorage.clear();
  mockGate.mockReturnValue({
    allowed: true,
    isOffline: false,
    isPending: false,
    state: { allowed: true },
  });
});

const nothingWaiting = {
  tasks: [],
  task_confirmations: [],
  hours_approvals: [],
  polls: [],
};
const count = (done: number, total: number) => ({ done, total });
/** The week the ring draws: done of total per kind, `null` for a kind that is off. */
const week = (overrides: Record<string, unknown> = {}) => ({
  start: "2026-11-08T05:00:00.000Z",
  end: "2026-11-15T05:00:00.000Z",
  events: count(0, 0),
  tasks: count(0, 0),
  polls: count(0, 0),
  cards: count(0, 0),
  unavailable: [],
  ...overrides,
});
const event = {
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
  created_by: "officer",
  created_at: "2026-11-01T00:00:00.000Z",
};
const confirmation = (id: string, title: string) => ({
  ...task,
  id,
  title,
  status: "COMPLETED",
});
const hoursEntry = {
  id: "h1",
  user_id: "u2",
  member_name: "Sam",
  date: "2026-11-10",
  duration_minutes: 90,
  description: "Food bank",
  created_at: "2026-11-10T00:00:00.000Z",
};
/** A local calendar date some days from today, as a task's due date is stored. */
const localDate = (daysAhead: number) => {
  const now = new Date();
  const day = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysAhead,
    12,
  );
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
};

const ring = () => screen.getByTestId("activity-week-ring");
/** The ring's popover: its headline, its lines and what couldn't load. */
const openRing = () => fireEvent.click(ring());
const weekPopover = () => screen.getByRole("dialog");
const toDo = () => screen.getByRole("region", { name: "To do" });
const running = () => screen.getByRole("region", { name: "Running" });
const weekLines = () =>
  screen.getByRole("group", { name: "This week by kind" });

describe("ActivityPage", () => {
  describe("the week ring (#5779)", () => {
    it("puts the week's count in a small ring beside Edit Activity, and its lines behind a press", () => {
      mockActivity.mockReturnValue(
        loaded({
          week: week({
            events: count(1, 2),
            tasks: count(1, 3),
            polls: count(0, 1),
          }),
        }),
      );
      render(<ActivityPage />);

      const pill = ring();
      // Done of total, never a sentence: the glance Apple Fitness gives.
      expect(pill).toHaveTextContent(/^2\/6$/);
      // A screen reader hears the sentence the old card's heading said.
      expect(pill).toHaveAccessibleName(
        "2 of 6 things done this week. 4 left this week.",
      );
      // The ring itself is decoration.
      const drawn = pill.querySelector("[data-progress]");
      expect(drawn).toHaveAttribute("data-progress", String(2 / 6));
      expect(drawn).toHaveAttribute("aria-hidden", "true");
      // In the header row, beside the page's one action.
      expect(pill.parentElement).toContainElement(
        screen.getByRole("button", { name: "Edit Activity" }),
      );
      expect(toDo()).not.toContainElement(pill);
      // The lines wait behind the ring.
      expect(
        screen.queryByRole("group", { name: "This week by kind" }),
      ).toBeNull();

      openRing();
      expect(within(weekPopover()).getByText("4 left this week")).toBeVisible();
      expect(
        within(weekLines())
          .getAllByRole("button")
          .map((line) => line.getAttribute("aria-label")),
      ).toEqual([
        "Events: 1 of 2 done",
        "Tasks: 1 of 3 done",
        "Polls and sign-ups: 0 of 1 done",
      ]);
      expect(screen.getByTestId("activity-week-line-tasks")).toHaveTextContent(
        "Tasks1 of 3",
      );

      // There is no Next row any more: the soonest thing stays in the list.
      expect(screen.queryByText("Next")).toBeNull();
      expect(screen.queryByRole("region", { name: "Next" })).toBeNull();
      expect(within(toDo()).getByText("Formal venue?")).toBeInTheDocument();
      expect(within(toDo()).getByText("Book the venue")).toBeInTheDocument();
    });

    it("narrows the To do list from a line, closing the lines, says so, and shows everything again", () => {
      mockActivity.mockReturnValue(
        loaded({
          week: week({ tasks: count(0, 1), polls: count(0, 1) }),
          made_by_you: {
            polls: [
              {
                ...poll,
                message_id: "p9",
                sender_id: "me",
                question: "Where should formal be?",
              },
            ],
            tasks: [],
            events: [],
          },
        }),
      );
      render(<ActivityPage />);
      expect(running()).toBeInTheDocument();
      expect(ring()).toHaveClass("text-foreground");

      openRing();
      const answers = () =>
        within(weekLines()).getByRole("button", {
          name: "Polls and sign-ups: 0 of 1 done",
        });
      expect(answers()).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(answers());

      // The press closes the lines, and the ring says the list is narrowed.
      expect(
        screen.queryByRole("group", { name: "This week by kind" }),
      ).toBeNull();
      expect(ring()).toHaveClass("text-accent-text");
      // Narrowed, the list holds every one of its kind.
      expect(within(toDo()).getByText("Formal venue?")).toBeInTheDocument();
      expect(within(toDo()).queryByText("Book the venue")).toBeNull();
      expect(
        within(toDo()).getByText(/Showing only polls and sign-ups\./),
      ).toBeInTheDocument();
      // The page is the list alone while it is narrowed: no Running.
      expect(screen.queryByRole("region", { name: "Running" })).toBeNull();

      // The lit line says so, and pressing it again shows everything.
      openRing();
      expect(answers()).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(answers());
      expect(screen.queryByText(/Showing only/)).toBeNull();
      expect(within(toDo()).getByText("Book the venue")).toBeInTheDocument();
      expect(running()).toBeInTheDocument();

      // And so does the note's own button.
      openRing();
      fireEvent.click(answers());
      fireEvent.click(
        within(toDo()).getByRole("button", { name: "Show everything" }),
      );
      expect(screen.queryByText(/Showing only/)).toBeNull();
      expect(within(toDo()).getByText("Book the venue")).toBeInTheDocument();
      expect(running()).toBeInTheDocument();
      expect(ring()).toHaveClass("text-foreground");
      // The note's button leaves, so focus goes back to the ring.
      expect(ring()).toHaveFocus();
    });

    it("says a narrowed kind has nothing left, not that there is nothing to do", () => {
      mockActivity.mockReturnValue(
        loaded({ week: week({ events: count(1, 1), tasks: count(0, 1) }) }),
      );
      render(<ActivityPage />);

      openRing();
      fireEvent.click(
        within(weekLines()).getByRole("button", {
          name: "Events: 1 of 1 done",
        }),
      );

      expect(
        within(toDo()).getByText(/No events left to do\./),
      ).toBeInTheDocument();
      expect(screen.queryByText("Nothing to do right now.")).toBeNull();
    });

    it("never calls a narrowed kind finished when its read failed", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          week: week({
            events: count(1, 2),
            tasks: null,
            unavailable: ["tasks"],
          }),
          unavailable: ["tasks"],
        }),
      );
      render(<ActivityPage />);

      // The dash line still narrows the list.
      openRing();
      fireEvent.click(
        within(weekLines()).getByRole("button", {
          name: "Tasks: couldn't load",
        }),
      );

      expect(
        within(toDo()).getByText(/Showing only tasks\./),
      ).toBeInTheDocument();
      expect(
        within(toDo()).getByText("Couldn't load tasks. Try again in a moment."),
      ).toBeInTheDocument();
      // An empty list under a failed read is not "No tasks left to do."
      expect(screen.queryByText(/left to do/)).toBeNull();
    });

    it("drops the narrowing for good when its line leaves the ring", () => {
      mockActivity.mockReturnValue(
        loaded({ week: week({ tasks: count(0, 1), polls: count(0, 1) }) }),
      );
      const { rerender } = render(<ActivityPage />);
      openRing();
      fireEvent.click(
        within(weekLines()).getByRole("button", { name: "Tasks: 0 of 1 done" }),
      );
      expect(within(toDo()).queryByText("Formal venue?")).toBeNull();

      // The tasks module is turned off: the read serves no count for it.
      mockActivity.mockReturnValue(
        loaded({
          needs_you: { ...nothingWaiting, polls: [poll] },
          week: week({ tasks: null, polls: count(0, 1) }),
        }),
      );
      rerender(<ActivityPage />);
      expect(screen.queryByText(/Showing only/)).toBeNull();

      // And back on: the list doesn't narrow itself again.
      mockActivity.mockReturnValue(
        loaded({ week: week({ tasks: count(0, 1), polls: count(0, 1) }) }),
      );
      rerender(<ActivityPage />);
      expect(screen.queryByText(/Showing only/)).toBeNull();
      openRing();
      expect(
        within(weekLines()).getByRole("button", { name: "Tasks: 0 of 1 done" }),
      ).toHaveAttribute("aria-pressed", "false");
    });

    it("says 0 with a quiet ring when nothing is due, never 0/0, and says what will count", () => {
      mockActivity.mockReturnValue(
        loaded({ needs_you: nothingWaiting, week: week() }),
      );
      render(<ActivityPage />);

      const pill = ring();
      expect(pill).toHaveTextContent(/^0$/);
      expect(pill).toHaveAccessibleName("Nothing due this week");
      expect(pill.querySelector("[data-progress]")).toHaveAttribute(
        "data-progress",
        "0",
      );
      // Only the groove is drawn.
      expect(pill.querySelectorAll("circle")).toHaveLength(1);

      openRing();
      const popover = weekPopover();
      expect(within(popover).getByText("Nothing due this week")).toBeVisible();
      expect(
        within(popover).getByText(
          "Your events, tasks and polls for the week count here.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "This week by kind" }),
      ).toBeNull();
      expect(screen.queryByText(/0 of 0|0\/0/)).toBeNull();
      expect(
        within(toDo()).getByText("Nothing to do right now."),
      ).toBeInTheDocument();
    });

    it("closes the ring in the success hue once everything is done", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          week: week({ events: count(2, 2), tasks: count(3, 3) }),
        }),
      );
      render(<ActivityPage />);

      const pill = ring();
      expect(pill).toHaveTextContent(/^5\/5$/);
      expect(pill.querySelector("[data-progress]")).toHaveAttribute(
        "data-progress",
        "1",
      );
      expect(pill.querySelector("circle.text-success")).not.toBeNull();
      expect(pill.querySelector("circle.text-primary")).toBeNull();

      openRing();
      expect(within(weekPopover()).getByText("All done this week")).toHaveClass(
        "text-success",
      );
    });

    it("fills the ring in the accent while something is left", () => {
      mockActivity.mockReturnValue(
        loaded({ week: week({ events: count(1, 2) }) }),
      );
      render(<ActivityPage />);

      const pill = ring();
      expect(pill.querySelector("circle.text-primary")).not.toBeNull();
      expect(pill.querySelector("circle.text-success")).toBeNull();
      openRing();
      expect(
        within(weekPopover()).getByText("1 left this week"),
      ).not.toHaveClass("text-success");
    });

    it("draws a dash for a part that couldn't load, and never calls the week done", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          week: week({
            events: count(1, 2),
            tasks: null,
            unavailable: ["tasks"],
          }),
          unavailable: ["tasks"],
        }),
      );
      render(<ActivityPage />);

      expect(ring()).toHaveTextContent(/^1\/2$/);
      openRing();
      const popover = weekPopover();
      expect(
        within(popover).getByText("At least 1 left this week"),
      ).toBeInTheDocument();
      const tasks = within(weekLines()).getByRole("button", {
        name: "Tasks: couldn't load",
      });
      expect(tasks).toHaveTextContent("Tasks–");
      expect(
        within(popover).getByText(
          "Couldn't load tasks. Try again in a moment.",
        ),
      ).toHaveClass("text-warning");
      // The list names it too, and doesn't call itself empty.
      expect(
        within(toDo()).getByText("Couldn't load tasks. Try again in a moment."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Nothing to do right now.")).toBeNull();
    });

    it("says – in the ring, never 0, when the only part of the week failed", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          week: week({ tasks: null, unavailable: ["tasks"] }),
          unavailable: ["tasks"],
        }),
      );
      render(<ActivityPage />);

      // Nothing known to count is not "nothing due": the ring says unknown.
      expect(ring()).toHaveTextContent(/^–$/);
      openRing();
      expect(
        within(weekPopover()).getByText("Some of your week couldn't load"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "Your events, tasks and polls for the week count here.",
        ),
      ).toBeNull();
      expect(screen.queryByText(/0 of 0|0\/0/)).toBeNull();
    });

    it("draws a dash for a shared line whose other half failed, never 0 of 0", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          week: week({
            events: count(3, 3),
            polls: count(0, 0),
            cards: null,
            unavailable: ["cards"],
          }),
          unavailable: ["cards"],
        }),
      );
      render(<ActivityPage />);

      openRing();
      expect(
        within(weekLines()).getByRole("button", {
          name: "Polls and sign-ups: couldn't load",
        }),
      ).toHaveTextContent("Polls and sign-ups–");
      expect(screen.queryByText(/0 of 0/)).toBeNull();
    });

    it("doesn't close the ring in the success hue while a part is missing", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          week: week({
            events: count(3, 3),
            tasks: null,
            unavailable: ["tasks"],
          }),
          unavailable: ["tasks"],
        }),
      );
      render(<ActivityPage />);

      // Three of three known, and still not a finished week.
      const pill = ring();
      expect(pill).toHaveTextContent(/^3\/3$/);
      expect(pill.querySelector("circle.text-success")).toBeNull();
      openRing();
      const headline = within(weekPopover()).getByText(
        "Some of your week couldn't load",
      );
      expect(headline).not.toHaveClass("text-success");
    });

    it("drops a poll that closed while the page was open from the count, as the list drops it", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            ...nothingWaiting,
            polls: [{ ...poll, closes_at: "2020-01-01T00:00:00.000Z" }],
          },
          week: week({ events: count(1, 1), polls: count(0, 1) }),
        }),
      );
      render(<ActivityPage />);

      // The read listed it as open; its time has passed since.
      expect(ring()).toHaveTextContent(/^1\/1$/);
      openRing();
      expect(
        within(weekPopover()).getByText("All done this week"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/left this week/)).toBeNull();
      expect(screen.queryByText("Formal venue?")).toBeNull();
    });

    it("draws no ring against an API from before the week, and the list keeps every row", () => {
      // `data()` carries no `week`, as an older API serves it.
      mockActivity.mockReturnValue(loaded());
      render(<ActivityPage />);

      expect(screen.queryByTestId("activity-week-ring")).toBeNull();
      expect(
        within(toDo()).getByRole("button", {
          name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
        }),
      ).toBeInTheDocument();
      expect(within(toDo()).getByText("Book the venue")).toBeInTheDocument();
    });

    it("leads To do with an event open for check-in, under Now in the accent", () => {
      mockActivity.mockReturnValue(
        loaded({
          coming_up: [
            {
              ...event,
              start_time: "2026-11-12T19:00:00.000Z",
              attendance: "required",
              check_in_open: true,
              checked_in: false,
            },
          ],
          week: week({ events: count(0, 1), tasks: count(0, 1) }),
        }),
      );
      render(<ActivityPage />);

      const now = within(toDo()).getByTestId("activity-day-now");
      const heading = within(now).getByRole("heading", { level: 3 });
      expect(heading).toHaveTextContent(/^Now$/);
      expect(heading).toHaveClass("text-accent-text");
      expect(
        within(now).getByRole("button", {
          name: /^(Unread:\s?)?Chapter meeting/,
        }),
      ).toBeInTheDocument();
      expect(
        within(toDo())
          .getAllByRole("heading", { level: 3 })
          .map((day) => day.textContent),
      ).toEqual(["Now", "Later"]);
    });

    it("leaves the Now card's event out of To do, and shows the card while the page loads (#5777)", () => {
      const live = {
        ...event,
        start_time: "2026-11-12T19:00:00.000Z",
        attendance: "required",
        check_in_open: true,
        checked_in: false,
      };
      eventsNow.value = { events: [live], now: Date.now() };
      try {
        mockActivity.mockReturnValue(
          loaded({
            coming_up: [live],
            week: week({ events: count(0, 1), tasks: count(0, 1) }),
          }),
        );
        const { unmount } = render(<ActivityPage />);
        const now = screen.getByRole("region", { name: "On now" });
        expect(within(now).getByText("Chapter meeting")).toBeInTheDocument();
        expect(within(toDo()).queryByText("Chapter meeting")).toBeNull();
        expect(screen.getAllByText("Chapter meeting")).toHaveLength(1);
        unmount();

        mockActivity.mockReturnValue({
          ...loaded({}),
          data: undefined,
          isPending: true,
        });
        render(<ActivityPage />);
        expect(
          screen.getByRole("region", { name: "On now" }),
        ).toBeInTheDocument();
      } finally {
        eventsNow.value = { events: [], now: Date.now() };
      }
    });

    it("waits for the viewer before drawing, since a row's panel draws for them", () => {
      mockActivity.mockReturnValue(loaded({ week: week() }));
      mockUser.mockReturnValue({ userId: null, isLoading: true });
      const { rerender } = render(<ActivityPage />);
      expect(screen.queryByTestId("activity-week-ring")).toBeNull();
      expect(screen.getByText("Loading your activity")).toBeInTheDocument();

      mockUser.mockReturnValue({ userId: "me", isLoading: false });
      rerender(<ActivityPage />);
      expect(ring()).toBeInTheDocument();
    });
  });

  describe("Running: N to approve (#4766, #5779)", () => {
    const officer = () =>
      mockPermissions.mockReturnValue({
        data: { permissions: ["tasks:manage", "service:approve"] },
      });

    it("shows a member no approve row, and an officer with an empty queue none either", () => {
      mockActivity.mockReturnValue(loaded());
      const { unmount } = render(<ActivityPage />);
      expect(screen.queryByTestId("activity-review-card")).toBeNull();
      // Nothing running and nothing to approve: no empty heading.
      expect(screen.queryByRole("region", { name: "Running" })).toBeNull();
      unmount();

      officer();
      render(<ActivityPage />);
      expect(screen.queryByTestId("activity-review-card")).toBeNull();
      expect(screen.queryByText(/to approve/i)).toBeNull();
      expect(screen.queryByRole("region", { name: "Running" })).toBeNull();
    });

    it("leads Running with what waits for the officer's OK, its count in the label, and starts a short queue open", () => {
      officer();
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            ...nothingWaiting,
            task_confirmations: [confirmation("t2", "Sweep the porch")],
            hours_approvals: [hoursEntry],
          },
        }),
      );
      render(<ActivityPage />);

      const card = within(running()).getByTestId("activity-review-card");
      const toggle = within(card).getByRole("button", {
        name: "2 to approve: 1 task · 1 hours entry",
      });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(within(card).getByText("2 to approve")).toBeInTheDocument();
      // The count is the label's; no chip repeats it.
      expect(within(card).queryByText(/^2$/)).toBeNull();
      expect(
        within(card).getByRole("button", {
          name: "act:confirm:Sweep the porch",
        }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("button", { name: "act:approve:Food bank" }),
      ).toBeInTheDocument();
      // The member's own list never holds what waits on their review.
      expect(within(toDo()).queryByText("Sweep the porch")).toBeNull();

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(within(card).queryByText("Sweep the porch")).toBeNull();
    });

    const queue = (length: number) =>
      loaded({
        needs_you: {
          ...nothingWaiting,
          task_confirmations: Array.from({ length }, (_, index) =>
            confirmation(`q${index + 1}`, `Finished ${index + 1}`),
          ),
        },
      });

    it("starts three open and four closed", () => {
      officer();
      mockActivity.mockReturnValue(queue(3));
      const { unmount } = render(<ActivityPage />);
      expect(screen.getByTestId("activity-review-toggle")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      unmount();

      mockActivity.mockReturnValue(queue(4));
      render(<ActivityPage />);
      expect(screen.getByTestId("activity-review-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    it("stays as it was when a re-read takes the queue across three, either way", () => {
      officer();
      mockActivity.mockReturnValue(queue(3));
      const { rerender, unmount } = render(<ActivityPage />);
      const toggle = () => screen.getByTestId("activity-review-toggle");
      expect(toggle()).toHaveAttribute("aria-expanded", "true");

      // Two more finish while the officer is part-way through: the row
      // they are working in doesn't close under them.
      mockActivity.mockReturnValue(queue(5));
      rerender(<ActivityPage />);
      expect(toggle()).toHaveAttribute("aria-expanded", "true");
      expect(
        within(screen.getByTestId("activity-review-card")).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(5);
      unmount();

      // And a long queue doesn't open itself as it shrinks.
      mockActivity.mockReturnValue(queue(4));
      const second = render(<ActivityPage />);
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
      mockActivity.mockReturnValue(queue(2));
      second.rerender(<ActivityPage />);
      expect(toggle()).toHaveAttribute("aria-expanded", "false");
    });

    it("keeps a long queue behind its count, then five rows and Show all", () => {
      officer();
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            ...nothingWaiting,
            task_confirmations: [1, 2, 3, 4, 5, 6].map((n) =>
              confirmation(`c${n}`, `Finished ${n}`),
            ),
            hours_approvals: [hoursEntry],
          },
        }),
      );
      render(<ActivityPage />);

      const card = screen.getByTestId("activity-review-card");
      const toggle = within(card).getByTestId("activity-review-toggle");
      expect(toggle).toHaveAccessibleName(
        "7 to approve: 6 tasks · 1 hours entry",
      );
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(within(card).queryByRole("listitem")).toBeNull();

      fireEvent.click(toggle);
      expect(within(card).getAllByRole("listitem")).toHaveLength(5);
      const all = within(card).getByRole("button", { name: "Show all 7" });
      fireEvent.click(all);
      expect(within(card).getAllByRole("listitem")).toHaveLength(7);
      expect(
        within(card).getByRole("button", { name: "Show fewer" }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("names a queue that couldn't load, with nothing to open, only for who reviews it", () => {
      officer();
      mockActivity.mockReturnValue(
        loaded({ needs_you: nothingWaiting, unavailable: ["tasks"] }),
      );
      const { unmount } = render(<ActivityPage />);
      const card = within(running()).getByTestId("activity-review-card");
      expect(within(card).getByText("To approve")).toBeInTheDocument();
      expect(
        within(card).getByText("Couldn't load tasks. Try again in a moment."),
      ).toBeInTheDocument();
      expect(within(card).queryByRole("button")).toBeNull();
      unmount();

      // With tasks turned off for the chapter there is nothing to confirm.
      mockModuleGate.mockReturnValue((module: string) => module !== "tasks");
      render(<ActivityPage />);
      expect(screen.queryByTestId("activity-review-card")).toBeNull();
    });

    it("holds the approve row, then what the member assigned, made and posted, in that order, and counts them all", () => {
      officer();
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            ...nothingWaiting,
            task_confirmations: [confirmation("t2", "Sweep the porch")],
          },
          made_by_you: {
            polls: [
              {
                ...poll,
                message_id: "p9",
                sender_id: "me",
                question: "Where should formal be?",
              },
            ],
            tasks: [{ ...task, id: "m1", title: "Order the shirts" }],
            events: [{ ...event, id: "e9", name: "Rush barbecue" }],
          },
        }),
      );
      render(<ActivityPage />);

      const section = running();
      const parts = within(section).getAllByRole("group");
      expect(parts.map((part) => part.getAttribute("aria-labelledby"))).toEqual(
        [
          "activity-running-tasks",
          "activity-running-events",
          "activity-running-polls",
        ],
      );
      expect(
        parts.map(
          (part) => within(part).getByRole("heading", { level: 3 }).textContent,
        ),
      ).toEqual(["Tasks you assigned", "Events you made", "Polls you posted"]);
      expect(within(parts[0]!).getByText("Order the shirts")).toBeVisible();
      expect(within(parts[1]!).getByText("Rush barbecue")).toBeVisible();
      expect(
        within(parts[2]!).getByText("Where should formal be?"),
      ).toBeVisible();
      // The approve row leads.
      const card = within(section).getByTestId("activity-review-card");
      expect(
        card.compareDocumentPosition(parts[0]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // One to approve and three running, beside the heading.
      const heading = within(section).getByRole("heading", { level: 2 });
      expect(heading).toHaveTextContent(/^Running$/);
      expect(heading.parentElement).toHaveTextContent(/^Running4$/);
      // None of it is the member's own to do.
      expect(within(toDo()).queryByText("Order the shirts")).toBeNull();
      expect(within(toDo()).queryByText("Rush barbecue")).toBeNull();
    });

    it("shows a member Running for what they made alone, with no approve row", () => {
      mockActivity.mockReturnValue(
        loaded({
          made_by_you: {
            polls: [],
            tasks: [{ ...task, id: "m1", title: "Order the shirts" }],
            events: [],
          },
        }),
      );
      render(<ActivityPage />);

      expect(within(running()).getByText("Order the shirts")).toBeVisible();
      expect(screen.queryByTestId("activity-review-card")).toBeNull();
    });
  });

  describe("To do by day (#4766)", () => {
    it("leads with Overdue in the warning hue, longest overdue first, without repeating it on each row", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            ...nothingWaiting,
            tasks: [
              {
                ...task,
                id: "late2",
                title: "Return the keys",
                due_date: localDate(-1),
                status: "OVERDUE",
              },
              {
                ...task,
                id: "late1",
                title: "File the roster",
                due_date: localDate(-3),
                status: "OVERDUE",
              },
              task,
            ],
          },
        }),
      );
      render(<ActivityPage />);

      const overdue = within(toDo()).getByTestId("activity-day-overdue");
      const heading = within(overdue).getByRole("heading", { level: 3 });
      // The count sits beside the heading, not in it: the day is named
      // "Overdue", never "Overdue2".
      expect(heading).toHaveTextContent(/^Overdue$/);
      expect(overdue).toHaveAccessibleName("Overdue");
      expect(heading.nextElementSibling).toHaveTextContent(/^2$/);
      expect(heading).toHaveClass("text-warning");
      // There is no Next row to lift the longest overdue out: it leads here.
      const rows = within(overdue).getAllByRole("button", {
        name: /^(Unread:\s?)?(File the roster|Return the keys)/,
      });
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("File the roster"),
        expect.stringContaining("Return the keys"),
      ]);
      // Its detail still says by how long; the chip would repeat the heading.
      expect(rows[1]).toHaveTextContent("Overdue by 1 day");
      expect(within(rows[1]!).queryByText("Overdue")).toBeNull();
      // Overdue is above every day.
      expect(
        within(toDo())
          .getAllByRole("heading", { level: 3 })
          .map((day) => day.textContent),
      ).toEqual(["Overdue", "Later"]);
    });

    it("draws three of a busy day, and the rest behind Show more", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            ...nothingWaiting,
            tasks: [1, 2, 3, 4, 5, 6].map((n) => ({
              ...task,
              id: `d${n}`,
              title: `Tomorrow ${n}`,
              due_date: localDate(1),
            })),
          },
        }),
      );
      render(<ActivityPage />);

      const day = within(toDo()).getByTestId("activity-day-day-1");
      const heading = within(day).getByRole("heading", { level: 3 });
      expect(heading).toHaveTextContent(/^Tomorrow$/);
      expect(heading.nextElementSibling).toHaveTextContent(/^6$/);
      expect(within(day).getAllByRole("listitem")).toHaveLength(3);
      fireEvent.click(within(day).getByRole("button", { name: "Show 3 more" }));
      expect(within(day).getAllByRole("listitem")).toHaveLength(6);
      expect(
        within(day).getByRole("button", { name: "Show fewer" }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("stays on the page with nothing to do, and says so (#5779)", () => {
      mockActivity.mockReturnValue(loaded({ needs_you: nothingWaiting }));
      render(<ActivityPage />);

      const list = toDo();
      expect(
        within(list).getByText("Nothing to do right now."),
      ).toBeInTheDocument();
      expect(within(list).queryAllByRole("heading", { level: 3 })).toEqual([]);
      // No count beside an empty list's heading.
      const heading = within(list).getByRole("heading", { level: 2 });
      expect(heading.parentElement).toHaveTextContent(/^To do$/);
    });

    it("keeps the Calendar one press away in its header (#5779)", () => {
      mockActivity.mockReturnValue(loaded());
      render(<ActivityPage />);

      const list = toDo();
      const calendar = within(list).getByRole("link", { name: "Calendar" });
      expect(calendar).toHaveAttribute("href", "/events");
      // Beside the heading, not a card of its own under the list.
      expect(
        within(list).getByRole("heading", { level: 2 }).parentElement
          ?.parentElement,
      ).toContainElement(calendar);
      expect(screen.getAllByRole("link", { name: /Calendar/ })).toHaveLength(1);
    });

    it("lists the member's message reminders in To do on the day they come back (#5779)", () => {
      const reminder = {
        id: "r1",
        message_id: "m9",
        thread_root_id: null,
        channel_id: "c1",
        channel_name: "general",
        channel_type: "PUBLIC",
        author_name: "Olive",
        preview: "Bring the banner Friday",
        message_created_at: "2026-11-10T15:00:00.000Z",
        message_available: true,
        remind_at: "2099-01-01T14:00:00.000Z",
        fired_at: null,
        due: false,
      };
      const due = {
        ...reminder,
        id: "r2",
        message_id: "m10",
        preview: "Pay dues",
        remind_at: new Date(Date.now() - 60_000).toISOString(),
        fired_at: new Date(Date.now() - 60_000).toISOString(),
        due: true,
      };
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          reminders: [reminder, due],
          week: week({ tasks: count(0, 1) }),
        }),
      );
      render(<ActivityPage />);

      // No group of their own any more.
      expect(screen.queryByRole("region", { name: "Reminders" })).toBeNull();
      // One already due is today's; one to come is on its day.
      expect(
        within(within(toDo()).getByTestId("activity-day-day-0")).getByText(
          "reminder:Pay dues",
        ),
      ).toBeInTheDocument();
      expect(
        within(within(toDo()).getByTestId("activity-day-later")).getByText(
          "reminder:Bring the banner Friday",
        ),
      ).toBeInTheDocument();

      // A line of the week narrows to its kind, and a reminder is none.
      openRing();
      fireEvent.click(
        within(weekLines()).getByRole("button", { name: "Tasks: 0 of 1 done" }),
      );
      expect(within(toDo()).queryByText(/^reminder:/)).toBeNull();
    });
  });

  it("lays out by its own width, since it is usually a pane beside chat", () => {
    mockPermissions.mockReturnValue({
      data: { permissions: ["tasks:manage"] },
    });
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          ...nothingWaiting,
          tasks: [task],
          task_confirmations: [confirmation("t2", "Sweep the porch")],
        },
        week: week({ tasks: count(0, 1), polls: count(0, 1) }),
      }),
    );
    render(<ActivityPage />);

    // The page is the container its parts measure, so a 480px pane in a wide
    // window keeps the narrow layout. A window breakpoint (`lg:`, `md:`) on
    // any of its sections would break that.
    for (const section of [toDo(), running()]) {
      expect(section.closest(".\\@container")).not.toBeNull();
      for (const element of [section, ...section.querySelectorAll("*")]) {
        expect(element.getAttribute("class") ?? "").not.toMatch(
          /(^|\s)(sm|md|lg|xl|2xl):/,
        );
      }
    }
  });

  it("orders the page by the default: Now, To do, then Running, with the week in the header (#5520, #5779)", () => {
    mockPermissions.mockReturnValue({
      data: { permissions: ["tasks:manage"] },
    });
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          tasks: [task],
          task_confirmations: [confirmation("t2", "Sweep the porch")],
          hours_approvals: [],
          polls: [poll],
        },
        made_by_you: {
          polls: [{ ...poll, message_id: "p9", sender_id: "me" }],
          tasks: [],
          events: [],
        },
        links: [
          {
            id: "l1",
            url: "https://forms.gle/abc",
            host: "forms.gle",
            title: null,
            message_id: "m1",
            thread_root_id: null,
            channel_id: "c1",
            channel_name: "rush",
            channel_type: "PUBLIC",
            posted_by: "olive",
            posted_by_name: "Olive",
            posted_at: "2026-11-10T15:00:00.000Z",
          },
        ],
        week: week({ tasks: count(0, 1), polls: count(0, 1) }),
      }),
    );
    render(<ActivityPage />);

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["To do", "Running"]);
    // The week is the ring above them, not a card.
    expect(
      ring().compareDocumentPosition(toDo()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // What #5779 moved off the page, and the old page's names, are gone.
    for (const gone of [
      "Needs you",
      "Coming up",
      "Made by you",
      "To review",
      "Waiting on others",
      "Reminders",
      "Links",
      "Last week",
      "This semester",
      "Next",
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    // A sign-up link is its channel's now (`channel-links-panel.tsx`).
    expect(screen.queryByText(/Google Form/)).toBeNull();
    expect(screen.queryByTestId("activity-week-card")).toBeNull();
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
  });

  describe("the member's cards (#5520)", () => {
    const withGroups = () =>
      loaded({
        made_by_you: {
          polls: [{ ...poll, message_id: "p9", sender_id: "me" }],
          tasks: [],
          events: [],
        },
      });
    const headings = () =>
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent);

    it("draws a saved order and leaves out what the member hid", () => {
      mockActivity.mockReturnValue(withGroups());
      mockLayout.mockReturnValue({
        data: {
          card_order: ["running", "todo", "a-card-from-a-newer-app"],
          hidden_cards: [],
          saved: true,
        },
      });
      const { unmount } = render(<ActivityPage />);
      expect(headings()).toEqual(["Running", "To do"]);
      unmount();

      mockLayout.mockReturnValue({
        data: { card_order: ["todo"], hidden_cards: ["running"], saved: true },
      });
      render(<ActivityPage />);
      expect(headings()).toEqual(["To do"]);
    });

    it("drops the cards #5779 took off the page from a saved arrangement", () => {
      mockActivity.mockReturnValue(withGroups());
      mockLayout.mockReturnValue({
        data: {
          card_order: [
            "waiting",
            "links",
            "semester",
            "recap",
            "calendar",
            "review",
            "reminders",
            "running",
            "todo",
          ],
          hidden_cards: ["week"],
          saved: true,
        },
      });
      render(<ActivityPage />);
      expect(headings()).toEqual(["Running", "To do"]);
    });

    it("edits in place of the page, and Done saves only a change", async () => {
      const user = userEvent.setup();
      mockActivity.mockReturnValue(withGroups());
      render(<ActivityPage />);

      // A small secondary button in the header, not a full-width bar.
      const edit = screen.getByRole("button", { name: "Edit Activity" });
      expect(edit).toHaveClass("border-control-edge", "bg-card");
      expect(edit).not.toHaveClass("w-full");
      await user.click(edit);
      expect(
        screen.getByRole("heading", { name: "Edit Activity" }),
      ).toBeInTheDocument();
      // Now leads and never moves; the three cards follow in the default
      // order: the Frapp card, To do, Running.
      const shown = screen.getByRole("heading", { name: "Shown" })
        .nextElementSibling as HTMLElement;
      expect(
        within(shown)
          .getAllByRole("listitem")
          .map((item) => item.querySelector("p")?.textContent),
      ).toEqual(["Now", "Frapp card", "To do", "Running"]);
      // To do moves but can't be hidden: the ring's lines act on it.
      expect(screen.queryByRole("button", { name: "Hide To do" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Done" }));
      expect(mockSaveLayout).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Edit Activity" }));
      await user.click(screen.getByRole("button", { name: "Hide Running" }));
      await user.click(screen.getByRole("button", { name: "Move To do up" }));
      expect(
        screen.getByRole("button", { name: "Show Running" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Done" }));

      expect(mockSaveLayout).toHaveBeenCalledTimes(1);
      const saved = mockSaveLayout.mock.calls[0]![0];
      expect(saved.hidden).toEqual(["running"]);
      expect(saved.shown).toEqual(["todo", "nudge"]);
    });

    it("offers Edit Activity only once the member's arrangement is in", () => {
      mockActivity.mockReturnValue(withGroups());
      mockLayout.mockReturnValue({ isSuccess: false, isPending: true });
      render(<ActivityPage />);
      expect(
        screen.queryByRole("button", { name: "Edit Activity" }),
      ).toBeNull();
    });

    it("offers Reset only once the member has saved an arrangement", async () => {
      const user = userEvent.setup();
      mockActivity.mockReturnValue(withGroups());
      render(<ActivityPage />);
      await user.click(screen.getByRole("button", { name: "Edit Activity" }));
      expect(
        screen.queryByRole("button", { name: "Reset to the default" }),
      ).toBeNull();
      cleanup();

      mockLayout.mockReturnValue({
        data: { card_order: ["todo"], hidden_cards: [], saved: true },
      });
      render(<ActivityPage />);
      await user.click(screen.getByRole("button", { name: "Edit Activity" }));
      await user.click(
        screen.getByRole("button", { name: "Reset to the default" }),
      );
      expect(mockResetLayout).toHaveBeenCalledTimes(1);
    });
  });

  it("leaves out Running with nothing in it", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    expect(screen.queryByRole("region", { name: "Running" })).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("lists open polls only: a closed one is in the Archive (#4258, #5127)", () => {
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
          ],
          tasks: [],
          events: [],
        },
      }),
    );
    render(<ActivityPage />);

    expect(within(running()).getByText("Open one")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archived polls/ })).toBeNull();
  });

  it("opens the Archive in place of the page, laid out by kind, and goes back (#5127)", () => {
    mockActivity.mockReturnValue(loaded({}));
    mockArchive.mockReturnValue({
      isPending: false,
      data: {
        events: [
          {
            id: "e-past",
            name: "Last week's meeting",
            location: null,
            start_time: "2026-11-02T19:00:00.000Z",
            end_time: "2026-11-02T20:00:00.000Z",
            attendance: "required",
            point_value: 10,
            check_in_opens_minutes: 10,
            check_in_open: false,
            check_in_needs_location: false,
            check_in_needs_code: false,
            checked_in: true,
            created_by: null,
            progress: null,
            created_at: "2026-10-01T00:00:00.000Z",
            unread: false,
            snoozed_until: null,
          },
        ],
        tasks: [],
        polls: [
          {
            ...poll,
            message_id: "m2",
            question: "Closed one",
            sender_id: "me",
            is_closed: true,
            closed_at: "2026-11-02T00:00:00.000Z",
          },
        ],
        unavailable: ["tasks"],
      },
    });
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(screen.queryByRole("region", { name: "To do" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Archive" }),
    ).toBeInTheDocument();
    const events = screen.getByRole("region", { name: "Events" });
    expect(within(events).getByText("Last week's meeting")).toBeInTheDocument();
    expect(within(events).getByText("Checked in")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Tasks" })).getByText(
        /Couldn't load tasks/,
      ),
    ).toBeInTheDocument();
    const polls = screen.getByRole("region", { name: "Polls" });
    expect(within(polls).getByText("Closed")).toBeInTheDocument();

    // A closed poll opens its card, with its result, as on the page.
    fireEvent.click(within(polls).getByRole("button", { name: /Closed one/ }));
    expect(screen.getByTestId("panel")).toHaveTextContent("panel:Closed one");

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.queryByRole("heading", { name: "Archive" })).toBeNull();
  });

  it("says when the Archive holds nothing", () => {
    mockActivity.mockReturnValue(loaded({}));
    mockArchive.mockReturnValue({
      isPending: false,
      data: { events: [], tasks: [], polls: [], unavailable: [] },
    });
    render(<ActivityPage />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(
      screen.getByText(/Nothing finished in the last 30 days/),
    ).toBeInTheDocument();
  });

  it("takes a poll off the page when its time runs out while the page is open", () => {
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
      expect(screen.getByText("Closing soon")).toBeInTheDocument();

      // One tick of the shared clock, past the closing time, with no re-read.
      act(() => {
        vi.advanceTimersByTime(31_000);
      });

      expect(screen.queryByText("Closing soon")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a section could not be loaded instead of calling it empty", () => {
    mockActivity.mockReturnValue(
      loaded({ needs_you: nothingWaiting, unavailable: ["polls"] }),
    );
    render(<ActivityPage />);

    expect(within(toDo()).getByText(/Couldn't load polls/)).toBeInTheDocument();
    expect(
      within(toDo()).queryByText("Nothing to do right now."),
    ).not.toBeInTheDocument();
  });

  it("names what it couldn't load under Running, with nothing else in it", () => {
    mockActivity.mockReturnValue(loaded({ unavailable: ["made_events"] }));
    render(<ActivityPage />);

    expect(
      within(running()).getByText(
        "Couldn't load events you made. Try again in a moment.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the row it was asked for in the panel", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    fireEvent.click(
      screen.getByRole("button", { name: /^(Unread:\s?)?Book the venue/ }),
    );

    expect(screen.getByText("panel:Book the venue")).toBeInTheDocument();
  });

  it("links a sign-up or form row to its message in chat, reading it, with no panel (#3926)", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          ...nothingWaiting,
          cards: [
            {
              kind: "form",
              message_id: "m-form",
              channel_id: "c-rush",
              channel_name: "rush",
              channel_type: "PUBLIC",
              sender_id: "officer",
              title: "Room picks",
              item_count: 3,
              closes_at: null,
              created_at: "2026-11-01T00:00:00.000Z",
              unread: true,
            },
          ],
        },
        needs_you_count: 1,
      }),
    );
    render(<ActivityPage />);

    const row = screen.getByRole("link", { name: /Room picks/ });
    expect(row).toHaveTextContent("Form · 3 questions · #rush");
    expect(row).toHaveTextContent("Fill out");
    expect(row.getAttribute("href")).toContain("c-rush");
    expect(row.getAttribute("href")).toContain("m-form");
    fireEvent.click(row);

    expect(mockMarkRead).toHaveBeenCalledWith([
      { kind: "form", item_id: "m-form" },
    ]);
    expect(screen.queryByText("panel:Room picks")).not.toBeInTheDocument();
  });

  it("re-reads before opening a review notification's task, and again on a later click", async () => {
    // The read in hand predates the submission; only the re-read holds it.
    const stale = loaded({ needs_you: { ...nothingWaiting, polls: [poll] } });
    const refetch = vi.fn(() =>
      Promise.resolve({
        data: data({
          needs_you: {
            ...nothingWaiting,
            task_confirmations: [confirmation("t9", "Sweep the porch")],
            polls: [poll],
          },
        }),
      }),
    );
    mockActivity.mockReturnValue({ ...stale, refetch });
    mockSearch = new URLSearchParams("review=t9");
    const { rerender } = render(<ActivityPage />);
    await act(async () => {});

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("panel:Sweep the porch")).toBeInTheDocument();
    // Dropped from the address, so a refresh doesn't open it again.
    expect(mockReplace).toHaveBeenCalledWith("/activity", { scroll: false });

    // The address drops it, then the same notification is clicked again.
    mockSearch = new URLSearchParams();
    rerender(<ActivityPage />);
    mockSearch = new URLSearchParams("review=t9");
    rerender(<ActivityPage />);
    await act(async () => {});
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("sends a review the fresh read doesn't hold to that task on the board", async () => {
    mockActivity.mockReturnValue({
      ...loaded(),
      refetch: vi.fn(() => Promise.resolve({ data: data() })),
    });
    mockSearch = new URLSearchParams("review=gone");
    render(<ActivityPage />);
    await act(async () => {});

    expect(screen.queryByText(/^panel:/)).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/tasks?task=gone");
  });

  it("dots an unread row and records the open when it is opened (#4405)", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          ...nothingWaiting,
          tasks: [{ ...task, unread: false }],
          polls: [{ ...poll, unread: true }],
        },
      }),
    );
    render(<ActivityPage />);

    const pollRow = screen.getByRole("button", {
      name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
    });
    const taskRow = screen.getByRole("button", {
      name: /^(Unread:\s?)?Book the venue/,
    });
    expect(pollRow).toHaveAccessibleName(
      /^Unread:\s?From Olive Officer\.\s?Formal venue\?/,
    );
    expect(pollRow.querySelector("[data-unread-dot]")).not.toBeNull();
    expect(taskRow.querySelector("[data-unread-dot]")).toBeNull();

    fireEvent.click(taskRow);
    expect(mockMarkRead).not.toHaveBeenCalled();
    fireEvent.click(pollRow);
    expect(mockMarkRead).toHaveBeenCalledWith([
      { kind: "poll", item_id: "p1" },
    ]);
  });

  it("keeps the panel open when the row has left the list after an action", () => {
    mockActivity.mockReturnValue(loaded());
    const { rerender } = render(<ActivityPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
      }),
    );

    // The vote landed: the re-read no longer lists the poll.
    mockActivity.mockReturnValue(
      loaded({ needs_you: { ...nothingWaiting, tasks: [task] } }),
    );
    rerender(<ActivityPage />);

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps the list and the open panel when a re-read fails", () => {
    mockActivity.mockReturnValue(loaded());
    const { rerender } = render(<ActivityPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
      }),
    );

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

    fireEvent.click(
      screen.getByRole("button", {
        name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(listRereads()).toBe(1);
    expect(standingRereads()).toBe(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "acted" }));
    fireEvent.click(screen.getByRole("button", { name: "settled close" }));
    expect(screen.queryByTestId("panel")).toBeNull();
    // `acted` re-read; the settled close did not read a second time.
    expect(listRereads()).toBe(2);
    expect(standingRereads()).toBe(2);
  });

  it("does not close the open row when another row's action answers late", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "late close" }));

    expect(screen.getByText("panel:Formal venue?")).toBeInTheDocument();
  });

  describe("asks on the row (#4402)", () => {
    const officerRead = () =>
      loaded({
        needs_you: {
          tasks: [],
          task_confirmations: [confirmation("t2", "Sweep the porch")],
          hours_approvals: [hoursEntry],
          polls: [poll],
        },
        coming_up: [
          {
            ...event,
            location: null,
            start_time: "2026-11-12T19:00:00.000Z",
            attendance: "required",
            point_value: 10,
            check_in_open: true,
            check_in_needs_location: false,
            checked_in: false,
            created_by: "officer",
            created_at: "2026-11-01T00:00:00.000Z",
          },
          {
            id: "e2",
            name: "Philanthropy 5K",
            location: null,
            start_time: "2026-11-12T19:30:00.000Z",
            end_time: "2099-01-01T21:00:00.000Z",
            attendance: "optional",
            point_value: 20,
            check_in_opens_minutes: 10,
            check_in_open: true,
            check_in_needs_location: true,
            checked_in: false,
          },
        ],
      });

    it("puts Confirm, Approve and Check in on the row, and keeps Vote and a zoned Check in opening the panel", () => {
      mockActivity.mockReturnValue(officerRead());
      render(<ActivityPage />);

      // Both wait in the To review card, open since there are only two.
      const review = screen.getByTestId("activity-review-card");
      for (const name of [
        "act:confirm:Sweep the porch",
        "act:approve:Food bank",
      ]) {
        expect(
          within(review).getByRole("button", { name }),
        ).toBeInTheDocument();
      }
      // An event open for check-in sits on its day in To do, its Check in a
      // button on the row there (#4427).
      expect(
        screen.getByRole("button", { name: "act:check-in:Chapter meeting" }),
      ).toBeInTheDocument();
      // A zoned event needs the member's location, which the web can't give
      // (#4427): its Check in stays the row's ask and opens the panel, which
      // says to use the phone.
      expect(
        screen.queryByRole("button", { name: "act:check-in:Philanthropy 5K" }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: /^(Unread:\s?)?Philanthropy 5K/ }),
      ).toHaveAccessibleName(/Check in/);
      // The ask moved out of the row: the row itself no longer names it,
      // and only holds its place for the button laid over it.
      const row = screen.getByRole("button", { name: /^Sweep the porch/ });
      expect(row).not.toHaveAccessibleName(/Confirm/);
      expect(
        row.querySelector('[aria-hidden="true"].invisible'),
      ).toHaveTextContent("Confirm");
      // On a card a row lightens under the pointer, as the card's controls do.
      expect(row).toHaveClass("hover:bg-card-hover");
      // A vote asks which option, so it stays the row's ask and opens the panel.
      expect(
        screen.queryByRole("button", { name: /^act:.*Formal/ }),
      ).toBeNull();
      const vote = screen.getByRole("button", {
        name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
      });
      expect(vote).toHaveTextContent("Vote");
      expect(vote).toHaveClass("hover:bg-surface-1");

      // The row beside the button still opens the panel.
      fireEvent.click(row);
      expect(screen.getByText("panel:Sweep the porch")).toBeInTheDocument();
    });

    it("reads the item and re-reads the page after acting on the row", () => {
      const read = officerRead();
      const hours = read.data.needs_you.hours_approvals as Array<
        Record<string, unknown>
      >;
      hours[0] = { ...hours[0], unread: true };
      mockActivity.mockReturnValue(read);
      render(<ActivityPage />);
      fireEvent.click(
        screen.getByRole("button", { name: "act:approve:Food bank" }),
      );
      expect(mockActed).toHaveBeenCalledWith("approve", "needs:hours:h1");
      expect(mockMarkRead).toHaveBeenCalledWith([
        { kind: "hours_entry", item_id: "h1" },
      ]);
      expect(listRereads()).toBe(1);
    });

    it("keeps every ask in its row, opening the panel, when the chapter's plan refuses the writes", () => {
      mockGate.mockReturnValue({
        allowed: false,
        isOffline: false,
        isPending: false,
        state: { allowed: false },
      });
      mockActivity.mockReturnValue(officerRead());
      render(<ActivityPage />);
      expect(screen.queryByRole("button", { name: /^act:/ })).toBeNull();
      expect(
        screen.getByRole("button", { name: /^Sweep the porch/ }),
      ).toHaveAccessibleName(/Confirm/);
    });
  });

  it("draws an ask as the action, apart from a status badge", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          ...nothingWaiting,
          // Sent back: its "Needs changes" is a status, not an ask.
          tasks: [
            {
              ...task,
              status: "IN_PROGRESS",
              stored_status: "IN_PROGRESS",
              sent_back_at: "2026-11-10T15:00:00.000Z",
            },
          ],
          polls: [poll],
        },
      }),
    );
    render(<ActivityPage />);
    const vote = screen.getByText("Vote");
    expect(vote.className).toContain("bg-accent-subtle");
    const status = within(
      screen.getByRole("button", { name: /^(Unread:\s?)?Book the venue/ }),
    ).getByText("Needs changes");
    expect(status.className).not.toContain("bg-accent-subtle");
  });

  it("doesn't say To do on every row of a list named To do", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    const row = within(toDo()).getByRole("button", {
      name: /^(Unread:\s?)?Book the venue/,
    });
    expect(within(row).queryByText("To do")).toBeNull();
  });

  it("splits Running by kind, and holds a long kind behind Show all", () => {
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
    // Named by its heading alone; the count sits beside it.
    const part = within(running()).getByRole("group", {
      name: "Tasks you assigned",
    });
    expect(within(part).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(within(part).getByRole("button", { name: "Show all 5" }));
    expect(within(part).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(part).getByRole("button", { name: "Show fewer" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("leads a row with the face of who it is from, and the glyph alone for someone who has left (#4402)", () => {
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          ...nothingWaiting,
          tasks: [
            task,
            { ...task, id: "t2", title: "Gone", created_by: "left" },
          ],
        },
      }),
    );
    render(<ActivityPage />);
    const faces = screen.getAllByTestId("activity-face");
    expect(faces).toHaveLength(1);
    // Initials on the member's tint until the photo loads (jsdom loads none).
    expect(faces[0]).toHaveTextContent("OO");
    expect(within(faces[0]!).getByText("OO")).toHaveStyle({
      backgroundColor: "rgb(1, 2, 3)",
      color: "rgb(4, 5, 6)",
    });
    // The kind still shows, as a glyph on the face's corner.
    expect(
      within(faces[0]!).getByTestId("activity-face-glyph").querySelector("svg"),
    ).not.toBeNull();
  });

  it("says a poll's poster to a screen reader, since its detail names only the channel (#4402)", () => {
    mockActivity.mockReturnValue(
      loaded({ needs_you: { ...nothingWaiting, polls: [poll] } }),
    );
    render(<ActivityPage />);
    const row = screen.getByRole("button", {
      name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
    });
    expect(row).toHaveAccessibleName(/^From Olive Officer\.\s?Formal venue\?/);
  });

  it("draws a closing time less than a day away relatively, in the warning tone (#4402)", () => {
    const soon = new Date(Date.now() + 150 * 60_000).toISOString();
    mockActivity.mockReturnValue(
      loaded({
        needs_you: {
          ...nothingWaiting,
          polls: [{ ...poll, closes_at: soon }],
        },
      }),
    );
    render(<ActivityPage />);
    const phrase = screen.getByTestId("activity-soon");
    expect(phrase).toHaveTextContent("closes in 2 hours");
    expect(phrase).toHaveClass("text-warning");
    expect(phrase.parentElement).toHaveTextContent(
      "#general · closes in 2 hours",
    );
  });

  it("draws an event with its date beside it", () => {
    mockActivity.mockReturnValue(loaded({ coming_up: [event] }));
    render(<ActivityPage />);
    const list = toDo();
    expect(within(list).getByTestId("activity-date-block")).toBeInTheDocument();
    // The block is decoration; the detail still says the day in words.
    expect(
      within(list).getByText(/^January 1, 2099 · .* · Great Room$/),
    ).toBeInTheDocument();
  });

  it("leaves a checked-in event out of the list: it is done", () => {
    mockActivity.mockReturnValue(
      loaded({ coming_up: [{ ...event, checked_in: true }] }),
    );
    render(<ActivityPage />);

    expect(screen.queryByText("Chapter meeting")).toBeNull();
  });

  describe("snooze (#4982)", () => {
    const later = (hours: number) =>
      new Date(Date.now() + hours * 3_600_000).toISOString();

    it("keeps a snoozed row off the list and under Snoozed, saying when it is back", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            tasks: [{ ...task, snoozed_until: later(5) }],
            task_confirmations: [],
            hours_approvals: [],
            polls: [poll],
          },
        }),
      );
      render(<ActivityPage />);

      expect(
        screen.queryByRole("button", { name: /^(Unread:\s?)?Book the venue/ }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Snoozed (1)" }));
      expect(
        within(document.getElementById("activity-snoozed")!).getByText(
          "Book the venue",
        ),
      ).toBeInTheDocument();
      expect(
        within(document.getElementById("activity-snoozed")!).getByText(
          /^Back /,
        ),
      ).toBeInTheDocument();
    });

    it("brings a snoozed row back from its menu under Snoozed", async () => {
      const user = userEvent.setup();
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            tasks: [{ ...task, snoozed_until: later(5) }],
            task_confirmations: [],
            hours_approvals: [],
            polls: [poll],
          },
        }),
      );
      render(<ActivityPage />);

      await user.click(screen.getByRole("button", { name: "Snoozed (1)" }));
      await user.click(
        screen.getByRole("button", { name: "More for Book the venue" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Unsnooze" }),
      );

      expect(mockUnsnooze).toHaveBeenCalledWith({
        kind: "task",
        item_id: "t1",
      });
    });

    it("snoozes a row from its menu", async () => {
      const user = userEvent.setup();
      mockActivity.mockReturnValue(loaded());
      render(<ActivityPage />);

      await user.click(
        screen.getByRole("button", { name: "More for Book the venue" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: /^Tomorrow · 8:00 AM/ }),
      );

      expect(mockSnooze).toHaveBeenCalledWith(
        { kind: "task", item_id: "t1" },
        expect.any(Date),
      );
    });
  });
});

describe("Running: how far along each thing is (#4792)", () => {
  it("draws a bar and the count under a poll the member posted, said whole to a screen reader", () => {
    mockActivity.mockReturnValue(
      loaded({
        made_by_you: {
          polls: [
            {
              ...poll,
              message_id: "p9",
              sender_id: "me",
              question: "Where should formal be?",
              progress: { done: 17, total: 25 },
            },
            // Nobody else can answer it: no bar, never "0 of 0".
            {
              ...poll,
              message_id: "p10",
              sender_id: "me",
              question: "Exec only?",
              progress: null,
            },
          ],
          tasks: [],
          events: [],
        },
      }),
    );

    render(<ActivityPage />);

    const formal = screen
      .getByText("Where should formal be?")
      .closest("li") as HTMLElement;
    expect(within(formal).getByText("17 of 25 voted")).toBeTruthy();
    expect(
      within(formal).getByText("17 of 25").getAttribute("aria-hidden"),
    ).toBe("true");
    const alone = screen.getByText("Exec only?").closest("li") as HTMLElement;
    expect(within(alone).queryByText(/ of /)).toBeNull();
  });
});

describe("Tasks you assigned: one row per task for everyone (#5538)", () => {
  const group = (overrides: Record<string, unknown> = {}) => ({
    id: "group-1",
    audience: "everyone",
    target_id: null,
    target_name: null,
    total: 30,
    done: 12,
    confirmed: 4,
    task_id: "copy-7",
    title: "Clean the house",
    description: null,
    due_date: "2099-01-01",
    due_at: null,
    point_reward: 5,
    proof_kind: "none",
    overdue: false,
    // Only the officer is on the roster: the rest have left, and count in +N.
    preview_assignee_ids: ["officer", "left-1", "left-2"],
    created_at: "2026-11-17T00:00:00.000Z",
    ...overrides,
  });
  /** Thirty copies in `tasks`, as an API serves them beside `task_items`. */
  const copies = Array.from({ length: 30 }, (_, index) => ({
    ...task,
    id: `copy-${index}`,
    title: "Clean the house",
    assignee_id: `u${index}`,
    created_by: "me",
  }));
  const solo = {
    ...task,
    id: "solo",
    title: "Book the band",
    created_by: "me",
  };
  const assigned = (items: unknown[]) =>
    loaded({
      needs_you: nothingWaiting,
      made_by_you: {
        polls: [],
        events: [],
        tasks: [...copies, solo],
        task_items: items,
      },
    });
  const part = () =>
    within(running()).getByRole("group", { name: "Tasks you assigned" });

  it("draws one row with who it went to, a done bar and faces, linking to the group on the board", () => {
    mockActivity.mockReturnValue(
      assigned([
        { kind: "group", group: group() },
        { kind: "task", task: solo },
      ]),
    );
    render(<ActivityPage />);

    // One row for the thirty copies, beside the one-person task.
    expect(within(part()).getAllByRole("listitem")).toHaveLength(2);
    const row = within(part()).getByRole("link", { name: /Clean the house/ });
    expect(row).toHaveAttribute("href", "/tasks?group=group-1");
    expect(row).toHaveTextContent(/Everyone · /);
    expect(row).toHaveAccessibleName(/12 of 30 done/);
    expect(within(row).getByText("12 of 30")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // The roster's one face, then the others counted.
    const stack = within(row).getByTestId("activity-face-stack");
    expect(
      within(stack).getAllByTestId("activity-face-stack-face"),
    ).toHaveLength(1);
    expect(stack).toHaveTextContent("OO+29");
    expect(within(row).queryByText("Overdue")).toBeNull();

    // A click goes to the board, never Activity's panel.
    fireEvent.click(row);
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("badges the row Overdue when any copy is", () => {
    mockActivity.mockReturnValue(
      assigned([{ kind: "group", group: group({ overdue: true }) }]),
    );
    render(<ActivityPage />);
    const row = within(part()).getByRole("link", { name: /Clean the house/ });
    expect(within(row).getByText("Overdue")).toBeInTheDocument();
  });

  it("keeps a one-person task a row that opens its panel", () => {
    mockActivity.mockReturnValue(
      assigned([
        { kind: "group", group: group() },
        { kind: "task", task: solo },
      ]),
    );
    render(<ActivityPage />);
    fireEvent.click(
      within(part()).getByRole("button", { name: /Book the band/ }),
    );
    expect(screen.getByText("panel:Book the band")).toBeInTheDocument();
  });

  it("sends a review link for the copy the row opens to the group on the board", async () => {
    const read = assigned([{ kind: "group", group: group() }]);
    mockActivity.mockReturnValue({
      ...read,
      refetch: vi.fn(() => Promise.resolve({ data: read.data })),
    });
    mockSearch = new URLSearchParams("review=copy-7");
    render(<ActivityPage />);
    await act(async () => {});

    expect(screen.queryByTestId("panel")).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith("/tasks?group=group-1");
  });
});
