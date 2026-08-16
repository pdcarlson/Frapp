import { render, screen } from "@testing-library/react";
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
    // Busy, not blocked — nothing established a subscription reason.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
