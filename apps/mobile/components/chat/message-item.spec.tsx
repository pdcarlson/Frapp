/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { reactionActionType } from "@repo/chat-core/types";
import { FrappThemeProvider } from "@/lib/theme";
import { Keyboard } from "react-native";
import { drawnText } from "@/test/screen-text";

const attachmentHook = vi.hoisted(() => ({
  calls: [] as Array<{ enabled: boolean }>,
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMessageAttachments: (
      _channelId: string,
      _messageId: string,
      enabled: boolean,
    ) => {
      attachmentHook.calls.push({ enabled });
      return { isPending: false, isError: false, data: [] };
    },
  };
});

// `useChapterBranding` reaches for `useCurrentChapter` (`@repo/hooks`), which
// needs `FrappClientProvider` — a client this file's tests, focused on the
// attachment-mount gate, have no reason to provide. `chapter-branding.spec.tsx`
// owns the branding/accent behavior itself.
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

import {
  UNAVAILABLE_QUOTE,
  DELETED_MESSAGE_PLACEHOLDER,
} from "@repo/chat-core/reply-preview";
import { EDITED_MARKER } from "@repo/chat-core/message-actions";
import { signetDarkTokens } from "@repo/theme/signet";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  ADD_REACTION_A11Y_LABEL,
  groupReactions,
  MessageItem,
} from "./message-item";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_blocked: false,
    _blockEvaluated: true,
    sender_id: OTHER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "hello",
    kind: "text",
    payload: null,
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

// `senderLabel` moved to `lib/chat/display-name.ts` when the display-name
// resolution landed, and its cases moved with it — see `display-name.spec.ts`.
// It no longer takes a `ChatMessage`, so it needs none of this file's factory.

describe("groupReactions", () => {
  it("decodes the action type back to its emoji and counts the users", () => {
    const groups = groupReactions(
      message({ reactions: { [reactionActionType("👍")]: [VIEWER, OTHER] } }),
      VIEWER,
    );

    expect(groups).toEqual([
      {
        emoji: "👍",
        actionType: reactionActionType("👍"),
        count: 2,
        mine: true,
      },
    ]);
  });

  it("marks a reaction as not mine when the viewer is absent", () => {
    const groups = groupReactions(
      message({ reactions: { [reactionActionType("🔥")]: [OTHER] } }),
      VIEWER,
    );

    expect(groups[0]?.mine).toBe(false);
  });

  it("never marks a reaction mine for an id that isn't the viewer's users.id", () => {
    // The documented C1 trap: using the Supabase auth uid instead of
    // `users.id` renders fine but silently breaks own-reaction state and the
    // RLS-scoped delete behind `unreact`. (A null viewer is no longer
    // representable here: the thread withholds rows until identity lands,
    // #2250.)
    const authUid = "99999999-9999-4999-8999-999999999999";
    const groups = groupReactions(
      message({ reactions: { [reactionActionType("🔥")]: [VIEWER] } }),
      authUid,
    );

    expect(groups[0]?.mine).toBe(false);
  });

  it("drops emptied groups and non-reaction action types", () => {
    const groups = groupReactions(
      message({
        reactions: {
          [reactionActionType("👍")]: [],
          "rsvp:going": [VIEWER],
          [reactionActionType("✅")]: [OTHER],
        },
      }),
      VIEWER,
    );

    // A card action is not a reaction and must not render as a chip; an emptied
    // group would otherwise render as a chip reading "0".
    expect(groups.map((g) => g.emoji)).toEqual(["✅"]);
  });

  it("survives a message with no reactions at all", () => {
    expect(groupReactions(message(), VIEWER)).toEqual([]);
  });
});

/**
 * Where the attachment renderer is allowed to mount.
 *
 * The gate lives here rather than in `MessageAttachments` because the query hook
 * inside it reaches for `FrappClientProvider` on render — so "don't fetch" is not
 * enough, the component must not mount at all for the overwhelming majority of
 * rows. #1229.
 */
