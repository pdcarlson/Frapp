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
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

const {
  mockCurrentChapter,
  mockRequestUpload,
  mockConfirmUpload,
  mockFetchResource,
  mockUpdateProfessor,
  mockMergeDepartments,
  mockDeleteResource,
  mockPermissions,
  taxonomyData,
  mockChapterId,
  mockToast,
  mockOffline,
  resourcesQuery,
} = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockRequestUpload: vi.fn().mockResolvedValue({}),
  mockConfirmUpload: vi.fn().mockResolvedValue({}),
  mockChapterId: { value: "chap-1" as string | null },
  mockToast: vi.fn(),
  mockFetchResource: vi.fn(),
  mockUpdateProfessor: vi.fn().mockResolvedValue({}),
  mockMergeDepartments: vi.fn().mockResolvedValue({ reassigned: 1 }),
  mockDeleteResource: vi.fn().mockResolvedValue({}),
  mockPermissions: { value: ["backwork:upload", "backwork:admin"] as string[] },
  taxonomyData: {
    departments: [] as unknown[],
    professors: [] as unknown[],
    loading: false,
    failed: false,
  },
  mockOffline: { value: false },
  resourcesQuery: {
    data: [] as unknown[],
    isPending: false,
    isLoading: false,
    fetchStatus: "idle" as "idle" | "fetching" | "paused",
    isError: false,
    refetch: () => undefined as unknown,
  },
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled trigger.
const RESOURCE = {
  id: "bw-1",
  title: "CS 3320 Midterm",
  department_id: null,
  course_number: "3320",
  professor_id: null,
  year: 2026,
  semester: "Fall",
  assignment_type: "Midterm",
  assignment_number: null,
  document_variant: "Student Copy",
  tags: null,
  is_redacted: false,
  created_at: "2026-08-01T00:00:00Z",
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => mockCurrentChapter(),
  useBackworkResources: () => resourcesQuery,
  useFetchBackworkResource: () => mockFetchResource,
  useDeleteBackworkResource: () => ({ mutateAsync: mockDeleteResource }),
  useMyPermissions: () => ({
    data: { permissions: mockPermissions.value },
  }),
  useDepartments: () => ({
    data: taxonomyData.departments,
    isLoading: taxonomyData.loading,
    isError: taxonomyData.failed,
    refetch: vi.fn(),
  }),
  useProfessors: () => ({
    data: taxonomyData.professors,
    isLoading: taxonomyData.loading,
    isError: false,
    refetch: vi.fn(),
  }),
  useRequestBackworkUploadUrl: () => ({
    mutateAsync: mockRequestUpload,
    isPending: false,
  }),
  useConfirmBackworkUpload: () => ({
    mutateAsync: mockConfirmUpload,
    isPending: false,
  }),
  // `<Can>` is mocked below to always render its children, so
  // `BackworkTaxonomyDrawer` (gated on `backwork:admin`) and the row menus'
  // rename and merge dialogs mount in every test in this file — these six
  // need a stub the same as every other hook this component tree reaches.
  useUpdateDepartment: () => ({ mutateAsync: vi.fn() }),
  useDeleteDepartment: () => ({ mutateAsync: vi.fn() }),
  useMergeDepartments: () => ({ mutateAsync: mockMergeDepartments }),
  useUpdateProfessor: () => ({ mutateAsync: mockUpdateProfessor }),
  useDeleteProfessor: () => ({ mutateAsync: vi.fn() }),
  useMergeProfessors: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: mockChapterId.value }),
}));

