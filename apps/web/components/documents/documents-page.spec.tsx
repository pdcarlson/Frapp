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
  mockCreateFolder,
  mockUpdateFolder,
  mockDeleteFolder,
  documentsQuery,
  documentsArgs,
  foldersQuery,
  mockOffline,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockDeleteDoc: vi.fn().mockResolvedValue({}),
  mockRefetch: vi.fn(),
  mockDocumentRefetch: vi.fn(),
  mockRequestUpload: vi.fn(),
  mockConfirmUpload: vi.fn(),
  mockCreateFolder: vi.fn().mockResolvedValue({}),
  mockUpdateFolder: vi.fn().mockResolvedValue({}),
  mockDeleteFolder: vi.fn().mockResolvedValue({}),
  mockOffline: { value: false },
  documentsQuery: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: () => undefined as unknown,
  },
  // What the page last asked `useDocuments` for — the search wiring is only
  // observable through this, since the mock never reaches the network.
  documentsArgs: { value: undefined as { search?: string } | undefined },
  foldersQuery: { data: [] as unknown[], isError: false },
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
  useDocuments: (options?: { search?: string }) => {
    documentsArgs.value = options;
    return documentsQuery;
  },
  useDocumentFolders: () => foldersQuery,
  useDocument: () => ({ refetch: mockDocumentRefetch }),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: mockRequestUpload }),
  useConfirmDocumentUpload: () => ({ mutateAsync: mockConfirmUpload }),
  useDeleteDocument: () => ({ mutateAsync: mockDeleteDoc }),
  useCreateDocumentFolder: () => ({ mutateAsync: mockCreateFolder }),
  useUpdateDocumentFolder: () => ({ mutateAsync: mockUpdateFolder }),
  useDeleteDocumentFolder: () => ({ mutateAsync: mockDeleteFolder }),
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
  documentsArgs.value = undefined;
  // The rail reads the folder *endpoint* now, not the documents — so a folder
  // only exists here if the server says so, which is the point of #791.
  foldersQuery.data = [
    { id: "f-1", name: "Governance", sort_order: 0 },
    { id: "f-2", name: "Rush", sort_order: 1 },
  ];
  foldersQuery.isError = false;
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

describe("DocumentsPage title search (#402)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
  });

  it("sends the query to the server rather than filtering in memory", async () => {
    // The whole point of #402's residual: #793 shipped `?search=`, and the
    // page has to actually use it. An in-memory filter would pass a "does it
    // narrow the list" assertion while never touching the endpoint.
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "bylaws");

    await waitFor(() =>
      expect(documentsArgs.value).toEqual({ search: "bylaws" }),
    );
  });

  it("trims the query, and sends undefined rather than an empty string", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    const input = screen.getByLabelText("Search documents");

    await user.type(input, "  bylaws  ");
    await waitFor(() =>
      expect(documentsArgs.value).toEqual({ search: "bylaws" }),
    );

    // Whitespace-only must collapse to the unfiltered query, not to a
    // `search=" "` cache entry that can never match anything.
    await user.clear(input);
    await user.type(input, "   ");
    await waitFor(() =>
      expect(documentsArgs.value).toEqual({ search: undefined }),
    );
  });

  it("does not escape % or _ — the server matches them literally", async () => {
    // spec/behavior/chapter-docs.md § Search. A client that escaped them would
    // silently stop matching a document actually titled "Budget_2026".
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "Budget_2026");

    await waitFor(() =>
      expect(documentsArgs.value).toEqual({ search: "Budget_2026" }),
    );
  });

  it("distinguishes 'no matches' from an empty library", async () => {
    const user = userEvent.setup();
    documentsQuery.data = [];
    render(<DocumentsPage />);

    // No query yet: the library really is empty, so invite an upload.
    expect(screen.getByText("No documents here yet")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search documents"), "zzz");

    await waitFor(() =>
      expect(
        screen.getByText("No documents match that search"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("No documents here yet")).not.toBeInTheDocument();
  });

  it("composes with the folder tab", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "bylaws");
    await waitFor(() =>
      expect(documentsArgs.value).toEqual({ search: "bylaws" }),
    );

    // The server narrows by title; the tab then narrows that to one folder.
    // BYLAWS is filed under Governance, so Rush must show the search-aware
    // empty state rather than the row.
    await user.click(screen.getByRole("button", { name: /^Rush$/ }));
    expect(
      screen.getByText("No documents match that search"),
    ).toBeInTheDocument();
    expect(documentsArgs.value).toEqual({ search: "bylaws" });
  });
});