function renderItem(
  message: ChatMessage,
  replyParent?: ChatMessage | null,
  extra: {
    startsRun?: boolean;
    onOpenActions?: () => void;
    roleColorFor?: (userId: string) => string | null;
  } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageItem
          message={message}
          viewerId={VIEWER}
          nameFor={(id) => (id === OTHER ? "Casey" : null)}
          roleColorFor={extra.roleColorFor}
          startsRun={extra.startsRun ?? true}
          replyParent={replyParent}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          onOpenActions={extra.onOpenActions}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

// An imported row names its Discord author from `author_name`, having no roster
// entry; once its author links the account (#2878) it carries their
// `sender_id` and is simply theirs.
describe("an imported author's row", () => {
  const texts = (tree: ReactTestRenderer) =>
    tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children);

  it("names an unlinked Discord author, with their initials", () => {
    const tree = renderItem(
      message({
        kind: "imported",
        sender_id: null,
        author_name: "Discord Dan",
        author_external_id: "99",
      }),
    );
    expect(texts(tree)).toContain("Discord Dan");
    expect(texts(tree)).toContain("DD");
  });

  it("reads a row the viewer linked as their own", () => {
    const tree = renderItem(
      message({
        kind: "imported",
        sender_id: VIEWER,
        author_name: "Discord Dan",
        author_external_id: "99",
      }),
    );
    expect(texts(tree)).toContain("You");
    expect(texts(tree)).not.toContain("Discord Dan");
  });

  it("draws avatar initials bold, as web does (§11 Row anatomy)", () => {
    const tree = renderItem(
      message({ sender_id: null, author_name: "Discord Dan" }),
    );
    const initials = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "DD",
    );
    expect(JSON.stringify(initials.props.style)).toContain("Figtree_700Bold");
  });
});

// Frapp's own posts (the welcome, the audit bridge, a poll's closing notice,
// an invite-accept DM) read "Frapp" and wear the crest rather than initials
// (#3347). The system actor is on no roster, so it used to fall through to
// "Member 000000" beside a "00" avatar.
describe("a system post", () => {
  const hasSystemAvatar = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => node.props.testID === "system-avatar").length >
    0;

  it("draws the crest, not initials, for the system sender", () => {
    const tree = renderItem(
      message({ sender_id: SYSTEM_SENDER_ID, kind: "system_audit" }),
    );
    expect(hasSystemAvatar(tree)).toBe(true);
    // The name resolves to "Frapp" (`SYSTEM_AUTHOR_LABEL`), so initials, if
    // the crest branch went, would be drawn from it rather than from the id.
    const texts = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children);
    expect(texts).toContain("Frapp");
    expect(texts).not.toContain("Member 000000");
    expect(texts).not.toContain("F");
    expect(texts).not.toContain("FR");
  });

  it("keeps initials for a member", () => {
    const tree = renderItem(message());
    expect(hasSystemAvatar(tree)).toBe(false);
  });

  it("draws no crest on a system follow-on row", () => {
    const tree = renderItem(
      message({ sender_id: SYSTEM_SENDER_ID, kind: "system_audit" }),
      undefined,
      { startsRun: false },
    );
    expect(hasSystemAvatar(tree)).toBe(false);
  });
});

describe("attachment rendering is gated on the message", () => {
  beforeEach(() => {
    attachmentHook.calls = [];
  });

  it("mounts the renderer for a message that has attachments", () => {
    renderItem(message({ attachment_count: 2 }));
    expect(attachmentHook.calls).toEqual([{ enabled: true }]);
  });

  it("does not mount it for a plain text message", () => {
    renderItem(message({ attachment_count: 0 }));
    expect(attachmentHook.calls).toEqual([]);
  });

  it("does not mount it for a deleted message that had attachments", () => {
    // The API 404s the attachment list for a deleted message, but the client
    // must not offer the affordance in the first place.
    renderItem(message({ attachment_count: 3, is_deleted: true }));
    expect(attachmentHook.calls).toEqual([]);
  });

  it("no longer renders the open-on-web placeholder", () => {
    // #1228's stopgap. It was honest but it was a dead end, and the acceptance
    // criteria require it deleted rather than left alongside the real renderer.
    const rendered = JSON.stringify(
      renderItem(message({ attachment_count: 1 })).toJSON(),
    );
    expect(rendered).not.toContain("open on web");
  });
});

