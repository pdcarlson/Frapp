import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

const MEMBERS = [
  { user_id: "u-1", display_name: "Alice Adams", email: "alice@example.edu" },
];

const ATTENDANCE = [
  {
    id: "att-1",
    event_id: "evt-1",
    user_id: "u-1",
    status: "PRESENT" as const,
    check_in_time: "2026-08-01T18:05:00Z",
    excuse_reason: null,
  },
];

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
// "This time last year" (#3930) has its own spec.
vi.mock("@/components/ai/suggested-events", () => ({
  SuggestedEvents: () => null,
  useRecordPlannedEvent: () => async () => undefined,
}));

vi.mock("@repo/hooks", async () => {
  const { eventsPageHooks } = await import("@/tests/events-page");
  return eventsPageHooks({
    useCurrentChapter: () => mockCurrentChapter(),
    useAttendance: () => ({
      data: ATTENDANCE,
      isPending: false,
      isError: false,
    }),
    useMembers: () => ({ data: MEMBERS, isPending: false, isError: false }),
  });
});

// The viewer whose last view (List or Calendar) the page reads; no stored
// choice unless a test writes one.
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "user-1", isLoading: false }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

// The detail sheet and the editor render their own gates; this block is about
// the page-level triggers that own the editor's `open` state.
vi.mock("./event-detail-sheet", () => ({ EventDetailSheet: () => null }));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The realtime subscription needs a QueryClientProvider and a Supabase client;
// neither is part of what this file covers.
vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => {},
}));

const { EventEditorDialog } = await import("./event-editor-dialog");
const { EventsPage } = await import("./events-page");
const { AttendancePanel } = await import("./attendance-panel");

const chapter = chapterSubscription(mockCurrentChapter);

function renderEditor() {
  render(
    <EventEditorDialog
      open
      mode="create"
      event={null}
      usingPreviewData={false}
      onOpenChange={() => {}}
      onSaved={async () => {}}
    />,
  );
}

const saveButton = () => screen.getByRole("button", { name: /create event/i });
// The form closes from its header (#5561): the sheet's Close, or Back when
// docked beside the page.
const closeButton = () =>
  screen.getByRole("button", { name: /^(close|back to events)$/i });
const autoAbsentButton = () =>
  screen.getByRole("button", { name: /mark no-shows absent/i });
const rowStatusSelect = () =>
  screen.getByRole("radiogroup", { name: /attendance for alice adams/i });
const statusFilter = () =>
  screen.getByRole("radiogroup", { name: /filter attendance by status/i });

