/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AppState } from "react-native";
import * as expoRouter from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import type { RushPayload } from "@repo/chat-core/cards";
import { RUSH_CARD_REFUSAL_COPY, RUSH_CARD_TALLY_ERROR } from "@repo/hooks";
import { moduleDisabledMessage } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The mobile chat rush card (#3383). Which controls show, the badge and the
 * tally are `rushCardControls`, `rushCardBadgeLabel` and `rushCardTally`,
 * which `packages/hooks/src/rush-card.spec.ts` covers branch by branch; these
 * cases check the card draws and wires what they decide, and that nothing
 * renders off the creation-time snapshot.
 */

const state = vi.hoisted(() => ({
  /** `undefined`: the permissions read hasn't answered (loading, or failed). */
  permissions: ["members:view"] as string[] | undefined,
  votePending: false,
  bidPending: false,
  live: undefined as unknown,
  liveError: false,
  candidateIds: [] as (string | undefined)[],
  chapter: { enabled_modules: {} } as Record<string, unknown> | undefined,
  writeBlockedReason: null as string | null,
}));
const vote = vi.hoisted(() => vi.fn());
const bid = vi.hoisted(() => vi.fn());

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyPermissions: () => ({
    data: state.permissions ? { permissions: state.permissions } : undefined,
  }),
  // The real hook is disabled without an id, so no id reads nothing.
  useRushCandidate: (id: string | undefined) => {
    state.candidateIds.push(id);
    return {
      data: id ? state.live : undefined,
      isError: !!id && state.liveError,
    };
  },
  useVoteRushCandidate: () => ({
    mutateAsync: vote,
    isPending: state.votePending,
  }),
  useBidRushCandidate: () => ({ mutateAsync: bid, isPending: state.bidPending }),
  useCurrentChapter: () => ({ data: state.chapter }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: state.writeBlockedReason }),
}));

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

import { RushCard } from "./rush-card";

/** Every mounted focus effect, run again: the member came back to the thread. */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

/** The listener the card registered last with the mocked `AppState`. */
function appStateListener(): (state: string) => void {
  const calls = vi.mocked(AppState.addEventListener).mock.calls;
  return calls[calls.length - 1]![1] as (state: string) => void;
}

const PAYLOAD: RushPayload = {
  candidate_id: "cand-1",
  display_name: "Jordan Reyes",
  added_by_user_id: "user-a",
  added_by_name: "Alice",
  stage: "new",
  bid_status: "none",
  created_at: "2026-11-04T18:00:00.000Z",
};

function liveCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    chapter_id: "chapter-1",
    display_name: "Jordan Reyes",
    name_key: "jordan reyes",
    user_id: null,
    stage: "new",
    bid_status: "none",
    created_by: "user-a",
    created_at: "2026-11-04T18:00:00.000Z",
    vote_count: 3,
    viewer_has_voted: false,
    ...overrides,
  };
}

function message(): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: "user-a",
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "Added candidate Jordan Reyes",
    kind: "rush",
    payload: PAYLOAD,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: "2026-11-04T18:00:00.000Z",
    client_message_id: "client-1",
    attachment_count: 0,
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: {},
    actions: [],
    _status: "confirmed",
  } as unknown as ChatMessage;
}

function render(options: { isConfirmed?: boolean } = {}): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <RushCard
          message={message()}
          payload={PAYLOAD}
          viewerId="viewer-1"
          isConfirmed={options.isConfirmed ?? true}
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

/** The card's own action buttons, by label: reactions and delivery excluded. */
function actions(tree: ReactTestRenderer): string[] {
  const labels = ["Vote", "Voted", "Extend bid"];
  return tree.root
    .findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        labels.includes(node.props.accessibilityLabel),
    )
    .map((node) => node.props.accessibilityLabel as string);
}

function button(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );
}

async function press(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    button(tree, label).props.onPress();
  });
}

const SUBSCRIPTION_REFUSED = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
};

