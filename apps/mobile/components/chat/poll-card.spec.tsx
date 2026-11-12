/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  POLLS_GATE_ERROR_COPY,
  POLLS_GATE_LOADING_COPY,
  POLLS_OFF_COPY,
} from "@repo/chat-core/polls";
import { FrappThemeProvider } from "@/lib/theme";
import { UNCONFIRMED_NOTE, RECORDED_NOTE } from "@/lib/chat/delivery-status";

// The member view the Polls gate reads (#3012). Polls is on unless a case
// says otherwise.
// The viewer's permissions, for the Close poll gate (#3794): the seeded Member
// role's `polls:create` unless a case says otherwise.
const myPermissions = vi.hoisted(() => ({
  current: ["members:view", "polls:create"] as string[],
}));

const chapterRead = vi.hoisted(() => ({
  current: {} as {
    data?: unknown;
    isError: boolean;
    fetchStatus: string;
    refetch: () => unknown;
  },
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMyPermissions: () => ({
      data: { permissions: myPermissions.current },
    }),
    useCurrentChapter: () => chapterRead.current,
    useOrgConfig: () => {
      throw new Error("the poll card must not read the officer-only config");
    },
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { PollCard, type PollCardProps } from "./poll-card";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  myPermissions.current = ["members:view", "polls:create"];
  chapterRead.current = {
    data: { enabled_modules: { polls: true } },
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  };
});

function poll(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_blocked: false,
    _blockEvaluated: true,
    sender_id: VIEWER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
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
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    mentions: [],
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  };
}

function renderPoll(
  message: ChatMessage,
  onVote: PollCardProps["onVote"] = vi.fn(),
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <PollCard
          message={message}
          viewerId={VIEWER}
          isConfirmed={message._status === "confirmed"}
          onVote={onVote}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("PollCard delivery status (#1910)", () => {
  it("does not render an unconfirmed poll as a fully-sent card", () => {
    const flat = JSON.stringify(
      renderPoll(poll({ _status: "unconfirmed" })).toJSON(),
    );
    expect(flat).toContain(UNCONFIRMED_NOTE);
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
    expect(flat).not.toContain("Send failed");
  });

  it("renders recorded as a don't-run-again note with no discard", () => {
    const flat = JSON.stringify(
      renderPoll(poll({ _status: "recorded" })).toJSON(),
    );
    expect(flat).toContain(RECORDED_NOTE);
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
  });

  it("keeps retry and discard on a failed poll", () => {
    const flat = JSON.stringify(
      renderPoll(poll({ _status: "failed" })).toJSON(),
    );
    expect(flat).toContain("Send failed");
    expect(flat).toContain("Retry sending this message");
    expect(flat).toContain("Discard this message");
  });
});

describe("PollCard module gate (#3012)", () => {
  // Two votes for Yes, one of them the viewer's, so the tally has to render.
  const vote = (id: string, userId: string) => ({
    id,
    message_id: "msg-1",
    user_id: userId,
    action_type: "vote",
    payload: { option_id: "yes" },
    created_at: new Date(2026, 7, 16, 17, 10).toISOString(),
  });
  const voted = () =>
    poll({ actions: [vote("a-1", VIEWER), vote("a-2", OTHER)] });

  /** The option rows: the card's only buttons with a `selected` state. */
  function options(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button" &&
        node.props.accessibilityState?.selected !== undefined,
    );
  }

  /**
   * Whether `copy` is a visible line on the card. The flattened tree also
   * carries each option's `accessibilityHint`, so a substring check on it
   * would pass with the line missing.
   */
  function shows(tree: ReactTestRenderer, copy: string) {
    return (
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === copy,
      ).length > 0
    );
  }

  function expectReadable(flat: string) {
    expect(flat).toContain("Lunch?");
    expect(flat).toContain('"Yes"');
    expect(flat).toContain('"No"');
    expect(flat).toContain("2 vote");
    expect(flat).toContain("100");
  }

  it("keeps the vote live while Polls is on", () => {
    const onVote = vi.fn();
    const tree = renderPoll(voted(), onVote);

    expectReadable(JSON.stringify(tree.toJSON()));
    const [, no] = options(tree);
    expect(no.props.disabled).toBe(false);
    act(() => no.props.onPress());
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", { option_id: "no" });
    expect(shows(tree, POLLS_OFF_COPY)).toBe(false);
  });

  it("treats a chapter with no polls key as on", () => {
    chapterRead.current.data = { enabled_modules: {} };
    const tree = renderPoll(voted());

    for (const option of options(tree)) {
      expect(option.props.disabled).toBe(false);
    }
    expect(shows(tree, POLLS_OFF_COPY)).toBe(false);
  });

  it("withdraws the vote while Polls is off, says why, and keeps the tally", () => {
    chapterRead.current.data = { enabled_modules: { polls: false } };
    const onVote = vi.fn();
    const tree = renderPoll(voted(), onVote);
    const flat = JSON.stringify(tree.toJSON());

    expectReadable(flat);
    expect(shows(tree, POLLS_OFF_COPY)).toBe(true);
    const rows = options(tree);
    expect(rows).toHaveLength(2);
    for (const option of rows) {
      expect(option.props.disabled).toBe(true);
      expect(option.props.accessibilityHint).toBe(POLLS_OFF_COPY);
    }
    // Only an officer can turn Polls back on, so there is nothing to retry.
    expect(flat).not.toContain("Retry checking whether polls are on");
    expect(onVote).not.toHaveBeenCalled();
  });

  it("does not invite a first vote while Polls is off", () => {
    chapterRead.current.data = { enabled_modules: { polls: false } };
    const flat = JSON.stringify(renderPoll(poll()).toJSON());

    expect(flat).toContain("No votes yet.");
    expect(flat).not.toContain("be the first to vote");
  });

  it("holds the vote and says so while the gate's read is in flight", () => {
    chapterRead.current = {
      data: undefined,
      isError: false,
      fetchStatus: "fetching",
      refetch: vi.fn(),
    };
    const tree = renderPoll(voted());
    const flat = JSON.stringify(tree.toJSON());

    expectReadable(flat);
    expect(shows(tree, POLLS_GATE_LOADING_COPY)).toBe(true);
    for (const option of options(tree)) {
      expect(option.props.disabled).toBe(true);
    }
    // The read is running, so there is nothing to retry yet.
    expect(flat).not.toContain("Retry checking whether polls are on");
  });

  it("holds the vote, says the check failed, and offers Retry", () => {
    const refetch = vi.fn(() => Promise.resolve());
    chapterRead.current = {
      data: undefined,
      isError: true,
      fetchStatus: "idle",
      refetch,
    };
    const tree = renderPoll(voted());

    expectReadable(JSON.stringify(tree.toJSON()));
    expect(shows(tree, POLLS_GATE_ERROR_COPY)).toBe(true);
    for (const option of options(tree)) {
      expect(option.props.disabled).toBe(true);
    }
    const retry = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Retry checking whether polls are on",
    );
    act(() => retry.props.onPress());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed with Retry on a paused or disabled read with nothing cached", () => {
    // Offline before the read ever answered (paused), or no chapter claim
    // (disabled): nothing is checking, so "Checking…" would never resolve, and
    // design-system §4 says idle with nothing cached fails closed.
    for (const fetchStatus of ["paused", "idle"]) {
      const refetch = vi.fn(() => Promise.resolve());
      chapterRead.current = {
        data: undefined,
        isError: false,
        fetchStatus,
        refetch,
      };
      const tree = renderPoll(voted());

      for (const option of options(tree)) {
        expect(option.props.disabled).toBe(true);
      }
      expect(shows(tree, POLLS_GATE_ERROR_COPY)).toBe(true);
      expect(shows(tree, POLLS_GATE_LOADING_COPY)).toBe(false);
      const retry = tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel ===
            "Retry checking whether polls are on",
      );
      act(() => retry.props.onPress());
      expect(refetch).toHaveBeenCalledTimes(1);
    }
  });

  it("gives a pending or failed row no gate line; its delivery chrome speaks", () => {
    chapterRead.current.data = { enabled_modules: { polls: false } };
    for (const status of ["unconfirmed", "failed"] as const) {
      const tree = renderPoll(poll({ _status: status }));
      expect(shows(tree, POLLS_OFF_COPY)).toBe(false);
      for (const option of options(tree)) {
        expect(option.props.accessibilityHint).toBeUndefined();
      }
    }
  });
});

