import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { localIsoDate } from "@repo/formatting";
import { chapterSubscription } from "@/tests/chapter-subscription";
import { networkMock } from "@/tests/network";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { folderOpenStorageKey } from "@/components/documents/use-folder-open";

const {
  mockCurrentChapter,
  mockDeleteDoc,
  mockRefetch,
  mockFolderRefetch,
  mockSignedLinks,
  mockRequestUpload,
  mockConfirmUpload,
  mockToast,
  mockCreateFolder,
  mockUpdateFolder,
  mockDeleteFolder,
  documentsQuery,
  documentsArgs,
  foldersQuery,
  mockOffline,
  canGate,
  roster,
  stars,
  mockStarsRefetch,
  mockSetStar,
  mockSetPin,
  typesQuery,
  manageGate,
  mockUpdateType,
  accessQuery,
  mockSetAccess,
} = vi.hoisted(() => ({
  // Who can see (#3642 piece 1): unread by default, so no field shows and
  // every write sends what it did before lists existed.
  accessQuery: {
    data: undefined as
      | { options: unknown[]; always: string[] | null }
      | undefined,
    isSuccess: false,
    isError: false,
  },
  mockSetAccess: vi.fn().mockResolvedValue({}),
  // The chapter's document types (#3642). Unread by default, so the panel
  // falls back to the common types plus the library's own, as before.
  typesQuery: { data: undefined as unknown[] | undefined, isSuccess: false },
  // Whether the viewer also holds `chapter_docs:manage` ("Edit types").
  manageGate: { granted: false },
  stars: {
    value: { folder_ids: [] as string[], document_ids: [] as string[] },
    failed: false,
  },
  mockStarsRefetch: vi.fn(),
  mockSetStar: vi.fn().mockResolvedValue(undefined),
  mockSetPin: vi.fn().mockResolvedValue(undefined),
  mockUpdateType: vi.fn().mockResolvedValue({}),
  mockCurrentChapter: vi.fn(),
  mockDeleteDoc: vi.fn().mockResolvedValue({}),
  mockRefetch: vi.fn(),
  mockFolderRefetch: vi.fn(),
  mockSignedLinks: vi.fn(),
  mockRequestUpload: vi.fn(),
  mockConfirmUpload: vi.fn(),
  mockToast: vi.fn(),
  mockCreateFolder: vi.fn().mockResolvedValue({}),
  mockUpdateFolder: vi.fn().mockResolvedValue({}),
  mockDeleteFolder: vi.fn().mockResolvedValue({}),
  mockOffline: { value: false },
  // Whether the mocked `Can` renders its children. Only the gate-remount test
  // flips it; everything else sees a pass-through.
  canGate: { granted: true },
  // The chapter roster's names, which a test may change to drop someone.
  roster: {
    names: { "u-1": "Marcus Ellison", "u-2": "Ryan Castellano" } as Record<string, string>,
  },
  documentsQuery: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: () => undefined as unknown,
  },
  // What the page last asked `useDocuments` for — the search wiring is only
  // observable through this, since the mock never reaches the network.
  documentsArgs: { value: undefined as { search?: string } | undefined },
  foldersQuery: {
    data: [] as unknown[],
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


// Drive's status (#5157), for the Upload menu's Drive item (#5576).
const mockDriveStatus = vi.hoisted(() =>
  vi.fn<(options?: { enabled?: boolean }) => { data: unknown }>(() => ({
    data: undefined,
  })),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => mockCurrentChapter(),
  useViewerUserId: () => "viewer-1",
  useMyPermissions: () => ({
    data: {
      permissions: [
        ...(canGate.granted ? ["chapter_docs:upload"] : []),
        ...(manageGate.granted ? ["chapter_docs:manage"] : []),
      ],
    },
  }),
  useDocuments: (options?: { search?: string }) => {
    // The upload panel's unsearched library read passes no options; only the
    // page's own list call carries the search being asserted on.
    if (options) documentsArgs.value = options;
    return documentsQuery;
  },
  useDocumentFolders: () => foldersQuery,
  useDocumentTypes: () => typesQuery,
  useCreateDocumentType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDocumentType: () => ({ mutateAsync: mockUpdateType, isPending: false }),
  useDeleteDocumentType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // The folder import's batch routes (#2242); its own spec covers them.
  useRequestDocumentUploadUrls: () => ({ mutateAsync: vi.fn() }),
  useConfirmDocumentUploads: () => ({ mutateAsync: vi.fn() }),
  useInvalidateDocuments: () => vi.fn(),
  // The Google Drive folder (#5157); `drive-folder-panel.spec.tsx` covers it.
  useGoogleDriveStatus: (options?: { enabled?: boolean }) =>
    mockDriveStatus(options),
  useConnectGoogleDrive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSyncGoogleDrive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisconnectGoogleDrive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOpenUpDriveCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSemesters: () => ({ data: [{ end_date: "2026-07-31" }] }),
  useMemberDisplayNames: () => ({ byId: roster.names }),
  useDocumentDownloadUrl: () => ({ mutateAsync: mockSignedLinks }),
  // The viewer's read of the signed links; never settles here, so an open
  // viewer shows its loading page. `document-viewer.spec.tsx` covers the rest.
  useDocument: () => ({
    data: undefined,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: mockRequestUpload }),
  useConfirmDocumentUpload: () => ({ mutateAsync: mockConfirmUpload }),
  useDeleteDocument: () => ({ mutateAsync: mockDeleteDoc }),
  useCreateDocumentFolder: () => ({ mutateAsync: mockCreateFolder }),
  useUpdateDocumentFolder: () => ({ mutateAsync: mockUpdateFolder }),
  useDeleteDocumentFolder: () => ({ mutateAsync: mockDeleteFolder }),
  useDocumentStars: () => ({
    data: stars.failed ? undefined : stars.value,
    isError: stars.failed,
    refetch: mockStarsRefetch,
  }),
  useSetDocumentStar: () => ({ mutateAsync: mockSetStar }),
  useSetDocumentPin: () => ({ mutateAsync: mockSetPin, isPending: false }),
  useDocumentAccessOptions: () => accessQuery,
  useSetDocumentAccess: () => ({ mutateAsync: mockSetAccess, isPending: false }),
}));

// `/documents?document=<id>`: what a source cited by Ask links to.
const linkedDocument = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      linkedDocument.current ? { document: linkedDocument.current } : {},
    ),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({
    children,
    deniedFallback,
  }: {
    children: React.ReactNode;
    deniedFallback?: React.ReactNode;
  }) => (canGate.granted ? <>{children}</> : <>{deniedFallback ?? null}</>),
}));

// The folder import (#2242) reads the auth account it began under.
vi.mock("@/lib/auth/use-auth-user-id", () => ({ useAuthUserId: () => "auth-1" }));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

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
  foldersQuery.refetch = mockFolderRefetch;
  stars.value = { folder_ids: [], document_ids: [] };
  stars.failed = false;
  typesQuery.data = undefined;
  typesQuery.isSuccess = false;
  manageGate.granted = false;
  accessQuery.data = undefined;
  accessQuery.isSuccess = false;
  accessQuery.isError = false;
}

const uploadTrigger = () =>
  screen.getByRole("button", { name: /upload document/i });
const deleteButton = () =>
  screen.getByRole("button", { name: /delete chapter bylaws/i });
const downloadButton = () => screen.getByRole("button", { name: /download/i });

/**
 * A control in the Filters menu (#5576): opens the menu first when it is
 * closed (a click elsewhere on the page closes it), then finds the control.
 */
