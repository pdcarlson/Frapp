import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RushCard } from "./rush-card";
import type { ChatMessage } from "@repo/chat-core/types";

const mockUseRushCandidate = vi.fn();
const voteMutate = vi.fn();
const bidMutate = vi.fn();

vi.mock("@repo/hooks", () => ({
  useRushCandidate: (id: string) => mockUseRushCandidate(id),
  useVoteRushCandidate: () => ({ mutate: voteMutate, isPending: false }),
  useBidRushCandidate: () => ({ mutate: bidMutate, isPending: false }),
  useOrgConfig: () => ({ data: { vocabulary: { recruitment: "Intake" } } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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

describe("RushCard", () => {
  beforeEach(() => {
    mockUseRushCandidate.mockReturnValue({
      data: {
        display_name: "Jane Doe",
        vote_count: 3,
        viewer_has_voted: false,
        bid_status: "none",
      },
      isPending: false,
    });
  });

  it("renders the candidate, vote count, and chapter vocab label", () => {
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByText("Intake")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("3 votes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vote" })).toBeEnabled();
  });

  it("disables Vote once the viewer has voted and never lists voter names", () => {
    mockUseRushCandidate.mockReturnValue({
      data: {
        display_name: "Jane Doe",
        vote_count: 1,
        viewer_has_voted: true,
        bid_status: "none",
      },
      isPending: false,
    });
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByRole("button", { name: "Voted" })).toBeDisabled();
    expect(screen.queryByText(/voter/i)).not.toBeInTheDocument();
  });

  it("falls back to content when the payload is missing", () => {
    render(<RushCard message={makeMessage(null)} isConfirmed />);

    expect(screen.getByText(/Added candidate Jane Doe/)).toBeInTheDocument();
    expect(screen.queryByText("Intake")).not.toBeInTheDocument();
  });

  it("does not invent a zero tally when the live fetch fails", () => {
    mockUseRushCandidate.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    render(<RushCard message={makeMessage()} isConfirmed />);

    expect(screen.getByText("Couldn't load votes")).toBeInTheDocument();
    expect(screen.queryByText("0 votes")).not.toBeInTheDocument();
  });
});