describe("PollCard closed early by its creator (#3794)", () => {
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
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <PollCard
            message={message}
            viewerId={VIEWER}
            isConfirmed={message._status === "confirmed"}
            onVote={onVote}
            onClosePoll={onClosePoll}
            onRetry={vi.fn()}
            onDiscard={vi.fn()}
            onReact={vi.fn()}
            onUnreact={vi.fn()}
          />
        </FrappThemeProvider>,
      );
    });
    return { tree, onVote, onClosePoll };
  }

  /** The Close poll control: the card's button whose label reads it. */
  function closeButton(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button" &&
        JSON.stringify(node.props.children?.props?.children) === '"Close poll"',
    );
  }

  it("offers Close poll on the viewer's own open poll, and calls back with its id", () => {
    const { tree, onClosePoll } = renderWithClose(poll({ payload: card }));

    const [button] = closeButton(tree);
    expect(button).toBeDefined();
    act(() => button.props.onPress());
    expect(onClosePoll).toHaveBeenCalledWith("msg-1");
  });

  it("offers it to nobody else without channels:manage", () => {
    const { tree } = renderWithClose(poll({ sender_id: OTHER, payload: card }));
    expect(closeButton(tree)).toHaveLength(0);
  });

  it("offers it on anyone's poll to a member who manages channels (#4046)", () => {
    myPermissions.current = ["members:view", "channels:manage"];
    const { tree } = renderWithClose(
      poll({ sender_id: OTHER, payload: { ...card, closes_at: null } }),
    );
    expect(closeButton(tree)).toHaveLength(1);
  });

  it("offers it to a creator without polls:create (#4046)", () => {
    // A role change took it away; the poll is still theirs to close.
    myPermissions.current = ["members:view"];
    expect(
      closeButton(renderWithClose(poll({ payload: card })).tree),
    ).toHaveLength(1);
  });

  it("withholds it while Polls is off", () => {
    // Polls off: the module guard refuses the close.
    myPermissions.current = ["members:view", "polls:create"];
    chapterRead.current.data = { enabled_modules: { polls: false } };
    expect(
      closeButton(renderWithClose(poll({ payload: card })).tree),
    ).toHaveLength(0);
  });

  it("says an open poll with no deadline has no end date, and still offers its creator Close poll (#3896)", () => {
    const { tree } = renderWithClose(
      poll({ payload: { ...card, closes_at: null } }),
    );
    expect(JSON.stringify(tree.toJSON())).toContain("Poll · No end date");
    expect(closeButton(tree)).toHaveLength(1);

    // A timed, open poll reads plain "Poll", as before.
    const timed = JSON.stringify(
      renderWithClose(poll({ payload: card })).tree.toJSON(),
    );
    expect(timed).not.toContain("No end date");
  });

  it("draws a card closed early as closed, with no vote, before its deadline", () => {
    const { tree, onVote } = renderWithClose(
      poll({
        payload: {
          ...card,
          closed_at: "2026-01-01T00:00:00.000Z",
          closed_by: VIEWER,
        },
      }),
    );

    expect(JSON.stringify(tree.toJSON())).toContain("Poll · Closed");
    const options = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityState?.selected !== undefined,
    );
    expect(options).toHaveLength(2);
    for (const option of options) expect(option.props.disabled).toBe(true);
    act(() => options[1].props.onPress());
    expect(onVote).not.toHaveBeenCalled();
    expect(closeButton(tree)).toHaveLength(0);
  });
});