beforeEach(() => {
  state.permissions = ["members:view"];
  state.votePending = false;
  state.bidPending = false;
  state.live = liveCandidate();
  state.liveError = false;
  state.candidateIds = [];
  state.chapter = { enabled_modules: {} };
  state.writeBlockedReason = null;
  vote.mockReset().mockResolvedValue({});
  bid.mockReset().mockResolvedValue({});
});

describe("RushCard — the snapshot", () => {
  it("draws the candidate and who added them under the chapter's word for recruitment", () => {
    const text = screenText(render());
    expect(text).toContain("Rush");
    expect(text).toContain("Jordan Reyes");
    expect(text).toContain("Added by Alice");
  });

  it.each([
    ["nphc", "Intake"],
    ["npc", "Recruitment"],
    ["honor", "Induction"],
  ])("says %s's word, %s", (org_archetype, word) => {
    state.chapter = { enabled_modules: {}, org_archetype, vocabulary: null };
    const text = screenText(render());
    expect(text).toContain(word);
    expect(text).not.toContain("Rush");
  });

  it("says the chapter's own word over its archetype's", () => {
    state.chapter = {
      enabled_modules: {},
      org_archetype: "ifc",
      vocabulary: { recruitment: "Recruitment" },
    };
    expect(screenText(render())).toContain("Recruitment");
  });

  it("badges nothing, counts nothing and offers nothing until the live candidate is read", () => {
    state.live = undefined;
    const tree = render();
    const text = screenText(tree);
    expect(text).not.toContain("Open");
    expect(text).not.toContain("votes");
    expect(actions(tree)).toEqual([]);
  });

  it("doesn't ask for a candidate without members:view, and shows no tally", () => {
    state.permissions = [];
    const tree = render();
    expect(state.candidateIds.every((id) => id === undefined)).toBe(true);
    expect(screenText(tree)).not.toContain("votes");
    expect(actions(tree)).toEqual([]);
  });

  it("asks for the candidate while the permissions read hasn't answered", () => {
    // Every seeded role holds members:view, and a failed permissions read
    // must not leave a member's card without its tally and controls.
    state.permissions = undefined;
    const tree = render();
    expect(state.candidateIds).toContain("cand-1");
    expect(actions(tree)).toEqual(["Vote", "Extend bid"]);
  });

  it("says the votes couldn't load when the read failed", () => {
    state.live = undefined;
    state.liveError = true;
    expect(screenText(render())).toContain(RUSH_CARD_TALLY_ERROR);
  });
});