// foundations.md §6 "Where the accent goes" (2026-11-05): names are neutral,
// the viewer's own included. With no role colour "You" reads in the foreground
// text, and the row draws no colour from the mocked `useChapterBranding()`.
describe("the viewer's own name is neutral", () => {
  it("colours 'You' with the foreground text, and paints no accent", () => {
    const tree = renderItem(message({ sender_id: VIEWER, content: "hello" }));
    const you = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "You",
    );
    expect(JSON.stringify(you.props.style)).toContain(
      `"color":"${signetDarkTokens.color.text.foreground}"`,
    );
    // Neither the accent text nor the old self bubble's fill is drawn.
    const flat = JSON.stringify(tree.toJSON());
    expect(flat).not.toContain("#C49A3A");
    expect(flat).not.toContain("#2B2009");
  });

  it("never resolves branding colours for someone else's message", () => {
    // Guards the split: a row by anyone else must not call
    // useChapterBranding() at all, so its tree carries no mocked colour.
    const flat = JSON.stringify(
      renderItem(message({ sender_id: OTHER, content: "hello" })).toJSON(),
    );
    expect(flat).not.toContain("#C49A3A");
    expect(flat).not.toContain("#2B2009");
    expect(flat).toContain("Casey");
  });
});

// #3485: an author's name wears their top role's palette color, the
// viewer's own "You" included (foundations.md §6, 2026-11-05).
describe("an author's name takes their role color", () => {
  const roleColorFor = (id: string) => (id === OTHER ? "#6FD08C" : "#F2994A");

  it("paints someone else's name in their role color", () => {
    const tree = renderItem(
      message({ sender_id: OTHER, content: "hi" }),
      undefined,
      {
        roleColorFor,
      },
    );
    const name = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "Casey",
    );
    expect(JSON.stringify(name.props.style)).toContain('"color":"#6FD08C"');
  });

  it("paints the viewer's own name in their role color too, never the accent", () => {
    const tree = renderItem(
      message({ sender_id: VIEWER, content: "hi" }),
      undefined,
      {
        roleColorFor,
      },
    );
    const you = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "You",
    );
    expect(JSON.stringify(you.props.style)).toContain('"color":"#F2994A"');
    expect(JSON.stringify(tree.toJSON())).not.toContain("#C49A3A");
  });
});

// #3370: the viewer's own reaction wears the chapter's tint, never Ask gold.
describe("the viewer's own reaction takes the chapter accent", () => {
  it("paints a mine chip from the branding hook and leaves others neutral", () => {
    const tree = renderItem(
      message({
        sender_id: OTHER,
        content: "hello",
        reactions: {
          [reactionActionType("👍")]: [VIEWER],
          [reactionActionType("🔥")]: [OTHER],
        },
      }),
    );
    const chip = (emoji: string) =>
      tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          typeof node.props.accessibilityLabel === "string" &&
          node.props.accessibilityLabel.includes(emoji),
      );
    const mine = JSON.stringify(chip("👍").props.style);
    expect(mine).toContain('"backgroundColor":"#251A33"');
    expect(mine).toContain('"borderColor":"#5C3E8A"');
    expect(JSON.stringify(chip("👍").findByType("Text" as never).props.style)).toContain(
      '"color":"#C49A3A"',
    );
    expect(JSON.stringify(chip("🔥").props.style)).not.toContain("#251A33");
  });
});

