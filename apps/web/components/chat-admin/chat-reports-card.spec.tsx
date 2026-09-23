import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatReport, ChatReportStatus } from "@repo/hooks";
import { formatLocaleDateTime } from "@repo/formatting";
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
  removeTimeline,
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
  removeTimeline: { value: undefined as unknown },
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    // The pure display-name helpers run for real, so the author label is the
    // one chat renders, not a stub's idea of it.
    resolveAuthorLabel: actual.resolveAuthorLabel,
    memberFallbackLabel: actual.memberFallbackLabel,
    // Real, so the toast is decided by the same classification the hook uses
    // to decide what to refresh.
    removalOutcomeUnknown: actual.removalOutcomeUnknown,
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
    useRemoveReportedMessage: (timeline: unknown) => {
      removeTimeline.value = timeline;
      return { mutateAsync: mockRemove };
    },
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
const { reportedMessageTimeline } =
  await import("@/lib/chat/reported-message-reads");

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

/** The default report's filing time, as its accessible names read it. */
const FILED = formatLocaleDateTime("2026-09-22T11:55:00Z");

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

describe("ChatReportsCard — accessible names", () => {
  it("names every control after the message and the report it acts on, so rows cannot be confused", () => {
    reportsByStatus.value = {
      open: settled([
        report(),
        report({
          id: "r-2",
          reported_sender_id: null,
          reported_author_name: "old_handle",
          reported_content: "second report",
          details: null,
        }),
      ]),
    };
    render(<ChatReportsCard />);

    expect(
      screen.getByRole("button", {
        name: `Remove message from Harper Lane, “You should quit the chapter, nobody wan…” (Harassment, reported ${FILED}, with a reporter's note)`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Dismiss report on message from old_handle, “second report” (Harassment, reported ${FILED})`,
      }),
    ).toBeInTheDocument();
    // One of each verb per row, and no two share a name.
    const names = screen
      .getAllByRole("button", { name: /^(Mark reviewed|Dismiss|Remove)/ })
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });

  it("tells apart two reports on the same message, which share an author and an excerpt", () => {
    // Two members reported one message. The subject is identical; the
    // reason, filing time and note are what the rows differ by.
    reportsByStatus.value = {
      open: settled([
        report(),
        report({
          id: "r-2",
          reason: "spam",
          details: null,
          created_at: "2026-09-22T10:00:00Z",
        }),
      ]),
    };
    render(<ChatReportsCard />);

    const dismissals = screen
      .getAllByRole("button", { name: /^Dismiss/ })
      .map((button) => button.getAttribute("aria-label"));
    expect(dismissals).toEqual([
      `Dismiss report on message from Harper Lane, “You should quit the chapter, nobody wan…” (Harassment, reported ${FILED}, with a reporter's note)`,
      `Dismiss report on message from Harper Lane, “You should quit the chapter, nobody wan…” (Spam, reported ${formatLocaleDateTime("2026-09-22T10:00:00Z")})`,
    ]);
  });

  it("tells apart two text-less messages from one author", () => {
    reportsByStatus.value = {
      open: settled([
        report({ reported_content: null, details: null }),
        report({
          id: "r-2",
          reported_content: null,
          reason: "sexual",
          details: "an image",
        }),
      ]),
    };
    render(<ChatReportsCard />);

    const removals = screen
      .getAllByRole("button", { name: /^Remove/ })
      .map((button) => button.getAttribute("aria-label"));
    expect(removals).toEqual([
      `Remove message from Harper Lane with no text (Harassment, reported ${FILED})`,
      `Remove message from Harper Lane with no text (Sexual content, reported ${FILED}, with a reporter's note)`,
    ]);
  });

  it("numbers two reports that match on message, reason, time and note, so their names still differ", () => {
    // Two members reported one message for the same reason in the same second,
    // neither with a note: everything visible about the rows is the same.
    reportsByStatus.value = {
      open: settled([
        report({ details: null }),
        report({ id: "r-2", details: null }),
      ]),
    };
    render(<ChatReportsCard />);

    const dismissals = screen
      .getAllByRole("button", { name: /^Dismiss/ })
      .map((button) => button.getAttribute("aria-label"));
    expect(dismissals).toEqual([
      `Dismiss report on message from Harper Lane, “You should quit the chapter, nobody wan…” (Harassment, reported ${FILED}, report 1 of 2)`,
      `Dismiss report on message from Harper Lane, “You should quit the chapter, nobody wan…” (Harassment, reported ${FILED}, report 2 of 2)`,
    ]);
  });
});

describe("ChatReportsCard — resolving", () => {
  it("marks a report reviewed through the resolve hook", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: /^Mark reviewed/ }));

    expect(mockResolve).toHaveBeenCalledWith({ id: "r-1", status: "reviewed" });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      description: "Report marked reviewed.",
    });
  });

  it("dismisses a report through the resolve hook", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: /^Dismiss/ }));

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
    await user.click(within(first).getByRole("button", { name: /^Dismiss/ }));

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
        within(first).getByRole("button", { name: /^Dismiss/ }),
      ).toBeEnabled(),
    );
  });

  it("keeps a row's controls held across a tab switch while its write is in flight", async () => {
    // Radix unmounts the inactive panel. Pending state kept inside the list
    // was dropped by the switch, and the row came back with live buttons over
    // a write that had not finished.
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    mockResolve.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    reportsByStatus.value = {
      open: settled([report()]),
      reviewed: settled([]),
    };
    render(<ChatReportsCard />);

    await user.click(
      within(row(/nobody wants you here/)).getByRole("button", {
        name: /^Dismiss/,
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Reviewed" }));
    await user.click(screen.getByRole("tab", { name: "Open" }));

    const back = row(/nobody wants you here/);
    expect(back).toHaveAttribute("aria-busy", "true");
    for (const button of within(back).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }

    finish({});
    await waitFor(() =>
      expect(
        within(row(/nobody wants you here/)).getByRole("button", {
          name: /^Dismiss/,
        }),
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

    await user.click(screen.getByRole("button", { name: /^Dismiss/ }));

    expect(mockToast).toHaveBeenCalledWith({
      variant: "destructive",
      description: "Report not found",
    });
  });

  it.each([
    [
      "a 500 that carries a message body",
      { statusCode: 500, message: "Internal server error" },
    ],
    ["a 503", { statusCode: 503 }],
    ["a transport failure", new TypeError("Failed to fetch")],
  ])(
    "says the outcome is unknown, never that it failed or the raw text, for %s",
    async (_label, failure) => {
      // The PATCH is a conditional update that may have committed before its
      // answer was lost; the queue refetches either way.
      const user = userEvent.setup();
      mockResolve.mockRejectedValue(failure);
      render(<ChatReportsCard />);

      await user.click(screen.getByRole("button", { name: /^Dismiss/ }));

      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        description:
          "Couldn't confirm the report was dismissed. It may have gone through anyway. Refresh to check, and retry if the report is still open.",
      });
    },
  );

  it.each([
    [
      "reviewed",
      /^Mark reviewed/,
      "Couldn't confirm the report was marked reviewed. It may have gone through anyway. Refresh to check, and retry if the report is still open.",
    ],
    [
      "actioned",
      /^Mark actioned/,
      "Couldn't confirm the report was marked actioned. It may have gone through anyway. Refresh to check, and retry if the report is still open.",
    ],
  ])(
    "says a 5xx on Mark %s left the outcome unknown",
    async (_status, name, description) => {
      const user = userEvent.setup();
      mockResolve.mockRejectedValue({ statusCode: 500 });
      // Mark actioned is offered only where the message is gone.
      reportsByStatus.value = {
        open: settled([report({ message_id: null })]),
      };
      render(<ChatReportsCard />);

      await user.click(screen.getByRole("button", { name }));

      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        description,
      });
    },
  );

  it("says plainly it couldn't, for a 4xx that is not one of the route's refusals", async () => {
    // A guard's 403 is decided before anything is written, so nothing landed.
    const user = userEvent.setup();
    mockResolve.mockRejectedValue({
      statusCode: 403,
      message: "Insufficient permissions",
    });
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: /^Dismiss/ }));

    expect(mockToast).toHaveBeenCalledWith({
      variant: "destructive",
      description: "Couldn't dismiss the report.",
    });
  });

  it("disables every write offline and says why, rather than failing on click", () => {
    mockOffline.value = true;
    render(<ChatReportsCard />);

    for (const name of [/^Mark reviewed/, /^Dismiss/, /^Remove message/]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Reconnect to make changes.");
    }
  });
});