describe("RushCard — live", () => {
  it("badges the bid and counts the votes", () => {
    const open = screenText(render());
    expect(open).toContain("Open");
    expect(open).toContain("3 votes");

    state.live = liveCandidate({
      bid_status: "extended",
      vote_count: 1,
      viewer_has_voted: true,
    });
    const extended = screenText(render());
    expect(extended).toContain("Bid extended");
    expect(extended).toContain("1 vote · you voted");
  });

  it("titles the card with the candidate's live name, not the snapshot's", () => {
    state.live = liveCandidate({ display_name: "Jordan Reyes-Cole" });
    expect(screenText(render())).toContain("Jordan Reyes-Cole");
  });

  it("lets a member vote and extend a bid", async () => {
    const tree = render();
    expect(actions(tree)).toEqual(["Vote", "Extend bid"]);
    await press(tree, "Vote");
    expect(vote).toHaveBeenCalledWith("cand-1");
    await press(tree, "Extend bid");
    expect(bid).toHaveBeenCalledWith("cand-1");
  });

  it("leaves a disabled Voted indicator once the viewer has voted", () => {
    state.live = liveCandidate({ viewer_has_voted: true });
    const tree = render();
    expect(actions(tree)).toEqual(["Voted", "Extend bid"]);
    expect(button(tree, "Voted").props.disabled).toBe(true);
  });

  it("drops Extend bid once a bid is out", () => {
    state.live = liveCandidate({ bid_status: "extended" });
    expect(actions(render())).toEqual(["Vote"]);
  });

  it("offers nothing once Recruitment is known to be off, and keeps the tally", () => {
    state.chapter = { enabled_modules: { rush: false } };
    const tree = render();
    expect(actions(tree)).toEqual([]);
    expect(screenText(tree)).toContain("3 votes");
  });

  it("says why the subscription gate refused, in a member's words, and withdraws the controls", async () => {
    vote.mockRejectedValue(SUBSCRIPTION_REFUSED);
    const tree = render();
    await press(tree, "Vote");
    const text = screenText(tree);
    expect(text).toContain(RUSH_CARD_REFUSAL_COPY.subscription);
    expect(text).not.toContain("complete checkout");
    for (const label of ["Vote", "Extend bid"]) {
      expect(button(tree, label).props.disabled).toBe(true);
      expect(button(tree, label).props.accessibilityHint).toBe(
        RUSH_CARD_REFUSAL_COPY.subscription,
      );
    }
  });

  it("says why the Recruitment gate refused, not the officer's instruction", async () => {
    bid.mockRejectedValue({
      statusCode: 403,
      error: "Forbidden",
      message: moduleDisabledMessage("rush"),
    });
    const tree = render();
    await press(tree, "Extend bid");
    const text = screenText(tree);
    expect(text).toContain(RUSH_CARD_REFUSAL_COPY.recruitmentOff);
    expect(text).not.toContain("Settings → Modules");
    expect(button(tree, "Extend bid").props.disabled).toBe(true);
  });

  it("puts the controls back when the member returns to the thread or the app", async () => {
    vote.mockRejectedValue(SUBSCRIPTION_REFUSED);
    const tree = render();
    await press(tree, "Vote");
    expect(button(tree, "Vote").props.disabled).toBe(true);
    act(() => refocus());
    expect(button(tree, "Vote").props.disabled).toBe(false);
    expect(screenText(tree)).not.toContain(
      RUSH_CARD_REFUSAL_COPY.subscription,
    );

    await press(tree, "Vote");
    expect(button(tree, "Vote").props.disabled).toBe(true);
    act(() => appStateListener()("background"));
    expect(button(tree, "Vote").props.disabled).toBe(true);
    act(() => appStateListener()("active"));
    expect(button(tree, "Vote").props.disabled).toBe(false);
  });

  it("sends one write for two taps in the same frame", async () => {
    let finish!: () => void;
    vote.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const tree = render();
    await act(async () => {
      const control = button(tree, "Vote");
      control.props.onPress();
      control.props.onPress();
    });
    expect(vote).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("relays any other refusal and leaves the member to retry", async () => {
    vote.mockRejectedValue({ statusCode: 404, message: "Candidate not found" });
    const tree = render();
    await press(tree, "Vote");
    expect(screenText(tree)).toContain(
      "It may have been deleted. Refresh and try again.",
    );
    expect(button(tree, "Vote").props.disabled).toBe(false);
  });

  it("falls back to its own words when the server gave none", async () => {
    bid.mockRejectedValue({ statusCode: 502 });
    const tree = render();
    await press(tree, "Extend bid");
    expect(screenText(tree)).toContain("Couldn't extend that bid.");
  });

  it.each([
    ["a vote", "votePending"],
    ["a bid", "bidPending"],
  ] as const)("can't be pressed while %s is pending", (_name, flag) => {
    state[flag] = true;
    const tree = render();
    for (const label of ["Vote", "Extend bid"]) {
      expect(button(tree, label).props.disabled).toBe(true);
    }
  });

  it("can't be pressed while a write would be lost, and says why", () => {
    state.writeBlockedReason = "Reconnect to make changes.";
    const control = button(render(), "Vote");
    expect(control.props.disabled).toBe(true);
    expect(control.props.accessibilityHint).toBe("Reconnect to make changes.");
  });

  it("can't be pressed on a row the server hasn't acknowledged", () => {
    expect(
      button(render({ isConfirmed: false }), "Vote").props.disabled,
    ).toBe(true);
  });
});
