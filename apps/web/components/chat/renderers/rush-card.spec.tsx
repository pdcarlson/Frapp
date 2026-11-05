import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUSH_CARD_REFUSAL_COPY } from "@repo/hooks";
import { moduleDisabledMessage } from "@repo/validation";
import { RushCard } from "./rush-card";
import type { ChatMessage } from "@repo/chat-core/types";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * The web chat rush card (#3383). Which controls show, the badge and the tally
 * are the shared rules in `@repo/hooks` (`rush-card.spec.ts` covers them
 * branch by branch), kept real here; these cases check the card draws and
 * wires what they decide, as the mobile card's spec does.
 */

const { mockOffline, state, voteMutate, bidMutate, toast } = vi.hoisted(
  () => ({
    mockOffline: { value: false },
    state: {
      live: undefined as unknown,
      liveError: false,
      candidateIds: [] as (string | undefined)[],
      /** `undefined`: the permissions read hasn't answered (loading, or failed). */
      permissions: ["members:view"] as string[] | undefined,
      votePending: false,
      bidPending: false,
    },
    voteMutate: vi.fn(),
    bidMutate: vi.fn(),
    toast: vi.fn(),
  }),
);
const mockCurrentChapter = vi.fn();

vi.mock("@/lib/providers/network-provider", async () => {
  const { networkMock } = await import("@/tests/network");
  return networkMock(mockOffline);
});

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // The real hook is disabled without an id, so no id reads nothing.
  useRushCandidate: (id: string | undefined) => {
    state.candidateIds.push(id);
    return {
      data: id ? state.live : undefined,
      isError: !!id && state.liveError,
    };
  },
  useVoteRushCandidate: () => ({
    mutate: voteMutate,
    isPending: state.votePending,
  }),
  useBidRushCandidate: () => ({
    mutate: bidMutate,
    isPending: state.bidPending,
  }),
  // The member view, which any member can read (#2957): the card's word, the
  // Recruitment gate and the subscription gate all come from here, never from
  // the officer-only config.
  useCurrentChapter: () => mockCurrentChapter(),
  useOrgConfig: () => {
    throw new Error("the rush card must not read the officer-only config");
  },
  useMyPermissions: () => ({
    data: state.permissions ? { permissions: state.permissions } : undefined,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function memberView(overrides: Record<string, unknown> = {}) {
  mockCurrentChapter.mockReturnValue({
    data: {
      subscription_status: "active",
      past_due_since: null,
      org_archetype: "ifc",
      vocabulary: { recruitment: "Intake" },
      enabled_modules: {},
      ...overrides,
    },
    isPending: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  });
}

function liveCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    chapter_id: "chapter-1",
    display_name: "Jane Doe",
    name_key: "jane doe",
    user_id: null,
    stage: "new",
    bid_status: "none",
    created_by: "user-1",
    created_at: "2026-09-10T00:00:00.000Z",
    vote_count: 3,
    viewer_has_voted: false,
    ...overrides,
  };
}

function makeMessage(
  payloadOverrides: Record<string, unknown> | null = {},
): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    sender_id: "user-1",
    content: "Added candidate Jane Doe",
    kind: "rush",
    is_deleted: false,
    payload:
      payloadOverrides === null
        ? null
        : {
            candidate_id: "cand-1",
            display_name: "Jane Doe",
            added_by_user_id: "user-1",
            added_by_name: "Alice",
            stage: "new",
            bid_status: "none",
            created_at: "2026-09-10T00:00:00.000Z",
            ...payloadOverrides,
          },
  } as unknown as ChatMessage;
}

/** The toast the last failed write raised. */
function lastToast(): { title: string; description: string } {
  const calls = toast.mock.calls;
  return calls[calls.length - 1]![0];
}

/** Fails the write the button fired with `error`. */
function refuse(mutate: typeof voteMutate, error: unknown) {
  const [, options] = mutate.mock.calls[mutate.mock.calls.length - 1]!;
  (options as { onError: (error: unknown) => void }).onError(error);
}

