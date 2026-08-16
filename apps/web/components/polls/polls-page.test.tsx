import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockVote, mockUnvote, mockRefetch } = vi.hoisted(
  () => ({
    mockCurrentChapter: vi.fn(),
    mockVote: vi.fn().mockResolvedValue({}),
    mockUnvote: vi.fn().mockResolvedValue({}),
    mockRefetch: vi.fn(),
  }),
);

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
  usePolls: () => ({
    data: [VOTED_POLL, UNVOTED_POLL],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: mockRefetch,
  }),
  useVoteOnPoll: () => ({ mutateAsync: mockVote, isPending: false }),
  useRemoveVote: () => ({ mutateAsync: mockUnvote, isPending: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { PollsPage } = await import("./polls-page");

const chapter = chapterSubscription(mockCurrentChapter);

/** First card = the poll this member has already voted on. */
const saveVote = () => screen.getAllByRole("button", { name: /save vote/i })[0]!;
const withdrawVote = () =>
  screen.getAllByRole("button", { name: /withdraw vote/i })[0]!;

describe("PollsPage subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(screen.getByRole("button", { name: /refresh polls/i })).toBeEnabled();
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