// The `👍 +` chip under every unreacted message made the thread loose and
// busy; the first reaction starts from the long-press sheet instead (s05).
describe("the reaction row", () => {
  const pressables = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as unknown) === "Pressable");
  const addChip = (tree: ReactTestRenderer) =>
    pressables(tree).filter(
      (node) => node.props.accessibilityLabel === ADD_REACTION_A11Y_LABEL,
    );

  it("draws nothing, not even an add chip, under a message nobody reacted to", () => {
    const tree = renderItem(message(), undefined, { onOpenActions: vi.fn() });
    expect(addChip(tree)).toHaveLength(0);
    expect(drawnText(tree.root)).not.toContain("+");
  });

  it("follows existing reactions with a + chip that opens the actions sheet", () => {
    const onOpenActions = vi.fn();
    const tree = renderItem(
      message({ reactions: { [reactionActionType("🔥")]: [OTHER] } }),
      undefined,
      { onOpenActions },
    );
    const [add] = addChip(tree);
    expect(add).toBeDefined();
    expect(drawnText(add!)).toBe("+");
    // After the reaction chips, as the board draws `5` then `+`.
    const labels = pressables(tree).map((node) => node.props.accessibilityLabel);
    expect(labels.indexOf(ADD_REACTION_A11Y_LABEL)).toBeGreaterThan(
      labels.indexOf("🔥, 1"),
    );
    act(() => add!.props.onPress());
    expect(onOpenActions).toHaveBeenCalledTimes(1);
    // Reach grows up and down only (components.md §11): chips sit 6pt apart,
    // so a sideways overhang would hand the + the reaction chip's right edge.
    const chips = pressables(tree).filter((node) =>
      ["🔥, 1", ADD_REACTION_A11Y_LABEL].includes(node.props.accessibilityLabel),
    );
    expect(chips).toHaveLength(2);
    for (const node of chips) {
      expect(node.props.hitSlop).toEqual({ top: 9, bottom: 9 });
    }
  });

  it("forwards a long press on + to the row's actions, as every chip does", () => {
    // The + is its own Pressable and claims the touch: without the forward, a
    // long press on it would end as a tap.
    const onOpenActions = vi.fn();
    const tree = renderItem(
      message({ reactions: { [reactionActionType("🔥")]: [OTHER] } }),
      undefined,
      { onOpenActions },
    );
    const [add] = addChip(tree);
    expect(add!.props.accessibilityRole).toBe("button");

    act(() => add!.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledTimes(1);
    act(() => add!.props.onPress());
    expect(onOpenActions).toHaveBeenCalledTimes(2);
  });

  it("still offers + after the viewer's own reaction", () => {
    const tree = renderItem(
      message({ reactions: { [reactionActionType("👍")]: [VIEWER] } }),
      undefined,
      { onOpenActions: vi.fn() },
    );
    expect(addChip(tree)).toHaveLength(1);
  });

  it("draws no + where the sheet can't open, or before the message is confirmed", () => {
    const reacted = { reactions: { [reactionActionType("🔥")]: [OTHER] } };
    // No actions on the row: the chips still toggle, but + has nowhere to go.
    const noActions = renderItem(message(reacted));
    expect(drawnText(noActions.root)).toContain("🔥 1");
    expect(addChip(noActions)).toHaveLength(0);

    const pending = renderItem(
      message({ ...reacted, _status: "pending" }),
      undefined,
      { onOpenActions: vi.fn() },
    );
    expect(addChip(pending)).toHaveLength(0);
  });
});

describe("a tap on the row", () => {
  // The thread's list keeps taps for its controls while the keyboard is up
  // (`keyboardShouldPersistTaps="handled"`), and the row's frame claims a tap
  // for its long press, so the frame is what has to put the keyboard away.
  it("puts the keyboard away, as a tap on the thread did before", () => {
    vi.mocked(Keyboard.dismiss).mockClear();
    const onOpenActions = vi.fn();
    const tree = renderItem(message(), undefined, { onOpenActions });
    const frame = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.onLongPress === onOpenActions &&
        node.props.accessible === false,
    );

    act(() => frame.props.onPress());
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
    expect(onOpenActions).not.toHaveBeenCalled();
  });
});

