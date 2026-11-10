import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const {
  mockCurrentChapter,
  mockAttendanceReport,
  mockUseEvents,
  mockUseMembers,
  mockUseMyPermissions,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockAttendanceReport: vi.fn(),
  mockUseEvents: vi.fn(),
  mockUseMembers: vi.fn(),
  mockUseMyPermissions: vi.fn(),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
const idle = () => ({ mutateAsync: vi.fn(), isPending: false });
const emptyList = () => ({
  data: [],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
});
// Granted by default so the existing picker tests don't have to think about
// the `reports:export` gate on `useEvents`/`useMembers` — the tests that do
// care about it override this per-case.
const grantedPermissions = () => ({
  data: { permissions: ["reports:export"] },
});

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useAttendanceReport: () => mockAttendanceReport(),
  usePointsReport: () => idle(),
  useRosterReport: () => idle(),
  useServiceReport: () => idle(),
  useEvents: (options?: { enabled?: boolean }) => mockUseEvents(options),
  useMembers: (options?: { enabled?: boolean }) => mockUseMembers(options),
  useMyPermissions: () => mockUseMyPermissions(),
  isReportExportEnvelope: () => false,
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { toastSpy, exportRowsSpy } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  exportRowsSpy: vi.fn(async () => {}),
}));
vi.mock("@/lib/utils", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, exportRows: exportRowsSpy };
});
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const { ReportsPage } = await import("./reports-page");

const chapter = chapterSubscription(mockCurrentChapter);

const generateButton = () =>
  screen.getByRole("button", { name: /generate report/i });
const pdfButton = () => screen.getByRole("button", { name: /download pdf/i });
const csvButton = () => screen.getByRole("button", { name: /^export$/i });

