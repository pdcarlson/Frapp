import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  POLLS_GATE_ERROR_COPY,
  POLLS_GATE_LOADING_COPY,
  POLLS_OFF_COPY,
} from "@repo/chat-core/polls";

/**
 * The poll card mirrors the Polls module gate (#3012). The server refuses a
 * card vote while Polls is off (#2993), so the card withdraws the vote and
 * says why, while the question, options and tally stay readable: reads are
 * never gated (`spec/product/modules.md` § Module disabling behavior).
 *
 * The real gate hook runs; only its read and the chapter store are stubbed, so
 * these also pin that it is the member view and not the officer-only config.
 */

// The viewer's permissions, for the Close poll gate (#3794, #4046): the seeded
// Member role's, which hold no `channels:manage`, unless a case says otherwise.
const myPermissions = vi.hoisted(() => ({
  current: ["members:view", "polls:create"] as string[],
}));

const chapterRead = vi.hoisted(() => ({
  current: {} as {
    data?: unknown;
    isError?: boolean;
    fetchStatus?: "fetching" | "paused" | "idle";
    refetch?: () => unknown;
  },
  /** The options the hook last read with. */
  options: undefined as unknown,
}));

const chapterStore = vi.hoisted(() => ({
  activeChapterId: "chapter-1" as string | null,
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMyPermissions: () => ({
      data: { permissions: myPermissions.current },
    }),
    useCurrentChapter: (options: unknown) => {
      chapterRead.options = options;
      return chapterRead.current;
    },
    useOrgConfig: () => {
      throw new Error("the poll card must not read the officer-only config");
    },
  };
});

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector(chapterStore),
}));

const { PollCard } = await import("./poll-card");

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function poll(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OTHER,
    content: "Lunch?",
    kind: "poll",
    payload: {
      question: "Lunch?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      closes_at: "",
    },
    is_deleted: false,
    reactions: {},
    // Two votes for Yes, one of them the viewer's, so the tally has to render.
    actions: [
      { action_type: "vote", user_id: VIEWER, payload: { option_id: "yes" } },
      { action_type: "vote", user_id: OTHER, payload: { option_id: "yes" } },
    ],
    _status: "confirmed",
    ...overrides,
  } as unknown as ChatMessage;
}

function renderPoll(message: ChatMessage = poll(), isConfirmed = true) {
  const onVote = vi.fn();
  render(
    <PollCard
      message={message}
      viewerId={VIEWER}
      isConfirmed={isConfirmed}
      onVote={onVote}
    />,
  );
  return { onVote };
}

function optionButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
}

function expectReadable() {
  expect(screen.getByText("Lunch?")).toBeInTheDocument();
  expect(optionButton("Yes")).toHaveTextContent("2 · 100%");
  expect(optionButton("No")).toHaveTextContent("0 · 0%");
  expect(screen.getByText(/^2 votes/)).toBeInTheDocument();
}