/** The rows' own layout (components.md §11, #2873). */
describe("compact layout (#2873)", () => {
  /** Accessible containers carrying the long-press action. */
  function actionHosts(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        (node.type as unknown) === "View" &&
        Array.isArray(node.props.accessibilityActions) &&
        node.props.accessibilityActions.some(
          (action: { name?: string }) => action.name === "longpress",
        ),
    );
  }

  it("draws the avatar, the name and the time of day on a run's first row", () => {
    const flat = JSON.stringify(renderItem(message()).toJSON());
    expect(flat).toContain("Casey");
    expect(flat).toContain('"CA"');
    const time = new Date(2026, 7, 16, 17, 9).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(flat).toContain(time);
    // Never the date: that is the day divider's job.
    expect(flat).not.toContain("Aug");
  });

  it("draws no avatar, name or time on a follow-on row", () => {
    const tree = renderItem(message(), undefined, { startsRun: false });
    const drawn = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map(drawnText);
    expect(drawn.some((text) => text.includes("CA"))).toBe(false);
    expect(drawn.some((text) => text.includes("Casey"))).toBe(false);
    expect(drawn.some((text) => text.includes(":09"))).toBe(false);
    expect(drawn.some((text) => text.includes("hello"))).toBe(true);
  });

  it("names the sender and time to a screen reader on a follow-on's gutter", () => {
    const tree = renderItem(message(), undefined, {
      startsRun: false,
      onOpenActions: vi.fn(),
    });
    const gutter = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith("Casey, "),
    );
    expect(gutter.props.accessible).toBe(true);
    // And it carries the long-press, so a photo-only follow-on is reachable.
    expect(actionHosts(tree)).toContain(gutter);
  });

  it("draws no text row for an attachment-only message", () => {
    const withText = renderItem(message({ attachment_count: 1 }), undefined, {
      onOpenActions: vi.fn(),
    });
    const photoOnly = renderItem(
      message({ content: "", attachment_count: 1 }),
      undefined,
      { onOpenActions: vi.fn() },
    );
    // The author line carries the action on both; only the one with text has
    // a body container too.
    expect(actionHosts(withText)).toHaveLength(2);
    expect(actionHosts(photoOnly)).toHaveLength(1);
  });

  it("offers a photo-only reply's jump on its author line", () => {
    const onJumpToParent = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageItem
            message={message({
              content: "",
              attachment_count: 1,
              reply_to_id: "msg-parent",
            })}
            viewerId={VIEWER}
            nameFor={() => "Casey"}
            startsRun
            replyParent={message({ id: "msg-parent", content: "the original" })}
            onRetry={vi.fn()}
            onDiscard={vi.fn()}
            onReact={vi.fn()}
            onUnreact={vi.fn()}
            onJumpToParent={onJumpToParent}
          />
        </FrappThemeProvider>,
      );
    });
    const host = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        Array.isArray(node.props.accessibilityActions) &&
        node.props.accessibilityActions.some(
          (action: { name?: string }) => action.name === "jumpToParent",
        ),
    );
    act(() =>
      host.props.onAccessibilityAction({
        nativeEvent: { actionName: "jumpToParent" },
      }),
    );
    expect(onJumpToParent).toHaveBeenCalledTimes(1);
  });

  it("trails Pinned after the text, muted, never in the accent", () => {
    const tree = renderItem(message({ is_pinned: true }));
    const pinned = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.children === " · Pinned",
    );
    const style = JSON.stringify(pinned.props.style);
    expect(style).toContain(
      `"color":"${signetDarkTokens.color.text.mutedForeground}"`,
    );
    expect(style).not.toContain("#C49A3A");
  });

  it("marks a photo-only message on a line of its own, with no stray separator", () => {
    const tree = renderItem(
      message({
        content: "",
        attachment_count: 1,
        is_pinned: true,
        edited_at: "2026-09-29T17:20:00.000Z",
      }),
      undefined,
      { onOpenActions: vi.fn() },
    );
    const texts = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children);
    // `(edited)` leads its own line, and Pinned follows it with the separator.
    expect(texts).toContainEqual([EDITED_MARKER, expect.anything()]);
    expect(texts).toContain(" · Pinned");
    // Still no text row above the photo: only the author line is an action host.
    expect(actionHosts(tree)).toHaveLength(1);
  });

  it("marks a pinned photo-only message without a leading separator", () => {
    const tree = renderItem(
      message({ content: "", attachment_count: 1, is_pinned: true }),
    );
    const texts = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children);
    expect(texts).toContain("Pinned");
    expect(texts).not.toContain(" · Pinned");
  });

  it("offers no reactions on a deleted message, not even the add chip", () => {
    const flat = JSON.stringify(
      renderItem(
        message({
          is_deleted: true,
          reactions: { [reactionActionType("🔥")]: [OTHER] },
        }),
        undefined,
        { onOpenActions: vi.fn() },
      ).toJSON(),
    );
    expect(flat).toContain(DELETED_MESSAGE_PLACEHOLDER);
    expect(flat).not.toContain("🔥");
    expect(flat).not.toContain(ADD_REACTION_A11Y_LABEL);
  });

  it("mutes the text of a send still in flight", () => {
    const tree = renderItem(message({ sender_id: VIEWER, _status: "pending" }));
    // The body is the Text whose own children carry the message.
    const body = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        Array.isArray(node.props.style) &&
        drawnText(node).includes("hello"),
    );
    expect(JSON.stringify(body.props.style)).toContain(
      `"color":"${signetDarkTokens.color.text.mutedForeground}"`,
    );
  });
});