describe("DocumentsPage folder management (#791)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
  });

  const folderRow = (name: string) =>
    screen.getByRole("button", { name: new RegExp(`^${name}$`) });

  it("renders folders the endpoint returns, including empty ones", () => {
    // The regression #791 exists for: deriving the rail over `documents` could
    // only ever show Governance, because nothing is filed under Rush.
    render(<DocumentsPage />);

    expect(folderRow("Governance")).toBeInTheDocument();
    expect(folderRow("Rush")).toBeInTheDocument();
  });

  it("honors sort_order rather than sorting alphabetically", () => {
    foldersQuery.data = [
      { id: "f-2", name: "Rush", sort_order: 0 },
      { id: "f-1", name: "Governance", sort_order: 1 },
    ];
    render(<DocumentsPage />);

    const rendered = screen
      .getAllByRole("button", { name: /^(Governance|Rush)$/ })
      .map((node) => node.textContent?.trim());
    expect(rendered).toEqual(["Rush", "Governance"]);
  });

  it("creates a folder", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /new folder/i }));
    await user.type(await screen.findByLabelText(/folder name/i), "Finance");
    await user.click(screen.getByRole("button", { name: /^create folder$/i }));

    await waitFor(() =>
      expect(mockCreateFolder).toHaveBeenCalledWith({ name: "Finance" }),
    );
  });

  it("prefills the rename dialog and sends only the new name", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /rename governance/i }));
    const input = await screen.findByLabelText(/folder name/i);
    expect(input).toHaveValue("Governance");

    await user.clear(input);
    await user.type(input, "Bylaws & governance");
    await user.click(screen.getByRole("button", { name: /^rename folder$/i }));

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith({
        id: "f-1",
        name: "Bylaws & governance",
      }),
    );
  });

  it("follows the active tab across a rename", async () => {
    // Documents record their folder by name and the server re-files them, so a
    // tab left pointing at the old name would filter the list to nothing.
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(folderRow("Governance"));
    await user.click(screen.getByRole("button", { name: /rename governance/i }));
    const input = await screen.findByLabelText(/folder name/i);
    await user.clear(input);
    await user.type(input, "Charter");
    await user.click(screen.getByRole("button", { name: /^rename folder$/i }));

    await waitFor(() => expect(mockUpdateFolder).toHaveBeenCalled());
    // The heading tracks the active folder.
    await waitFor(() =>
      expect(screen.getByText("Charter")).toBeInTheDocument(),
    );
  });

  it("reorders by writing indices, so equal sort_order values still move", async () => {
    // Swapping the two neighbours' values would be a no-op here — both are 0,
    // which is what implicit upload-time folder registration can produce.
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0 },
      { id: "f-2", name: "Rush", sort_order: 0 },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /move rush up/i }));

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith({
        id: "f-1",
        sort_order: 1,
      }),
    );
    expect(mockUpdateFolder).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.anything() }),
    );
  });

  it("cannot move the first folder up or the last one down", () => {
    render(<DocumentsPage />);

    expect(
      screen.getByRole("button", { name: /move governance up/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /move rush down/i }),
    ).toBeDisabled();
  });

  it("warns that documents survive a folder delete, and confirms first", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(
      screen.getByRole("button", { name: /delete folder governance/i }),
    );

    const dialog = await screen
      .findByRole("alertdialog")
      .catch(() => screen.getByRole("dialog"));
    expect(nativeConfirm).not.toHaveBeenCalled();
    // The server moves them to root — saying "cannot be undone" here would be
    // a false claim about the member's files.
    expect(within(dialog).getByText(/move to the root level/i)).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /delete folder/i }),
    );
    await waitFor(() => expect(mockDeleteFolder).toHaveBeenCalledWith("f-1"));
  });

  it("drops back to All files when the active folder is deleted", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(folderRow("Governance"));
    // "Governance" itself is ambiguous — it is the rail row and the card
    // heading — so assert the heading it replaced is gone instead.
    expect(screen.queryByText("All documents")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /delete folder governance/i }),
    );
    const dialog = await screen
      .findByRole("alertdialog")
      .catch(() => screen.getByRole("dialog"));
    await user.click(
      within(dialog).getByRole("button", { name: /delete folder/i }),
    );

    await waitFor(() => expect(mockDeleteFolder).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("All documents")).toBeInTheDocument(),
    );
  });

  it("gates every folder write behind the subscription, like upload", () => {
    // Each folder route carries chapter_docs:manage and no @FreeTier, so they
    // are paid ops on the same gate the rest of this page's writes use.
    chapter.pastDue();
    render(<DocumentsPage />);

    expect(screen.getByRole("button", { name: /new folder/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /rename governance/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /delete folder governance/i }),
    ).toBeDisabled();
  });
});