describe("PollCard with more than one choice (#3793)", () => {
  const vote = (id: string, userId: string, optionId: unknown) => ({
    id,
    message_id: "msg-1",
    user_id: userId,
    action_type: "vote",
    payload: { option_id: optionId } as Record<string, unknown>,
    created_at: new Date(2026, 7, 16, 17, 10).toISOString(),
  });
  const multi = (actions: ChatMessage["actions"]) =>
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
    });
  /** The option rows: the card's only buttons with a `selected` state. */
  const optionRows = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityState?.selected !== undefined,
    );

  it("says a member can pick several, and adds an option to their picks", () => {
    const onVote = vi.fn();
    const tree = renderPoll(
      multi([vote("a-1", VIEWER, ["fri"]), vote("a-2", OTHER, ["fri", "sat"])]),
      onVote,
    );
    const flat = JSON.stringify(tree.toJSON());

    expect(flat).toContain("Select one or more");
    expect(flat).toContain("2 people voted · your choices are highlighted");
    // Shares are of the two voters, so they needn't add up to 100.
    expect(flat).toContain('"2"," · ","100","%"');
    expect(flat).toContain('"1"," · ","50","%"');
    const [fri, sat, sun] = optionRows(tree);
    expect(fri.props.accessibilityState.selected).toBe(true);
    expect(sat.props.accessibilityState.selected).toBe(false);
    act(() => sun.props.onPress());
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", {
      option_id: ["fri", "sun"],
    });
  });

  it("highlights every one of the viewer's picks", () => {
    const tree = renderPoll(
      multi([vote("a-1", VIEWER, ["fri", "sun"]), vote("a-2", OTHER, ["sat"])]),
    );
    expect(
      optionRows(tree).map((row) => row.props.accessibilityState.selected),
    ).toEqual([true, false, true]);
  });

  it("keeps both picks when the second tap lands before the first answer", () => {
    const onVote = vi.fn();
    const tree = renderPoll(multi([]), onVote);

    act(() => optionRows(tree)[0].props.onPress());
    act(() => optionRows(tree)[1].props.onPress());
    expect(onVote).toHaveBeenNthCalledWith(1, "msg-1", "vote", {
      option_id: ["fri"],
    });
    expect(onVote).toHaveBeenNthCalledWith(2, "msg-1", "vote", {
      option_id: ["fri", "sat"],
    });
  });

  it("clears a pick on a second tap, down to none", () => {
    const onVote = vi.fn();
    const tree = renderPoll(multi([vote("a-1", VIEWER, ["fri"])]), onVote);

    act(() => optionRows(tree)[0].props.onPress());
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", { option_id: [] });
  });

  it("leaves a single-choice card as it was: no hint, one pick replacing another", () => {
    const onVote = vi.fn();
    const tree = renderPoll(
      poll({ actions: [vote("a-1", VIEWER, "yes"), vote("a-2", OTHER, "yes")] }),
      onVote,
    );
    const flat = JSON.stringify(tree.toJSON());

    expect(flat).not.toContain("Select one or more");
    expect(flat).toContain("2 votes · your vote is highlighted");
    act(() => optionRows(tree)[1].props.onPress());
    expect(onVote).toHaveBeenCalledWith("msg-1", "vote", { option_id: "no" });
  });
});