describe("ChatReportsCard — removing the reported message", () => {
  async function confirmRemove(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^Remove message/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove message" }),
    );
  }

  it("asks first, naming the message, and stating it is one message, for everyone, with the conversation still closed", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: /^Remove message/ }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Remove the message from Harper Lane?"),
    ).toBeInTheDocument();
    const description = within(dialog).getByText(/this one message/);
    expect(description).toHaveTextContent(
      /It reads “You should quit the chapter, nobody wan…”/,
    );
    expect(description).toHaveTextContent(/for everyone/);
    expect(description).toHaveTextContent(/marks the report actioned/);
    expect(description).toHaveTextContent(/officers can't open it/);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("warns before removing that the sender will notice, and may identify the reporter in a DM", async () => {
    // The trade-off accepted with report-scoped removal (#2311, option 1).
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: /^Remove message/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/this one message/)).toHaveTextContent(
      "The sender will see this message was removed. In a direct message they may be able to tell who reported it.",
    );
  });

  it("hands the removal the web timeline, so the removed text is patched out of the cached chat", () => {
    render(<ChatReportsCard />);
    expect(removeTimeline.value).toBe(reportedMessageTimeline);
  });

  it("does nothing when the officer cancels", async () => {
    const user = userEvent.setup();
    render(<ChatReportsCard />);

    await user.click(screen.getByRole("button", { name: /^Remove message/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("hands the report to the removal once confirmed — the hook sends its id alone", async () => {
    const user = userEvent.setup();
    mockRemove.mockResolvedValue({
      ...report({ status: "actioned" }),
      message_already_deleted: false,
      channel_id: "chan-1",
    });
    render(<ChatReportsCard />);

    await confirmRemove(user);

    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
    expect(mockRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r-1", message_id: "m-1" }),
    );
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      description: "Message removed. The report is marked actioned.",
    });
  });

  it("says plainly when the message was already removed, without saying by whom", async () => {
    // The server is idempotent on the message: its sender, another officer or
    // an earlier attempt may have removed it, and the report closes anyway.
    const user = userEvent.setup();
    mockRemove.mockResolvedValue({
      ...report({ status: "actioned" }),
      message_already_deleted: true,
    });
    render(<ChatReportsCard />);

    await confirmRemove(user);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        description:
          "This message was already removed. The report is marked actioned.",
      }),
    );
    expect(JSON.stringify(mockToast.mock.calls)).not.toMatch(/sender/i);
  });

  it("offers Mark actioned instead of Remove when the message is gone, and says why", async () => {
    const user = userEvent.setup();
    reportsByStatus.value = { open: settled([report({ message_id: null })]) };
    render(<ChatReportsCard />);

    expect(
      screen.queryByRole("button", { name: /^Remove message/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This message no longer exists, so there's nothing to remove. Mark actioned to close the report.",
      ),
    ).toBeInTheDocument();
    // Resolving without acting is still available.
    expect(screen.getByRole("button", { name: /^Dismiss/ })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /^Mark actioned/ }));

    expect(mockResolve).toHaveBeenCalledWith({ id: "r-1", status: "actioned" });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      description: "Report marked actioned.",
    });
  });

  it("shows the server's own words for a 409, and never blames the sender", async () => {
    const user = userEvent.setup();
    mockRemove.mockRejectedValue({
      statusCode: 409,
      message: "This report is no longer open",
    });
    render(<ChatReportsCard />);

    await confirmRemove(user);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        description: "This report is no longer open",
      }),
    );
    expect(screen.queryByText(/sender already deleted/i)).toBeNull();
  });

  it.each([
    [
      "a 500 that carries a message body",
      { statusCode: 500, message: "Internal server error" },
    ],
    ["a 502 from the gateway", { statusCode: 502 }],
    ["a transport failure", new TypeError("Failed to fetch")],
  ])(
    "says the removal may have landed, in its own words, after %s — and keeps Remove for a retry",
    async (_label, failure) => {
      // The report is claimed before the message is touched, so a 4xx
      // removed nothing; a 5xx or a lost response may have. The officer is
      // told which it could be and how to find out, never the raw body.
      const user = userEvent.setup();
      mockRemove.mockRejectedValue(failure);
      render(<ChatReportsCard />);

      await confirmRemove(user);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          variant: "destructive",
          description:
            "Couldn't confirm the removal. The message may have been removed anyway. Refresh to check, and retry if the report is still open.",
        }),
      );
      expect(
        screen.getByRole("button", { name: /^Remove message/ }),
      ).toBeEnabled();
    },
  );

  it("says plainly it couldn't remove, for a 4xx that is not one of the route's refusals", async () => {
    const user = userEvent.setup();
    mockRemove.mockRejectedValue({
      statusCode: 403,
      message: "Insufficient permissions",
    });
    render(<ChatReportsCard />);

    await confirmRemove(user);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        description: "Couldn't remove the message.",
      }),
    );
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