describe("ReportsPage subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAttendanceReport.mockReturnValue(idle());
    mockUseEvents.mockReturnValue(emptyList());
    mockUseMembers.mockReturnValue(emptyList());
    mockUseMyPermissions.mockReturnValue(grantedPermissions());
  });

  it("leaves both export triggers alone on an active chapter", () => {
    chapter.active();
    render(<ReportsPage />);

    expect(generateButton()).toBeEnabled();
    expect(pdfButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables Generate report and names blocker plus recovery when incomplete", () => {
    chapter.incomplete();
    render(<ReportsPage />);

    // §5 rule 1: gate the trigger. All four report routes are POSTs, so there
    // is nothing further downstream to gate instead.
    expect(generateButton()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
  });

  it("gates the PDF export too, not just Generate report", () => {
    // `POST /v1/reports/:kind?format=pdf` is the same guarded route as the JSON
    // run, so leaving it live would have the page claim exports are blocked
    // while still offering one.
    chapter.incomplete();
    render(<ReportsPage />);

    expect(pdfButton()).toBeDisabled();
  });

  it("ties both disabled exports to the one explanation", () => {
    chapter.incomplete();
    render(<ReportsPage />);

    const describedBy = generateButton().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(pdfButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("never gates the filters or the local CSV serialization", () => {
    // `enforceSubscription` returns early for GET, and the CSV never leaves the
    // browser at all — only the two POST triggers carry the gate.
    chapter.incomplete();
    render(<ReportsPage />);

    expect(screen.getByLabelText(/^report$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^event/i)).toBeEnabled();
    expect(csvButton()).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the buttons' own in-flight guards intact behind the gate", () => {
    // The gate ORs in the caller's conditions rather than replacing them: an
    // active chapter mid-run still cannot queue a second report.
    chapter.active();
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    });
    render(<ReportsPage />);

    expect(generateButton()).toBeDisabled();
    expect(pdfButton()).toBeDisabled();
    // Busy, not blocked — nothing established a subscription reason. Asserted
    // through the controls' own `aria-describedby` rather than "no role=status
    // anywhere": the notice was the only live region on this screen when that
    // proxy was written, and the Preview panel's loading state is now a second
    // one. The wiring is what the gate actually promises.
    expect(generateButton()).not.toHaveAttribute("aria-describedby");
    expect(pdfButton()).not.toHaveAttribute("aria-describedby");
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate exists to prevent.
    chapter.loading();
    render(<ReportsPage />);

    expect(generateButton()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
  });

  it("blocks paid-ops report exports immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<ReportsPage />);

    expect(generateButton()).toBeDisabled();
    expect(pdfButton()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than at checkout", () => {
    chapter.canceled();
    render(<ReportsPage />);

    expect(generateButton()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of its own
    // exports; the server guard is still the enforcement.
    chapter.unreadable();
    render(<ReportsPage />);

    expect(generateButton()).toBeEnabled();
    expect(pdfButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("ReportsPage preview states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
    mockUseEvents.mockReturnValue(emptyList());
    mockUseMembers.mockReturnValue(emptyList());
    mockUseMyPermissions.mockReturnValue(grantedPermissions());
  });

  it("renders an error with a retry when a run fails, not the idle copy", async () => {
    // The defect: the catch reported a toast and never touched `preview`, so
    // `preview === null` fell through to "Generate a report to see a preview
    // here." — a failed report rendering as "nothing has happened yet", with
    // no retry path. README §4 requires an error state on every async view.
    const user = userEvent.setup();
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("Chapter has no terms")),
      isPending: false,
    });

    render(<ReportsPage />);
    await user.click(generateButton());

    expect(
      await screen.findByText(/couldn't generate attendance report/i),
    ).toBeInTheDocument();
    // A plain Error was written for the console, not the officer.
    expect(screen.queryByText("Chapter has no terms")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Generate a report to see a preview here."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("explains a refusal from the body the report hooks throw, in the officer's words", async () => {
    // openapi-fetch throws the parsed error body, a plain object, not an
    // `Error`; the shared error map rewrites the API's field-named sentence.
    const user = userEvent.setup();
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue({
        statusCode: 400,
        message: "start_date must not be after end_date",
      }),
      isPending: false,
    });

    render(<ReportsPage />);
    await user.click(generateButton());

    expect(
      await screen.findByText(
        "The end date has to be on or after the start date.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't reach Frapp. Check your connection and try again."),
    ).not.toBeInTheDocument();
  });

  it("will not let Retry queue a second run during a PDF export", async () => {
    // The loading branch is `activeMutation.isPending && !pdfPending`, so a
    // PDF export falls straight through to the stale error — and `NestedError`
    // had no way to disable its Retry. That is a third entry point into the
    // same mutation the two footer buttons already guard.
    const user = userEvent.setup();
    // The second call never settles, so the export stays in flight for the
    // length of the assertion.
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi
        .fn()
        .mockRejectedValueOnce(new Error("Chapter has no terms"))
        .mockImplementation(() => new Promise(() => {})),
      isPending: false,
    });

    render(<ReportsPage />);
    await user.click(generateButton());
    expect(await screen.findByRole("button", { name: /retry/i })).toBeEnabled();

    // Start a PDF export; the preview keeps its error, and Retry must not
    // remain a live way into the same mutation.
    await user.click(pdfButton());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retry/i })).toBeDisabled(),
    );
  });

  it("mirrors the subscription gate on Retry, not just the busy flags", async () => {
    // Retry re-enters `runReport`, a paid-ops POST. Disabling it only while
    // busy meant a chapter that lapsed between the failed run and the click
    // fired the doomed request README §5 exists to prevent — the canonical
    // billing-screen bug, reached by a third button on the same controller.
    const user = userEvent.setup();
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("Chapter has no terms")),
      isPending: false,
    });

    const { rerender } = render(<ReportsPage />);
    await user.click(generateButton());
    expect(await screen.findByRole("button", { name: /retry/i })).toBeEnabled();

    chapter.canceled();
    rerender(<ReportsPage />);

    expect(screen.getByRole("button", { name: /retry/i })).toBeDisabled();
    // And it points at the same one explanation every other disabled write does.
    expect(screen.getByRole("button", { name: /retry/i })).toHaveAttribute(
      "aria-describedby",
      generateButton().getAttribute("aria-describedby"),
    );
  });

  it("says so on screen when the report is truncated, not only in a toast", async () => {
    // `spec/behavior/reports.md`: truncation is never silent. The toast is
    // transient; the preview and any export built from it are not.
    const user = userEvent.setup();
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        payload: [{ member: "Paul", status: "PRESENT" }],
        truncation: { truncated: true, rowLimit: 5000, note: null },
      }),
      isPending: false,
    });

    render(<ReportsPage />);
    await user.click(generateButton());

    expect(await screen.findByText(/incomplete report/i)).toBeInTheDocument();
    expect(screen.getByText(/not a complete record/i)).toBeInTheDocument();
  });

  it("exports the previewed rows under the report's name, and warns again when they are truncated", async () => {
    // #3969: Export is a file-type menu. The truncation warning at export time
    // now rides the menu's `onExported`, and for the clipboard copy it has to
    // carry the "copied" notice too, since one toast shows at a time.
    const user = userEvent.setup();
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        payload: [{ member: "Paul", status: "PRESENT" }],
        truncation: { truncated: true, rowLimit: 5000, note: null },
      }),
      isPending: false,
    });

    render(<ReportsPage />);
    await user.click(generateButton());
    await screen.findByText(/incomplete report/i);
    toastSpy.mockClear();
    exportRowsSpy.mockClear();

    await user.click(csvButton());
    await user.click(
      await screen.findByRole("menuitem", { name: "Copy for Google Sheets" }),
    );

    expect(exportRowsSpy).toHaveBeenCalledWith(
      [{ member: "Paul", status: "PRESENT" }],
      "attendance",
      "sheets",
    );
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Copied an incomplete report",
        variant: "destructive",
        description: expect.stringMatching(/Paste into a Google Sheet/),
      }),
    );
  });

  it("keeps the preview clean when the report is complete", async () => {
    const user = userEvent.setup();
    mockAttendanceReport.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({
        payload: [{ member: "Paul", status: "PRESENT" }],
        truncation: { truncated: false, rowLimit: null, note: null },
      }),
      isPending: false,
    });

    render(<ReportsPage />);
    await user.click(generateButton());

    expect(await screen.findByText("Paul")).toBeInTheDocument();
    expect(screen.queryByText(/incomplete report/i)).not.toBeInTheDocument();
  });
});

