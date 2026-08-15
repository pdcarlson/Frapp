import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from
// the wire format to the disabled trigger.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useInvoices: () => ({ data: [], isPending: false, isError: false }),
  useOverdueInvoices: () => ({ data: [], isError: false }),
  useMembers: () => ({ data: [] }),
  useCreateInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTransitionInvoiceStatus: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { InvoiceAdminCard } = await import("./invoice-admin-card");

function setChapter(
  subscription_status: string,
  past_due_since: string | null = null,
) {
  mockCurrentChapter.mockReturnValue({
    data: { subscription_status, past_due_since },
    isPending: false,
    isError: false,
  });
}

function trigger() {
  return screen.getByRole("button", { name: /create invoice/i });
}

describe("InvoiceAdminCard subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves invoicing alone on an active chapter", () => {
    setChapter("active");
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeEnabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("disables the trigger and names blocker plus recovery when incomplete", async () => {
    setChapter("incomplete");
    render(<InvoiceAdminCard />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(screen.getByText(/complete checkout/i)).toBeInTheDocument();

    // §5 rule 4: disabled, not hidden — the card itself is still there.
    expect(screen.getByText(/member invoices/i)).toBeInTheDocument();

    // And the dialog must not open onto a doomed action.
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ties the disabled trigger to its explanation for screen readers", () => {
    setChapter("incomplete");
    render(<InvoiceAdminCard />);

    const describedBy = trigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("blocks paid-ops invoicing immediately on past_due, grace or not", () => {
    setChapter("past_due", new Date().toISOString());
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at support rather than a checkout it cannot use", () => {
    setChapter("canceled");
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText(/contact support/i)).toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of its own
    // billing screen; the server guard is still the enforcement.
    mockCurrentChapter.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    render(<InvoiceAdminCard />);

    expect(trigger()).toBeEnabled();
  });
});