// Honours backwork `permission` / `anyOf` against `mockPermissions`, with no
// loading or offline branch: the real gate's states are `can-fallback.spec.tsx`'s
// job. Any other permission (the notice's `billing:manage` link) passes.
vi.mock("@/components/shared/can", () => ({
  Can: ({
    children,
    permission,
    anyOf,
  }: {
    children: React.ReactNode;
    permission?: string;
    anyOf?: readonly string[];
  }) => {
    const wanted = permission ? [permission] : (anyOf ?? []);
    const allowed = wanted.some(
      (p) => !p.startsWith("backwork:") || mockPermissions.value.includes(p),
    );
    return allowed ? <>{children}</> : null;
  },
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

const { BackworkPage } = await import("./backwork-page");

const chapter = chapterSubscription(mockCurrentChapter);

/** Closed-dialog state: the trigger is the only button named "Upload". */
const uploadTrigger = () => screen.getByRole("button", { name: /^upload$/i });

function resolvedResourcesQuery() {
  mockChapterId.value = "chap-1";
  resourcesQuery.data = [RESOURCE];
  resourcesQuery.isPending = false;
  resourcesQuery.isLoading = false;
  resourcesQuery.fetchStatus = "idle";
  resourcesQuery.isError = false;
  resourcesQuery.refetch = vi.fn();
}

describe("BackworkPage disabled-query handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedResourcesQuery();
    chapter.active();
  });

  it("offers a retry when offline rather than spinning on a paused query", () => {
    // README §4 item 4. `paused` was routed to the loading copy, so an
    // offline member with no cached archive sat on "Loading backwork"
    // for as long as they stayed offline.
    mockOffline.value = true;
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.fetchStatus = "paused";

    render(<BackworkPage />);

    expect(
      screen.getByText(/backwork unavailable offline/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading backwork")).not.toBeInTheDocument();
  });

  it("announces the load, which moving to the nested state family nearly cost", () => {
    // Same trap as `/documents`: this page renders no top-level `LoadingState`,
    // so the nested one has to carry the announcement or there is none.
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.isLoading = true;
    resourcesQuery.fetchStatus = "fetching";

    render(<BackworkPage />);

    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Loading backwork");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("keeps a loaded archive readable when the connection drops", () => {
    // Same rule as `/documents` and `/polls`: offline replaces the list only
    // when there is nothing loaded to replace.
    mockOffline.value = true;

    render(<BackworkPage />);

    expect(screen.getByText("CS 3320 Midterm")).toBeInTheDocument();
    expect(
      screen.queryByText(/backwork unavailable offline/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the loaded archive through a paused background refetch", () => {
    // Same distinction as `/polls`: a paused *background* refetch keeps the
    // cached rows, so it must not render as a first load.
    resourcesQuery.isPending = false;
    resourcesQuery.isLoading = false;
    resourcesQuery.fetchStatus = "paused";

    render(<BackworkPage />);

    expect(screen.getByText("CS 3320 Midterm")).toBeInTheDocument();
    expect(screen.queryByText("Loading backwork")).not.toBeInTheDocument();
  });

  it("keeps the upload trigger reachable while the list is offline", () => {
    // The offline state is scoped to the Resources list region rather than
    // replacing the page, so it cannot unmount the gated upload dialog above
    // it — the defect `/documents` shipped with its own early returns. (It was
    // the Resources *card* until the greenfield lane flattened it; the scoping
    // is what matters here, not the container.)
    mockOffline.value = true;
    resourcesQuery.data = [];

    render(<BackworkPage />);

    expect(
      screen.getByRole("button", { name: /^upload$/i }),
    ).toBeInTheDocument();
  });

  it("shows an empty chapter-pick state instead of spinning when no chapter is selected", () => {
    mockChapterId.value = null;
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.isLoading = false;
    resourcesQuery.fetchStatus = "idle";

    render(<BackworkPage />);

    expect(screen.queryByText("Loading backwork")).not.toBeInTheDocument();
    expect(screen.getByText("No chapter selected")).toBeInTheDocument();
    expect(
      screen.getByText(/pick a chapter from the switcher/i),
    ).toBeInTheDocument();
  });

  it("does not spin when the resources query is disabled (pending and idle)", () => {
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.isLoading = false;
    resourcesQuery.fetchStatus = "idle";

    render(<BackworkPage />);

    expect(screen.queryByText("Loading backwork")).not.toBeInTheDocument();
  });

  it("still spins while a fetch is actually in flight", () => {
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.isLoading = true;
    resourcesQuery.fetchStatus = "fetching";

    render(<BackworkPage />);

    expect(screen.getByText("Loading backwork")).toBeInTheDocument();
  });

  it("spins when the query is paused (offline) instead of showing an empty library", () => {
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.isLoading = false;
    resourcesQuery.fetchStatus = "paused";

    render(<BackworkPage />);

    expect(screen.getByText("Loading backwork")).toBeInTheDocument();
    expect(
      screen.queryByText("No backwork yet"),
    ).not.toBeInTheDocument();
  });
});

describe("BackworkPage subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvedResourcesQuery();
    /*
      `mockOffline` is module state shared by every case in this file, and this
      block had no reset — it simply held because nothing in it had ever gone
      offline. The in-dialog submit case below does, and without this one leaked
      `true` turned the next seven cases red: a disabled trigger opens no
      dialog, and the offline gate suppresses the subscription notices the
      others assert on. The sibling block at the top of the file already resets
      it for the same reason.
    */
    mockOffline.value = false;
  });

  it("leaves the upload flow alone on an active chapter", () => {
    chapter.active();
    render(<BackworkPage />);

    expect(uploadTrigger()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the upload trigger and names blocker plus recovery when incomplete", () => {
    chapter.incomplete();
    render(<BackworkPage />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");

    // §5 rule 4: disabled, not hidden — the library itself is untouched.
    expect(screen.getByText(/CS 3320 Midterm/)).toBeInTheDocument();
  });

  it("ties the disabled trigger to its explanation for screen readers", () => {
    chapter.incomplete();
    render(<BackworkPage />);

    const describedBy = uploadTrigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("leaves no other write on the surface reachable while blocked", () => {
    // `requestUpload` and `confirmUpload` are the only writes here, and both sit
    // behind the dialog's submit. §5 rule 1 makes that submit *unreachable*
    // rather than merely disabled — the trigger refuses to open onto it — so the
    // check is that the disabled trigger is the whole upload surface.
    chapter.incomplete();
    render(<BackworkPage />);

    const uploadButtons = screen.getAllByRole("button", { name: /^upload$/i });
    expect(uploadButtons).toHaveLength(1);
    expect(uploadButtons[0]).toBeDisabled();
  });

  it("refuses to open the upload form onto an action that cannot succeed", async () => {
    chapter.incomplete();
    render(<BackworkPage />);

    await userEvent.click(uploadTrigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it("closes an already-open upload form when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close request, so a background
    // refetch that revokes the write cannot be caught there. Without this the
    // member finishes a metadata form that is guaranteed to 403.
    chapter.active();
    const { rerender } = render(<BackworkPage />);
    await userEvent.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.pastDue();
    rerender(<BackworkPage />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // Focus lands on the explanation rather than <body>: the trigger it would
    // otherwise return to went disabled in the same commit.
    await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());
  });

  it("leaves Upload enabled with no file and answers the press inline", async () => {
    /*
      This case reverses deliberately. It used to assert Upload was DISABLED
      with no file attached — `controlProps(uploading || !file)`. The framework
      board (`1j`) says "Upload stays enabled" and moves the rejection inline
      onto the field, because a disabled submit over nine optional fields does
      not tell a member which one is wrong.

      What survives the reversal: the press still requests no signed-URL
      ticket, and Cancel is still not gated, since a revoked subscription must
      leave a way out of the form.
    */
    chapter.active();
    render(<BackworkPage />);
    await userEvent.click(uploadTrigger());

    const dialog = within(screen.getByRole("dialog"));
    const submit = dialog.getByRole("button", { name: /^upload$/i });
    expect(submit).toBeEnabled();

    await userEvent.click(submit);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      /choose a file to upload/i,
    );
    expect(mockRequestUpload).not.toHaveBeenCalled();
    expect(dialog.getByRole("button", { name: /cancel/i })).toBeEnabled();
  });

  it("drops a spent inline error when the sheet is reopened after Cancel", async () => {
    // Same hole as `/documents`: Cancel sets the controlled `open` prop
    // directly, so it never reaches `onOpenChange`. The clear lives on the open
    // edge, which every reopen goes through.
    const user = userEvent.setup();
    chapter.active();
    render(<BackworkPage />);

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

  it("keeps the gate on the in-dialog submit, not only on the trigger", async () => {
    /*
      `backwork-page.tsx`'s submit is `{...gate.controlProps(uploading)}`, and
      its comment warns that writing a bare `disabled` after the spread would
      drop the gate. Nothing in this file pinned that: every other
      disabled-assertion here targets the OUTER trigger, and the subscription
      path cannot reach the submit at all, because `useGatedDialog` force-closes
      the dialog the moment the verdict turns blocked.

      Offline is the one block that leaves the dialog standing — it must not
      slam a draft — so it is the only path from which the submit is observable.
      `/documents` already had this case; Backwork did not.
    */
    const user = userEvent.setup();
    chapter.active();
    const { rerender } = render(<BackworkPage />);

    await user.click(uploadTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    mockOffline.value = true;
    rerender(<BackworkPage />);

    // The trigger is `aria-hidden` behind the open dialog, so this resolves to
    // the submit — the control that would actually fire the write.
    const submit = screen.getByRole("button", { name: /^upload$/i });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("title", "Reconnect to make changes.");
  });

  it("names the verdict, not just the rule, when a file is rejected", async () => {
    // Was a toast BODY under a "File too large" title; inline it is the whole
    // error, so it has to say what went wrong. Same case on `/documents`.
    const user = userEvent.setup();
    chapter.active();
    render(<BackworkPage />);
    await user.click(uploadTrigger());

    const dialog = within(screen.getByRole("dialog"));
    const oversized = new File(["x"], "huge.pdf", { type: "application/pdf" });
    // Backwork's own ceiling is 100 MB (#3487), so 40 MB no longer trips it.
    Object.defineProperty(oversized, "size", { value: 110 * 1024 * 1024 });
    await user.upload(dialog.getByLabelText(/^file$/i), oversized);
    await user.click(dialog.getByRole("button", { name: /^upload$/i }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      /too large.*100 MB/i,
    );
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it("takes a 60 MB scan, over the shared 25 MB cap but under backwork's 100 MB", async () => {
    const user = userEvent.setup();
    chapter.active();
    render(<BackworkPage />);
    await user.click(uploadTrigger());

    const dialog = within(screen.getByRole("dialog"));
    const scan = new File(["x"], "scan.pdf", { type: "application/pdf" });
    Object.defineProperty(scan, "size", { value: 60 * 1024 * 1024 });
    await user.upload(dialog.getByLabelText(/^file$/i), scan);
    await user.click(dialog.getByRole("button", { name: /^upload$/i }));

    await waitFor(() => expect(mockRequestUpload).toHaveBeenCalled());
  });

  // #1040: the call site read `download_url` while the API returns
  // `downloadUrl`, so this opened `undefined`. The SDK types this body as
  // `never` (no OpenAPI response schema), so no type catches the wrong key.
  it("opens the signed URL the API actually returns", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    // The real payload: `BackworkService.findById` returns `{ ...resource, downloadUrl }`.
    // A bare `{ downloadUrl }` fixture would pass even if the selector picked
    // some other string field off the row, so spread a realistic resource.
    mockFetchResource.mockResolvedValue({
      ...RESOURCE,
      downloadUrl: "https://signed/exam.pdf",
    });
    chapter.active();
    render(<BackworkPage />);

    try {
      await user.click(
        screen.getByRole("button", { name: /^download cs 3320 midterm$/i }),
      );

      await waitFor(() =>
        expect(open).toHaveBeenCalledWith(
          "https://signed/exam.pdf",
          "_blank",
          "noopener",
        ),
      );
    } finally {
      open.mockRestore();
    }
  });

  it("never gates the reads", () => {
    // `enforceSubscription` returns early for GET, so a lapsed chapter keeps
    // browsing, filtering, and its signed download links.
    chapter.incomplete();
    render(<BackworkPage />);

    expect(screen.getByRole("button", { name: /^course$/i })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /^download cs 3320 midterm$/i }),
    ).toBeEnabled();
    expect(screen.getByLabelText(/^search backwork$/i)).toBeEnabled();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common path
    // to the very 403 this gate prevents: a trigger that paints enabled for that
    // round trip still lets a fast click reach a doomed form.
    chapter.loading();
    render(<BackworkPage />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
  });

  it("blocks paid-ops uploads immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<BackworkPage />);

    expect(uploadTrigger()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than checkout", () => {
    chapter.canceled();
    render(<BackworkPage />);

    expect(uploadTrigger()).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // Deliberately asymmetric with `<Can>`. An unresolved subscription most
    // likely belongs to a paying chapter, and locking uploads over a failed
    // fetch is worse than the late 403; the server guard is still the
    // enforcement.
    chapter.unreadable();
    render(<BackworkPage />);

    expect(uploadTrigger()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("BackworkPage upload allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvedResourcesQuery();
    chapter.active();
    mockRequestUpload.mockResolvedValue({
      upload_url: "https://storage.example/put",
      storage_path: "chapters/chap-1/backwork/res-1/notes.gif",
    });
    mockConfirmUpload.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    vi.spyOn(globalThis.crypto.subtle, "digest").mockResolvedValue(
      new Uint8Array(32).buffer,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists .gif on the file input (regression: previously omitted while Documents and the API allowed it)", async () => {
    render(<BackworkPage />);
    await userEvent.click(uploadTrigger());

    const input = screen.getByLabelText(/^file$/i);
    const accept = input.getAttribute("accept") ?? "";
    expect(accept.split(",")).toContain(".gif");
    expect(accept.split(",")).toContain(".doc");
  });

  it("requests an upload URL for a GIF instead of rejecting it client-side", async () => {
    render(<BackworkPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    const file = new File(["GIF89a"], "notes.gif", { type: "image/gif" });
    // fireEvent.change, not userEvent.upload: user-event filters against
    // `accept`, and a long comma-joined list has been flaky about matching
    // `.gif` even when the attribute contains it.
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: { files: [file] },
    });

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "File type not allowed" }),
    );
    await waitFor(() => expect(mockRequestUpload).toHaveBeenCalledTimes(1));
    expect(mockRequestUpload).toHaveBeenCalledWith({
      filename: "notes.gif",
      content_type: "image/gif",
    });
    // The resolved type plus x-upsert, exactly as the inline PUT sent them
    // before it moved into `putSignedUpload` (#2614).
    expect(fetch).toHaveBeenCalledWith(
      "https://storage.example/put",
      expect.objectContaining({
        body: file,
        headers: { "content-type": "image/gif", "x-upsert": "true" },
      }),
    );
  });

  it("shows the storage status when the bucket refuses the file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response),
    );
    render(<BackworkPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    const file = new File(["GIF89a"], "notes.gif", { type: "image/gif" });
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: { files: [file] },
    });
    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't upload backwork",
          description: "Storage rejected upload (400).",
        }),
      ),
    );
    expect(mockConfirmUpload).not.toHaveBeenCalled();
  });

  it("toasts when the upload-URL ticket omits the signed URL", async () => {
    mockRequestUpload.mockResolvedValue({
      storage_path: "chapters/chap-1/backwork/res-1/notes.pdf",
    });

    render(<BackworkPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    const file = new File(["%PDF-1.4"], "notes.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: { files: [file] },
    });

    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't upload backwork",
          description: "Upload URL response missing signed URL or storage path.",
        }),
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(mockConfirmUpload).not.toHaveBeenCalled();
  });
});

