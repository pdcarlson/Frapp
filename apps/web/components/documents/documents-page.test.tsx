import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";
import { networkMock } from "@/tests/network";

const {
  mockCurrentChapter,
  mockDeleteDoc,
  mockRefetch,
  mockDocumentRefetch,
  mockRequestUpload,
  mockConfirmUpload,
  documentsQuery,
  mockOffline,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockDeleteDoc: vi.fn().mockResolvedValue({}),
  mockRefetch: vi.fn(),
  mockDocumentRefetch: vi.fn(),
  mockRequestUpload: vi.fn(),
  mockConfirmUpload: vi.fn(),
  mockOffline: { value: false },
  documentsQuery: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: () => undefined as unknown,
  },
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

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => mockCurrentChapter(),
  useDocuments: () => documentsQuery,
  useDocument: () => ({ refetch: mockDocumentRefetch }),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: mockRequestUpload }),
  useConfirmDocumentUpload: () => ({ mutateAsync: mockConfirmUpload }),
  useDeleteDocument: () => ({ mutateAsync: mockDeleteDoc }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

const { DocumentsPage } = await import("./documents-page");

const chapter = chapterSubscription(mockCurrentChapter);

function resolvedDocumentsQuery() {
  documentsQuery.data = [BYLAWS];
  documentsQuery.isPending = false;
  documentsQuery.isError = false;
  documentsQuery.refetch = mockRefetch;
}

const uploadTrigger = () =>
  screen.getByRole("button", { name: /upload document/i });
const deleteButton = () =>
  screen.getByRole("button", { name: /delete chapter bylaws/i });
const downloadButton = () => screen.getByRole("button", { name: /download/i });

describe("DocumentsPage subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
  });

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

  // #1040: the call site read `download_url` while the API returns
  // `downloadUrl`, so this opened `undefined`. Nothing typed catches it — the
  // endpoint has no OpenAPI response schema, so the SDK types the body as
  // `never` and any property access compiles.
  it("opens the signed URL the API actually returns", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mockDocumentRefetch.mockResolvedValue({
      data: { ...BYLAWS, downloadUrl: "https://signed/bylaws.pdf" },
    });
    chapter.active();
    render(<DocumentsPage />);

    // `finally`, so a failed assertion cannot leak the spy into later tests —
    // vitest.config.ts sets no `restoreMocks`.
    try {
      await user.click(downloadButton());

      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(
          "https://signed/bylaws.pdf",
          "_blank",
          "noopener",
        ),
      );
    } finally {
      open.mockRestore();
    }
  });

  it("never gates reading the library", () => {
    // `enforceSubscription` returns early for GET, so downloads and the folder
    // filters keep working for a lapsed chapter.
    chapter.incomplete();
    render(<DocumentsPage />);

    expect(downloadButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: /all files/i })).toBeEnabled();
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

describe("DocumentsPage upload metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
    mockRequestUpload.mockResolvedValue({
      upload_url: "https://storage.example/put",
      storage_path: "chapters/chap-1/documents/doc-1/bylaws.pdf",
    });
    mockConfirmUpload.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends content type, size, document type and effective date on confirm", async () => {
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/title/i), "Bylaws 2026");
    await userEvent.type(
      within(dialog).getByLabelText(/document type/i),
      "Bylaws",
    );
    fireEvent.change(within(dialog).getByLabelText(/effective date/i), {
      target: { value: "2026-01-01" },
    });

    const file = new File(["%PDF-1.4"], "bylaws.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: { files: [file] },
    });

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        content_type: "application/pdf",
        byte_size: file.size,
        document_type: "Bylaws",
        effective_date: "2026-01-01",
      }),
    );
  });

  it("omits document type and effective date when left blank", async () => {
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/title/i), "Agenda");

    const file = new File(["%PDF-1.4"], "agenda.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: { files: [file] },
    });

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        document_type: undefined,
        effective_date: undefined,
      }),
    );
  });
});

describe("DocumentsPage state ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
  });

  it("keeps an open upload dialog mounted when the list query fails under it", async () => {
    // The defect: `isError` was an early return above the whole tree, so a
    // background refetch failure unmounted `DialogContent` mid-draft and
    // discarded whatever had been typed. `subscription-gate.tsx` names this
    // hazard for `useGatedDialog` by hand; nothing asserted it.
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);

    await user.click(uploadTrigger());
    const title = await screen.findByLabelText(/title/i);
    await user.type(title, "Retreat agenda");

    documentsQuery.isError = true;
    documentsQuery.data = [];
    rerender(<DocumentsPage />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue("Retreat agenda");
    // And the failure is still reported — in the list, where it belongs.
    expect(screen.getByText(/couldn't load documents/i)).toBeInTheDocument();
  });

  it("offers a retry when offline rather than a spinner that cannot resolve", () => {
    // `useDocuments` has no `enabled` gate, so a paused query keeps
    // `isPending` true — an offline member sat on the loading copy forever.
    mockOffline.value = true;
    documentsQuery.isPending = true;
    documentsQuery.data = [];

    render(<DocumentsPage />);

    expect(
      screen.getByText(/documents unavailable offline/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Loading chapter documents..."),
    ).not.toBeInTheDocument();
  });

  it("announces the load, which moving to the nested state family nearly cost", () => {
    // `NestedLoading` omits `role="status"` by default, because it was written
    // for pages that also render a top-level `LoadingState`. This page does
    // not — the nested state is its only state — so without `announce` a
    // screen-reader user opening it mid-load hears nothing at all.
    documentsQuery.isPending = true;
    documentsQuery.data = [];

    render(<DocumentsPage />);

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Loading chapter documents...");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("keeps a loaded library readable when the connection drops", () => {
    // TanStack does not clear `data` when the link goes; README §4 scopes the
    // offline state to "no cached data" and §10 keeps stale content in place.
    // An unconditional `isOffline` branch threw away a list the member could
    // still read, on a WiFi blip. The shell's OfflineBanner states the
    // connection on every route, so the screen owes no state here.
    mockOffline.value = true;

    render(<DocumentsPage />);

    expect(screen.getByText("Chapter bylaws")).toBeInTheDocument();
    expect(
      screen.queryByText(/documents unavailable offline/i),
    ).not.toBeInTheDocument();
  });

  it("still lets a member reach the upload dialog while the list is loading", () => {
    documentsQuery.isPending = true;
    documentsQuery.data = [];

    render(<DocumentsPage />);

    expect(uploadTrigger()).toBeInTheDocument();
    expect(
      screen.getByText("Loading chapter documents..."),
    ).toBeInTheDocument();
  });
});

describe("DocumentsPage delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
  });

  it("confirms through the in-product dialog, never window.confirm", async () => {
    // README §2's ban binds "Every surface" (#1198). §9 also requires the
    // confirm button to name its action rather than say "Confirm".
    const nativeConfirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(deleteButton());

    const dialog = await screen
      .findByRole("alertdialog")
      .catch(() => screen.getByRole("dialog"));
    expect(
      within(dialog).getByRole("button", { name: /delete document/i }),
    ).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: /delete document/i }),
    );
    await waitFor(() => expect(mockDeleteDoc).toHaveBeenCalledWith("doc-1"));
  });

  it("does not delete when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(deleteButton());
    const dialog = await screen
      .findByRole("alertdialog")
      .catch(() => screen.getByRole("dialog"));
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});
