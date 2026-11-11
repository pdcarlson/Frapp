import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { messageFlagView } from "@repo/chat-core/flags";
import type { BlockState } from "@repo/chat-core/blocks";
import { signetDarkTokens } from "@repo/theme/signet";
import { formatTimeOfDay } from "@repo/formatting";
import { StyleSheet, Text } from "react-native";
import { FrappThemeProvider, tint } from "@/lib/theme";
import { AlertGlyph } from "@/components/control-glyphs";
import { screenText } from "@/test/screen-text";
import {
  resetChatDensityForTests,
  setChatDensity,
} from "@/lib/chat/chat-density";
import { MessageItem } from "./message-item";

// Message flags on the phone (#3921). Beside the row's main suite rather than
// in it, so the two change apart.

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMessageAttachments: () => ({
      isPending: false,
      isError: false,
      data: [],
    }),
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

const VIEWER = "11111111-1111-4111-8111-111111111111";
const SENDER = "22222222-2222-4222-8222-222222222222";
const FLAGGER = "33333333-3333-4333-8333-333333333333";
const names: Record<string, string> = {
  [SENDER]: "Elias",
  [FLAGGER]: "Marcus",
};
const nameFor = (id: string) => names[id] ?? null;
const ready = (blocked: string[] = []): BlockState => ({
  status: "ready",
  ids: new Set(blocked),
  unblocked: new Set(),
  cleared: new Set(),
});

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_blocked: false,
    _blockEvaluated: true,
    sender_id: SENDER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "tailgate starts at 11",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    flag: "important",
    flagged_by: FLAGGER,
    flagged_at: "2026-11-11T14:00:00.000Z",
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 10, 11, 13, 46).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    mentions: [],
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  };
}

function renderRow(msg: ChatMessage, blocked: string[] = []) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageItem
          message={msg}
          viewerId={VIEWER}
          nameFor={nameFor}
          startsRun
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          flag={messageFlagView(msg, VIEWER, ready(blocked), nameFor)}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const byTestId = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll(
    (node) => (node.type as unknown) === "View" && node.props.testID === id,
  );

describe("MessageItem flags (#3921)", () => {
  afterEach(() => {
    act(() => setChatDensity("cozy"));
    resetChatDensityForTests();
  });

  it("tints an Important row in danger red with a danger bar", () => {
    const tree = renderRow(message());
    const [fill] = byTestId(tree, "message-flag-important");
    expect(fill).toBeDefined();
    const style = JSON.stringify(fill!.props.style);
    expect(style).toContain(
      `"borderLeftColor":"${signetDarkTokens.color.semantic.destructive}"`,
    );
    const [caption] = byTestId(tree, "message-flag");
    expect(caption?.props.accessibilityLabel).toBe(
      "Important · flagged by Marcus",
    );
  });

  it("fills the row with the danger tint, a 2px bar and a red caption with its glyph", () => {
    const tree = renderRow(message());
    const style = StyleSheet.flatten(
      byTestId(tree, "message-flag-important")[0]!.props.style,
    );
    expect(style.backgroundColor).toBe(
      tint(signetDarkTokens.color.semantic.destructive),
    );
    expect(style.borderLeftWidth).toBe(2);
    const [caption] = byTestId(tree, "message-flag");
    expect(caption!.findAllByType(AlertGlyph)).toHaveLength(1);
    const label = caption!.findAllByType(Text)[0]!;
    expect(StyleSheet.flatten(label.props.style).color).toBe(
      signetDarkTokens.color.semantic.destructiveText,
    );
  });

  it("draws a thread's reply count in the foreground tone on an Important row", () => {
    const thread = {
      reply_count: 3,
      last_reply_at: "2026-11-11T14:00:00.000Z",
      recent_sender_ids: [],
    };
    const replies = (tree: ReactTestRenderer) =>
      tree.root
        .findAllByType(Text)
        .find((node) => node.props.children === "3 replies");
    const important = renderRow(message({ thread }));
    expect(StyleSheet.flatten(replies(important)!.props.style).color).toBe(
      signetDarkTokens.color.text.foreground,
    );
    const plain = renderRow(message({ thread, flag: null, flagged_by: null }));
    expect(StyleSheet.flatten(replies(plain)!.props.style).color).toBe(
      "#C49A3A",
    );
  });

  it("outranks the mention highlight", () => {
    const tree = renderRow(message({ mentions: [VIEWER] }));
    expect(byTestId(tree, "message-flag-important")).toHaveLength(1);
    expect(byTestId(tree, "message-mentions-viewer")).toHaveLength(0);
  });

  it("draws a lighter flag as a caption only", () => {
    const tree = renderRow(message({ flag: "funny", flagged_by: SENDER }));
    expect(byTestId(tree, "message-flag-important")).toHaveLength(0);
    expect(screenText(tree)).toContain("Funny");
    expect(screenText(tree)).not.toContain("flagged by");
  });

  it("drops a blocked flagger's name and keeps the flag", () => {
    const tree = renderRow(message(), [FLAGGER]);
    expect(byTestId(tree, "message-flag-important")).toHaveLength(1);
    expect(screenText(tree)).not.toContain("flagged by");
  });

  it("draws no flag on a deleted message", () => {
    const tree = renderRow(message({ is_deleted: true }));
    expect(byTestId(tree, "message-flag")).toHaveLength(0);
    expect(byTestId(tree, "message-flag-important")).toHaveLength(0);
  });

  it.each(["cozy", "compact", "bubbles"] as const)(
    "puts the flag on the author line, beside the time, in %s (#4288)",
    (density) => {
      act(() => setChatDensity(density));
      const tree = renderRow(message());
      const [line] = byTestId(tree, "author-line");
      expect(line).toBeDefined();
      expect(
        line!.findAll(
          (node) =>
            (node.type as unknown) === "View" &&
            node.props.testID === "message-flag",
        ),
      ).toHaveLength(1);
      const texts = line!
        .findAllByType(Text)
        .map((node) => node.props.children);
      expect(texts).toContain(formatTimeOfDay(message().created_at));
    },
  );

  it("puts the caption on a line of its own on a row with no author line", () => {
    let tree!: ReactTestRenderer;
    const msg = message();
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MessageItem
            message={msg}
            viewerId={VIEWER}
            nameFor={nameFor}
            startsRun={false}
            onRetry={vi.fn()}
            onDiscard={vi.fn()}
            onReact={vi.fn()}
            onUnreact={vi.fn()}
            flag={messageFlagView(msg, VIEWER, ready([]), nameFor)}
          />
        </FrappThemeProvider>,
      );
    });
    expect(byTestId(tree, "author-line")).toHaveLength(0);
    expect(byTestId(tree, "message-flag")).toHaveLength(1);
  });

  it.each(["cozy", "compact", "bubbles"] as const)(
    "draws one caption in %s",
    (density) => {
      act(() => setChatDensity(density));
      const tree = renderRow(message());
      expect(byTestId(tree, "message-flag")).toHaveLength(1);
    },
  );
});
