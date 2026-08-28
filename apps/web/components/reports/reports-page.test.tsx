import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockAttendanceReport } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockAttendanceReport: vi.fn(),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
const idle = () => ({ mutateAsync: vi.fn(), isPending: false });

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useAttendanceReport: () => mockAttendanceReport(),
  usePointsReport: () => idle(),
  useRosterReport: () => idle(),
  useServiceReport: () => idle(),
  isReportExportEnvelope: () => false,
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { ReportsPage } = await import("./reports-page");

const chapter = chapterSubscription(mockCurrentChapter);

const generateButton = () =>
  screen.getByRole("button", { name: /generate report/i });
const pdfButton = () => screen.getByRole("button", { name: /download pdf/i });
const csvButton = () => screen.getByRole("button", { name: /download csv/i });

describe("ReportsPage subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAttendanceReport.mockReturnValue(idle());
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

    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.getByLabelText(/event id/i)).toBeEnabled();
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
    expect(screen.getByText("Chapter has no terms")).toBeInTheDocument();
    expect(
      screen.queryByText("Generate a report to see a preview here."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
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
    // transient; the preview and the CSV built from it are not.
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