const PARENT_ID = "msg-parent";

function parentRow(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message({
    id: PARENT_ID,
    content: "the original",
    sender_id: OTHER,
    ...overrides,
  });
}

describe("reply quote (#1727)", () => {
  it("renders the quoted parent above an incoming reply", () => {
    const flat = JSON.stringify(
      renderItem(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        parentRow(),
      ).toJSON(),
    );
    expect(flat).toContain("the original");
    expect(flat).toContain("Casey");
    expect(flat).toContain("agreed");
  });

  it("draws the quote above the author line", () => {
    const flat = JSON.stringify(
      renderItem(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        parentRow({ sender_id: OTHER }),
      ).toJSON(),
    );
    // The quote's author comes first in the tree, then the row's own.
    expect(flat.indexOf("the original")).toBeLessThan(
      flat.lastIndexOf("Casey"),
    );
  });

  it("says so when the parent is outside the loaded window", () => {
    // Nothing backfills older history (#1571). Rendering nothing would make
    // this reply indistinguishable from a plain message.
    const flat = JSON.stringify(
      renderItem(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        null,
      ).toJSON(),
    );
    expect(flat).toContain(UNAVAILABLE_QUOTE);
    expect(flat).not.toContain("the original");
  });

  it("does not quote on a message that is not a reply", () => {
    const flat = JSON.stringify(
      renderItem(message({ content: "hello" })).toJSON(),
    );
    expect(flat).not.toContain(UNAVAILABLE_QUOTE);
  });

  it("hides the quote on a deleted reply", () => {
    const flat = JSON.stringify(
      renderItem(
        message({
          reply_to_id: PARENT_ID,
          is_deleted: true,
          content: "",
        }),
        parentRow(),
      ).toJSON(),
    );
    expect(flat).not.toContain("the original");
    expect(flat).toContain(DELETED_MESSAGE_PLACEHOLDER);
  });

  it("quotes a deleted parent as the tombstone, not as a blank", () => {
    const flat = JSON.stringify(
      renderItem(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        parentRow({ is_deleted: true, content: "" }),
      ).toJSON(),
    );
    expect(flat).toContain("[message deleted]");
    expect(flat).toContain("agreed");
  });

  it("flattens markdown in the parent using the shared preview rules", () => {
    // The quote flattens the parent with the shared preview rules (#1727), so
    // `_really_ urgent` reads `really urgent` in the strip, as the parent's own
    // row now draws it too (#2861).
    const flat = JSON.stringify(
      renderItem(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        parentRow({ content: "_really_ urgent" }),
      ).toJSON(),
    );
    expect(flat).toContain("really urgent");
    expect(flat).not.toContain("_really_");
  });

  it("still quotes on the viewer's own message", () => {
    const flat = JSON.stringify(
      renderItem(
        message({
          sender_id: VIEWER,
          reply_to_id: PARENT_ID,
          content: "agreed",
        }),
        parentRow(),
      ).toJSON(),
    );
    expect(flat).toContain("the original");
    expect(flat).toContain("agreed");
  });
});