describe("BackworkPage year and assignment-number guard (#2206)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvedResourcesQuery();
    chapter.active();
    mockRequestUpload.mockResolvedValue({
      upload_url: "https://storage.example/put",
      storage_path: "chapters/chap-1/backwork/res-1/notes.pdf",
    });
    mockConfirmUpload.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    vi.spyOn(globalThis.crypto.subtle, "digest").mockResolvedValue(
      new Uint8Array(32).buffer,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function openUpload() {
    render(<BackworkPage />);
    await userEvent.click(uploadTrigger());
    const dialog = screen.getByRole("dialog");
    return {
      dialog,
      year: within(dialog).getByLabelText(/^year$/i),
      assignment: within(dialog).getByLabelText(/assignment number/i),
    };
  }

  it("keeps the last whole number in both fields through a negative or a decimal", async () => {
    const { year, assignment } = await openUpload();
    expectRefusedEntriesKeep(year, "2026");
    expectRefusedEntriesKeep(assignment, "2");
  });

  it("reads an emptied or unparseable field as left blank", async () => {
    const { year, assignment } = await openUpload();
    expectClearingEntriesEmpty(year, "2026");
    expectClearingEntriesEmpty(assignment, "2");
  });

  it("keeps the 0 left by deleting a leading digit, then refuses it before the upload", async () => {
    const { dialog, assignment } = await openUpload();
    fireEvent.change(assignment, { target: { value: "10" } });
    fireEvent.change(assignment, { target: { value: "0" } });
    expect(assignment).toHaveValue(0);

    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: {
        files: [new File(["%PDF"], "notes.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.submit(document.getElementById("backwork-upload-form")!);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Check the year and assignment number",
        }),
      ),
    );
    // Refused before the file reaches storage, so nothing is left orphaned.
    expect(mockRequestUpload).not.toHaveBeenCalled();
    expect(mockConfirmUpload).not.toHaveBeenCalled();
  });

  it("refuses a year under the API's 1900 before the upload", async () => {
    const { dialog, year } = await openUpload();
    fireEvent.change(year, { target: { value: "2" } });
    expect(year).toHaveValue(2);

    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: {
        files: [new File(["%PDF"], "notes.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.submit(document.getElementById("backwork-upload-form")!);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Check the year and assignment number",
        }),
      ),
    );
    expect(mockRequestUpload).not.toHaveBeenCalled();
  });

  it("confirms with the kept whole numbers, and omits a blank one", async () => {
    const { dialog, year, assignment } = await openUpload();
    fireEvent.change(year, { target: { value: "2026" } });
    fireEvent.change(year, { target: { value: "1.5" } });
    fireEvent.change(assignment, { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText(/^file$/i), {
      target: {
        files: [new File(["%PDF"], "notes.pdf", { type: "application/pdf" })],
      },
    });
    const submit = within(dialog).getByRole("button", { name: /^upload$/i });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    const body = mockConfirmUpload.mock.calls[0]![0];
    expect(body.year).toBe(2026);
    expect(body.assignment_number).toBeUndefined();
  });
});

