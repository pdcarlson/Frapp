import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatReport, ChatReportStatus } from "@repo/hooks";
import { networkMock } from "@/tests/network";

/*
 * The officer report queue. What is pinned here is the contract in
 * `spec/behavior/chat/README.md` § Report and block as the card has to honour
 * it — the evidence snapshot is what renders, Remove sends the report id and
 * nothing else, Remove exists only where the server can do it, and every
 * async state is a real state rather than a blank card.
 *
 * `<Can>` runs for real over a stubbed permission query, because the gate is
 * part of the contract: the routes need `members:view` AND `channels:manage`.
 */

const NOW = Date.parse("2026-09-22T12:00:00Z");

const {
  mockOffline,
  mockToast,
  permissions,
  reportsByStatus,
  mockResolve,
  mockRemove,
  mockRefetch,
  requestedStatuses,
} = vi.hoisted(() => ({
  mockOffline: { value: false },
  mockToast: vi.fn(),
  permissions: { value: ["members:view", "channels:manage"] as string[] },
  reportsByStatus: {
    value: {} as Record<string, Record<string, unknown>>,
  },
  mockResolve: vi.fn(),
  mockRemove: vi.fn(),
  mockRefetch: vi.fn(),
  requestedStatuses: [] as string[],
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    // The pure display-name helpers run for real, so the author label is the
    // one chat renders, not a stub's idea of it.
    resolveAuthorLabel: actual.resolveAuthorLabel,
    memberFallbackLabel: actual.memberFallbackLabel,
    useMyPermissions: () => ({
      data: { permissions: permissions.value },
      isPending: false,
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn(),
    }),
    useChatReports: (status: ChatReportStatus) => {
      requestedStatuses.push(status);
      return {
        data: undefined,
        isPending: false,
        isLoading: false,
        isError: false,
        fetchStatus: "idle",
        refetch: mockRefetch,
        ...reportsByStatus.value[status],
      };
    },
    useResolveChatReport: () => ({ mutateAsync: mockResolve }),
    useRemoveReportedMessage: () => ({ mutateAsync: mockRemove }),
    useMemberDisplayNames: () => ({
      nameFor: (id: string) =>
        ({ "u-sender": "Harper Lane", "u-officer": "Alex Chen" })[id] ?? null,
    }),
    useNow: () => NOW,
  };
});

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

const { ChatReportsCard } = await import("./chat-reports-card");

function report(overrides: Partial<ChatReport> = {}): ChatReport {
  return {
    id: "r-1",
    chapter_id: "chap-1",
    message_id: "m-1",
    reported_content: "You should quit the chapter, nobody wants you here",
    reported_sender_id: "u-sender",
    reported_author_name: null,
    reason: "harassment",
    details: "Third message like this this week",
    status: "open",
    created_at: "2026-09-22T11:55:00Z",
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

function settled(rows: ChatReport[]) {
  return { data: rows, isPending: false, isLoading: false, isError: false };
}

const row = (text: RegExp | string) =>
  screen.getByText(text).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  mockOffline.value = false;
  permissions.value = ["members:view", "channels:manage"];
  requestedStatuses.length = 0;
  reportsByStatus.value = { open: settled([report()]) };
  mockResolve.mockResolvedValue({});
  mockRemove.mockResolvedValue({});
});

