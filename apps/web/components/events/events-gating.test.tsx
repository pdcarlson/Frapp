import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
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
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useCreateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRoles: () => ({ data: [{ id: "r1", name: "Exec" }], isError: false }),
  useActiveChapterId: () => "chap-1",
  useAttendance: () => ({
    data: ATTENDANCE,
    isPending: false,
    isError: false,
  }),
  useMembers: () => ({ data: MEMBERS, isPending: false, isError: false }),
  useUpdateAttendanceStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAutoAbsent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// The realtime subscription needs a QueryClientProvider and a Supabase client;
// neither is part of what this file covers.
vi.mock("@/lib/realtime/use-realtime-table", () => ({
  useRealtimeTable: () => {},
}));

const { EventEditorDialog } = await import("./event-editor-dialog");
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
const cancelButton = () => screen.getByRole("button", { name: /cancel/i });
const autoAbsentButton = () =>
  screen.getByRole("button", { name: /run auto-absent/i });
const rowStatusSelect = () =>
  screen.getByRole("combobox", { name: /update attendance for alice adams/i });
const statusFilter = () =>
  screen.getByRole("combobox", { name: /filter attendance by status/i });

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
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
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

  it("leaves Cancel live so the blocked dialog is not a trap", () => {
    chapter.incomplete();
    renderEditor();

    expect(cancelButton()).toBeEnabled();
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

    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
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
    expect(rowStatusSelect()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables auto-absent and names the blocker when incomplete", () => {
    chapter.incomplete();
    render(<AttendancePanel eventId="evt-1" />);

    expect(autoAbsentButton()).toBeDisabled();
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
  });

  it("gates the per-row status write too, not just the headline one", () => {
    chapter.incomplete();
    render(<AttendancePanel eventId="evt-1" />);

    const describedBy = autoAbsentButton().getAttribute("aria-describedby");
    expect(rowStatusSelect()).toBeDisabled();
    expect(rowStatusSelect()).toHaveAttribute("aria-describedby", describedBy);
  });

  it("never gates the status filter, which is a read", () => {
    chapter.incomplete();
    render(<AttendancePanel eventId="evt-1" />);

    expect(statusFilter()).toBeEnabled();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    render(<AttendancePanel eventId="evt-1" />);

    expect(autoAbsentButton()).toBeEnabled();
    expect(rowStatusSelect()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
