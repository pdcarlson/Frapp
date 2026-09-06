import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";
import { networkMock } from "@/tests/network";

const { mockCurrentChapter, mockVote, mockUnvote, mockRefetch, pollsQuery } =
  vi.hoisted(() => ({
    mockCurrentChapter: vi.fn(),
    mockVote: vi.fn().mockResolvedValue({}),
    mockUnvote: vi.fn().mockResolvedValue({}),
    mockRefetch: vi.fn(),
    pollsQuery: {
      data: [] as unknown[],
      isPending: false,
      isLoading: false,
      isFetching: false,
      fetchStatus: "idle" as "idle" | "fetching" | "paused",
      isError: false,
      refetch: () => undefined as unknown,
    },
  }));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
const VOTED_POLL = {
  id: "poll-1",
  channel_id: "chan-1",
  sender_id: "user-1",
  content: "Pizza night?",
  metadata: {
    question: "Pizza night?",
    options: ["Friday", "Saturday"],
    choice_mode: "single" as const,
    expires_at: null,
  },
  created_at: "2026-08-01T00:00:00Z",
  isExpired: false,
  results: [
    { optionIndex: 0, optionText: "Friday", voteCount: 3 },
    { optionIndex: 1, optionText: "Saturday", voteCount: 1 },
  ],
  // Pre-selected, so both writes start reachable on an active chapter.
  userVotes: [0],
};

