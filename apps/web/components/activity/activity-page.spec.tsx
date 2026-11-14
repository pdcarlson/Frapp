import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";

const mockActivity = vi.fn();
const mockStanding = vi.fn<() => { isPending: boolean; data?: unknown }>(
  () => ({ isPending: false, data: undefined }),
);
const mockInvalidate = vi.fn();
/**
 * How many times the page re-read its list. Each re-read also re-reads the
 * standing ("This semester"), so counting every invalidation would double.
 */
const listRereads = () =>
  mockInvalidate.mock.calls.filter(
    ([options]) =>
      Array.isArray(options?.queryKey) &&
      !JSON.stringify(options.queryKey).includes("standing"),
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

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    // The model is the real one: the week, the agenda, the review queue,
    // the groups and the gauges (`activity-agenda.ts`, `activity-rows.ts`,
    // `activity-standing.ts`). Only the reads are stood in for.
    ACTIVITY_GLYPH_NAV: actual.ACTIVITY_GLYPH_NAV,
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
    activityReview: actual.activityReview,
    activityReviewQueue: actual.activityReviewQueue,
    activityRowAction: actual.activityRowAction,
    activityStandingGauges: actual.activityStandingGauges,
    activityWeekSummary: actual.activityWeekSummary,
    findActivityTaskRow: actual.findActivityTaskRow,
    activityKeys: actual.activityKeys,
    activityStandingKeys: actual.activityStandingKeys,
    useNowDate: actual.useNowDate,
    useActiveChapterId: () => "chap-1",
    useActivity: () => mockActivity(),
    useActivityStanding: () => mockStanding(),
    useActivityUnread: () => ({ markRead: mockMarkRead }),
    useMyPermissions: () => mockPermissions(),
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

// The link row's actions are its own spec's (`activity-link-row.spec.tsx`);
// this page owes drawing one per link, with Remove only for an officer.
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
  mockSearch = new URLSearchParams();
  mockModuleGate.mockReturnValue(undefined);
  mockUser.mockReturnValue({ userId: "me", isLoading: false });
  mockNetwork.mockReturnValue({ isOffline: false });
  mockPermissions.mockReturnValue({ data: { permissions: [] } });
  mockStanding.mockReturnValue({ isPending: false, data: undefined });
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

const weekCard = () => screen.getByTestId("activity-week-card");
const toDo = () => screen.getByRole("region", { name: "To do" });
const weekLines = () =>
  screen.getByRole("group", { name: "This week by kind" });

describe("ActivityPage", () => {
  describe("the week card (#4766)", () => {
    it("leads with the ring's count, a line per kind, and the one thing to do next", () => {
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

      const card = weekCard();
      expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent(
        "4 left this week",
      );
      const ring = within(card).getByTestId("activity-week-ring");
      expect(ring).toHaveTextContent("2of 6");
      expect(ring).toHaveAttribute("data-progress", String(2 / 6));
      // The ring is decoration; a screen reader hears it as a sentence.
      expect(ring).toHaveAttribute("aria-hidden", "true");
      expect(
        within(card).getByText(
          "2 of 6 things done this week. 4 left this week.",
        ),
      ).toHaveClass("sr-only");
      expect(
        within(weekLines())
          .getAllByRole("button")
          .map((line) => line.getAttribute("aria-label")),
      ).toEqual([
        "Events: 1 of 2 done",
        "Tasks: 1 of 3 done",
        "Polls and sign-ups: 0 of 1 done",
      ]);

      // The soonest thing is on the card, and not repeated in the list.
      expect(within(card).getByText("Next")).toBeInTheDocument();
      expect(
        within(card).getByRole("button", {
          name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
        }),
      ).toBeInTheDocument();
      expect(within(toDo()).queryByText("Formal venue?")).toBeNull();
      expect(within(toDo()).getByText("Book the venue")).toBeInTheDocument();
    });

    it("narrows the To do list from a line, says so, and shows everything again", () => {
      mockActivity.mockReturnValue(
        loaded({
          week: week({ tasks: count(0, 1), polls: count(0, 1) }),
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
        }),
      );
      render(<ActivityPage />);
      expect(screen.getByRole("region", { name: "Links" })).toBeInTheDocument();
      const answers = within(weekLines()).getByRole("button", {
        name: "Polls and sign-ups: 0 of 1 done",
      });
      expect(answers).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(answers);

      expect(answers).toHaveAttribute("aria-pressed", "true");
      // Narrowed, the list holds every one of its kind, the next thing too,
      // and the card above it stays as it was.
      expect(within(toDo()).getByText("Formal venue?")).toBeInTheDocument();
      expect(within(toDo()).queryByText("Book the venue")).toBeNull();
      expect(
        within(weekCard()).getByRole("button", {
          name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
        }),
      ).toBeInTheDocument();
      expect(
        within(toDo()).getByText(/Showing only polls and sign-ups\./),
      ).toBeInTheDocument();
      // The page is the list alone while it is narrowed.
      expect(screen.queryByRole("region", { name: "Links" })).toBeNull();

      fireEvent.click(
        within(toDo()).getByRole("button", { name: "Show everything" }),
      );
      expect(answers).toHaveAttribute("aria-pressed", "false");
      // The note and its button are gone: the line that narrowed the list
      // takes the focus, so a keyboard is not sent back to the page's top.
      expect(answers).toHaveFocus();
      expect(within(toDo()).getByText("Book the venue")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Links" })).toBeInTheDocument();

      // Pressing the lit line again does the same.
      fireEvent.click(answers);
      fireEvent.click(answers);
      expect(answers).toHaveAttribute("aria-pressed", "false");
    });

    it("says a narrowed kind has nothing left, not that there is nothing to do", () => {
      mockActivity.mockReturnValue(
        loaded({ week: week({ events: count(1, 1), tasks: count(0, 1) }) }),
      );
      render(<ActivityPage />);

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

    it("drops the narrowing for good when its line leaves the card", () => {
      mockActivity.mockReturnValue(
        loaded({ week: week({ tasks: count(0, 1), polls: count(0, 1) }) }),
      );
      const { rerender } = render(<ActivityPage />);
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
      expect(
        within(weekLines()).getByRole("button", { name: "Tasks: 0 of 1 done" }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByText(/Showing only/)).toBeNull();
    });

    it("says nothing is due with a quiet ring, and never 0 of 0", () => {
      mockActivity.mockReturnValue(
        loaded({ needs_you: nothingWaiting, week: week() }),
      );
      render(<ActivityPage />);

      const card = weekCard();
      expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent(
        "Nothing due this week",
      );
      const ring = within(card).getByTestId("activity-week-ring");
      expect(ring).toHaveTextContent("");
      expect(ring).toHaveAttribute("data-progress", "0");
      expect(
        within(card).getByText(
          "Your events, tasks and polls for the week count here.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "This week by kind" }),
      ).toBeNull();
      expect(screen.queryByText(/0 of 0/)).toBeNull();
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

      const heading = within(weekCard()).getByRole("heading", { level: 2 });
      expect(heading).toHaveTextContent("All done this week");
      expect(heading).toHaveClass("text-success");
      const ring = screen.getByTestId("activity-week-ring");
      expect(ring).toHaveAttribute("data-progress", "1");
      expect(ring.querySelector("circle.text-success")).not.toBeNull();
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

      const card = weekCard();
      expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent(
        "At least 1 left this week",
      );
      const tasks = within(weekLines()).getByRole("button", {
        name: "Tasks: couldn't load",
      });
      expect(tasks).toHaveTextContent("Tasks–");
      expect(
        within(card).getByText("Couldn't load tasks. Try again in a moment."),
      ).toHaveClass("text-warning");
      // The list names it too, and doesn't call itself empty.
      expect(
        within(toDo()).getByText("Couldn't load tasks. Try again in a moment."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Nothing to do right now.")).toBeNull();
    });

    it("draws a dash in the ring, not the quiet check, when the only part of the week failed", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: nothingWaiting,
          week: week({ tasks: null, unavailable: ["tasks"] }),
          unavailable: ["tasks"],
        }),
      );
      render(<ActivityPage />);

      const card = weekCard();
      expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent(
        "Some of your week couldn't load",
      );
      // Nothing known to count is not "nothing due": the ring says unknown.
      const ring = within(card).getByTestId("activity-week-ring");
      expect(ring).toHaveTextContent("–");
      expect(ring.querySelector("svg.lucide-check")).toBeNull();
      expect(
        screen.queryByText(
          "Your events, tasks and polls for the week count here.",
        ),
      ).toBeNull();
      expect(screen.queryByText(/0 of 0/)).toBeNull();
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

      const heading = within(weekCard()).getByRole("heading", { level: 2 });
      expect(heading).toHaveTextContent("Some of your week couldn't load");
      expect(heading).not.toHaveClass("text-success");
      // Three of three known, and still not a finished week.
      const ring = screen.getByTestId("activity-week-ring");
      expect(ring).toHaveTextContent("3of 3");
      expect(ring.querySelector("circle.text-success")).toBeNull();
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
      expect(
        within(weekCard()).getByRole("heading", { level: 2 }),
      ).toHaveTextContent("All done this week");
      expect(screen.queryByText(/left this week/)).toBeNull();
      expect(screen.queryByText("Formal venue?")).toBeNull();
    });

    it("draws no card at all against an older API with nothing next", () => {
      mockActivity.mockReturnValue(loaded({ needs_you: nothingWaiting }));
      render(<ActivityPage />);

      expect(screen.queryByTestId("activity-week-card")).toBeNull();
      expect(
        within(toDo()).getByText("Nothing to do right now."),
      ).toBeInTheDocument();
    });

    it("draws no ring against an API from before the week, only the next thing", () => {
      // `data()` carries no `week`, as an older API serves it.
      mockActivity.mockReturnValue(loaded());
      render(<ActivityPage />);

      expect(screen.queryByTestId("activity-week-ring")).toBeNull();
      const next = screen.getByRole("region", { name: "Next" });
      expect(
        within(next).getByRole("button", {
          name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
        }),
      ).toBeInTheDocument();
    });

    it("says an event open for check-in is happening now", () => {
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

      const label = within(weekCard()).getByText("Happening now");
      expect(label).toHaveClass("text-accent-text");
      expect(
        within(weekCard()).getByRole("button", {
          name: /^(Unread:\s?)?Chapter meeting/,
        }),
      ).toBeInTheDocument();
    });

    it("waits for the viewer before drawing, since a row's panel draws for them", () => {
      mockActivity.mockReturnValue(loaded({ week: week() }));
      mockUser.mockReturnValue({ userId: null, isLoading: true });
      const { rerender } = render(<ActivityPage />);
      expect(screen.queryByTestId("activity-week-card")).toBeNull();
      expect(screen.getByText("Loading your activity")).toBeInTheDocument();

      mockUser.mockReturnValue({ userId: "me", isLoading: false });
      rerender(<ActivityPage />);
      expect(weekCard()).toBeInTheDocument();
    });
  });

  describe("This semester (#4766)", () => {
    it("draws a gauge per number, each linking to the page that owns it, with a ring only toward a target", () => {
      mockActivity.mockReturnValue(loaded());
      mockStanding.mockReturnValue({
        isPending: false,
        data: {
          points: { total: 42, rank: 5, ranked: 58, goal: null },
          required_events: { required: 8, attended: 6, excused: 1 },
          service: null,
          study: null,
          unavailable: ["service"],
        },
      });
      render(<ActivityPage />);

      const standing = screen.getByRole("region", { name: "This semester" });
      expect(
        within(standing).getByRole("link", {
          name: "Attended 6 of 8 required events this semester, 1 excused",
        }),
      ).toHaveAttribute("href", "/events");
      expect(
        within(standing).getByTestId("activity-gauge-ring-required_events"),
      ).toHaveAttribute("data-progress", "0.75");
      // No goal for points: the number stands alone, with no invented end.
      const points = within(standing).getByRole("link", {
        name: "42 points this semester, ranked 5 of 58",
      });
      expect(points).toHaveAttribute("href", "/points");
      expect(
        within(standing).queryByTestId("activity-gauge-ring-points"),
      ).toBeNull();
      // A part that couldn't load says so, and never reads as zero.
      const service = within(standing).getByRole("link", {
        name: "Service hours: couldn't load",
      });
      expect(service).toHaveAttribute("href", "/service");
      expect(service).toHaveTextContent("–");
      expect(service).toHaveTextContent("Couldn't load");
      // Study wasn't served and didn't fail: no gauge, not a zero.
      expect(within(standing).getAllByRole("link")).toHaveLength(3);
    });

    it("closes a gauge that has reached its goal in the success hue", () => {
      mockActivity.mockReturnValue(loaded());
      mockStanding.mockReturnValue({
        isPending: false,
        data: {
          points: { total: 160, rank: 1, ranked: 58, goal: 150 },
          required_events: { required: 8, attended: 6, excused: 0 },
          service: null,
          study: null,
          unavailable: [],
        },
      });
      render(<ActivityPage />);

      expect(
        screen
          .getByTestId("activity-gauge-ring-points")
          .querySelector("circle.text-success"),
      ).not.toBeNull();
      expect(
        screen
          .getByTestId("activity-gauge-ring-required_events")
          .querySelector("circle.text-primary"),
      ).not.toBeNull();
    });

    it("isn't drawn for a new member in a chapter with no goals", () => {
      mockActivity.mockReturnValue(loaded());
      mockStanding.mockReturnValue({
        isPending: false,
        data: {
          points: { total: 0, rank: null, ranked: 0, goal: null },
          required_events: { required: 0, attended: 0, excused: 0 },
          service: {
            approved_minutes: 0,
            pending_minutes: 0,
            goal_minutes: null,
          },
          study: null,
          unavailable: [],
        },
      });
      render(<ActivityPage />);

      expect(
        screen.queryByRole("region", { name: "This semester" }),
      ).toBeNull();
      expect(screen.queryByText("This semester")).toBeNull();
    });

    it("leaves the rest of the page as it was when its read fails", () => {
      mockActivity.mockReturnValue(loaded());
      mockStanding.mockReturnValue({ isPending: false, data: undefined });
      render(<ActivityPage />);

      expect(
        screen.queryByRole("region", { name: "This semester" }),
      ).toBeNull();
      expect(within(toDo()).getByText("Book the venue")).toBeInTheDocument();
    });
  });

  describe("To review (#4766)", () => {
    const officer = () =>
      mockPermissions.mockReturnValue({
        data: { permissions: ["tasks:manage", "service:approve"] },
      });

    it("shows a member no card, and an officer with an empty queue none either", () => {
      mockActivity.mockReturnValue(loaded());
      const { unmount } = render(<ActivityPage />);
      expect(screen.queryByTestId("activity-review-card")).toBeNull();
      unmount();

      officer();
      render(<ActivityPage />);
      expect(screen.queryByTestId("activity-review-card")).toBeNull();
      expect(screen.queryByText("To review")).toBeNull();
    });

    it("starts a short queue open, so a confirmation is still one press", () => {
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

      const card = screen.getByTestId("activity-review-card");
      const toggle = within(card).getByRole("button", {
        name: "To review, 2: 1 task · 1 hours entry",
      });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(
        within(card).getByRole("button", {
          name: "act:confirm:Sweep the porch",
        }),
      ).toBeInTheDocument();
      expect(
        within(card).getByRole("button", { name: "act:approve:Food bank" }),
      ).toBeInTheDocument();
      // The member's own list never holds what waits on their review.
      expect(screen.queryByRole("region", { name: "To do" })).not.toBeNull();
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

      // Two more finish while the officer is part-way through: the card
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
        "To review, 7: 6 tasks · 1 hours entry",
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
      const card = screen.getByTestId("activity-review-card");
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
  });

  describe("To do by day (#4766)", () => {
    it("leads with Overdue in the warning hue, without repeating it on each row", () => {
      mockActivity.mockReturnValue(
        loaded({
          needs_you: {
            ...nothingWaiting,
            tasks: [
              {
                ...task,
                id: "late1",
                title: "File the roster",
                due_date: localDate(-3),
                status: "OVERDUE",
              },
              {
                ...task,
                id: "late2",
                title: "Return the keys",
                due_date: localDate(-1),
                status: "OVERDUE",
              },
              task,
            ],
          },
        }),
      );
      render(<ActivityPage />);

      // The longest overdue is the next thing, and says so on its own row.
      expect(
        within(weekCard()).getByRole("button", {
          name: /^(Unread:\s?)?File the roster/,
        }),
      ).toHaveTextContent("Overdue");
      const overdue = within(toDo()).getByTestId("activity-day-overdue");
      const heading = within(overdue).getByRole("heading", { level: 3 });
      // The count sits beside the heading, not in it: the day is named
      // "Overdue", never "Overdue1".
      expect(heading).toHaveTextContent(/^Overdue$/);
      expect(overdue).toHaveAccessibleName("Overdue");
      expect(heading.nextElementSibling).toHaveTextContent(/^1$/);
      expect(heading).toHaveClass("text-warning");
      const row = within(overdue).getByRole("button", {
        name: /^(Unread:\s?)?Return the keys/,
      });
      // Its detail still says by how long; the chip would repeat the heading.
      expect(row).toHaveTextContent("Overdue by 1 day");
      expect(within(row).queryByText("Overdue")).toBeNull();
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
      expect(heading.nextElementSibling).toHaveTextContent(/^5$/);
      expect(within(day).getAllByRole("listitem")).toHaveLength(3);
      fireEvent.click(within(day).getByRole("button", { name: "Show 2 more" }));
      expect(within(day).getAllByRole("listitem")).toHaveLength(5);
      expect(
        within(day).getByRole("button", { name: "Show fewer" }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("has no heading over nothing when its one thing is on the week card", () => {
      mockActivity.mockReturnValue(
        loaded({ needs_you: { ...nothingWaiting, polls: [poll] } }),
      );
      render(<ActivityPage />);

      expect(
        within(weekCard()).getByRole("button", {
          name: /^(Unread:\s?)?(From .*\.\s?)?Formal venue\?/,
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "To do" })).toBeNull();
      expect(screen.queryByText("Nothing to do right now.")).toBeNull();
    });
  });

  it("lays out by its own width, since it is usually a pane beside chat", () => {
    mockActivity.mockReturnValue(
      loaded({ week: week({ tasks: count(0, 1), polls: count(0, 1) }) }),
    );
    mockStanding.mockReturnValue({
      isPending: false,
      data: {
        points: { total: 42, rank: 5, ranked: 58, goal: 60 },
        required_events: { required: 8, attended: 6, excused: 0 },
        service: {
          approved_minutes: 270,
          pending_minutes: 0,
          goal_minutes: 600,
        },
        study: {
          minutes: 125,
          week_start: "2026-11-08T05:00:00.000Z",
          goal_minutes: 360,
        },
        unavailable: [],
      },
    });
    render(<ActivityPage />);

    // The page is the container its parts measure, so a 480px pane in a wide
    // window keeps the narrow layout. A window breakpoint (`lg:`, `md:`)
    // on any of these would break that.
    const card = weekCard();
    expect(card.closest(".\\@container")).not.toBeNull();
    const cardLayout = card.querySelector("section");
    expect(cardLayout).toHaveClass("flex-col", "@3xl:flex-row");
    const strip = screen.getByRole("region", { name: "This semester" });
    const grid = strip.querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-2", "@3xl:grid-cols-4");
    for (const element of [cardLayout, grid]) {
      expect(element?.className).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
    }
  });

  it("orders the page: the week, this semester, to review, to do, waiting on others, links", () => {
    mockPermissions.mockReturnValue({
      data: { permissions: ["tasks:manage"] },
    });
    mockStanding.mockReturnValue({
      isPending: false,
      data: {
        points: { total: 42, rank: 5, ranked: 58, goal: null },
        required_events: { required: 8, attended: 6, excused: 1 },
        service: null,
        study: null,
        unavailable: [],
      },
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
    ).toEqual([
      "2 left this week",
      "This semester",
      "To review",
      "To do",
      "Waiting on others",
      "Links",
    ]);
    // The old page's names are gone with its tiles and chips.
    for (const gone of ["Needs you", "Coming up", "Made by you"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
  });

  it("leaves out a group with nothing in it", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    expect(
      screen.queryByRole("region", { name: "Waiting on others" }),
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "Links" })).toBeNull();
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

    const made = screen.getByRole("region", { name: "Waiting on others" });
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

  it("keeps Waiting on others while every posted poll is closed, for its archive", () => {
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

    const made = screen.getByRole("region", { name: "Waiting on others" });
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
      const made = screen.getByRole("region", { name: "Waiting on others" });
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
      loaded({ needs_you: nothingWaiting, unavailable: ["polls"] }),
    );
    render(<ActivityPage />);

    expect(within(toDo()).getByText(/Couldn't load polls/)).toBeInTheDocument();
    expect(
      within(toDo()).queryByText("Nothing to do right now."),
    ).not.toBeInTheDocument();
  });

  it("names what it couldn't load under Waiting on others, with nothing else in it", () => {
    mockActivity.mockReturnValue(loaded({ unavailable: ["made_events"] }));
    render(<ActivityPage />);

    const made = screen.getByRole("region", { name: "Waiting on others" });
    expect(
      within(made).getByText(
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

  it("sends a review the fresh read doesn't hold to the task board", async () => {
    mockActivity.mockReturnValue({
      ...loaded(),
      refetch: vi.fn(() => Promise.resolve({ data: data() })),
    });
    mockSearch = new URLSearchParams("review=gone");
    render(<ActivityPage />);
    await act(async () => {});

    expect(screen.queryByText(/^panel:/)).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/tasks");
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

  it("lists sign-up links in their own group, with Remove only for a channels:manage holder", () => {
    const link = {
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
          tasks: [{ ...task, status: "OVERDUE", stored_status: "TODO" }],
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

  it("doesn't say To do on every row of a list named To do", () => {
    mockActivity.mockReturnValue(loaded());
    render(<ActivityPage />);

    const row = within(toDo()).getByRole("button", {
      name: /^(Unread:\s?)?Book the venue/,
    });
    expect(within(row).queryByText("To do")).toBeNull();
  });

  it("splits Waiting on others by kind, and holds a long kind behind Show all", () => {
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
    const made = screen.getByRole("region", { name: "Waiting on others" });
    // Named by its heading alone; the count sits beside it.
    const part = within(made).getByRole("group", {
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
      within(list).getByText(/^Jan 1, 2099 · .* · Great Room$/),
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