describe("ReportsPage event and member pickers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
    mockAttendanceReport.mockReturnValue(idle());
    mockUseEvents.mockReturnValue(emptyList());
    mockUseMembers.mockReturnValue(emptyList());
    mockUseMyPermissions.mockReturnValue(grantedPermissions());
  });

  it("lists events by name and start time instead of asking for a raw UUID", () => {
    mockUseEvents.mockReturnValue({
      data: [
        {
          id: "evt-1",
          name: "Chapter Meeting",
          start_time: "2026-09-01T18:00:00Z",
        },
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ReportsPage />);

    expect(
      screen.getByRole("option", { name: /chapter meeting/i }),
    ).toHaveValue("evt-1");
    expect(screen.queryByPlaceholderText(/uuid/i)).not.toBeInTheDocument();
  });

  it("scopes the attendance report to the event selected from the picker", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({
      payload: [],
      truncation: { truncated: false, rowLimit: null, note: null },
    });
    mockAttendanceReport.mockReturnValue({ mutateAsync, isPending: false });
    mockUseEvents.mockReturnValue({
      data: [
        {
          id: "evt-1",
          name: "Chapter Meeting",
          start_time: "2026-09-01T18:00:00Z",
        },
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ReportsPage />);
    await user.selectOptions(screen.getByLabelText(/^event/i), "evt-1");
    await user.click(generateButton());

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ event_id: "evt-1" }),
      }),
    );
  });

  it("keeps the event picker usable and names the failure when the event list errors", () => {
    const refetch = vi.fn();
    mockUseEvents.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });

    render(<ReportsPage />);

    expect(screen.getByText(/couldn't load events/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^event/i)).toBeEnabled();
  });

  it("says so when the chapter has no events yet", () => {
    mockUseEvents.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ReportsPage />);

    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  it("disables the event picker while the event list is loading", () => {
    mockUseEvents.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ReportsPage />);

    expect(screen.getByLabelText(/^event/i)).toBeDisabled();
  });

  it("lists members by display name and email for the points report, not a raw UUID", async () => {
    const user = userEvent.setup();
    mockUseMembers.mockReturnValue({
      data: [
        {
          user_id: "user-1",
          display_name: "Paul Carlson",
          email: "paul@example.com",
        },
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ReportsPage />);
    await user.click(screen.getByLabelText(/^report$/i));
    await user.click(await screen.findByRole("option", { name: "Points" }));

    const option = await screen.findByRole("option", {
      name: /paul carlson \(paul@example\.com\)/i,
    });
    expect(option).toHaveValue("user-1");
    expect(screen.queryByPlaceholderText(/uuid/i)).not.toBeInTheDocument();
  });

  it("names an unnamed member with the shared label, email beside it", async () => {
    // #2422: `Member <first six of id>` is how every other surface names this
    // member, so the email is extra identity around the label, not a stand-in.
    const user = userEvent.setup();
    mockUseMembers.mockReturnValue({
      data: [
        {
          user_id: "2f4a1c9d-0000-4000-8000-000000000000",
          display_name: "  ",
          email: "jo@example.com",
        },
        {
          user_id: "8f14e45f-0000-4000-8000-000000000000",
          display_name: "",
          email: null,
        },
      ],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ReportsPage />);
    await user.click(screen.getByLabelText(/^report$/i));
    await user.click(await screen.findByRole("option", { name: "Points" }));

    expect(
      await screen.findByRole("option", {
        name: "Member 2f4a1c (jo@example.com)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Member 8f14e4" }),
    ).toBeInTheDocument();
  });

  it("scopes the event/member list fetch to reports:export, not just the page render", () => {
    // `useEvents`/`useMembers` are eager queries, unlike the four report
    // mutations — firing them for a visitor who cannot even see this page
    // (denied by the outer `<Can permission="reports:export">`) would still
    // download every member's full profile as a side effect.
    mockUseMyPermissions.mockReturnValue({ data: { permissions: [] } });

    render(<ReportsPage />);

    expect(mockUseEvents).toHaveBeenCalledWith({ enabled: false });
    expect(mockUseMembers).toHaveBeenCalledWith({ enabled: false });
  });

  it("enables the event/member list fetch once reports:export is confirmed", () => {
    render(<ReportsPage />);

    expect(mockUseEvents).toHaveBeenCalledWith({ enabled: true });
    expect(mockUseMembers).toHaveBeenCalledWith({ enabled: true });
  });

  it("never asks the officer to type an id (P2.2)", () => {
    mockUseEvents.mockReturnValue(emptyList());
    render(<ReportsPage />);

    expect(screen.queryByText(/can't find the event/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/id$/i)).not.toBeInTheDocument();
  });
});