/** No existing vote, so its own guards keep both writes shut regardless. */
const UNVOTED_POLL = {
  ...VOTED_POLL,
  id: "poll-2",
  content: "Retreat weekend?",
  metadata: { ...VOTED_POLL.metadata, question: "Retreat weekend?" },
  results: [
    { optionIndex: 0, optionText: "Retreat A", voteCount: 0 },
    { optionIndex: 1, optionText: "Retreat B", voteCount: 0 },
  ],
  userVotes: [],
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useChannels: () => ({
    data: [{ id: "chan-1", name: "General" }],
    isPending: false,
    isError: false,
  }),
  usePolls: () => pollsQuery,
  useVoteOnPoll: () => ({ mutateAsync: mockVote, isPending: false }),
  useRemoveVote: () => ({ mutateAsync: mockUnvote, isPending: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

const { mockCanGrant, mockOffline } = vi.hoisted(() => ({
  mockCanGrant: { value: true },
  mockOffline: { value: false },
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@/components/shared/can", () => ({
  Can: ({
    children,
    deniedFallback,
  }: {
    children: ReactNode;
    deniedFallback?: ReactNode;
  }) => <>{mockCanGrant.value ? children : deniedFallback}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { PollsPage } = await import("./polls-page");

const chapter = chapterSubscription(mockCurrentChapter);

/** First card = the poll this member has already voted on. */
const saveVote = () =>
  screen.getAllByRole("button", { name: /save vote/i })[0]!;
const withdrawVote = () =>
  screen.getAllByRole("button", { name: /withdraw vote/i })[0]!;

function resolvedPollsQuery() {
  pollsQuery.data = [VOTED_POLL, UNVOTED_POLL];
  pollsQuery.isPending = false;
  pollsQuery.isLoading = false;
  pollsQuery.isFetching = false;
  pollsQuery.fetchStatus = "idle";
  pollsQuery.isError = false;
  pollsQuery.refetch = mockRefetch;
}

describe("PollsPage disabled-query handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanGrant.value = true;
    mockOffline.value = false;
    resolvedPollsQuery();
    chapter.active();
  });

  it("does not spin when the polls query is disabled (pending but not fetching)", () => {
    // `usePolls` sets `enabled: !!chapterId && polls:view_all`. TanStack v5
    // leaves that query `isPending` forever; `isLoading` is the in-flight flag.
    pollsQuery.data = undefined as unknown as unknown[];
    pollsQuery.isPending = true;
    pollsQuery.isLoading = false;
    pollsQuery.isFetching = false;
    pollsQuery.fetchStatus = "idle";

    render(<PollsPage />);

    expect(
      screen.queryByText("Loading chapter polls..."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/poll list requires polls:view_all/i),
    ).toBeInTheDocument();
  });

  it("still spins while a permitted fetch is actually in flight", () => {
    pollsQuery.data = undefined as unknown as unknown[];
    pollsQuery.isPending = true;
    pollsQuery.isLoading = true;
    pollsQuery.isFetching = true;
    pollsQuery.fetchStatus = "fetching";

    render(<PollsPage />);

    expect(screen.getByText("Loading chapter polls...")).toBeInTheDocument();
  });

  it("spins when the query is paused (offline) rather than claiming view_all is missing", () => {
    // `isPending && !isFetching` is also true for fetchStatus "paused".
    // That is not a disabled query — the member has the grant, the network
    // does not. The idle branch is the enabled:false signal.
    pollsQuery.data = undefined as unknown as unknown[];
    pollsQuery.isPending = true;
    pollsQuery.isLoading = false;
    pollsQuery.isFetching = false;
    pollsQuery.fetchStatus = "paused";

    render(<PollsPage />);

    expect(screen.getByText("Loading chapter polls...")).toBeInTheDocument();
    expect(
      screen.queryByText(/poll list requires polls:view_all/i),
    ).not.toBeInTheDocument();
  });

  it("offers a retry when offline instead of a spinner that cannot resolve", () => {
    // README §4 item 4. A paused query is `isPending`, so without this branch
    // an offline member with no cached polls sat on "Loading chapter polls..."
    // for as long as they stayed offline.
    mockOffline.value = true;
    pollsQuery.data = undefined as unknown as unknown[];
    pollsQuery.isPending = true;
    pollsQuery.fetchStatus = "paused";

    render(<PollsPage />);

    expect(screen.getByText(/polls unavailable offline/i)).toBeInTheDocument();
    expect(
      screen.queryByText("Loading chapter polls..."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("keeps loaded polls on screen when the connection drops", () => {
    // TanStack keeps `data` when the link goes; README §4 scopes the offline
    // state to "no cached data" and §10 keeps stale content in place. The
    // shell's OfflineBanner states the connection on every route, and the vote
    // controls fail with their own message, so the list is not thrown away.
    mockOffline.value = true;

    render(<PollsPage />);

    expect(screen.getAllByText("Pizza night?").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/polls unavailable offline/i),
    ).not.toBeInTheDocument();
  });

  it("keeps loaded polls through a paused background refetch", () => {
    // `isLoading` implies no data, but `fetchStatus === "paused"` alone does
    // not: TanStack pauses a *background* refetch (reconnect, window focus)
    // while keeping the cached rows. An unqualified check swapped a rendered
    // list for a spinner on exactly the blip the offline branch guards.
    pollsQuery.isPending = false;
    pollsQuery.isLoading = false;
    pollsQuery.fetchStatus = "paused";

    render(<PollsPage />);

    expect(screen.getAllByText("Pizza night?").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("Loading chapter polls..."),
    ).not.toBeInTheDocument();
  });

  it("answers the permission question before the network one", () => {
    // Chapter Ops' ordering: an unauthorized member reaching this route while
    // offline must not be told to reconnect to do something they may not do.
    mockCanGrant.value = false;
    mockOffline.value = true;

    render(<PollsPage />);

    expect(
      screen.queryByText(/polls unavailable offline/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/polls:view_all/)).toBeInTheDocument();
  });

  it("shows the Can denied copy, not a spinner, when the caller lacks polls:view_all", () => {
    mockCanGrant.value = false;
    pollsQuery.data = undefined as unknown as unknown[];
    pollsQuery.isPending = true;
    pollsQuery.isLoading = false;
    pollsQuery.isFetching = false;
    pollsQuery.fetchStatus = "idle";

    render(<PollsPage />);

    expect(
      screen.queryByText("Loading chapter polls..."),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/polls:view_all/i)).toBeInTheDocument();
    expect(screen.getByText(/ask your chapter president/i)).toBeInTheDocument();
  });
});

describe("PollsPage status colour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanGrant.value = true;
    mockOffline.value = false;
    resolvedPollsQuery();
    chapter.active();
  });

  it("never paints the poll status in the chapter accent", () => {
    // `status-kind.spec.ts` constrains the *mapper*; this constrains the call
    // site. The defect it replaces was an inline ternary, which a mapper-level
    // guard cannot see — so a revert to `variant="default"` here would pass
    // that file and fail this one.
    render(<PollsPage />);

    const badge = screen.getAllByText("Open")[0]!;
    expect(badge.className).not.toContain("bg-accent-subtle");
    expect(badge.className).not.toContain("text-accent-text");
    expect(badge.className).toContain("bg-success");
  });

  it("renders a closed poll as quiet metadata, not a failure", () => {
    pollsQuery.data = [{ ...VOTED_POLL, isExpired: true }];

    render(<PollsPage />);

    const badge = screen.getAllByText("Closed")[0]!;
    expect(badge.className).toContain("border-border");
    expect(badge.className).not.toContain("bg-destructive");
    expect(badge.className).not.toContain("bg-accent-subtle");
  });

  it("shows a manually closed poll's own close date, not a still-future expires_at (#379)", () => {
    // A poll closed early via `PollService.close` can have an expires_at
    // that hasn't happened yet — showing that date next to "Closed" would
    // tell a member the poll closed on a day that hasn't occurred.
    pollsQuery.data = [
      {
        ...VOTED_POLL,
        isExpired: true,
        metadata: {
          ...VOTED_POLL.metadata,
          expires_at: "2099-06-01T00:00:00Z",
          closed_at: "2026-08-15T00:00:00Z",
        },
      },
    ];

    render(<PollsPage />);

    expect(screen.getAllByText(/Closed/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("2099");
  });
});

describe("PollsPage subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanGrant.value = true;
    resolvedPollsQuery();
  });

  it("leaves voting alone on an active chapter", () => {
    chapter.active();
    render(<PollsPage />);

    expect(saveVote()).toBeEnabled();
    expect(withdrawVote()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the vote control and names blocker plus recovery when incomplete", () => {
    chapter.incomplete();
    render(<PollsPage />);

    // §5 rule 1: gate the control that starts the write, not the request.
    expect(saveVote()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");

    // §5 rule 4: disabled, not hidden — the polls themselves are untouched.
    expect(screen.getByText("Pizza night?")).toBeInTheDocument();
  });

  it("gates withdraw as well as save", () => {
    // `DELETE /v1/polls/:messageId/vote` sits behind the same guard, so gating
    // only Save would have the surface claim writes are blocked while still
    // offering one per card.
    chapter.incomplete();
    render(<PollsPage />);

    expect(withdrawVote()).toBeDisabled();
    for (const button of screen.getAllByRole("button", {
      name: /save vote|withdraw vote/i,
    })) {
      expect(button).toBeDisabled();
    }
  });

  it("ties every disabled write on the surface to one explanation", () => {
    chapter.incomplete();
    render(<PollsPage />);

    // One page-level gate, so both cards describe themselves with the same id.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    const describedBy = saveVote().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(withdrawVote()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("keeps each control's own guard on top of the gate", () => {
    // The props are `controlProps(selection.size === 0 || …)`, not a bare
    // `disabled` written after the spread — that would silently drop the gate.
    chapter.active();
    render(<PollsPage />);

    const unvotedSave = screen.getAllByRole("button", {
      name: /save vote/i,
    })[1]!;
    const unvotedWithdraw = screen.getAllByRole("button", {
      name: /withdraw vote/i,
    })[1]!;
    expect(unvotedSave).toBeDisabled();
    expect(unvotedWithdraw).toBeDisabled();
  });

  it("never fires a vote from a gated control", async () => {
    chapter.incomplete();
    render(<PollsPage />);

    await userEvent.click(saveVote());
    await userEvent.click(withdrawVote());
    expect(mockVote).not.toHaveBeenCalled();
    expect(mockUnvote).not.toHaveBeenCalled();
  });

  it("never gates the reads", () => {
    // `enforceSubscription` returns early for GET, so a lapsed chapter keeps
    // browsing, filtering, refreshing, and reading tallies.
    chapter.incomplete();
    render(<PollsPage />);

    expect(
      screen.getByRole("combobox", { name: /filter polls by channel/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("combobox", { name: /filter polls by status/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /refresh polls/i }),
    ).toBeEnabled();
    // The option rows are the results display and only move local selection
    // state, so they stay live with their counts readable.
    expect(screen.getByRole("button", { name: /friday/i })).toBeEnabled();
    expect(screen.getByText(/3 votes/)).toBeInTheDocument();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate prevents.
    chapter.loading();
    render(<PollsPage />);

    expect(saveVote()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
  });

  it("blocks paid-ops voting immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<PollsPage />);

    expect(saveVote()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than checkout", () => {
    chapter.canceled();
    render(<PollsPage />);

    expect(saveVote()).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // Deliberately asymmetric with `<Can>`. An unresolved subscription most
    // likely belongs to a paying chapter, and locking voting over a failed
    // fetch is worse than the late 403; the server guard is still the
    // enforcement.
    chapter.unreadable();
    render(<PollsPage />);

    expect(saveVote()).toBeEnabled();
    expect(withdrawVote()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
