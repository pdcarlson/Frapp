import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
const BYLAWS = {
  id: "doc-1",
  chapter_id: "chap-1",
  title: "Chapter bylaws",
  description: null,
  folder: "Governance",
  storage_path: "chap-1/bylaws.pdf",
  uploaded_by: "u-1",
  created_at: "2026-08-01T00:00:00Z",
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useDocuments: () => ({
    data: [BYLAWS],
    isPending: false,
    isError: false,
  }),
  useDocument: () => ({ refetch: vi.fn() }),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmDocumentUpload: () => ({ mutateAsync: vi.fn() }),
  useDeleteDocument: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { DocumentsPage } = await import("./documents-page");

const chapter = chapterSubscription(mockCurrentChapter);

const uploadTrigger = () =>
  screen.getByRole("button", { name: /upload document/i });
const deleteButton = () =>
  screen.getByRole("button", { name: /delete chapter bylaws/i });
const downloadButton = () => screen.getByRole("button", { name: /download/i });

describe("DocumentsPage subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves every document write alone on an active chapter", () => {
    chapter.active();
    render(<DocumentsPage />);

    expect(uploadTrigger()).toBeEnabled();
    expect(deleteButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the upload trigger and names blocker plus recovery when incomplete", async () => {
    chapter.incomplete();
    render(<DocumentsPage />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");

    // §5 rule 4: disabled, not hidden — the library itself is still there.
    expect(screen.getByText(/chapter bylaws/i)).toBeInTheDocument();

    // And the dialog must not open onto an upload the API will reject.
    await userEvent.click(uploadTrigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gates the per-row delete too, not just upload", () => {
    // DELETE /v1/documents/:id sits behind the same guard, so leaving it live
    // would have the page claim writes are blocked while still offering one
    // per row.
    chapter.incomplete();
    render(<DocumentsPage />);

    expect(deleteButton()).toBeDisabled();
  });

  it("ties every disabled control to the one explanation", () => {
    chapter.incomplete();
    render(<DocumentsPage />);

    const describedBy = uploadTrigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(deleteButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("never gates reading the library", () => {
    // `enforceSubscription` returns early for GET, so downloads and the folder
    // filters keep working for a lapsed chapter.
    chapter.incomplete();
    render(<DocumentsPage />);

    expect(downloadButton()).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /all files/i }),
    ).toBeEnabled();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate exists to prevent.
    chapter.loading();
    render(<DocumentsPage />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
  });

  it("blocks paid-ops document writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<DocumentsPage />);

    expect(uploadTrigger()).toBeDisabled();
    expect(deleteButton()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than at checkout", () => {
    chapter.canceled();
    render(<DocumentsPage />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of its own
    // document library; the server guard is still the enforcement.
    chapter.unreadable();
    render(<DocumentsPage />);

    expect(uploadTrigger()).toBeEnabled();
    expect(deleteButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes an already-open upload dialog when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close request, so a background
    // refetch that revokes the write cannot be caught there — otherwise the
    // member finishes a form guaranteed to 403.
    chapter.active();
    const { rerender } = render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.incomplete();
    rerender(<DocumentsPage />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(uploadTrigger()).toBeDisabled();
  });

  it("keeps the submit's own file guard intact behind the gate", async () => {
    // The gate ORs in the caller's conditions rather than replacing them: an
    // active chapter with no file attached still cannot submit.
    chapter.active();
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: /^upload$/i })).toBeDisabled();
  });
});

describe("DocumentsPage upload allowlist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists .gif and legacy Office extensions on the file input", async () => {
    chapter.active();
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const input = within(screen.getByRole("dialog")).getByLabelText(/^file$/i);
    const accept = input.getAttribute("accept") ?? "";
    expect(accept.split(",")).toContain(".gif");
    expect(accept.split(",")).toContain(".doc");
    expect(accept.split(",")).toContain(".xls");
    expect(accept.split(",")).toContain(".ppt");
  });
});