describe("EventEditorDialog subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves the save button alone on an active chapter", () => {
    chapter.active();
    renderEditor();

    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables saving and names the blocker when incomplete", () => {
    chapter.incomplete();
    renderEditor();

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("ties the disabled save button to the one explanation", () => {
    chapter.incomplete();
    renderEditor();

    const describedBy = saveButton().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("leaves the way out live so the blocked dialog is not a trap", () => {
    chapter.incomplete();
    renderEditor();

    expect(closeButton()).toBeEnabled();
  });

  it("keeps the save button disabled while editing too", () => {
    chapter.pastDue();
    render(
      <EventEditorDialog
        open
        mode="edit"
        event={{
          id: "evt-1",
          name: "Chapter Meeting",
          start_time: "2026-08-01T18:00:00.000Z",
          end_time: "2026-08-01T19:00:00.000Z",
        }}
        usingPreviewData={false}
        onOpenChange={() => {}}
        onSaved={async () => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    renderEditor();

    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("AttendancePanel subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves every control alone on an active chapter", () => {
    chapter.active();
    render(<AttendancePanel eventId="evt-1" />);

    expect(autoAbsentButton()).toBeEnabled();
    expect(rowStatusSelect()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables auto-absent and names the blocker when incomplete", () => {
    chapter.incomplete();
    render(<AttendancePanel eventId="evt-1" />);

    expect(autoAbsentButton()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/settings?tab=billing");
  });

  it("gates the per-row status write too, not just the headline one", () => {
    chapter.incomplete();
    render(<AttendancePanel eventId="evt-1" />);

    const describedBy = autoAbsentButton().getAttribute("aria-describedby");
    // Every answer on the row is off, and the row says why.
    for (const answer of within(rowStatusSelect()).getAllByRole("radio")) {
      expect(answer).toBeDisabled();
    }
    expect(rowStatusSelect()).toHaveAttribute("aria-describedby", describedBy);
  });

  it("never gates the status filter, which is a read", () => {
    chapter.incomplete();
    render(<AttendancePanel eventId="evt-1" />);

    expect(statusFilter()).not.toHaveAttribute("aria-disabled");
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    render(<AttendancePanel eventId="evt-1" />);

    expect(autoAbsentButton()).toBeEnabled();
    expect(rowStatusSelect()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("AttendancePanel auto-absent before check-in closes (FRAPP-WEB-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Local noon, so check-in's close (15 minutes after an end five minutes
    // ago) is "Today" whenever the suite runs; at 23:50 it read "Tomorrow".
    // Only `Date` is faked, so the query and render timers still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 13, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("waits for check-in to close, which is when the API accepts it", () => {
    chapter.active();
    // Ended five minutes ago: still inside the 15-minute check-in grace.
    const end = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<AttendancePanel eventId="evt-1" eventEnd={end} />);

    expect(autoAbsentButton()).toBeDisabled();
    // Said in visible text, since a disabled button shows no tooltip.
    const notice = screen.getByText(
      /available when check-in closes/i,
    );
    expect(notice).toHaveTextContent(/\(Today · /);
    expect(autoAbsentButton()).toHaveAttribute("aria-describedby", notice.id);
    // The row write is not held: officers correct statuses during check-in.
    expect(rowStatusSelect()).not.toHaveAttribute("aria-disabled");
  });

  it("makes no promise about the close when the subscription blocks it", () => {
    chapter.incomplete();
    const end = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<AttendancePanel eventId="evt-1" eventEnd={end} />);

    expect(autoAbsentButton()).toBeDisabled();
    expect(
      screen.queryByText(/available when check-in closes/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("offers it once check-in has closed", () => {
    chapter.active();
    const end = new Date(Date.now() - 20 * 60_000).toISOString();
    render(<AttendancePanel eventId="evt-1" eventEnd={end} />);

    expect(autoAbsentButton()).toBeEnabled();
    expect(
      screen.queryByText(/available when check-in closes/i),
    ).not.toBeInTheDocument();
  });
});

describe("EventsPage subscription gating", () => {
  // `POST /v1/events` and `PATCH /v1/events/:id` are paid-ops. The page owns the
  // editor dialog's `open`, so §5 rule 1 lands here: the New event button and
  // the hour grid's hours are the triggers that must refuse to open it (#841).
  beforeEach(() => vi.clearAllMocks());

  const newEvent = () => screen.getByRole("button", { name: /new event/i });

  it("disables every create entry point and names the blocker when incomplete", async () => {
    chapter.incomplete();
    render(<EventsPage />);

    expect(newEvent()).toBeDisabled();
    // The hour grid's hours are more ways into the same dialog; gating only
    // the header button would leave a live path to a doomed form.
    await userEvent.click(
      screen.getByRole("button", { name: "Hours for Today" }),
    );
    for (const hour of screen.getAllByRole("button", {
      name: /^create event on/i,
    })) {
      expect(hour).toBeDisabled();
    }
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("leaves search and filters live while blocked", () => {
    chapter.incomplete();
    render(<EventsPage />);

    expect(screen.getByPlaceholderText(/search events/i)).toBeEnabled();
  });

  it("leaves both entry points alone on an active chapter", () => {
    chapter.active();
    render(<EventsPage />);

    expect(newEvent()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    render(<EventsPage />);

    expect(newEvent()).toBeEnabled();
  });
});
