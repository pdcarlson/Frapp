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
