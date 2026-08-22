import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const {
  mockCurrentChapter,
  mockRequestUpload,
  mockConfirmUpload,
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

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useBackworkResources: () => resourcesQuery,
  useBackworkResource: () => ({ refetch: vi.fn() }),
  useDepartments: () => ({ data: [] }),
  useProfessors: () => ({ data: [] }),
  useRequestBackworkUploadUrl: () => ({
    mutateAsync: mockRequestUpload,
    isPending: false,
  }),
  useConfirmBackworkUpload: () => ({
    mutateAsync: mockConfirmUpload,
    isPending: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId: mockChapterId.value }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: mockOffline.value }),
}));

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
    // offline member with no cached archive sat on "Loading backwork..."
    // for as long as they stayed offline.
    mockOffline.value = true;
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.fetchStatus = "paused";

    render(<BackworkPage />);

    expect(
      screen.getByText(/backwork unavailable offline/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading backwork...")).not.toBeInTheDocument();
  });

  it("keeps the upload trigger reachable while the list is offline", () => {
    // The offline state is scoped to the Resources card rather than replacing
    // the page, so it cannot unmount the gated upload dialog above it — the
    // defect `/documents` shipped with its own early returns.
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

    expect(screen.queryByText("Loading backwork...")).not.toBeInTheDocument();
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

    expect(screen.queryByText("Loading backwork...")).not.toBeInTheDocument();
  });

  it("still spins while a fetch is actually in flight", () => {
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.isLoading = true;
    resourcesQuery.fetchStatus = "fetching";

    render(<BackworkPage />);

    expect(screen.getByText("Loading backwork...")).toBeInTheDocument();
  });

  it("spins when the query is paused (offline) instead of showing an empty library", () => {
    resourcesQuery.data = undefined as unknown as unknown[];
    resourcesQuery.isPending = true;
    resourcesQuery.isLoading = false;
    resourcesQuery.fetchStatus = "paused";

    render(<BackworkPage />);

    expect(screen.getByText("Loading backwork...")).toBeInTheDocument();
    expect(
      screen.queryByText("No backwork matches this view"),
    ).not.toBeInTheDocument();
  });
});

describe("BackworkPage subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvedResourcesQuery();
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

  it("keeps the submit's own file guard on top of the gate", async () => {
    // The submit is `controlProps(uploading || !file)`, not a bare `disabled`:
    // spreading the gate and then writing `disabled` afterwards would drop it.
    chapter.active();
    render(<BackworkPage />);
    await userEvent.click(uploadTrigger());

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /^upload$/i }),
    ).toBeDisabled();
    // Cancel is not a write, and a revoked subscription must still leave a way
    // out of the form.
    expect(
      within(dialog).getByRole("button", { name: /cancel/i }),
    ).toBeEnabled();
  });

  it("never gates the reads", () => {
    // `enforceSubscription` returns early for GET, so a lapsed chapter keeps
    // browsing, filtering, and its signed download links.
    chapter.incomplete();
    render(<BackworkPage />);

    expect(screen.getByRole("button", { name: /apply filters/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^clear$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /download/i })).toBeEnabled();
    expect(screen.getByLabelText(/^search$/i)).toBeEnabled();
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true } as Response),
    );
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
  });
});