describe("ChatReportsCard — what a row shows", () => {
  it("renders the report's own evidence: snapshot text, author, reason, note and age", () => {
    render(<ChatReportsCard />);

    const item = row(/nobody wants you here/);
    expect(within(item).getByText("Harper Lane")).toBeInTheDocument();
    expect(within(item).getByText("Harassment")).toBeInTheDocument();
    expect(
      within(item).getByText(/Third message like this this week/),
    ).toBeInTheDocument();
    expect(
      within(item).getByText(/Reported 5 minutes ago/),
    ).toBeInTheDocument();
  });

  it("names an imported author from the snapshot when there is no Signet sender", () => {
    reportsByStatus.value = {
      open: settled([
        report({
          reported_sender_id: null,
          reported_author_name: "old_handle",
        }),
      ]),
    };
    render(<ChatReportsCard />);
    expect(screen.getByText("old_handle")).toBeInTheDocument();
  });

  it("gives every reason a human label, never the raw token", () => {
    reportsByStatus.value = {
      open: settled([
        report({ id: "a", reason: "self_harm", reported_content: "a" }),
        report({ id: "b", reason: "hate", reported_content: "b" }),
        report({ id: "c", reason: "violence", reported_content: "c" }),
      ]),
    };
    render(<ChatReportsCard />);
    expect(screen.getByText("Self-harm")).toBeInTheDocument();
    expect(screen.getByText("Hate speech")).toBeInTheDocument();
    expect(screen.getByText("Violence or threats")).toBeInTheDocument();
    expect(screen.queryByText("self_harm")).not.toBeInTheDocument();
  });

  it("says so when the reported message had no text", () => {
    reportsByStatus.value = {
      open: settled([report({ reported_content: null })]),
    };
    render(<ChatReportsCard />);
    expect(screen.getByText("This message had no text.")).toBeInTheDocument();
  });
});

describe("ChatReportsCard — status tabs", () => {
  it("opens on the Open queue and reads only that slice", () => {
    render(<ChatReportsCard />);
    expect(screen.getByRole("tab", { name: "Open" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new Set(requestedStatuses)).toEqual(new Set(["open"]));
  });

  it("switches slice per tab and shows who resolved a closed report, with no actions", async () => {
    const user = userEvent.setup();
    reportsByStatus.value = {
      open: settled([report()]),
      dismissed: settled([
        report({
          id: "r-9",
          status: "dismissed",
          reported_content: "just a joke between friends",
          reason: "other",
          resolved_by: "u-officer",
          resolved_at: "2026-09-22T09:00:00Z",
        }),
      ]),
    };
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("tab", { name: "Dismissed" }));

    expect(requestedStatuses).toContain("dismissed");
    const item = row(/just a joke between friends/);
    expect(
      within(item).getByText(/Dismissed by Alex Chen/),
    ).toBeInTheDocument();
    expect(within(item).getByText("3 hours ago")).toBeInTheDocument();
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/nobody wants you here/)).not.toBeInTheDocument();
  });

  it.each([
    ["Open", "open", "No open reports"],
    ["Reviewed", "reviewed", "No reviewed reports"],
    ["Actioned", "actioned", "No actioned reports"],
    ["Dismissed", "dismissed", "No dismissed reports"],
  ] as const)(
    "renders the %s tab's own empty state",
    async (label, status, title) => {
      const user = userEvent.setup();
      reportsByStatus.value = { [status]: settled([]), open: settled([]) };
      render(<ChatReportsCard />);
      await user.click(screen.getByRole("tab", { name: label }));
      expect(screen.getByText(title)).toBeInTheDocument();
    },
  );
});