describe("delivery status (#1910)", () => {
  const DESTRUCTIVE = "#F85149";

  it("renders an unconfirmed row as a muted note, not as delivered", () => {
    const flat = JSON.stringify(
      renderItem(
        message({
          sender_id: VIEWER,
          _status: "unconfirmed",
          _error:
            "Not confirmed — these points may or may not have been recorded.",
        }),
      ).toJSON(),
    );

    expect(flat).toContain(
      "Not confirmed — these points may or may not have been recorded.",
    );
    expect(flat).not.toContain("Send failed");
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
    // Not a known failure — red is what makes an officer re-type the command.
    expect(flat).not.toContain(DESTRUCTIVE);
  });

  it("never offers discard on an unconfirmed row even when a handler is wired", () => {
    // renderItem always wires onDiscard. The control must not appear.
    const flat = JSON.stringify(
      renderItem(
        message({ sender_id: VIEWER, _status: "unconfirmed" }),
      ).toJSON(),
    );
    expect(flat).toContain("Not confirmed");
    expect(flat).not.toContain("Discard");
  });

  it("renders a recorded row as a muted don't-run-again note, with no retry", () => {
    const flat = JSON.stringify(
      renderItem(
        message({
          sender_id: VIEWER,
          _status: "recorded",
          _error:
            "Points recorded — the chat card didn't post. Don't run this command again.",
        }),
      ).toJSON(),
    );

    expect(flat).toContain("Don't run this command again.");
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
    expect(flat).not.toContain(DESTRUCTIVE);
  });

  it("keeps failed rows red with retry and discard", () => {
    const flat = JSON.stringify(
      renderItem(message({ sender_id: VIEWER, _status: "failed" })).toJSON(),
    );

    expect(flat).toContain("Send failed");
    expect(flat).toContain("Retry sending this message");
    expect(flat).toContain("Discard this message");
    expect(flat).toContain(DESTRUCTIVE);
  });

  it("draws no delivery line on a confirmed message", () => {
    const flat = JSON.stringify(
      renderItem(message({ sender_id: VIEWER, _status: "confirmed" })).toJSON(),
    );

    expect(flat).not.toContain("Not confirmed");
    expect(flat).not.toContain("Send failed");
    expect(flat).not.toContain("Sending");
  });

  it("says Sending… under a pending message", () => {
    const flat = JSON.stringify(
      renderItem(message({ sender_id: VIEWER, _status: "pending" })).toJSON(),
    );
    expect(flat).toContain("Sending…");
    expect(flat).not.toContain("Discard this message");
  });
});