describe("PollCard module gate (#3012)", () => {
  beforeEach(() => {
    chapterStore.activeChapterId = "chapter-1";
    chapterRead.current = {
      data: { enabled_modules: { polls: true } },
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn(),
    };
  });

  it("keeps the vote live while Polls is on", () => {
    const { onVote } = renderPoll();

    expectReadable();
    expect(optionButton("No")).toBeEnabled();
    fireEvent.click(optionButton("No"));
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", { option_id: "no" });
    expect(screen.queryByText(POLLS_OFF_COPY)).not.toBeInTheDocument();
  });

  it("treats a chapter with no polls key as on", () => {
    chapterRead.current = {
      ...chapterRead.current,
      data: { enabled_modules: {} },
    };
    const { onVote } = renderPoll();

    expect(optionButton("No")).toBeEnabled();
    fireEvent.click(optionButton("No"));
    expect(onVote).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(POLLS_OFF_COPY)).not.toBeInTheDocument();
  });

  it("withdraws the vote while Polls is off, says why, and keeps the tally", () => {
    chapterRead.current = {
      ...chapterRead.current,
      data: { enabled_modules: { polls: false } },
    };
    const { onVote } = renderPoll();

    expectReadable();
    const reason = screen.getByText(POLLS_OFF_COPY);
    for (const label of ["Yes", "No"]) {
      expect(optionButton(label)).toBeDisabled();
      expect(optionButton(label)).toHaveAttribute(
        "aria-describedby",
        reason.id,
      );
    }
    fireEvent.click(optionButton("No"));
    expect(onVote).not.toHaveBeenCalled();
    // Only an officer can turn Polls back on, so there is nothing to retry.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("does not invite a first vote while Polls is off", () => {
    chapterRead.current = {
      ...chapterRead.current,
      data: { enabled_modules: { polls: false } },
    };
    renderPoll(poll({ actions: [] }));

    expect(screen.getByText("No votes yet.")).toBeInTheDocument();
  });

  it("holds the vote and says so while the gate's read is in flight", () => {
    chapterRead.current = {
      data: undefined,
      isError: false,
      fetchStatus: "fetching",
      refetch: vi.fn(),
    };
    renderPoll();

    expectReadable();
    expect(optionButton("No")).toBeDisabled();
    expect(screen.getByText(POLLS_GATE_LOADING_COPY)).toBeInTheDocument();
    expect(screen.queryByText(POLLS_OFF_COPY)).not.toBeInTheDocument();
    // The read is running, so there is nothing to retry yet.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("holds the vote, says the check failed, and offers Retry", () => {
    const refetch = vi.fn();
    chapterRead.current = {
      data: undefined,
      isError: true,
      fetchStatus: "idle",
      refetch,
    };
    renderPoll();

    expectReadable();
    expect(optionButton("No")).toBeDisabled();
    expect(screen.getByText(POLLS_GATE_ERROR_COPY)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed with Retry when offline before the read ever answered", () => {
    // A paused read: nothing is checking, so "Checking…" would never resolve.
    const refetch = vi.fn();
    chapterRead.current = {
      data: undefined,
      isError: false,
      fetchStatus: "paused",
      refetch,
    };
    renderPoll();

    expect(optionButton("No")).toBeDisabled();
    expect(screen.getByText(POLLS_GATE_ERROR_COPY)).toBeInTheDocument();
    expect(screen.queryByText(POLLS_GATE_LOADING_COPY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed, not loading, when there is no active chapter to read", () => {
    // The read is disabled, so it will never answer by itself
    // (design-system §4: idle with nothing cached fails closed).
    chapterStore.activeChapterId = null;
    chapterRead.current = {
      data: undefined,
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn(),
    };
    renderPoll();

    expect(chapterRead.options).toEqual({ chapterId: null, enabled: false });
    expect(optionButton("No")).toBeDisabled();
    expect(screen.getByText(POLLS_GATE_ERROR_COPY)).toBeInTheDocument();
    expect(screen.queryByText(POLLS_GATE_LOADING_COPY)).toBeNull();
  });

  it("gives a pending or failed row no gate line; its delivery chrome speaks", () => {
    chapterRead.current = {
      ...chapterRead.current,
      data: { enabled_modules: { polls: false } },
    };
    renderPoll(poll({ _status: "failed" }), false);

    expect(optionButton("No")).toBeDisabled();
    expect(optionButton("No")).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(POLLS_OFF_COPY)).not.toBeInTheDocument();
  });

  it("gives a closed poll no module reason", () => {
    chapterRead.current = {
      ...chapterRead.current,
      data: { enabled_modules: { polls: false } },
    };
    renderPoll(
      poll({
        payload: {
          question: "Lunch?",
          options: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
          closes_at: "2020-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(screen.getByText(/Closed/)).toBeInTheDocument();
    expect(optionButton("No")).toBeDisabled();
    expect(screen.queryByText(POLLS_OFF_COPY)).not.toBeInTheDocument();
  });
});

describe("PollCard closed early by its creator (#3794)", () => {
  beforeEach(() => {
    myPermissions.current = ["members:view", "polls:create"];
    chapterStore.activeChapterId = "chapter-1";
    chapterRead.current = {
      data: { enabled_modules: { polls: true } },
      isError: false,
      fetchStatus: "idle",
      refetch: vi.fn(),
    };
  });

  const card = {
    question: "Lunch?",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
    closes_at: "2999-01-01T00:00:00.000Z",
  };

  function renderWithClose(message: ChatMessage) {
    const onVote = vi.fn();
    const onClosePoll = vi.fn();
    render(
      <PollCard
        message={message}
        viewerId={VIEWER}
        isConfirmed
        onVote={onVote}
        onClosePoll={onClosePoll}
      />,
    );
    return { onVote, onClosePoll };
  }

  it("offers Close poll on the viewer's own open poll, and calls back with its id", () => {
    const { onClosePoll } = renderWithClose(
      poll({ sender_id: VIEWER, payload: card }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close poll" }));
    expect(onClosePoll).toHaveBeenCalledWith("msg-1");
  });

  it("offers it to nobody else without channels:manage", () => {
    renderWithClose(poll({ sender_id: OTHER, payload: card }));

    expect(
      screen.queryByRole("button", { name: "Close poll" }),
    ).not.toBeInTheDocument();
  });

  it("offers it on anyone's poll to a member who manages channels (#4046)", () => {
    myPermissions.current = ["members:view", "channels:manage"];
    const { onClosePoll } = renderWithClose(
      poll({ sender_id: OTHER, payload: { ...card, closes_at: null } }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close poll" }));
    expect(onClosePoll).toHaveBeenCalledWith("msg-1");
  });

  it("offers it to a creator without polls:create (#4046)", () => {
    // A role change took it away; the poll is still theirs to close.
    myPermissions.current = ["members:view"];
    const { onClosePoll } = renderWithClose(
      poll({ sender_id: VIEWER, payload: card }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close poll" }));
    expect(onClosePoll).toHaveBeenCalledWith("msg-1");
  });

  it("withholds it while Polls is off", () => {
    // Polls off: the module guard refuses the close.
    myPermissions.current = ["members:view", "polls:create"];
    chapterRead.current = {
      ...chapterRead.current,
      data: { enabled_modules: { polls: false } },
    };
    renderWithClose(poll({ sender_id: VIEWER, payload: card }));
    expect(
      screen.queryByRole("button", { name: "Close poll" }),
    ).not.toBeInTheDocument();
  });

  it("says an open poll with no deadline has no end date, and still offers its creator Close poll (#3896)", () => {
    const { onVote } = renderWithClose(
      poll({ sender_id: VIEWER, payload: { ...card, closes_at: null } }),
    );

    expect(screen.getByText("Poll · No end date")).toBeInTheDocument();
    fireEvent.click(optionButton("No"));
    expect(onVote).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Close poll" }),
    ).toBeInTheDocument();
  });

  it("reads a timed, open poll as plain Poll, as before", () => {
    renderWithClose(poll({ sender_id: VIEWER, payload: card }));
    expect(screen.getByText("Poll")).toBeInTheDocument();
  });

  it("draws a card closed early as closed, with its tally and no vote, before its deadline", () => {
    const { onVote } = renderWithClose(
      poll({
        sender_id: VIEWER,
        payload: {
          ...card,
          closed_at: "2026-01-01T00:00:00.000Z",
          closed_by: VIEWER,
        },
      }),
    );

    expect(screen.getByText("Poll · Closed")).toBeInTheDocument();
    expectReadable();
    expect(optionButton("No")).toBeDisabled();
    fireEvent.click(optionButton("No"));
    expect(onVote).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Close poll" }),
    ).not.toBeInTheDocument();
  });
});

describe("PollCard with more than one choice (#3793)", () => {
  const multi = (actions: object[]) =>
    poll({
      payload: {
        question: "Which days work?",
        options: [
          { id: "fri", label: "Fri" },
          { id: "sat", label: "Sat" },
          { id: "sun", label: "Sun" },
        ],
        closes_at: "2999-01-01T00:00:00.000Z",
        choice_mode: "multi",
      },
      actions,
    } as Partial<ChatMessage>);
  const vote = (user_id: string, option_id: unknown) => ({
    action_type: "vote",
    user_id,
    payload: { option_id },
  });

  it("says a member can pick several, and adds an option to their picks", () => {
    const { onVote } = renderPoll(
      multi([vote(VIEWER, ["fri"]), vote(OTHER, ["fri", "sat"])]),
    );

    expect(screen.getByText("Select one or more")).toBeInTheDocument();
    // Shares are of the two voters, so they needn't add up to 100.
    expect(optionButton("Fri")).toHaveTextContent("2 · 100%");
    expect(optionButton("Sat")).toHaveTextContent("1 · 50%");
    expect(optionButton("Fri")).toHaveAttribute("aria-pressed", "true");
    expect(optionButton("Sat")).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByText("2 people voted · your choices are highlighted"),
    ).toBeInTheDocument();

    fireEvent.click(optionButton("Sun"));
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", {
      option_id: ["fri", "sun"],
    });
  });

  it("highlights every one of the viewer's picks", () => {
    renderPoll(multi([vote(VIEWER, ["fri", "sun"]), vote(OTHER, ["sat"])]));

    expect(optionButton("Fri")).toHaveAttribute("aria-pressed", "true");
    expect(optionButton("Sat")).toHaveAttribute("aria-pressed", "false");
    expect(optionButton("Sun")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps both picks when the second tap lands before the first answer", () => {
    // The card doesn't redraw until the API answers, so the second tap is
    // built on the first, not on the card's still-empty picks.
    const { onVote } = renderPoll(multi([]));

    fireEvent.click(optionButton("Fri"));
    fireEvent.click(optionButton("Sat"));
    expect(onVote).toHaveBeenNthCalledWith(1, "msg-1", "vote", {
      option_id: ["fri"],
    });
    expect(onVote).toHaveBeenNthCalledWith(2, "msg-1", "vote", {
      option_id: ["fri", "sat"],
    });
  });

  it("clears a pick on a second tap, down to none", () => {
    const { onVote } = renderPoll(multi([vote(VIEWER, ["fri"])]));

    fireEvent.click(optionButton("Fri"));
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", { option_id: [] });
  });

  it("leaves a single-choice card as it was: no hint, one pick replacing another", () => {
    const { onVote } = renderPoll();

    expect(screen.queryByText("Select one or more")).not.toBeInTheDocument();
    expectReadable();
    expect(
      screen.getByText("2 votes · your vote is highlighted"),
    ).toBeInTheDocument();
    fireEvent.click(optionButton("No"));
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", { option_id: "no" });
  });
});