async function filterButton(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  if (!screen.queryByRole("button", { name })) {
    await user.click(screen.getByRole("button", { name: /^Filters/ }));
  }
  return screen.findByRole("button", { name });
}

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
    ).toHaveAttribute("href", "/settings?tab=billing");

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
  //
  // A server from before #3849 sends no `forcedDownloadUrl`, so Download falls
  // back to opening the inline link. `document-viewer.spec.tsx` covers the
  // forced link.
  it("opens the signed URL the API actually returns", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mockSignedLinks.mockResolvedValue({
      ...BYLAWS,
      downloadUrl: "https://signed/bylaws.pdf",
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

  // components.md § Icon-only actions: Download and Delete are glyphs, named
  // for the document, with the name as the tooltip.
  it("draws the row's download and delete as icons named for the document", () => {
    chapter.active();
    render(<DocumentsPage />);

    for (const name of ["Download Chapter bylaws", "Delete Chapter bylaws"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("title", name);
      expect(button.textContent).toBe("");
    }
  });

  // #3849: the row's name opens the document full screen, without a request
  // for the download link.
  it("opens a document in the viewer when its row is clicked", async () => {
    const user = userEvent.setup();
    chapter.active();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /^Chapter bylaws/ }));

    const viewer = await screen.findByRole("dialog", { name: "Chapter bylaws" });
    expect(within(viewer).getByRole("button", { name: "Download" })).toBeVisible();
    expect(mockSignedLinks).not.toHaveBeenCalled();

    await user.click(within(viewer).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  // #451: a source cited by Ask opens its file, and the link is spent so
  // closing the viewer does not reopen it.
  it("opens the document a link names, and takes it out of the address", async () => {
    chapter.active();
    linkedDocument.current = "doc-1";
    const replaceState = vi.spyOn(window.history, "replaceState");
    try {
      render(<DocumentsPage />);
      expect(
        await screen.findByRole("dialog", { name: "Chapter bylaws" }),
      ).toBeVisible();
      expect(replaceState).toHaveBeenCalledWith(null, "", window.location.pathname);
    } finally {
      linkedDocument.current = null;
      replaceState.mockRestore();
    }
  });

  it("opens nothing for a link to a document the member cannot see", () => {
    chapter.active();
    linkedDocument.current = "doc-gone";
    try {
      render(<DocumentsPage />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      linkedDocument.current = null;
    }
  });

  it("never gates reading the library", () => {
    // `enforceSubscription` returns early for GET, so downloads and the folder
    // filters keep working for a lapsed chapter.
    chapter.incomplete();
    render(<DocumentsPage />);

    expect(downloadButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: /^all files/i })).toBeEnabled();
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

  it("opens Upload docked in place of the page beside chat, and hands focus back to Upload (#4593)", async () => {
    chapter.active();
    render(
      <div data-tool-column="">
        <div data-tool-page="">
          <DocumentsPage />
        </div>
      </div>,
    );
    // A pointer press that leaves the button unfocused, as Safari's does.
    fireEvent.pointerDown(uploadTrigger());
    const trigger = uploadTrigger();
    fireEvent.click(trigger);
    // Covered by the panel: hidden, and not focused.
    expect(trigger).not.toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Upload document" });
    expect(region.parentElement).toHaveAttribute("data-tool-column");

    await userEvent.click(
      screen.getByRole("button", { name: "Back to documents" }),
    );
    expect(
      screen.queryByRole("region", { name: "Upload document" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(uploadTrigger()).toHaveFocus());
  });

  it("reopens Upload on its draft when the page was left mid-form (#4593)", async () => {
    chapter.active();
    const tree = () => (
      <div data-tool-column="">
        <div data-tool-page="">
          <DocumentsPage />
        </div>
      </div>
    );
    const first = render(tree());
    await userEvent.click(uploadTrigger());
    await userEvent.type(screen.getByLabelText("Title"), "Bylaws 2026");
    // A nav link: the page goes, the form with it, no question asked.
    first.unmount();

    render(tree());
    const region = await screen.findByRole("region", {
      name: "Upload document",
    });
    expect(within(region).getByLabelText("Title")).toHaveValue("Bylaws 2026");
    expect(within(region).getByText("Draft restored")).toBeInTheDocument();
  });

  it("comes back to the page, not the form, after going back from it (#4593)", async () => {
    chapter.active();
    const tree = () => (
      <div data-tool-column="">
        <div data-tool-page="">
          <DocumentsPage />
        </div>
      </div>
    );
    const first = render(tree());
    await userEvent.click(uploadTrigger());
    await userEvent.type(screen.getByLabelText("Title"), "Bylaws 2026");
    await userEvent.click(
      screen.getByRole("button", { name: "Back to documents" }),
    );
    first.unmount();

    render(tree());
    expect(
      screen.queryByRole("region", { name: "Upload document" }),
    ).not.toBeInTheDocument();
    // Still kept: Upload opens on it, and says so.
    await userEvent.click(uploadTrigger());
    expect(screen.getByLabelText("Title")).toHaveValue("Bylaws 2026");
    expect(screen.getByText("Draft restored")).toBeInTheDocument();
  });

  it("keeps nothing for an Upload opened and left untouched (#4593)", async () => {
    chapter.active();
    const tree = () => (
      <div data-tool-column="">
        <div data-tool-page="">
          <DocumentsPage />
        </div>
      </div>
    );
    const first = render(tree());
    await userEvent.click(uploadTrigger());
    first.unmount();
    render(tree());
    expect(
      screen.queryByRole("region", { name: "Upload document" }),
    ).not.toBeInTheDocument();
    await userEvent.click(uploadTrigger());
    expect(screen.queryByText("Draft restored")).not.toBeInTheDocument();
  });

  it("drops the draft on Cancel (#4593)", async () => {
    chapter.active();
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());
    await userEvent.type(screen.getByLabelText("Title"), "Bylaws 2026");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(uploadTrigger());
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("sends focus to the notice, not Upload, when a lapse closes the docked form", async () => {
    chapter.active();
    const tree = () => (
      <div data-tool-column="">
        <div data-tool-page="">
          <DocumentsPage />
        </div>
      </div>
    );
    const { rerender } = render(tree());
    await userEvent.click(uploadTrigger());
    expect(
      screen.getByRole("region", { name: "Upload document" }),
    ).toBeInTheDocument();

    chapter.incomplete();
    rerender(tree());

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Upload document" }),
      ).not.toBeInTheDocument(),
    );
    expect(uploadTrigger()).not.toHaveFocus();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("leaves Upload enabled with no file and answers the press inline", async () => {
    /*
      This case reverses deliberately. It used to assert that Upload was
      DISABLED with no file attached, which was the page's own guard ORed into
      `gate.controlProps`. The framework board (`1j`) says "Upload stays
      enabled" and puts the rejection inline on the field instead — a disabled
      control with no explanation is the state a member cannot get out of,
      because nothing tells them which of six fields is the problem.

      What has to survive the reversal is that the press still cannot upload
      anything: no signed-URL ticket is requested.
    */
    chapter.active();
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = within(screen.getByRole("dialog"));
    const submit = dialog.getByRole("button", { name: /^upload$/i });
    expect(submit).toBeEnabled();

    await userEvent.click(submit);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      /choose a file to upload/i,
    );
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it("drops a spent inline error when the sheet is reopened after Cancel", async () => {
    /*
      Cancel calls `uploadDialog.setOpen(false)`, and `useGatedDialog`'s revoke
      effect calls its own `setOpenState(false)`. Radix runs the `open` prop
      through `useControllableState`, whose `onChange` fires only for Radix's
      own setter — so neither of those reaches `<Dialog onOpenChange>`, and an
      earlier draft of this lane cleared the error there. The rejection then
      survived a Cancel and greeted the next open. The clear moved to the OPEN
      edge, which every reopen goes through.
    */
    const user = userEvent.setup();
    chapter.active();
    render(<DocumentsPage />);

    await user.click(uploadTrigger());
    let dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: /^upload$/i }));
    expect(await dialog.findByRole("alert")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(uploadTrigger());
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the verdict, not just the rule, when a file is rejected", async () => {
    /*
      These two strings were toast BODIES, under a title that said "File too
      large" or "File type not allowed". Inline they are the whole error, so a
      bare "Chapter documents accept files up to 25MB." would state a rule
      without ever telling the member their file broke it. Nothing pinned the
      wording before, in either position.
    */
    const user = userEvent.setup();
    chapter.active();
    render(<DocumentsPage />);
    await user.click(uploadTrigger());

    const dialog = within(screen.getByRole("dialog"));
    const oversized = new File(["x"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 40 * 1024 * 1024 });
    await user.upload(dialog.getByLabelText(/^file$/i), oversized);
    await user.click(dialog.getByRole("button", { name: /^upload$/i }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(/too large/i);
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it("tells a member with a .zip to unzip it and import the folder (#5331)", async () => {
    // A dropped file skips the picker's filter, so the check is what answers.
    const user = userEvent.setup({ applyAccept: false });
    chapter.active();
    render(<DocumentsPage />);
    await user.click(uploadTrigger());

    const dialog = within(screen.getByRole("dialog"));
    const zipped = new File(["x"], "Chapter drive.zip", {
      type: "application/zip",
    });
    await user.upload(dialog.getByLabelText(/^file$/i), zipped);
    await user.click(dialog.getByRole("button", { name: /^upload$/i }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Zip files can't be uploaded. Unzip it and use Import a folder.",
    );
    expect(mockRequestUpload).not.toHaveBeenCalled();
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
    resolvedDocumentsQuery();
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

  const pickFile = (dialog: HTMLElement, name: string) => {
    const file = new File(["%PDF-1.4"], name, { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: { files: [file] },
    });
    return file;
  };

  it("offers the chapter's own types once they load (#3642)", async () => {
    typesQuery.data = [
      { id: "t-1", chapter_id: "chap-1", name: "By-Laws", sort_order: 1, created_at: "" },
      { id: "t-2", chapter_id: "chap-1", name: "Contract", sort_order: 2, created_at: "" },
    ];
    typesQuery.isSuccess = true;
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "fall-2026-bylaws-revision.pdf");

    // The file name's guess lands on the chapter's spelling, and the seeded
    // defaults the chapter deleted are gone.
    expect(within(dialog).getByRole("button", { name: "By-Laws" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Contract" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Minutes" })).toBeNull();
    // Editing the list is for document managers only.
    expect(within(dialog).queryByRole("button", { name: /edit types/i })).toBeNull();
  });

  it("shows Edit types to a document manager", async () => {
    typesQuery.data = [
      { id: "t-1", chapter_id: "chap-1", name: "Bylaws", sort_order: 1, created_at: "" },
    ];
    typesQuery.isSuccess = true;
    manageGate.granted = true;
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /edit types/i }));
    expect(await screen.findByText("Document types")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Bylaws" })).toBeInTheDocument();
  });

  it("renames a type from Edit types without starting an upload", async () => {
    typesQuery.data = [
      { id: "t-1", chapter_id: "chap-1", name: "Bylaws", sort_order: 1, created_at: "" },
    ];
    typesQuery.isSuccess = true;
    manageGate.granted = true;
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());
    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "bylaws.pdf");

    await userEvent.click(within(dialog).getByRole("button", { name: /edit types/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Rename Bylaws" }));
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "  Constitution {Enter}");

    await waitFor(() =>
      expect(mockUpdateType).toHaveBeenCalledWith({ id: "t-1", name: "Constitution" }),
    );
    // The inline form's submit stays inside the popover (it's portalled, but
    // React bubbles it up to the upload form around the trigger).
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it("lets go of a picked type that left the list rather than re-adding it", async () => {
    typesQuery.data = [
      { id: "t-1", chapter_id: "chap-1", name: "Bylaws", sort_order: 1, created_at: "" },
      { id: "t-2", chapter_id: "chap-1", name: "Minutes", sort_order: 2, created_at: "" },
    ];
    typesQuery.isSuccess = true;
    const { rerender } = render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());
    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "bylaws.pdf");
    expect(within(dialog).getByRole("button", { name: "Bylaws" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // An officer renames Bylaws elsewhere; the list refetches.
    typesQuery.data = [
      { id: "t-1", chapter_id: "chap-1", name: "Constitution", sort_order: 1, created_at: "" },
      { id: "t-2", chapter_id: "chap-1", name: "Minutes", sort_order: 2, created_at: "" },
    ];
    rerender(<DocumentsPage />);

    await waitFor(() =>
      expect(within(dialog).queryByLabelText("New type name")).toBeNull(),
    );
    for (const chip of ["Constitution", "Minutes"]) {
      expect(within(dialog).getByRole("button", { name: chip })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  it("fills title and type from the file name and sends them with the date", async () => {
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    const file = pickFile(dialog, "fall-2026-bylaws-revision.pdf");

    expect(within(dialog).getByLabelText(/title/i)).toHaveValue(
      "Fall 2026 bylaws revision",
    );
    expect(within(dialog).getByRole("button", { name: "Bylaws" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(within(dialog).getByLabelText(/effective date/i), {
      target: { value: "2026-01-01" },
    });

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Fall 2026 bylaws revision",
        content_type: "application/pdf",
        byte_size: file.size,
        document_type: "Bylaws",
        effective_date: "2026-01-01",
      }),
    );
  });

  it("sends who can see the file only when the uploader chose roles (#3642 piece 1)", async () => {
    accessQuery.data = {
      options: [
        {
          entry: "tier:t-exec",
          kind: "tier",
          id: "t-exec",
          name: "Executive board",
          color: null,
          tier_id: null,
          user_ids: ["u-1"],
        },
      ],
      always: ["tier:t-exec"],
    };
    accessQuery.isSuccess = true;
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "exec-minutes.pdf");
    // No folder picked, so the open choice reads Everyone.
    expect(
      within(dialog).getByRole("radio", { name: "Everyone" }),
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Chosen roles" }),
    );

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({ who_can_see: ["tier:t-exec"] }),
    );
  });

  it("starts the effective date on Today and omits a type nothing points at", async () => {
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "scan_0042.pdf");
    expect(within(dialog).getByLabelText(/effective date/i)).toHaveValue(
      "Today",
    );

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Scan 0042",
        document_type: undefined,
        effective_date: localIsoDate(new Date()),
      }),
    );
  });

  it("sends no effective date once the officer clears Today", async () => {
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "scan_0042.pdf");
    await userEvent.clear(within(dialog).getByLabelText(/effective date/i));

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({ effective_date: undefined }),
    );
  });

  it("keeps a typed title and a picked type when the file is replaced", async () => {
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "exec-minutes.pdf");
    const title = within(dialog).getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, "Exec minutes, Oct 12");
    await userEvent.click(within(dialog).getByRole("button", { name: "Policy" }));

    pickFile(dialog, "budget-final.pdf");

    expect(title).toHaveValue("Exec minutes, Oct 12");
    expect(within(dialog).getByRole("button", { name: "Policy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("files a fresh upload into the folder on screen", async () => {
    render(<DocumentsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^rush/i }));
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "rush-schedule.pdf");
    await userEvent.click(within(dialog).getByRole("button", { name: /^upload$/i }));

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "Rush" }),
    );
  });

  it("files a bylaws upload from All files into the folder that says Bylaws", async () => {
    foldersQuery.data = [
      { id: "f-1", name: "Bylaws & Governance", sort_order: 0 },
      { id: "f-2", name: "Rush", sort_order: 1 },
    ];
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "fall-2026-bylaws.pdf");
    await userEvent.click(within(dialog).getByRole("button", { name: /^upload$/i }));

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "Bylaws & Governance" }),
    );
  });

  it("re-files into the corrected type's folder when the guess was wrong", async () => {
    foldersQuery.data = [
      { id: "f-1", name: "Meeting Minutes", sort_order: 0 },
      { id: "f-2", name: "Finance", sort_order: 1 },
    ];
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    pickFile(dialog, "finance-committee-minutes.pdf");
    await userEvent.click(within(dialog).getByRole("button", { name: "Budget" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^upload$/i }));

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({ document_type: "Budget", folder: "Finance" }),
    );
  });

  it("opens the panel with a file dropped anywhere on the page", async () => {
    render(<DocumentsPage />);
    const file = new File(["%PDF-1.4"], "chapter-budget.pdf", {
      type: "application/pdf",
    });
    const dataTransfer = { types: ["Files"], files: [file] };

    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByText(/drop to upload/i)).toBeInTheDocument();
    fireEvent.drop(window, { dataTransfer });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("chapter-budget.pdf")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/title/i)).toHaveValue("Chapter budget");
    expect(within(dialog).getByRole("button", { name: "Budget" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  const uploadPdf = async (name: string) => {
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());
    const dialog = screen.getByRole("dialog");
    const file = new File(["%PDF-1.4"], name, { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: { files: [file] },
    });
    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    return file;
  };

  it("PUTs with the resolved type and x-upsert", async () => {
    const file = await uploadPdf("bylaws.pdf");

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("https://storage.example/put", {
      method: "PUT",
      body: file,
      headers: { "content-type": "application/pdf", "x-upsert": "true" },
    });
  });

  it("tells the member what to try when storage refuses the file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 413 } as Response),
    );

    await uploadPdf("bylaws.pdf");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't upload document",
          description: "That file is too large.",
        }),
      ),
    );
    expect(mockConfirmUpload).not.toHaveBeenCalled();
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
      screen.queryByText("Loading chapter documents"),
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
    expect(live).toHaveTextContent("Loading chapter documents");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("keeps a loaded library readable when the connection drops", () => {
    // TanStack does not clear `data` when the link goes; README §4 scopes the
    // offline state to "no cached data" and §10 keeps stale content in place.
    // An unconditional `isOffline` branch threw away a list the member could
    // still read, on a WiFi blip. The shell's ConnectionPill states the
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
    expect(screen.getByText("Loading chapter documents")).toBeInTheDocument();
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

describe("DocumentsPage search, filters and sort (#3852)", () => {
  const RUSH = {
    ...BYLAWS,
    id: "doc-2",
    title: "Rush schedule",
    folder: "Rush",
    description: "Week one events",
    uploaded_by: "u-2",
    created_at: "2026-09-20T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    documentsQuery.data = [BYLAWS, RUSH];
    roster.names = { "u-1": "Marcus Ellison", "u-2": "Ryan Castellano" };
    chapter.active();
  });

  const rowTitles = () =>
    screen
      .queryAllByRole("button", { name: /^Download / })
      .map((button) => button.getAttribute("aria-label")!.replace(/^Download /, ""));

  it("searches in memory and never asks the server to", async () => {
    // Backwork's model: one list response, re-ranked locally per keystroke.
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "week one");

    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule"]));
    expect(documentsArgs.value).toBeUndefined();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("matches the uploader's name and forgives a typo", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "castelano");

    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule"]));
    expect(screen.getByText(/by Ryan Castellano/)).toBeInTheDocument();
  });

  it("filters by uploader from a menu of people who uploaded something", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(await filterButton(user, "Uploaded by"));
    await user.click(await screen.findByRole("menuitem", { name: "Marcus Ellison" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Chapter bylaws"]));
    expect(
      await filterButton(user, "Uploaded by: Marcus Ellison"),
    ).toBeInTheDocument();
  });

  it("filters by file type, and searches format words (#3938)", async () => {
    documentsQuery.data = [
      BYLAWS,
      {
        ...RUSH,
        content_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(await filterButton(user, "File type"));
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual(["Any type", "PDF", "Spreadsheet"]);
    await user.click(screen.getByRole("menuitem", { name: "Spreadsheet" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule"]));

    await user.click(await filterButton(user, "File type: Spreadsheet"));
    await user.click(await screen.findByRole("menuitem", { name: "Any type" }));
    await user.type(screen.getByLabelText("Search documents"), "pdf");
    await waitFor(() => expect(rowTitles()).toEqual(["Chapter bylaws"]));
  });

  it("sorts by name by default and newest first on request", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    expect(rowTitles()).toEqual(["Chapter bylaws", "Rush schedule"]);

    await user.click(await filterButton(user, "Sort: Name A–Z"));
    await user.click(await screen.findByRole("menuitem", { name: "Newest first" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule", "Chapter bylaws"]));
  });

  it("narrows by Date added, and a custom range with no dates narrows nothing", async () => {
    // BYLAWS was added Aug 1 2026, after the Jul 31 rollover; an older file
    // falls before this semester.
    documentsQuery.data = [
      BYLAWS,
      { ...RUSH, created_at: "2026-03-01T00:00:00Z" },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(await filterButton(user, "Date added"));
    await user.click(await screen.findByRole("radio", { name: "Custom range" }));
    expect(rowTitles()).toEqual(["Chapter bylaws", "Rush schedule"]);
    // Untinted too: the chip doesn't claim a filter that narrows nothing.
    expect(await filterButton(user, "Date added")).toBeInTheDocument();
    expect(screen.getByText("2 documents")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "This semester" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Chapter bylaws"]));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("keeps a picked uploader whose last file went, and says nothing matches", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);
    await user.click(await filterButton(user, "Uploaded by"));
    await user.click(await screen.findByRole("menuitem", { name: "Ryan Castellano" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule"]));

    documentsQuery.data = [BYLAWS];
    rerender(<DocumentsPage />);

    expect(await screen.findByText("No documents match these filters.")).toBeInTheDocument();
    expect(
      await filterButton(user, "Uploaded by: Ryan Castellano"),
    ).toBeInTheDocument();
  });

  it("drops a picked uploader who has left the roster", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);
    await user.click(await filterButton(user, "Uploaded by"));
    await user.click(await screen.findByRole("menuitem", { name: "Ryan Castellano" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule"]));

    roster.names = { "u-1": "Marcus Ellison" };
    rerender(<DocumentsPage />);

    expect(rowTitles()).toEqual(["Chapter bylaws", "Rush schedule"]);
    expect(await filterButton(user, "Uploaded by")).toBeInTheDocument();
  });

  it("counts against the open folder, not the whole library", async () => {
    documentsQuery.data = [
      BYLAWS,
      RUSH,
      { ...RUSH, id: "doc-3", title: "Rush budget", description: null },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /^Rush$/ }));
    await user.type(screen.getByLabelText("Search documents"), "schedule");

    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule"]));
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("moves Last 30 days along while the page stays open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
      // 28 days old now; 31 days old three days on.
      documentsQuery.data = [{ ...RUSH, created_at: "2026-10-12T12:00:00Z" }];
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<DocumentsPage />);
      await user.click(await filterButton(user, "Date added"));
      await user.click(await screen.findByRole("radio", { name: "Last 30 days" }));
      expect(rowTitles()).toEqual(["Rush schedule"]);

      act(() => {
        vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
        vi.advanceTimersByTime(60_000);
      });

      expect(rowTitles()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("steps the viewer through the list as filtered and sorted, and closes it when a filter drops the file", async () => {
    documentsQuery.data = [
      BYLAWS,
      RUSH,
      { ...RUSH, id: "doc-3", title: "Rush budget", description: null, created_at: "2026-09-01T00:00:00Z" },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(await filterButton(user, "Uploaded by"));
    await user.click(await screen.findByRole("menuitem", { name: "Ryan Castellano" }));
    await user.click(await filterButton(user, "Sort: Name A–Z"));
    await user.click(await screen.findByRole("menuitem", { name: "Newest first" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Rush schedule", "Rush budget"]));

    await user.click(screen.getByRole("button", { name: /^Rush schedule/ }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "Rush budget" })).toBeInTheDocument();
    // Wraps within Ryan's two files: Marcus's bylaws are filtered out.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: "Rush schedule" })).toBeInTheDocument();

    // A search typed behind the viewer drops the open file: the viewer closes.
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "budget" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("names the uploader inside the row's open button", () => {
    render(<DocumentsPage />);
    expect(
      screen.getByRole("button", { name: /^Rush schedule.*Uploaded .* by Ryan Castellano/ }),
    ).toBeInTheDocument();
  });

  it("filters by a typed custom range, and Clear filters resets every filter", async () => {
    documentsQuery.data = [BYLAWS, { ...RUSH, created_at: "2026-03-01T00:00:00Z" }];
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(await filterButton(user, "Date added"));
    await user.click(await screen.findByRole("radio", { name: "Custom range" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-01" } });
    await waitFor(() => expect(rowTitles()).toEqual(["Chapter bylaws"]));

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-07-15" } });
    // Nothing matches, so the empty list offers one too; the menu's is used.
    const clear = await screen.findAllByRole("button", { name: "Clear filters" });
    expect(clear).toHaveLength(2);
    await user.click(clear.at(-1)!);

    await waitFor(() => expect(rowTitles()).toEqual(["Chapter bylaws", "Rush schedule"]));
    expect(await filterButton(user, "Date added")).toBeInTheDocument();
  });

  it("matches a punctuation-only search literally", async () => {
    documentsQuery.data = [BYLAWS, { ...RUSH, title: "Budget_2026" }];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "_");

    await waitFor(() => expect(rowTitles()).toEqual(["Budget_2026"]));
  });

  it("holds the date windows still while a file is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
      // 29 days 23 hours old at the start; past 30 days a day later.
      documentsQuery.data = [{ ...RUSH, created_at: "2026-10-10T13:00:00Z" }];
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<DocumentsPage />);
      await user.click(await filterButton(user, "Date added"));
      await user.click(await screen.findByRole("radio", { name: "Last 30 days" }));
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: /^Rush schedule/ }));

      act(() => {
        vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
        vi.advanceTimersByTime(120_000);
      });
      expect(screen.getByRole("dialog", { name: "Rush schedule" })).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      // Closing catches the clock up, and the file has aged out.
      act(() => {
        vi.advanceTimersByTime(10);
      });
      await waitFor(() => expect(rowTitles()).toEqual([]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes 'no matches' from an empty library", async () => {
    const user = userEvent.setup();
    documentsQuery.data = [];
    render(<DocumentsPage />);

    // No query yet: the library really is empty, so invite an upload.
    expect(screen.getByText(/^No documents yet\./)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload a file" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search documents"), "zzz");

    await waitFor(() =>
      expect(screen.getByText(/No documents match “zzz”/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Upload a file" })).toBeNull();

    // The miss offers the way back, and the way back is the library.
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(screen.getByText(/^No documents yet\./)).toBeInTheDocument(),
    );
  });

  it("composes with the folder tab", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "bylaws");
    await user.click(screen.getByRole("button", { name: /^Rush$/ }));
    expect(screen.getByText(/Nothing in Rush matches\./)).toBeInTheDocument();

    // The way out of a folder miss is the whole library, search kept.
    await user.click(screen.getByRole("button", { name: "Search all files" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Chapter bylaws"]));
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
  // Management is a mode: the per-folder controls render only after Edit.
  const editFolders = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: /^edit folders$/i }));

  it("renders folders the endpoint returns, including empty ones", () => {
    // The regression #791 exists for: deriving the rail over `documents` could
    // only ever show Governance, because nothing is filed under Rush.
    render(<DocumentsPage />);

    expect(folderRow("Governance")).toBeInTheDocument();
    expect(folderRow("Rush")).toBeInTheDocument();
  });

  it("keeps the management controls put away until Edit, and back after Done", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    expect(
      screen.queryByRole("button", { name: /edit governance/i }),
    ).toBeNull();

    await editFolders(user);
    expect(
      screen.getByRole("button", { name: /edit governance/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /^done editing folders$/i }),
    );
    expect(
      screen.queryByRole("button", { name: /edit governance/i }),
    ).toBeNull();
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

    await editFolders(user);

    await user.click(
      screen.getByRole("button", { name: /edit governance/i }),
    );
    const input = await screen.findByLabelText(/folder name/i);
    expect(input).toHaveValue("Governance");

    await user.clear(input);
    await user.type(input, "Bylaws & governance");
    await user.click(screen.getByRole("button", { name: /^save folder$/i }));

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith({
        id: "f-1",
        name: "Bylaws & governance",
      }),
    );
  });

  // #5220: Drive names and deletes a folder its sync made; Documents follows.
  it("leaves renaming and deleting a synced folder to Google Drive", async () => {
    accessQuery.data = {
      options: [
        {
          entry: "tier:t-exec",
          kind: "tier",
          id: "t-exec",
          name: "Executive board",
          color: null,
          tier_id: null,
          user_ids: ["u-1"],
        },
      ],
      always: ["tier:t-exec"],
    };
    accessQuery.isSuccess = true;
    foldersQuery.data = [
      {
        id: "f-1",
        name: "Governance",
        sort_order: 0,
        drive_folder_id: "drive-gov",
      },
      { id: "f-2", name: "Rush", sort_order: 1 },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await editFolders(user);
    expect(
      screen.queryByRole("button", { name: /delete folder governance/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /delete folder rush/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit governance/i }));
    const input = await screen.findByLabelText(/folder name/i);
    expect(input).toHaveAttribute("readonly");
    expect(
      screen.getByText(/comes from Google Drive: rename or delete it there/i),
    ).toBeInTheDocument();
    // Who can see it stays the folder's own to set.
    expect(
      screen.getByRole("radio", { name: "Chosen roles" }),
    ).toBeInTheDocument();
  });

  it("follows the active tab across a rename", async () => {
    // Documents record their folder by name and the server re-files them, so a
    // tab left pointing at the old name would filter the list to nothing.
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(folderRow("Governance"));
    await editFolders(user);
    await user.click(
      screen.getByRole("button", { name: /edit governance/i }),
    );
    const input = await screen.findByLabelText(/folder name/i);
    await user.clear(input);
    await user.type(input, "Charter");
    await user.click(screen.getByRole("button", { name: /^save folder$/i }));

    await waitFor(() => expect(mockUpdateFolder).toHaveBeenCalled());
    // The heading, and the narrow page's Folder control, track the active
    // folder.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /^Charter/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Folder: Charter" })).toBeInTheDocument();
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

    await editFolders(user);

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

  it("cannot move the first folder up or the last one down", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await editFolders(user);

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

    await editFolders(user);

    await user.click(
      screen.getByRole("button", { name: /delete folder governance/i }),
    );

    const dialog = await screen
      .findByRole("alertdialog")
      .catch(() => screen.getByRole("dialog"));
    expect(nativeConfirm).not.toHaveBeenCalled();
    // The server moves them to root — saying "cannot be undone" here would be
    // a false claim about the member's files.
    expect(
      within(dialog).getByText(/move to the root level/i),
    ).toBeInTheDocument();

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

    await editFolders(user);

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

  it("gates every folder write behind the subscription, like upload", async () => {
    // Each folder route carries chapter_docs:manage and no @FreeTier, so they
    // are paid ops on the same gate the rest of this page's writes use. Edit
    // itself is not a write, so it opens on a lapsed chapter too.
    chapter.pastDue();
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(screen.getByRole("button", { name: /^edit folders$/i }));

    expect(screen.getByRole("button", { name: /new folder/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /edit governance/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /delete folder governance/i }),
    ).toBeDisabled();
  });
});

describe("DocumentsPage folder tree (#5337)", () => {
  // A synced Drive tree, as `folderPath` names its folders.
  const FIJI = [
    { id: "t-1", name: "Town in Fiji", sort_order: 0, drive_folder_id: "d1" },
    {
      id: "t-2",
      name: "Town in Fiji / Rush",
      sort_order: 1,
      drive_folder_id: "d2",
    },
    {
      id: "t-3",
      name: "Town in Fiji / Rush / 2024",
      sort_order: 2,
      drive_folder_id: "d3",
    },
    {
      id: "t-4",
      name: "Town in Fiji / Formal",
      sort_order: 3,
      drive_folder_id: "d4",
    },
  ];
  const FLYER = {
    ...BYLAWS,
    id: "doc-flyer",
    title: "Rush flyer",
    folder: "Town in Fiji / Rush / 2024",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
    foldersQuery.data = FIJI;
    documentsQuery.data = [BYLAWS, FLYER];
    window.localStorage.clear();
  });

  const row = (name: string) =>
    screen.getByRole("button", { name: new RegExp(`^${name}$`) });

  it("draws each folder under its parent by its own name, the lone top folder open", () => {
    render(<DocumentsPage />);
    expect(row("Town in Fiji")).toBeInTheDocument();
    // Two folders at this level, so each starts closed.
    expect(row("Rush")).toBeInTheDocument();
    expect(row("Formal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^2024$/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open Town in Fiji / Rush" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "Close Town in Fiji" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a folder from its chevron, and a folder shows only its own files", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(
      screen.getByRole("button", { name: "Open Town in Fiji / Rush" }),
    );
    // Opening is not choosing: the list is still All files.
    expect(screen.getByText("Chapter bylaws")).toBeInTheDocument();
    await user.click(row("2024"));
    expect(screen.getByText("Rush flyer")).toBeInTheDocument();
    expect(screen.queryByText("Chapter bylaws")).toBeNull();
    // Its parent holds none of its child's files.
    await user.click(row("Rush"));
    expect(screen.queryByText("Rush flyer")).toBeNull();
  });

  it("opens a closed folder when it is chosen, as Drive's sidebar does", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(row("Rush"));
    expect(row("2024")).toBeInTheDocument();
  });

  it("keeps what this member closed on this browser", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DocumentsPage />);
    await user.click(
      screen.getByRole("button", { name: "Close Town in Fiji" }),
    );
    expect(screen.queryByRole("button", { name: /^Rush$/ })).toBeNull();
    unmount();
    render(<DocumentsPage />);
    expect(screen.queryByRole("button", { name: /^Rush$/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open Town in Fiji" }),
    ).toBeInTheDocument();
  });

  it("keeps each member's picks apart, and each chapter's", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(screen.getByRole("button", { name: "Close Town in Fiji" }));
    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith("frapp.documents.folders-open."),
    );
    expect(keys).toEqual([folderOpenStorageKey("auth-1", "chap-1")]);
    expect(folderOpenStorageKey("auth-1", "chap-1")).not.toBe(
      folderOpenStorageKey("auth-2", "chap-1"),
    );
    expect(folderOpenStorageKey("auth-1", "chap-1")).not.toBe(
      folderOpenStorageKey("auth-1", "chap-2"),
    );
  });

  it("never hides the folder on screen, and closing the folder above it chooses that one", async () => {
    foldersQuery.data = [
      FIJI[0]!,
      FIJI[1]!,
      { ...FIJI[2]!, pinned_at: "2026-11-17T00:00:00Z" },
      FIJI[3]!,
      { id: "t-5", name: "Town in Fiji / Rush / 2024 / Flyers", sort_order: 4 },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);
    const rail = screen.getByRole("navigation", { name: "Folders" });
    // 2024 is pinned, so it leads the rail; choosing it opens it to Flyers.
    await user.click(
      within(rail).getByRole("button", { name: /^2024\s*Town in Fiji \/ Rush$/ }),
    );
    await user.click(within(rail).getByRole("button", { name: /^Flyers$/ }));
    // Closing the folder above the one on screen chooses it instead.
    await user.click(
      within(rail).getByRole("button", {
        name: "Close Town in Fiji / Rush / 2024",
      }),
    );
    expect(within(rail).queryByRole("button", { name: /^Flyers$/ })).toBeNull();
    // Only 2024's own open and close were saved: nothing was opened above
    // it for showing Flyers.
    expect(
      JSON.parse(
        window.localStorage.getItem(folderOpenStorageKey("auth-1", "chap-1"))!,
      ),
    ).toEqual({ "t-3": false });
  });

  it("opens the folders above a nested starred folder before its star moves it back", async () => {
    foldersQuery.data = [
      ...FIJI,
      { id: "t-5", name: "Town in Fiji / Rush / 2024 / Flyers", sort_order: 4 },
    ];
    stars.value = { folder_ids: ["t-3"], document_ids: [] };
    const user = userEvent.setup();
    render(<DocumentsPage />);
    const rail = screen.getByRole("navigation", { name: "Folders" });
    // Unstarring 2024 sends it back under Rush, which starts closed: the
    // folders above it open first, so its star (and focus) stay put.
    await user.click(
      within(rail).getByRole("button", {
        name: "Unstar Town in Fiji / Rush / 2024",
      }),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(folderOpenStorageKey("auth-1", "chap-1"))!,
      ),
    ).toMatchObject({ "t-1": true, "t-2": true });
  });

  it("puts a folder whose parent the member can't see under the nearest one they can", () => {
    foldersQuery.data = [FIJI[0]!, FIJI[2]!, FIJI[3]!];
    render(<DocumentsPage />);
    expect(row("Rush / 2024")).toBeInTheDocument();
  });

  it("lifts a pinned folder to Pinned with what is under it, saying where it lives", () => {
    foldersQuery.data = [
      FIJI[0]!,
      { ...FIJI[1]!, pinned_at: "2026-11-17T00:00:00Z" },
      FIJI[2]!,
      FIJI[3]!,
    ];
    render(<DocumentsPage />);
    const pinned = screen.getByRole("group", { name: "Pinned" });
    expect(
      within(pinned).getByRole("button", { name: /^Rush\s*Town in Fiji$/ }),
    ).toBeInTheDocument();
    // The card above All files reads the same way.
    expect(screen.getByText("In Town in Fiji · 0 files")).toBeInTheDocument();
    // Shown once in the rail: not also under Town in Fiji.
    const rail = screen.getByRole("navigation", { name: "Folders" });
    expect(within(rail).getAllByRole("button", { name: /^Rush/ })).toHaveLength(
      1,
    );
  });

  it("moves a folder past the one beside it at its own level", async () => {
    manageGate.granted = true;
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(screen.getByRole("button", { name: /^edit folders$/i }));
    await user.click(
      screen.getByRole("button", { name: "Move Town in Fiji / Formal up" }),
    );
    // Formal and Rush trade places; 2024, under Rush, isn't rewritten, so a
    // move past a synced folder with hundreds below it is still two writes.
    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith({
        id: "t-4",
        sort_order: 1,
      }),
    );
    expect(mockUpdateFolder).toHaveBeenCalledWith({ id: "t-2", sort_order: 3 });
    expect(mockUpdateFolder).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Move Town in Fiji / Rush up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Town in Fiji down" }),
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

  it("keeps searching a cached library offline", async () => {
    // Search runs over the library in hand (#3852), so a dropped connection
    // changes nothing about it. Server-side search needed a whole
    // "Search needs a connection" state for this.
    const user = userEvent.setup();
    mockOffline.value = true;
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "bylaws");

    expect(await screen.findByText("Chapter bylaws")).toBeInTheDocument();
    expect(screen.queryByText("Documents unavailable offline")).toBeNull();
  });

  it("shows the offline state when nothing is cached", () => {
    mockOffline.value = true;
    documentsQuery.data = [];
    render(<DocumentsPage />);

    expect(
      screen.getByText("Documents unavailable offline"),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText(/couldn't load the folder list/i),
    ).toBeInTheDocument();
  });

  it("offers no folder management for a derived fallback row", () => {
    // A derived name has no folder record behind it, so there is nothing to
    // rename, reorder or delete — offering the controls would 404.
    foldersQuery.data = [];
    foldersQuery.isError = true;
    render(<DocumentsPage />);

    expect(
      screen.queryByRole("button", { name: /edit governance/i }),
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
        screen.getByText("No documents outside a folder match."),
      ).toBeInTheDocument(),
    );
  });

  it("keeps folder controls at the 44px touch floor", async () => {
    // `button.tsx` sizes `icon` at 44 deliberately; these four sit adjacent in
    // a 200px rail, where an undersized target puts delete next to move-down.
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(screen.getByRole("button", { name: /^edit folders$/i }));

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

  it("derives folder tabs from the whole library, never the matches", async () => {
    // With the folder endpoint down the rail reads folders off the documents.
    // Search narrows the rows, not the library, so a query matching only
    // Governance files must not take the Rush tab away.
    foldersQuery.data = [];
    foldersQuery.isError = true;
    documentsQuery.data = [
      BYLAWS,
      { ...BYLAWS, id: "doc-2", title: "Rush schedule", folder: "Rush" },
    ];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.type(screen.getByLabelText("Search documents"), "bylaws");

    await waitFor(() => expect(screen.queryByText("Rush schedule")).toBeNull());
    expect(screen.getByRole("button", { name: /^Rush$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Governance$/ }),
    ).toBeInTheDocument();
  });
});

describe("DocumentsPage offline write gating", () => {
  // Call-site coverage for #1753 — the reverted attempt only tested the
  // synthetic harness, which is why findings 2–4 escaped.
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedDocumentsQuery();
    chapter.active();
  });

  it("disables document writes while OFFLINE and keeps reads live", () => {
    mockOffline.value = true;
    render(<DocumentsPage />);

    expect(uploadTrigger()).toBeDisabled();
    expect(deleteButton()).toBeDisabled();
    expect(uploadTrigger()).toHaveAttribute(
      "title",
      "Reconnect to make changes.",
    );
    // An icon-only control keeps its name ahead of the reason.
    expect(deleteButton()).toHaveAttribute(
      "title",
      "Delete Chapter bylaws. Reconnect to make changes.",
    );
    expect(uploadTrigger()).not.toHaveAttribute("aria-describedby");
    // Finding 3: the page-level SubscriptionNotice sits outside the dialog
    // and must not appear for an offline-only block.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
    // Downloads are reads — enforceSubscription skips GET.
    expect(downloadButton()).toBeEnabled();
    expect(screen.getByText("Chapter bylaws")).toBeInTheDocument();
  });

  it("does not slam an open upload dialog when the connection drops", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <ConnectionPill />
        <DocumentsPage />
      </>,
    );

    await user.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const title = await screen.findByLabelText(/title/i);
    await user.type(title, "Retreat agenda");

    mockOffline.value = true;
    rerender(
      <>
        <ConnectionPill />
        <DocumentsPage />
      </>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue("Retreat agenda");
    // The header trigger is `aria-hidden` while the dialog is open, so assert
    // on the in-dialog submit — the write that would actually fire.
    const submit = screen.getByRole("button", { name: /^upload$/i });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("title", "Reconnect to make changes.");
  });

  it("keeps keyboard focus off <body> when the upload dialog closes while OFFLINE", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <ConnectionPill />
        <DocumentsPage />
      </>,
    );

    await user.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    mockOffline.value = true;
    rerender(
      <>
        <ConnectionPill />
        <DocumentsPage />
      </>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /You're offline/ })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});

describe("DocumentsPage wiring across its split components (#3273)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    canGate.granted = true;
    resolvedDocumentsQuery();
    chapter.active();
  });

  afterEach(() => {
    canGate.granted = true;
  });

  it("opens Import a folder from the Upload menu, with no button of its own (#5576)", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    expect(
      screen.queryByRole("button", { name: "Import a folder" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "More ways to add documents" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Import a folder" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("keeps every filter in one Filters menu that counts what is on (#5576)", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    expect(
      screen.queryByRole("button", { name: "Uploaded by" }),
    ).not.toBeInTheDocument();

    await user.click(await filterButton(user, "Starred"));
    expect(
      screen.getByRole("button", { name: "Filters, 1 on" }),
    ).toBeInTheDocument();
  });

  it("picks a folder from the narrow page's Folder menu and closes it (#5576)", async () => {
    foldersQuery.data = [{ id: "f-1", name: "Governance", sort_order: 0 }];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: "Folder: All files" }));
    const menu = await screen.findByRole("dialog");
    await user.click(within(menu).getByRole("button", { name: /^Governance/ }));

    expect(
      await screen.findByRole("button", { name: "Folder: Governance" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("asks for Drive's status only for an officer who manages documents (#5576)", () => {
    manageGate.granted = false;
    render(<DocumentsPage />);
    expect(mockDriveStatus).toHaveBeenCalledWith({ enabled: false });
    expect(mockDriveStatus).not.toHaveBeenCalledWith({ enabled: true });
    manageGate.granted = true;
  });

  it("opens Google Drive from the Upload menu when the server offers it (#5576)", async () => {
    manageGate.granted = true;
    mockDriveStatus.mockReturnValue({
      data: {
        available: true,
        connection: null,
        service_account_email: "drive@example.com",
      },
    });
    try {
      const user = userEvent.setup();
      render(<DocumentsPage />);
      await user.click(
        screen.getByRole("button", { name: "More ways to add documents" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Connect Google Drive" }),
      );
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    } finally {
      mockDriveStatus.mockReturnValue({ data: undefined });
    }
  });

  it("keeps a row's controls out of sight until hover or focus, and behind More on touch (#5576)", () => {
    render(<DocumentsPage />);
    const star = screen.getByRole("button", { name: "Star Chapter bylaws" });
    const controls = star.closest("div")!;
    // jsdom can't run the media queries, so the classes are the contract.
    expect(controls.className).toContain("pointer-fine:opacity-0");
    expect(controls.className).toContain("pointer-fine:group-hover/row:opacity-100");
    expect(controls.className).toContain("pointer-fine:group-focus-within/row:opacity-100");
    expect(controls.className).toContain("pointer-coarse:hidden");
    const more = screen.getByRole("button", { name: "Actions for Chapter bylaws" });
    expect(more.className).toContain("pointer-coarse:inline-flex");
    expect(more.className).toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("offers the row's actions from the touch More menu (#5576)", async () => {
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await user.click(
      screen.getByRole("button", { name: "Actions for Chapter bylaws" }),
    );
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual(expect.arrayContaining(["Star", "Download"]));
  });

  it("paints each file's tile, and its folder's rail glyph, in the folder's hue (#5576)", () => {
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0 },
      { id: "f-2", name: "Rush", sort_order: 1 },
    ];
    documentsQuery.data = [
      BYLAWS,
      { ...BYLAWS, id: "doc-2", title: "Rush schedule", folder: "Rush" },
    ];
    render(<DocumentsPage />);
    const tile = (title: string) =>
      screen
        .getByRole("button", { name: new RegExp(`^${title}`) })
        .querySelector<HTMLElement>("span[style]")!;
    const governance = tile("Chapter bylaws").style.color;
    const rush = tile("Rush schedule").style.color;
    expect(governance).not.toBe("");
    expect(rush).not.toBe(governance);
    const railGlyph = screen
      .getAllByRole("button", { name: /^Governance/ })[0]!
      .querySelector<HTMLElement>("span[style]")!;
    expect(railGlyph.style.color).toBe(governance);
  });

  it("keeps an upload draft when the permission gate unmounts the sheet and comes back", async () => {
    // The reason `useDocumentUpload` is called by the page and not by the
    // sheet: state owned inside the `Can`-gated subtree goes with it.
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);

    await user.click(uploadTrigger());
    await user.type(await screen.findByLabelText(/title/i), "Retreat agenda");

    canGate.granted = false;
    rerender(<DocumentsPage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    canGate.granted = true;
    rerender(<DocumentsPage />);
    expect(await screen.findByLabelText(/title/i)).toHaveValue(
      "Retreat agenda",
    );
  });

  it("retries the documents query from the list's error state", async () => {
    documentsQuery.isError = true;
    documentsQuery.data = [];
    render(<DocumentsPage />);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockFolderRefetch).not.toHaveBeenCalled();
  });

  it("retries the documents query from the list's offline state", async () => {
    mockOffline.value = true;
    documentsQuery.isPending = true;
    documentsQuery.data = [];
    render(<DocumentsPage />);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockFolderRefetch).not.toHaveBeenCalled();
  });

  it("retries the folder query, not the documents, from the rail's notice", async () => {
    foldersQuery.data = [];
    foldersQuery.isError = true;
    render(<DocumentsPage />);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(mockFolderRefetch).toHaveBeenCalledTimes(1);
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("refetches the folders after a reorder fails, so the rail shows what saved", async () => {
    mockUpdateFolder.mockRejectedValueOnce(new Error("network down"));
    render(<DocumentsPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /^edit folders$/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /move rush up/i }),
    );

    await waitFor(() => expect(mockFolderRefetch).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't reorder folders" }),
    );
  });
});

describe("DocumentsPage pins and stars (#3934)", () => {
  const MINUTES = {
    ...BYLAWS,
    id: "doc-2",
    title: "Meeting minutes",
    folder: "Rush",
    storage_path: "chap-1/minutes.pdf",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    canGate.granted = true;
    resolvedDocumentsQuery();
    chapter.active();
  });

  afterEach(() => {
    canGate.granted = true;
  });

  const rail = () => screen.getByRole("navigation");

  it("groups the rail: pinned for the chapter, then the member's stars, then the rest", () => {
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0, pinned_at: null },
      {
        id: "f-2",
        name: "Rush",
        sort_order: 1,
        pinned_at: "2026-11-11T00:00:00Z",
      },
      { id: "f-3", name: "Finance", sort_order: 2, pinned_at: null },
    ];
    stars.value = { folder_ids: ["f-3"], document_ids: [] };
    render(<DocumentsPage />);

    const pinned = within(rail()).getByRole("group", { name: "Pinned" });
    const starred = within(rail()).getByRole("group", { name: "Starred" });
    const other = within(rail()).getByRole("group", { name: "Other folders" });
    expect(
      within(pinned).getByRole("button", { name: "Rush" }),
    ).toBeInTheDocument();
    expect(
      within(starred).getByRole("button", { name: "Finance" }),
    ).toBeInTheDocument();
    expect(
      within(other).getByRole("button", { name: "Governance" }),
    ).toBeInTheDocument();
    expect(
      within(starred).getByRole("button", { name: "Unstar Finance" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves the rail ungrouped when nothing is pinned or starred", () => {
    render(<DocumentsPage />);
    expect(within(rail()).queryByRole("group")).not.toBeInTheDocument();
  });

  it("stars a folder and a file for the member alone", async () => {
    render(<DocumentsPage />);

    await userEvent.click(
      within(rail()).getByRole("button", { name: "Star Governance" }),
    );
    expect(mockSetStar).toHaveBeenCalledWith(
      { target: { kind: "folder", id: "f-1" }, starred: true },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Star Chapter bylaws" }),
    );
    expect(mockSetStar).toHaveBeenCalledWith(
      { target: { kind: "document", id: "doc-1" }, starred: true },
    );
  });

  it("draws pinned and starred cards above All files, and a folder card opens the folder", async () => {
    documentsQuery.data = [
      BYLAWS,
      { ...MINUTES, pinned_at: "2026-11-11T00:00:00Z" },
    ];
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0, pinned_at: null },
      {
        id: "f-2",
        name: "Rush",
        sort_order: 1,
        pinned_at: "2026-11-11T00:00:00Z",
      },
    ];
    stars.value = { folder_ids: [], document_ids: ["doc-1"] };
    render(<DocumentsPage />);

    const pinned = screen.getByRole("region", { name: "Pinned" });
    expect(within(pinned).getByText("Rush")).toBeInTheDocument();
    expect(within(pinned).getByText("Folder · 1 file")).toBeInTheDocument();
    expect(within(pinned).getByText("Meeting minutes")).toBeInTheDocument();
    const starred = screen.getByRole("region", { name: "Starred" });
    expect(within(starred).getByText("Chapter bylaws")).toBeInTheDocument();

    await userEvent.click(within(pinned).getByText("Rush"));
    expect(screen.getByRole("heading", { name: "Rush" })).toBeInTheDocument();
    // Inside a folder the cards give way to the list, so nothing shows twice.
    expect(
      screen.queryByRole("region", { name: "Pinned" }),
    ).not.toBeInTheDocument();
  });

  it("leads a searched list with pinned, then starred files, instead of cards", async () => {
    const AGENDA = {
      ...BYLAWS,
      id: "doc-3",
      title: "Chapter agenda",
      storage_path: "chap-1/agenda.pdf",
    };
    documentsQuery.data = [
      AGENDA,
      BYLAWS,
      {
        ...MINUTES,
        title: "Chapter minutes",
        pinned_at: "2026-11-11T00:00:00Z",
      },
    ];
    stars.value = { folder_ids: [], document_ids: ["doc-1"] };
    render(<DocumentsPage />);

    await userEvent.type(screen.getByLabelText(/search documents/i), "chapter");

    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Pinned" }),
      ).not.toBeInTheDocument(),
    );
    const list = screen.getByRole("region", { name: /documents/i });
    const titles = within(list)
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(titles[0]).toContain("Chapter minutes");
    expect(titles[1]).toContain("Chapter bylaws");
    expect(titles[2]).toContain("Chapter agenda");
  });

  it("filters to Pinned, Starred or either, with the search and the other chips (#4290)", async () => {
    const AGENDA = {
      ...BYLAWS,
      id: "doc-3",
      title: "Chapter agenda",
      storage_path: "chap-1/agenda.xlsx",
      content_type: null,
    };
    documentsQuery.data = [
      AGENDA,
      BYLAWS,
      { ...MINUTES, pinned_at: "2026-11-11T00:00:00Z" },
    ];
    stars.value = { folder_ids: [], document_ids: ["doc-1", "doc-3"] };
    const user = userEvent.setup();
    render(<DocumentsPage />);
    const list = () => screen.getByRole("region", { name: /documents/i });
    const shown = () =>
      within(list())
        .queryAllByRole("listitem")
        .map((row) => row.querySelector("span.font-semibold")?.textContent);

    const starredChip = await filterButton(user, "Starred");
    expect(starredChip).toHaveAttribute("aria-pressed", "false");
    await user.click(starredChip);
    expect(starredChip).toHaveAttribute("aria-pressed", "true");
    // The cards give way to the list, as any filter does.
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Starred" })).not.toBeInTheDocument(),
    );
    expect(shown()).toEqual(["Chapter agenda", "Chapter bylaws"]);

    await user.click(await filterButton(user, "Pinned"));
    // Both on: either, pinned leading.
    expect(shown()).toEqual(["Meeting minutes", "Chapter agenda", "Chapter bylaws"]);

    await user.click(await filterButton(user, "Pinned"));
    await user.click(await filterButton(user, "File type"));
    await user.click(await screen.findByRole("menuitem", { name: "Spreadsheet" }));
    await waitFor(() => expect(shown()).toEqual(["Chapter agenda"]));

    await user.type(screen.getByLabelText("Search documents"), "bylaws");
    await user.click(await screen.findByRole("button", { name: "Clear filters" }));
    const starredAfter = await filterButton(user, "Starred");
    await waitFor(() =>
      expect(starredAfter).toHaveAttribute("aria-pressed", "false"),
    );
  });

  it("keeps a row unstarred under Starred, and its focus, until the filter changes (#4290)", async () => {
    documentsQuery.data = [BYLAWS, MINUTES];
    stars.value = { folder_ids: [], document_ids: ["doc-1"] };
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);
    await user.click(await filterButton(user, "Starred"));
    const unstar = screen.getByRole("button", { name: "Unstar Chapter bylaws" });
    await user.click(unstar);
    expect(mockSetStar).toHaveBeenCalled();
    // The server's answer: the star is gone.
    stars.value = { folder_ids: [], document_ids: [] };
    rerender(<DocumentsPage />);

    const star = await screen.findByRole("button", { name: "Star Chapter bylaws" });
    expect(star).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Meeting minutes/ })).not.toBeInTheDocument();

    await user.click(await filterButton(user, "Starred"));
    await user.click(await filterButton(user, "Starred"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Star Chapter bylaws" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("pins a file and a folder for the chapter, for whoever manages documents", async () => {
    render(<DocumentsPage />);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Pin Chapter bylaws for the chapter",
      }),
    );
    expect(mockSetPin).toHaveBeenCalledWith({
      target: { kind: "document", id: "doc-1" },
      pinned: true,
    });

    await userEvent.click(
      screen.getByRole("button", { name: /^edit folders$/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pin Rush for the chapter" }),
    );
    expect(mockSetPin).toHaveBeenCalledWith({
      target: { kind: "folder", id: "f-2" },
      pinned: true,
    });
  });

  it("offers no pin to a member who can't manage documents", () => {
    canGate.granted = false;
    render(<DocumentsPage />);
    expect(
      screen.queryByRole("button", { name: /^pin /i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Star Chapter bylaws" }),
    ).toBeInTheDocument();
  });

  it("moves a folder within its tier and writes the pinned ones first", async () => {
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0, pinned_at: null },
      { id: "f-2", name: "Rush", sort_order: 1, pinned_at: null },
      {
        id: "f-3",
        name: "Finance",
        sort_order: 2,
        pinned_at: "2026-11-11T00:00:00Z",
      },
    ];
    render(<DocumentsPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /^edit folders$/i }),
    );
    // Finance is the only pinned folder, so it can't move within its tier.
    expect(
      screen.getByRole("button", { name: "Move Finance up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Finance down" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Governance down" }),
    );
    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith({
        id: "f-1",
        sort_order: 2,
      }),
    );
    expect(mockUpdateFolder).toHaveBeenCalledWith({ id: "f-3", sort_order: 0 });
    // Rush already sits at 1 in the new order, so it is not rewritten.
    expect(mockUpdateFolder).toHaveBeenCalledTimes(2);
  });

  it("keeps every Star and Pin behind the subscription gate", async () => {
    chapter.incomplete();
    documentsQuery.data = [{ ...BYLAWS, pinned_at: "2026-11-11T00:00:00Z" }];
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0, pinned_at: null },
    ];
    render(<DocumentsPage />);

    // The card's star and the row's star share a name; both are gated.
    for (const button of screen.getAllByRole("button", {
      name: "Star Chapter bylaws",
    })) {
      expect(button).toBeDisabled();
    }
    expect(
      screen.getByRole("button", {
        name: "Unpin Chapter bylaws for the chapter",
      }),
    ).toBeDisabled();
    expect(
      within(rail()).getByRole("button", { name: "Star Governance" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: /^edit folders$/i }),
    );
    expect(
      screen.getByRole("button", { name: "Pin Governance for the chapter" }),
    ).toBeDisabled();
  });

  it("says so when a star or a pin fails", async () => {
    mockSetPin.mockRejectedValueOnce(new Error("network down"));
    // The first of two overlapping stars fails: it is still reported.
    let failFirst!: (error: unknown) => void;
    mockSetStar
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0, pinned_at: null },
    ];
    render(<DocumentsPage />);

    await userEvent.click(
      screen.getByRole("button", { name: "Star Chapter bylaws" }),
    );
    await userEvent.click(
      within(rail()).getByRole("button", { name: "Star Governance" }),
    );
    await act(async () => failFirst(new Error("network down")));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't star Chapter bylaws",
        variant: "destructive",
      }),
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Pin Chapter bylaws for the chapter",
      }),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't pin Chapter bylaws",
          variant: "destructive",
        }),
      ),
    );
  });

  it("shows Edit the chapter's arrangement, without the officer's own stars", async () => {
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0, pinned_at: null },
      {
        id: "f-2",
        name: "Rush",
        sort_order: 1,
        pinned_at: "2026-11-11T00:00:00Z",
      },
      { id: "f-3", name: "Finance", sort_order: 2, pinned_at: null },
    ];
    stars.value = { folder_ids: ["f-3"], document_ids: [] };
    render(<DocumentsPage />);
    expect(
      within(rail()).getByRole("group", { name: "Starred" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /^edit folders$/i }),
    );
    expect(
      within(rail()).queryByRole("group", { name: "Starred" }),
    ).not.toBeInTheDocument();
    const other = within(rail()).getByRole("group", { name: "Other folders" });
    expect(
      within(other).getByRole("button", { name: "Move Governance up" }),
    ).toBeDisabled();
    // Finance moves among the rest, its star notwithstanding.
    expect(
      within(other).getByRole("button", { name: "Move Finance up" }),
    ).toBeEnabled();
    expect(
      within(other).getByRole("button", { name: "Move Finance down" }),
    ).toBeDisabled();
  });

  it("draws no empty group in Edit when every folder is pinned", async () => {
    foldersQuery.data = [
      {
        id: "f-1",
        name: "Governance",
        sort_order: 0,
        pinned_at: "2026-11-11T00:00:00Z",
      },
      {
        id: "f-2",
        name: "Rush",
        sort_order: 1,
        pinned_at: "2026-11-11T00:00:00Z",
      },
    ];
    render(<DocumentsPage />);
    await userEvent.click(
      screen.getByRole("button", { name: /^edit folders$/i }),
    );
    expect(
      within(rail()).getByRole("group", { name: "Pinned" }),
    ).toBeInTheDocument();
    expect(
      within(rail()).queryByRole("group", { name: "Other folders" }),
    ).not.toBeInTheDocument();
  });

  it("shows a member who can't pin a pinned file's pin as a mark only", () => {
    canGate.granted = false;
    documentsQuery.data = [{ ...BYLAWS, pinned_at: "2026-11-11T00:00:00Z" }];
    render(<DocumentsPage />);
    expect(
      screen.getAllByText("Pinned for the chapter").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /pin chapter bylaws/i }),
    ).not.toBeInTheDocument();
  });

  it("gives a pinned folder its card before anything is filed", () => {
    documentsQuery.data = [];
    foldersQuery.data = [
      {
        id: "f-2",
        name: "Rush",
        sort_order: 0,
        pinned_at: "2026-11-11T00:00:00Z",
      },
    ];
    render(<DocumentsPage />);
    const pinned = screen.getByRole("region", { name: "Pinned" });
    expect(within(pinned).getByText("Folder · 0 files")).toBeInTheDocument();
  });

  it("keeps focus on a folder's Star when starring moves it to Starred", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DocumentsPage />);
    within(rail()).getByRole("button", { name: "Star Governance" }).focus();
    await user.keyboard("{Enter}");

    // The optimistic star lands, which moves the folder into its new group.
    stars.value = { folder_ids: ["f-1"], document_ids: [] };
    rerender(<DocumentsPage />);

    expect(document.activeElement).toBe(
      within(rail()).getByRole("button", { name: "Unstar Governance" }),
    );
  });

  it("returns focus to the row, not the card, when the viewer opened from the row closes", async () => {
    const user = userEvent.setup();
    documentsQuery.data = [{ ...BYLAWS, pinned_at: "2026-11-11T00:00:00Z" }];
    render(<DocumentsPage />);
    const list = screen.getByRole("region", { name: /all documents/i });
    const row = list.querySelector<HTMLElement>(
      '[data-document-open="doc-1"]',
    )!;
    // The card above the list names the same file; it must not take focus.
    expect(
      screen
        .getByRole("region", { name: "Pinned" })
        .querySelector('[data-document-open="doc-1"]'),
    ).not.toBeNull();

    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("says when the stars couldn't be read, with a way to try again", async () => {
    stars.failed = true;
    render(<DocumentsPage />);
    expect(screen.getByText(/couldn't load your stars/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockStarsRefetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * #4175: List or Grid, picked at the toolbar's end and kept per viewer. A
 * tile shows what the row shows and keeps the row's controls, so the layout
 * changes nothing a member can do with a file.
 */
describe("DocumentsPage who can see (#3642 piece 1)", () => {
  const EXEC_TIER = {
    entry: "tier:t-exec",
    kind: "tier",
    id: "t-exec",
    name: "Executive board",
    color: null,
    tier_id: null,
    user_ids: ["u-1", "u-2"],
  };
  const TREASURER = {
    entry: "role:r-treasurer",
    kind: "role",
    id: "r-treasurer",
    name: "Treasurer",
    color: "#336699",
    tier_id: "t-exec",
    user_ids: ["u-2"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    chapter.active();
    resolvedDocumentsQuery();
    accessQuery.data = { options: [EXEC_TIER, TREASURER], always: [] };
    accessQuery.isSuccess = true;
  });

  it("draws a lock on a limited folder and on the files filed in it", () => {
    foldersQuery.data = [
      { id: "f-1", name: "Governance", sort_order: 0, who_can_see: ["tier:t-exec"] },
      { id: "f-2", name: "Rush", sort_order: 1 },
    ];
    documentsQuery.data = [
      { ...BYLAWS, folder: "Governance" },
      { ...BYLAWS, id: "doc-2", title: "Rush schedule", folder: "Rush" },
    ];
    render(<DocumentsPage />);

    expect(
      screen.getAllByText("Not everyone can see this folder"),
    ).toHaveLength(1);
    // Bylaws sits in the limited folder; the Rush schedule does not.
    expect(screen.getAllByText("Not everyone can see this")).toHaveLength(1);
  });

  it("offers Who can see on a file only to its uploader or a manager", () => {
    documentsQuery.data = [
      { ...BYLAWS, uploaded_by: "viewer-1" },
      { ...BYLAWS, id: "doc-2", title: "Rush schedule", uploaded_by: "u-9" },
      {
        ...BYLAWS,
        id: "doc-3",
        title: "Synced minutes",
        uploaded_by: "viewer-1",
        drive_file_id: "drive-1",
      },
    ];
    render(<DocumentsPage />);

    expect(
      screen.getByRole("button", { name: "Who can see Chapter bylaws" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Who can see Rush schedule" }),
    ).not.toBeInTheDocument();
    // A Drive copy is filed as uploaded by whoever connected the folder.
    expect(
      screen.queryByRole("button", { name: "Who can see Synced minutes" }),
    ).not.toBeInTheDocument();
  });

  it("sets a file's own list and puts it back to Same as folder", async () => {
    manageGate.granted = true;
    documentsQuery.data = [{ ...BYLAWS, who_can_see: ["tier:t-exec"] }];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(
      screen.getByRole("button", { name: "Who can see Chapter bylaws" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Executive board")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: "Same as folder" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSetAccess).toHaveBeenCalledWith({
        id: "doc-1",
        who_can_see: null,
      }),
    );
  });

  it("keeps the setter's tiers on the list without a remove", async () => {
    manageGate.granted = true;
    accessQuery.data = { options: [EXEC_TIER, TREASURER], always: ["tier:t-exec"] };
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(
      screen.getByRole("button", { name: "Who can see Chapter bylaws" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Chosen roles" }));

    expect(within(dialog).getByText("Executive board")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /remove executive board/i }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockSetAccess).toHaveBeenCalledWith({
        id: "doc-1",
        who_can_see: ["tier:t-exec"],
      }),
    );
  });

  it("saves only a folder's list when its name didn't change", async () => {
    manageGate.granted = true;
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /^edit folders$/i }));
    await user.click(screen.getByRole("button", { name: /edit governance/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Chosen roles" }));
    await user.click(
      within(dialog).getByRole("button", { name: /add to who can see/i }),
    );
    await user.click(await screen.findByRole("option", { name: /treasurer/i }));
    await user.click(within(dialog).getByRole("button", { name: /^save folder$/i }));

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith({
        id: "f-1",
        who_can_see: ["role:r-treasurer"],
      }),
    );
  });

  it("closes a folder dialog opened only to look without a write", async () => {
    manageGate.granted = true;
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /^edit folders$/i }));
    await user.click(screen.getByRole("button", { name: /edit governance/i }));
    await user.click(
      await screen.findByRole("button", { name: /^save folder$/i }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockUpdateFolder).not.toHaveBeenCalled();
  });

  it("draws a lock on a file with its own list, outside any folder", () => {
    documentsQuery.data = [
      { ...BYLAWS, folder: null, who_can_see: ["tier:t-exec"] },
      { ...BYLAWS, id: "doc-2", title: "Rush schedule", folder: null },
    ];
    render(<DocumentsPage />);

    expect(screen.getAllByText("Not everyone can see this")).toHaveLength(1);
  });

  it("draws the lock on a pinned card too", () => {
    foldersQuery.data = [
      {
        id: "f-1",
        name: "Governance",
        sort_order: 0,
        pinned_at: "2026-11-11T00:00:00Z",
        who_can_see: ["tier:t-exec"],
      },
    ];
    documentsQuery.data = [{ ...BYLAWS, folder: null }];
    render(<DocumentsPage />);

    const pinned = screen.getByRole("region", { name: "Pinned" });
    expect(
      within(pinned).getByText("Not everyone can see this"),
    ).toBeInTheDocument();
  });

  it("shows a stored list as it is and saves nothing when only looked at", async () => {
    manageGate.granted = true;
    accessQuery.data = { options: [EXEC_TIER, TREASURER], always: ["tier:t-exec"] };
    documentsQuery.data = [{ ...BYLAWS, who_can_see: ["role:r-treasurer"] }];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(
      screen.getByRole("button", { name: "Who can see Chapter bylaws" }),
    );
    const dialog = await screen.findByRole("dialog");
    // Someone above set it to the Treasurer alone; this member's tier joins
    // only when they change the list, as the API adds it on save.
    expect(within(dialog).getByText("Treasurer")).toBeInTheDocument();
    expect(within(dialog).queryByText("Executive board")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockSetAccess).not.toHaveBeenCalled();
  });

  it("waits for an entry before saving an empty Chosen list", async () => {
    manageGate.granted = true;
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(
      screen.getByRole("button", { name: "Who can see Chapter bylaws" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Chosen roles" }));

    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("lets a member outside the tiers lift a list but not set one", async () => {
    manageGate.granted = true;
    accessQuery.data = { options: [EXEC_TIER], always: null };
    documentsQuery.data = [{ ...BYLAWS, who_can_see: ["tier:t-exec"] }];
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(
      screen.getByRole("button", { name: "Who can see Chapter bylaws" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).queryByRole("button", { name: /add to who can see/i }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();

    await user.click(within(dialog).getByRole("radio", { name: "Same as folder" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockSetAccess).toHaveBeenCalledWith({
        id: "doc-1",
        who_can_see: null,
      }),
    );
  });

  it("tells a member outside the tiers why a file with no list can't be limited", async () => {
    manageGate.granted = true;
    accessQuery.data = { options: [EXEC_TIER], always: null };
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(
      screen.getByRole("button", { name: "Who can see Chapter bylaws" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/once you hold a role in one of the chapter/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("radio", { name: "Chosen roles" }),
    ).not.toBeInTheDocument();
  });

  it("creates a folder with its list", async () => {
    manageGate.granted = true;
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /new folder/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/folder name/i), "Finance");
    await user.click(within(dialog).getByRole("radio", { name: "Chosen roles" }));
    await user.click(
      within(dialog).getByRole("button", { name: /add to who can see/i }),
    );
    await user.click(await screen.findByRole("option", { name: /treasurer/i }));
    await user.click(within(dialog).getByRole("button", { name: /^create folder$/i }));

    await waitFor(() =>
      expect(mockCreateFolder).toHaveBeenCalledWith({
        name: "Finance",
        who_can_see: ["role:r-treasurer"],
      }),
    );
  });

  it("leaves the upload panel's field out for a member outside the tiers", async () => {
    accessQuery.data = { options: [EXEC_TIER], always: null };
    render(<DocumentsPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).queryByRole("radio", { name: "Chosen roles" }),
    ).not.toBeInTheDocument();
  });

  it("leaves the field out for a member outside the tiers", async () => {
    manageGate.granted = true;
    accessQuery.data = { options: [EXEC_TIER], always: null };
    const user = userEvent.setup();
    render(<DocumentsPage />);

    await user.click(screen.getByRole("button", { name: /^edit folders$/i }));
    await user.click(screen.getByRole("button", { name: /edit governance/i }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).queryByRole("radio", { name: "Chosen roles" }),
    ).not.toBeInTheDocument();
  });
});