describe("links in a message are tappable (#2775)", () => {
  function links(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.accessibilityRole === "link",
    );
  }

  it("draws a bare URL and a markdown link as links, on anyone's message", async () => {
    const WebBrowser = await import("expo-web-browser");
    for (const sender of [OTHER, VIEWER]) {
      vi.mocked(WebBrowser.openBrowserAsync).mockClear();
      const tree = renderItem(
        message({
          sender_id: sender,
          content: "see https://frapp.live/a and [docs](https://x.test/d).",
        }),
      );
      const found = links(tree);
      expect(found.map((node) => node.props.children)).toEqual([
        "https://frapp.live/a",
        "docs",
      ]);
      act(() => found[1]!.props.onPress());
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        "https://x.test/d",
      );
    }
  });

  it("never links an unsafe target, and keeps its label as text", () => {
    const tree = renderItem(
      message({ content: "[click me](javascript:alert(1))" }),
    );
    expect(links(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain("click me");
  });

  it("offers each link to a screen reader as a named action", () => {
    const tree = renderItem(
      message({ content: "https://frapp.live/a", _status: "confirmed" }),
    );
    const container = tree.root.find(
      (node) =>
        (node.type as unknown) === "View" &&
        Array.isArray(node.props.accessibilityActions) &&
        node.props.accessibilityActions.some(
          (action: { label?: string }) =>
            action.label === "Open https://frapp.live/a",
        ),
    );
    expect(container.props.accessible).toBe(true);
  });
});

describe("markers under a list (#2861)", () => {
  it("start their own line with no leading space", () => {
    const tree = renderItem(
      message({
        content: "- a\n- b",
        edited_at: "2026-09-29T18:00:00Z",
        is_pinned: true,
      }),
    );
    const body = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        Array.isArray(node.props.style) &&
        drawnText(node).startsWith("a"),
    );
    expect(drawnText(body)).toBe(`a\nb\n${EDITED_MARKER} · Pinned`);
  });

  it("drop the Pinned separator when Pinned starts the line", () => {
    const tree = renderItem(message({ content: "- a", is_pinned: true }));
    const body = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        Array.isArray(node.props.style) &&
        drawnText(node).startsWith("a"),
    );
    expect(drawnText(body)).toBe("a\nPinned");
  });
});

describe("a body whose markdown draws nothing (#2861)", () => {
  it("draws no text line, and puts the markers on a line of their own", () => {
    const tree = renderItem(
      message({ content: "---", edited_at: "2026-09-29T18:00:00Z" }),
    );
    const drawn = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map(drawnText);
    // `OwnLineMarkers` draws the marker bare; one trailing a text line leads
    // with a space.
    expect(drawn).toContain(EDITED_MARKER);
    expect(drawn).not.toContain(` ${EDITED_MARKER}`);
    expect(drawn.some((text) => text.includes("---"))).toBe(false);
  });
});

describe("edited marker (#2775)", () => {
  it("marks an edited message, the viewer's or anyone's", () => {
    for (const sender of [OTHER, VIEWER]) {
      const flat = JSON.stringify(
        renderItem(
          message({
            sender_id: sender,
            edited_at: "2026-09-29T18:00:00Z",
          }),
        ).toJSON(),
      );
      expect(flat).toContain(EDITED_MARKER);
      // The copy itself, as web and the behavior spec have it.
      expect(flat).toMatch(/\S \(edited\)/);
      expect(EDITED_MARKER).toBe("(edited)");
    }
  });

  it("marks an edited follow-on row too, which draws no author line (#2872)", () => {
    const flat = JSON.stringify(
      renderItem(message({ edited_at: "2026-09-29T18:00:00Z" }), undefined, {
        startsRun: false,
      }).toJSON(),
    );
    expect(flat).toContain(EDITED_MARKER);
  });

  it("does not mark an unedited or deleted message", () => {
    expect(JSON.stringify(renderItem(message()).toJSON())).not.toContain(
      EDITED_MARKER,
    );
    expect(
      JSON.stringify(
        renderItem(
          message({ edited_at: "2026-09-29T18:00:00Z", is_deleted: true }),
        ).toJSON(),
      ),
    ).not.toContain(EDITED_MARKER);
  });
});