describe("BackworkPage library (2026-11-05 redesign)", () => {
  const LIBRARY = [
    {
      ...RESOURCE,
      id: "bw-cogs",
      title: "Cog Sci Homework 2",
      department_id: "dept-cogs",
      course_number: "2120",
      professor_id: "prof-bram",
      year: 2026,
      semester: "Fall",
      assignment_type: "Homework",
      document_variant: "Student Copy",
      is_redacted: true,
      tags: ["curved"],
      created_at: "2026-11-03T15:00:00Z",
    },
    {
      ...RESOURCE,
      id: "bw-csci",
      title: "Data Structures Exam 1",
      department_id: "dept-csci",
      course_number: "1200",
      professor_id: "prof-thompson",
      year: 2025,
      semester: "Spring",
      assignment_type: "Exam",
      document_variant: "Answer Key",
      created_at: "2026-10-30T15:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    resolvedResourcesQuery();
    resourcesQuery.data = LIBRARY;
    taxonomyData.departments = [
      { id: "dept-cogs", code: "COGS", name: "Cognitive Science" },
      { id: "dept-csci", code: "CSCI", name: null },
    ];
    taxonomyData.professors = [
      { id: "prof-bram", name: "Bram" },
      { id: "prof-thompson", name: "Thompson" },
    ];
    mockPermissions.value = ["backwork:upload", "backwork:admin"];
    chapter.active();
  });

  afterEach(() => {
    taxonomyData.departments = [];
    taxonomyData.professors = [];
    taxonomyData.loading = false;
    taxonomyData.failed = false;
    mockOffline.value = false;
  });

  const titles = () =>
    screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p")?.textContent);

  it("lists newest term first, with course, professor, term and copy on each row", () => {
    render(<BackworkPage />);

    expect(titles()).toEqual(["Cog Sci Homework 2", "Data Structures Exam 1"]);
    const first = screen.getAllByRole("listitem")[0]!;
    expect(within(first).getByText("COGS 2120")).toBeInTheDocument();
    expect(within(first).getByText("Bram")).toBeInTheDocument();
    expect(within(first).getByText("Fall 2026")).toBeInTheDocument();
    expect(within(first).getByText("Student copy")).toBeInTheDocument();
    expect(within(first).getByRole("img", { name: "Redacted" })).toBeInTheDocument();
    expect(within(first).getByText("Homework")).toBeInTheDocument();
  });

  it("does not ask for any download link until Download is pressed", () => {
    // The old list mounted a detail query per row, so every page load minted a
    // signed URL for every file in the library.
    render(<BackworkPage />);
    expect(mockFetchResource).not.toHaveBeenCalled();
  });

  it("searches as you type, forgiving a typo", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    await user.type(screen.getByLabelText(/^search backwork$/i), "cog sci homwork 2");

    await waitFor(() => expect(titles()).toEqual(["Cog Sci Homework 2"]));
    expect(screen.getByText("1 of 2 files")).toBeInTheDocument();
  });

  it("searches tags and professors, which the old box never did", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);
    const search = screen.getByLabelText(/^search backwork$/i);

    await user.type(search, "curved");
    await waitFor(() => expect(titles()).toEqual(["Cog Sci Homework 2"]));

    await user.clear(search);
    await user.type(search, "thompsn");
    await waitFor(() => expect(titles()).toEqual(["Data Structures Exam 1"]));
  });

  it("applies a filter chip the moment it is picked, and clears it", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    await user.click(screen.getByRole("button", { name: /^professor$/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Thompson" }));

    await waitFor(() => expect(titles()).toEqual(["Data Structures Exam 1"]));
    expect(
      screen.getByRole("button", { name: /^professor: thompson$/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    await waitFor(() => expect(titles()).toHaveLength(2));
  });

  it("offers a way out when nothing matches", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    await user.type(screen.getByLabelText(/^search backwork$/i), "organic chemistry");
    expect(await screen.findByText("No files match")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /clear search and filters/i }),
    );
    await waitFor(() => expect(titles()).toHaveLength(2));
  });

  it("opens the same actions on right-click as on the row's More button", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);
    const row = screen.getAllByRole("listitem")[0]!;

    fireEvent.contextMenu(row);
    const fromRightClick = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    await user.click(
      within(row).getByRole("button", { name: /^more for cog sci homework 2$/i }),
    );
    const fromButton = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );

    expect(fromButton).toEqual(fromRightClick);
    expect(fromRightClick).toEqual([
      "Download",
      "Show only COGS 2120",
      "Show only Bram",
      "Rename Bram…",
      "Merge Bram into…",
      "Name the COGS department…",
      "Merge COGS into…",
      "Delete file…",
    ]);
  });

  it("keeps officer tools out of a member's menu", async () => {
    mockPermissions.value = ["backwork:upload"];
    render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual(["Download", "Show only COGS 2120", "Show only Bram"]);
  });

  it("leaves the browser's own menu on selected text", async () => {
    render(<BackworkPage />);
    const row = screen.getAllByRole("listitem")[0]!;
    const title = within(row).getByText("Cog Sci Homework 2", { selector: "span" });
    const range = document.createRange();
    range.selectNodeContents(title);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    try {
      fireEvent.pointerDown(title, { button: 2 });
      fireEvent.contextMenu(title);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    } finally {
      window.getSelection()!.removeAllRanges();
    }
  });

  it("filters to a row's course from its menu", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[1]!);
    await user.click(await screen.findByRole("menuitem", { name: "Show only CSCI 1200" }));

    await waitFor(() => expect(titles()).toEqual(["Data Structures Exam 1"]));
  });

  it("deletes a file only after the officer confirms", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Delete file…" }));

    const dialog = await screen.findByRole("dialog");
    expect(mockDeleteResource).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(mockDeleteResource).toHaveBeenCalledWith("bw-cogs"));
  });

  it("keeps the file when the officer cancels the delete", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Delete file…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockDeleteResource).not.toHaveBeenCalled();
  });

  it("disables an officer's row writes on a lapsed chapter, but not download or filters", async () => {
    chapter.pastDue();
    render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    const item = async (name: string) => screen.findByRole("menuitem", { name });
    for (const name of [
      "Rename Bram…",
      "Merge Bram into…",
      "Name the COGS department…",
      "Merge COGS into…",
      "Delete file…",
    ]) {
      expect(await item(name)).toHaveAttribute("aria-disabled", "true");
    }
    for (const name of ["Download", "Show only COGS 2120", "Show only Bram"]) {
      expect(await item(name)).not.toHaveAttribute("aria-disabled");
    }
  });

  it("highlights what the search matched, in the title, course and term", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    await user.type(screen.getByLabelText("Search backwork"), "homewrk cogs fall");
    await waitFor(() => expect(titles()).toEqual(["Cog Sci Homework 2"]));
    const marks = Array.from(document.querySelectorAll("mark")).map((m) => m.textContent);
    expect(marks).toEqual(expect.arrayContaining(["Homework", "COGS", "Fall"]));
  });

  it("drops a filter once no file has its value, instead of emptying the list", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Show only Bram" }));
    await waitFor(() => expect(titles()).toEqual(["Cog Sci Homework 2"]));

    // A merge moved Bram's files to Thompson and deleted Bram.
    resourcesQuery.data = LIBRARY.map((r) => ({ ...r, professor_id: "prof-thompson" }));
    taxonomyData.professors = [{ id: "prof-thompson", name: "Thompson" }];
    rerender(<BackworkPage />);

    await waitFor(() => expect(titles()).toHaveLength(2));
    expect(screen.getByRole("button", { name: /^professor$/i })).toBeInTheDocument();
  });

  it("ties a disabled row write to the notice, and gates the clean-up entry", async () => {
    const user = userEvent.setup();
    chapter.pastDue();
    render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    const rename = await screen.findByRole("menuitem", { name: "Rename Bram…" });
    const noticeId = rename.getAttribute("aria-describedby");
    expect(noticeId).toBeTruthy();
    expect(document.getElementById(noticeId!)).toHaveTextContent(/past due/i);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /^more backwork options$/i }));
    expect(
      await screen.findByRole("menuitem", { name: /clean up professors and departments/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the lapsed-chapter notice to an officer who cannot upload", () => {
    mockPermissions.value = ["backwork:admin"];
    chapter.pastDue();
    render(<BackworkPage />);
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("does not delete when the chapter lapses while the confirm is open", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Delete file…" }));
    const dialog = await screen.findByRole("dialog");
    chapter.pastDue();
    rerender(<BackworkPage />);
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockDeleteResource).not.toHaveBeenCalled();
  });

  it("keeps a dropped filter dropped when a file with its value comes back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Show only Bram" }));
    resourcesQuery.data = LIBRARY.map((r) => ({ ...r, professor_id: "prof-thompson" }));
    rerender(<BackworkPage />);
    await waitFor(() => expect(titles()).toHaveLength(2));

    resourcesQuery.data = LIBRARY;
    rerender(<BackworkPage />);
    await waitFor(() => expect(titles()).toHaveLength(2));
  });

  it("highlights the course when the search typed it joined", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);
    await user.type(screen.getByLabelText("Search backwork"), "cogs2120");
    await waitFor(() => expect(titles()).toEqual(["Cog Sci Homework 2"]));
    const marks = Array.from(document.querySelectorAll("mark")).map((m) => m.textContent);
    expect(marks).toEqual(expect.arrayContaining(["COGS", "2120"]));
  });

  it("waits for the departments and professors its rows join on", () => {
    taxonomyData.loading = true;
    render(<BackworkPage />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Loading backwork");
  });

  it("shows the error state when the department read fails", () => {
    taxonomyData.failed = true;
    render(<BackworkPage />);
    expect(screen.getByText("Couldn't load backwork")).toBeInTheDocument();
  });

  it("disables the menu's Download while that file's link is on its way", async () => {
    const user = userEvent.setup();
    mockFetchResource.mockImplementation(() => new Promise(() => undefined));
    render(<BackworkPage />);
    await user.click(screen.getByRole("button", { name: "Download Cog Sci Homework 2" }));

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    expect(await screen.findByRole("menuitem", { name: "Download" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("says offline, not the subscription, when a confirmed delete can't send", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BackworkPage />);
    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Delete file…" }));
    const dialog = await screen.findByRole("dialog");
    mockOffline.value = true;
    rerender(<BackworkPage />);
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/offline/i) }),
      ),
    );
    expect(mockDeleteResource).not.toHaveBeenCalled();
  });

  it("says when the list hit the server's row cap", () => {
    resourcesQuery.data = Array.from({ length: 1000 }, (_, i) => ({
      ...RESOURCE,
      id: `bw-${i}`,
    }));
    render(<BackworkPage />);
    expect(screen.getByText(/showing the newest 1,000 files/i)).toBeInTheDocument();
  });

  it("keeps each download's spinner until that download finishes", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const pending = new Map<string, (value: unknown) => void>();
    mockFetchResource.mockImplementation(
      (id: string) => new Promise((resolve) => pending.set(id, resolve)),
    );
    try {
      render(<BackworkPage />);
      const cogs = screen.getByRole("button", { name: "Download Cog Sci Homework 2" });
      const csci = screen.getByRole("button", { name: "Download Data Structures Exam 1" });
      await user.click(cogs);
      await user.click(csci);
      expect(cogs).toBeDisabled();
      expect(csci).toBeDisabled();

      pending.get("bw-cogs")!({ downloadUrl: "https://signed/a.pdf" });
      await waitFor(() => expect(cogs).toBeEnabled());
      expect(csci).toBeDisabled();
    } finally {
      open.mockRestore();
    }
  });

  it("opens the clean-up drawer from the page's More menu", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    await user.click(screen.getByRole("button", { name: /^more backwork options$/i }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: /clean up professors and departments/i,
      }),
    );

    expect(
      await screen.findByText(/manage departments & professors/i),
    ).toBeInTheDocument();
  });

  it("renames a row's professor from its menu", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);

    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Rename Bram…" }));

    const field = await screen.findByLabelText(/^name$/i);
    expect(field).toHaveValue("Bram");
    await user.clear(field);
    await user.type(field, "Dr. Bram");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(mockUpdateProfessor).toHaveBeenCalledWith({
        id: "prof-bram",
        body: { name: "Dr. Bram" },
      }),
    );
  });

  it("keeps an open rename's Save shut once the chapter lapses", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BackworkPage />);
    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Rename Bram…" }));
    const field = await screen.findByLabelText(/^name$/i);
    await user.type(field, "x");
    chapter.pastDue();
    rerender(<BackworkPage />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.submit(field.closest("form")!);
    expect(mockUpdateProfessor).not.toHaveBeenCalled();
  });

  it("merges the row's department into the one picked, source first", async () => {
    const user = userEvent.setup();
    render(<BackworkPage />);
    fireEvent.contextMenu(screen.getAllByRole("listitem")[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "Merge COGS into…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Merge into" }));
    await user.click(await screen.findByRole("option", { name: "CSCI" }));
    await user.click(within(dialog).getByRole("button", { name: /^merge$/i }));
    await waitFor(() =>
      expect(mockMergeDepartments).toHaveBeenCalledWith({
        id: "dept-cogs",
        targetId: "dept-csci",
      }),
    );
  });
});
