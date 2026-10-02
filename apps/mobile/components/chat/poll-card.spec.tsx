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
    logoUrl: null,
    chapterName: null,
  }),
}));

import { PollCard, type PollCardProps } from "./poll-card";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
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