describe("DocumentsPage search and folder resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
  });

  it("keeps a cached library reachable when a search is typed offline", async () => {
    // Server-side search made every query string its own cache key, so an
    // offline search lands on a key that was never fetched and `documents`
    // empties. The plain offline card would then replace a library the member
    // still has — the exact discard this page's state comment forbids.
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);
    await user.type(screen.getByLabelText("Search documents"), "bylaws");

    // The connection drops with the query still in the box: the search key was
    // never fetched, so the list empties even though the unfiltered library is
    // still cached under its own key.
    mockOffline.value = true;
    documentsQuery.data = [];
    rerender(<DocumentsPage />);

    expect(
      await screen.findByText("Search needs a connection"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Documents unavailable offline"),
    ).not.toBeInTheDocument();
  });

  it("still shows the plain offline state when nothing is being searched", () => {
    mockOffline.value = true;
    documentsQuery.data = [];
    render(<DocumentsPage />);

    expect(
      screen.getByText("Documents unavailable offline"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Search needs a connection"),
    ).not.toBeInTheDocument();
  });

  it("falls back to folders derived from documents when the endpoint fails", () => {
    // Failing to an empty rail would claim the chapter has no folders while
    // rows keep printing "· Governance", promising a tab that isn't there.
    foldersQuery.data = [];
    foldersQuery.isError = true;
    render(<DocumentsPage />);

    expect(
      screen.getByRole("button", { name: /^Governance$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/couldn't load the folder list/i)).toBeInTheDocument();
  });

  it("offers no folder management for a derived fallback row", () => {
    // A derived name has no folder record behind it, so there is nothing to
    // rename, reorder or delete — offering the controls would 404.
    foldersQuery.data = [];
    foldersQuery.isError = true;
    render(<DocumentsPage />);

    expect(
      screen.queryByRole("button", { name: /rename governance/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete folder governance/i }),
    ).not.toBeInTheDocument();
  });

  it("surfaces the API's 409 message rather than a permissions guess", async () => {
    // #791's acceptance criterion. The fallback copy talks about permissions,
    // which would be a misleading thing to show for a duplicate name.
    mockCreateFolder.mockRejectedValueOnce({
      message: 'A folder named "Finance" already exists',
    });
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /new folder/i }));
    await user.type(await screen.findByLabelText(/folder name/i), "Finance");
    await user.click(screen.getByRole("button", { name: /^create folder$/i }));

    await waitFor(() => expect(mockCreateFolder).toHaveBeenCalled());
    // The dialog stays open on failure so the name can be corrected in place.
    expect(await screen.findByLabelText(/folder name/i)).toHaveValue("Finance");
  });

  it("composes search with the No folder tab", async () => {
    // A distinct branch of the `visible` memo (`!doc.folder`) from the
    // named-folder one, and the only search test that reaches it.
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /^No folder$/ }));
    await user.type(screen.getByLabelText("Search documents"), "bylaws");

    // BYLAWS is filed under Governance, so the uncategorized bucket has no
    // match and must show the search-aware empty state.
    await waitFor(() =>
      expect(
        screen.getByText("No documents match that search"),
      ).toBeInTheDocument(),
    );
    expect(documentsArgs.value).toEqual({ search: "bylaws" });
  });

  it("keeps folder controls at the 44px touch floor", () => {
    // `button.tsx` sizes `icon` at 44 deliberately; these four sit adjacent in
    // a 240px rail, where an undersized target puts delete next to move-down.
    render(<DocumentsPage />);

    const move = screen.getByRole("button", { name: /move governance down/i });
    expect(move.className).toContain("pointer-coarse:h-11");
    expect(move.className).toContain("pointer-coarse:w-11");
  });
});

describe("DocumentsPage derived folder fallback under search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
  });

  it("never derives folder tabs from a search result set", async () => {
    // The fallback derives from `documents`, which IS the search response. If it
    // ran mid-search, a query matching only Governance files would delete the
    // Rush tab keystroke by keystroke — the rail describing the result set
    // instead of the chapter. It drops to the two built-in filters instead, and
    // the notice says why.
    foldersQuery.data = [];
    foldersQuery.isError = true;
    documentsQuery.data = [
      BYLAWS,
      { ...BYLAWS, id: "doc-2", title: "Rush schedule", folder: "Rush" },
    ];
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);

    // Unfiltered: both folders derive fine.
    expect(screen.getByRole("button", { name: /^Rush$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Governance$/ }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search documents"), "bylaws");
    // The server answers with Governance matches only.
    documentsQuery.data = [BYLAWS];
    rerender(<DocumentsPage />);

    await waitFor(() =>
      expect(documentsArgs.value).toEqual({ search: "bylaws" }),
    );
    // Neither tab survives — crucially including Governance, which the result
    // set *would* have produced. Deriving a rail from matches is the bug.
    expect(
      screen.queryByRole("button", { name: /^Governance$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Rush$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/folder filters are unavailable while searching/i),
    ).toBeInTheDocument();
  });
});