describe("ChatReportsCard — async states", () => {
  it("shows a skeleton while the slice loads", () => {
    reportsByStatus.value = {
      open: { isPending: true, isLoading: true, fetchStatus: "fetching" },
    };
    render(<ChatReportsCard />);
    expect(screen.getByText("Loading reports...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("shows an error with a retry that refetches the slice", async () => {
    const user = userEvent.setup();
    reportsByStatus.value = {
      open: {
        isPending: false,
        isError: true,
        fetchStatus: "idle",
        error: { statusCode: 500 },
      },
    };
    render(<ChatReportsCard />);

    expect(screen.getByText("Couldn't load reports")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the rows it holds when only a background refetch failed", () => {
    reportsByStatus.value = {
      open: {
        ...settled([report()]),
        isError: true,
        error: { statusCode: 500 },
      },
    };
    render(<ChatReportsCard />);
    expect(screen.getByText(/nobody wants you here/)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load reports")).not.toBeInTheDocument();
  });

  it("shows an offline state rather than an empty queue when nothing is cached", () => {
    mockOffline.value = true;
    reportsByStatus.value = {
      open: { data: undefined, isPending: true, fetchStatus: "paused" },
    };
    render(<ChatReportsCard />);
    expect(screen.getByText("Reports unavailable offline")).toBeInTheDocument();
    expect(screen.queryByText("No open reports")).not.toBeInTheDocument();
  });
});

describe("ChatReportsCard — resolving", () => {
  it("marks a report reviewed through the resolve hook", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));

    expect(mockResolve).toHaveBeenCalledWith({ id: "r-1", status: "reviewed" });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      description: "Report marked reviewed.",
    });
  });

  it("dismisses a report through the resolve hook", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(mockResolve).toHaveBeenCalledWith({
      id: "r-1",
      status: "dismissed",
    });
    expect(mockToast).toHaveBeenCalledWith({
      description: "Report dismissed.",
    });
  });

  it("holds the row's controls while its write is in flight, and leaves other rows live", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    mockResolve.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    reportsByStatus.value = {
      open: settled([
        report(),
        report({ id: "r-2", reported_content: "second report" }),
      ]),
    };
    render(<ChatReportsCard />);

    const first = row(/nobody wants you here/);
    await user.click(within(first).getByRole("button", { name: "Dismiss" }));

    expect(first).toHaveAttribute("aria-busy", "true");
    for (const button of within(first).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    for (const button of within(row("second report")).getAllByRole("button")) {
      expect(button).toBeEnabled();
    }

    finish({});
    await waitFor(() =>
      expect(
        within(first).getByRole("button", { name: "Dismiss" }),
      ).toBeEnabled(),
    );
  });

  it("toasts the server's reason when a resolve is refused", async () => {
    const user = userEvent.setup();
    mockResolve.mockRejectedValue({
      statusCode: 404,
      message: "Report not found",
    });
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(mockToast).toHaveBeenCalledWith({
      variant: "destructive",
      description: "Report not found",
    });
  });

  it("disables every write offline and says why, rather than failing on click", () => {
    mockOffline.value = true;
    render(<ChatReportsCard />);

    for (const name of ["Mark reviewed", "Dismiss", "Remove message"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Reconnect to make changes.");
    }
  });
});

describe("ChatReportsCard — removing the reported message", () => {
  it("asks first, stating it is one message, for everyone, and that the conversation stays closed", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Remove message" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Remove this message?"),
    ).toBeInTheDocument();
    const description = within(dialog).getByText(/this one message/);
    expect(description).toHaveTextContent(/for everyone/);
    expect(description).toHaveTextContent(/marks the report actioned/);
    expect(description).toHaveTextContent(/officers can't open it/);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("does nothing when the officer cancels", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Remove message" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("sends the report id alone once confirmed", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Remove message" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove message" }),
    );

    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
    expect(mockRemove).toHaveBeenCalledWith("r-1");
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      description: "Message removed. The report is marked actioned.",
    });
  });

  it("offers no Remove when the message is gone, and says why", () => {
    reportsByStatus.value = { open: settled([report({ message_id: null })]) };
    render(<ChatReportsCard />);

    expect(
      screen.queryByRole("button", { name: "Remove message" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "The message no longer exists, so there's nothing to remove.",
      ),
    ).toBeInTheDocument();
    // Resolving is still the way out.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  it("retires Remove after a 409 on a report that stays open, so it cannot refuse twice", async () => {
    const user = userEvent.setup();
    mockRemove.mockRejectedValue({
      statusCode: 409,
      message: "The reported message is already deleted",
    });
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Remove message" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove message" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "The sender already deleted this message, so there's nothing to remove.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Remove message" }),
    ).not.toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith({
      variant: "destructive",
      description: "The reported message is already deleted",
    });
  });

  it("keeps Remove after a failure that is not a 409", async () => {
    const user = userEvent.setup();
    mockRemove.mockRejectedValue({ statusCode: 500 });
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: "Remove message" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove message" }),
    );

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        description: "Couldn't remove the message.",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Remove message" }),
    ).toBeInTheDocument();
  });
});

describe("ChatReportsCard — the gate", () => {
  it("explains instead of offering a queue that can only 403 when members:view is missing", () => {
    permissions.value = ["channels:manage"];
    render(<ChatReportsCard />);

    expect(
      screen.getByText(
        /needs the members:view and channels:manage permissions/,
      ),
    ).toBeInTheDocument();
    expect(requestedStatuses).toEqual([]);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("admits the wildcard", () => {
    permissions.value = ["*"];
    render(<ChatReportsCard />);
    expect(screen.getByRole("tab", { name: "Open" })).toBeInTheDocument();
  });
});