describe("RushCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    state.live = liveCandidate();
    state.liveError = false;
    state.candidateIds = [];
    state.permissions = ["members:view"];
    state.votePending = false;
    state.bidPending = false;
    memberView();
  });

  it("renders the candidate, vote count, and chapter vocab label", () => {
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByText("Intake")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("3 votes")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vote" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Extend bid" })).toBeEnabled();
  });

  it("says the archetype's word when the chapter stores none", () => {
    memberView({ org_archetype: "honor", vocabulary: null });
    render(<RushCard message={makeMessage()} isConfirmed />);
    expect(screen.getByText("Induction")).toBeInTheDocument();
  });

  it("disables Vote once the viewer has voted and never lists voter names", () => {
    state.live = liveCandidate({ vote_count: 1, viewer_has_voted: true });
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByRole("button", { name: "Voted" })).toBeDisabled();
    expect(screen.getByText("1 vote · you voted")).toBeInTheDocument();
    expect(screen.queryByText(/voter/i)).not.toBeInTheDocument();
  });

  it("badges an extended bid and offers no second one", () => {
    state.live = liveCandidate({ bid_status: "extended" });
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByText("Bid extended")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /bid/i }),
    ).not.toBeInTheDocument();
  });

  it("badges nothing, counts nothing and offers nothing before the live read", () => {
    state.live = undefined;
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText(/votes?$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ignores the snapshot's bid: only the live candidate says a bid is out", () => {
    state.live = undefined;
    render(
      <RushCard message={makeMessage({ bid_status: "extended" })} isConfirmed />,
    );
    expect(screen.queryByText("Bid extended")).not.toBeInTheDocument();
  });

  it("doesn't ask for a candidate without members:view", () => {
    state.permissions = [];
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(state.candidateIds.every((id) => id === undefined)).toBe(true);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("asks for the candidate while the permissions read hasn't answered", () => {
    // Every seeded role holds members:view, and a failed permissions read
    // must not leave a member's card without its tally and controls.
    state.permissions = undefined;
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(state.candidateIds).toContain("cand-1");
    expect(screen.getByRole("button", { name: "Vote" })).toBeEnabled();
  });

  it("titles the card with the candidate's live name, not the snapshot's", () => {
    state.live = liveCandidate({ display_name: "Jane Doe-Ruiz" });
    render(<RushCard message={makeMessage()} isConfirmed />);
    expect(screen.getByText("Jane Doe-Ruiz")).toBeInTheDocument();
  });

  it.each([
    ["a vote", "votePending"],
    ["a bid", "bidPending"],
  ] as const)("can't be pressed while %s is pending", (_name, flag) => {
    state[flag] = true;
    render(<RushCard message={makeMessage()} isConfirmed />);
    expect(screen.getByRole("button", { name: "Vote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Extend bid" })).toBeDisabled();
  });

  it("falls back to content when the payload is missing", () => {
    render(<RushCard message={makeMessage(null)} isConfirmed />);

    expect(screen.getByText(/Added candidate Jane Doe/)).toBeInTheDocument();
    expect(screen.queryByText("Intake")).not.toBeInTheDocument();
  });

  it("does not invent a zero tally when the live fetch fails", () => {
    state.live = undefined;
    state.liveError = true;
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByText("Couldn't load votes")).toBeInTheDocument();
    expect(screen.queryByText("0 votes")).not.toBeInTheDocument();
  });

  it("votes and extends a bid for the card's candidate", () => {
    render(<RushCard message={makeMessage()} isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    fireEvent.click(screen.getByRole("button", { name: "Extend bid" }));
    expect(voteMutate.mock.calls[0]![0]).toBe("cand-1");
    expect(bidMutate.mock.calls[0]![0]).toBe("cand-1");
  });

  it("can't be pressed on a row the server hasn't acknowledged", () => {
    render(<RushCard message={makeMessage()} isConfirmed={false} />);
    expect(screen.getByRole("button", { name: "Vote" })).toBeDisabled();
  });

  it("offers nothing once Recruitment is known to be off, and keeps the tally", () => {
    memberView({ enabled_modules: { rush: false } });
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 votes")).toBeInTheDocument();
  });

  it("tells a Recruitment refusal in a member's words, not the officer's instruction", () => {
    render(<RushCard message={makeMessage()} isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: "Extend bid" }));
    refuse(bidMutate, { statusCode: 403, message: moduleDisabledMessage("rush") });

    expect(lastToast().title).toBe("Couldn't extend that bid");
    expect(lastToast().description).toBe(
      RUSH_CARD_REFUSAL_COPY.recruitmentOff,
    );
  });

  it("relays any other refusal", () => {
    render(<RushCard message={makeMessage()} isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    refuse(voteMutate, { statusCode: 404, message: "Candidate not found" });

    expect(lastToast().title).toBe("Couldn't record that vote");
    expect(lastToast().description).toBe("Candidate not found");
  });
});

describe("RushCard subscription gating", () => {
  // The card lives in chat, which is `@FreeTier`, but both writes are
  // paid-ops on `rush.controller.ts`. The route decides the gate (#841).
  const chapter = chapterSubscription(mockCurrentChapter);

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    state.live = liveCandidate();
    state.liveError = false;
    state.permissions = ["members:view"];
    state.votePending = false;
    state.bidPending = false;
  });

  it("disables both writes and explains why on a lapsed chapter", () => {
    chapter.incomplete();
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByRole("button", { name: "Vote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Extend bid" })).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("leaves them alone on an active chapter", () => {
    chapter.active();
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByRole("button", { name: "Vote" })).toBeEnabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing under a card with only the Voted indicator left", () => {
    chapter.incomplete();
    state.live = liveCandidate({
      viewer_has_voted: true,
      bid_status: "extended",
    });
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByRole("button", { name: "Voted" })).toBeDisabled();
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("tells a subscription refusal in a member's words", () => {
    chapter.active();
    render(<RushCard message={makeMessage()} isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    refuse(voteMutate, {
      statusCode: 403,
      message:
        "Chapter subscription is not active; complete checkout to use this feature.",
    });
    expect(lastToast().description).toBe(RUSH_CARD_REFUSAL_COPY.subscription);
  });
});
