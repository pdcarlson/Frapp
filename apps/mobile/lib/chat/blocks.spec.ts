import { describe, expect, it } from "vitest";
import {
  mergeServerRow,
  emptyCache,
  selectMessages,
} from "@repo/chat-core/cache";
import type { ChatMessage, RawChatMessage } from "@repo/chat-core/types";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  canOpenMessageActions,
  messageActionsFor,
  rosterMembership,
  type MemberLookup,
  type MessageActionsContext,
} from "./blocks";

// The classifier these actions sit beside moved to `@repo/chat-core/blocks`
// with its spec (#2313), and the Reply/Edit/Delete rules are chat-core's
// `message-actions` (#2775). What is pinned here is how the mobile sheet
// combines them with Report and Block, which web does not offer.

const VIEWER = "11111111-1111-4111-8111-111111111111";
const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";

const everyoneIsAMember: MemberLookup = () => true;

function restRow(
  id: string,
  senderId: string | null,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    id,
    channel_id: "chan-1",
    sender_id: senderId,
    author_name: senderId === null ? "Discord Dan" : null,
    content: `body ${id}`,
    kind: "text",
    created_at: "2026-09-15T18:00:00.123456+00:00",
    sender_blocked: false,
    ...overrides,
  };
}

function one(raw: RawChatMessage): ChatMessage {
  const [message] = selectMessages(mergeServerRow(emptyCache(), raw));
  return message!;
}

/** A member in an ordinary channel they can post and reply in, no `channels:manage`. */
function context(
  isMember: MemberLookup = everyoneIsAMember,
  overrides: Partial<MessageActionsContext> = {},
): MessageActionsContext {
  return {
    isMember,
    canReply: true,
    canPost: true,
    canManageChannel: false,
    ...overrides,
  };
}

describe("messageActionsFor", () => {
  const base = one(restRow("m1", FRIEND));
  const mine = one(restRow("m2", VIEWER));

  it("offers reply, report and block on someone else's confirmed message", () => {
    expect(messageActionsFor(base, VIEWER, context())).toEqual({
      canOpen: true,
      canReply: true,
      canEdit: false,
      canDelete: false,
      canReport: true,
      canBlock: true,
    });
  });

  it("offers reply, edit and delete on the viewer's own message, and never report or block", () => {
    expect(messageActionsFor(mine, VIEWER, context())).toEqual({
      canOpen: true,
      canReply: true,
      canEdit: true,
      canDelete: true,
      canReport: false,
      canBlock: false,
    });
    expect(canOpenMessageActions(mine, VIEWER)).toBe(true);
  });

  it("offers delete on anyone's message with channels:manage, and still never edit", () => {
    const actions = messageActionsFor(
      base,
      VIEWER,
      context(everyoneIsAMember, { canManageChannel: true }),
    );
    expect(actions.canDelete).toBe(true);
    expect(actions.canEdit).toBe(false);
  });

  it("withholds reply where the channel takes none, and edit where the viewer can't post", () => {
    const readOnly = messageActionsFor(
      mine,
      VIEWER,
      context(everyoneIsAMember, { canReply: false, canPost: false }),
    );
    expect(readOnly.canReply).toBe(false);
    expect(readOnly.canEdit).toBe(false);
    expect(readOnly.canDelete).toBe(true);
  });

  it("never offers edit on the viewer's own poll", () => {
    const poll = one(restRow("m3", VIEWER, { kind: "poll" }));
    expect(messageActionsFor(poll, VIEWER, context()).canEdit).toBe(false);
    expect(messageActionsFor(poll, VIEWER, context()).canDelete).toBe(true);
  });

  it("offers nothing before the viewer is known", () => {
    expect(messageActionsFor(base, null, context()).canOpen).toBe(false);
    expect(canOpenMessageActions(base, null)).toBe(false);
  });

  it("offers nothing on a row the server has not confirmed, or a deleted one", () => {
    for (const row of [
      { ...base, _status: "pending" as const },
      { ...base, _status: "failed" as const },
      { ...base, is_deleted: true },
      { ...mine, _status: "pending" as const },
      { ...mine, is_deleted: true },
    ]) {
      expect(messageActionsFor(row, VIEWER, context()).canOpen).toBe(false);
      expect(canOpenMessageActions(row, VIEWER)).toBe(false);
    }
  });

  it("reports but never blocks the system actor", () => {
    const actions = messageActionsFor(
      { ...base, sender_id: SYSTEM_SENDER_ID },
      VIEWER,
      context(),
    );
    expect(actions.canReport).toBe(true);
    expect(actions.canBlock).toBe(false);
  });

  it("reports but never blocks or edits an imported row", () => {
    const imported = one(restRow("m4", null, { kind: "imported" }));
    const actions = messageActionsFor(imported, VIEWER, context());
    expect(actions.canReport).toBe(true);
    expect(actions.canBlock).toBe(false);
    expect(actions.canEdit).toBe(false);
    expect(actions.canDelete).toBe(false);
  });

  it("offers Block to a sender the cached roster does not list — a brand-new member looks exactly like that", () => {
    // Loaded before FRIEND joined. Hiding Block here would hide Guideline
    // 1.2's control from the member who just arrived.
    const staleRoster = rosterMembership({
      byId: { [VIEWER]: "Vic" },
      isPending: false,
      isError: false,
    });
    expect(messageActionsFor(base, VIEWER, context(staleRoster)).canBlock).toBe(
      true,
    );
  });

  it("still offers Block while the roster cannot say, leaving the 404 to the confirmation", () => {
    for (const roster of [
      { byId: {}, isPending: true, isError: false },
      { byId: {}, isPending: false, isError: true },
    ]) {
      expect(
        messageActionsFor(base, VIEWER, context(rosterMembership(roster)))
          .canBlock,
      ).toBe(true);
    }
  });

  it("reports but does not offer Block once a block attempt proved they left (finding 11)", () => {
    const afterA404 = rosterMembership(
      { byId: { [VIEWER]: "Vic" }, isPending: false, isError: false },
      new Set([FRIEND]),
    );
    const actions = messageActionsFor(base, VIEWER, context(afterA404));
    expect(actions.canReport).toBe(true);
    expect(actions.canBlock).toBe(false);
  });
});

describe("rosterMembership", () => {
  it("says yes for a listed member and nothing either way for anyone else", () => {
    const loaded = rosterMembership({
      byId: { [FRIEND]: "Casey" },
      isPending: false,
      isError: false,
    });
    expect(loaded(FRIEND)).toBe(true);
    // Not listed is not departed: the roster is cached.
    expect(loaded(BLOCKED)).toBeNull();
    // Not fooled by the object prototype.
    expect(loaded("toString")).toBeNull();
    expect(
      rosterMembership({ byId: {}, isPending: true, isError: false })(FRIEND),
    ).toBeNull();
  });

  it("says no only for a member a block attempt proved departed, until a roster lists them again", () => {
    const departed = new Set([BLOCKED]);
    expect(
      rosterMembership(
        { byId: {}, isPending: false, isError: false },
        departed,
      )(BLOCKED),
    ).toBe(false);
    expect(
      rosterMembership(
        { byId: {}, isPending: true, isError: false },
        departed,
      )(BLOCKED),
    ).toBe(false);
    // Rejoined: the roster's word wins.
    expect(
      rosterMembership(
        { byId: { [BLOCKED]: "Blake" }, isPending: false, isError: false },
        departed,
      )(BLOCKED),
    ).toBe(true);
  });
});
