/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

// These screens paint with the chapter accent (`useChapterBranding`), which
// reads the current chapter through the client provider these specs don't
// mount. A purple chapter's values, deliberately not house gold, so a control
// that slips back to a `gold.*` token shows up in an assertion; the hook
// itself has its own spec.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));
import { FrappThemeProvider } from "@/lib/theme";
import { ChatComposer, type ChatComposerProps } from "./chat-composer";

/**
 * The composer's attachment half, pinned where review alone would not catch a
 * regression.
 *
 * Two of these are bugs the web composer shipped and fixed once already, so
 * they are the ones most likely to come back: an attachment-only message being
 * treated as an empty send, and an attach control that stays live in a state
 * where the upload cannot succeed.
 *
 * Harness notes, because the mobile mocks make the obvious assertions lie:
 * `react-test-renderer` fires `onPress` even on a disabled `Pressable`, so
 * "press it and expect no call" passes against broken code — assert
 * `props.disabled` / `accessibilityState` instead. And `style` is a function
 * here, so a `JSON.stringify(tree.toJSON())` search finds nothing for these
 * controls and would pass vacuously.
 */

function renderComposer(overrides: Partial<ChatComposerProps> = {}) {
  const props: ChatComposerProps = {
    value: "",
    onChangeText: vi.fn(),
    onSend: vi.fn(),
    canSend: true,
    placeholder: "Message",
    ...overrides,
  };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChatComposer {...props} />
      </FrappThemeProvider>,
    );
  });
  return { tree, props };
}

function byLabel(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (node) => node.props?.accessibilityLabel === label,
  )[0];
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    storagePath: "chapters/c/chat/m/photo.jpg",
    filename: "photo.jpg",
    contentType: "image/jpeg",
    byteSize: 2048,
    ...overrides,
  };
}

describe("ChatComposer attach affordance", () => {
  it("renders no attach control at all when no handler is supplied", () => {
    // #2296's lesson, kept: a control for a capability that does not exist
    // reads as a bug and, on iOS, ships a purpose string for nothing. Absent
    // beats inert.
    const { tree } = renderComposer();
    expect(byLabel(tree, "Attach photo")).toBeUndefined();
  });

  it("enables the attach control when a handler is supplied and posting is live", () => {
    const { tree } = renderComposer({ onAttach: vi.fn() });
    expect(byLabel(tree, "Attach photo").props.disabled).toBe(false);
  });

  it("disables attach while an upload is in flight, and marks it busy", () => {
    // The picker half runs before any mutation starts, and a live button
    // through it invites a second picker stacked on the first.
    const { tree } = renderComposer({ onAttach: vi.fn(), isUploading: true });
    const button = byLabel(tree, "Attach photo");
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
  });

  it("disables attach — but keeps it visible — when a reason is given", () => {
    // An upload is a live PUT with no outbox behind it, so unlike the composer
    // itself it does have to go dark offline. Hiding it instead would read as
    // a missing feature.
    const { tree } = renderComposer({
      onAttach: vi.fn(),
      attachDisabledReason: "Photos need a connection — you can still send text.",
    });
    const button = byLabel(tree, "Attach photo");
    expect(button).toBeDefined();
    expect(button.props.disabled).toBe(true);
  });
});

describe("ChatComposer staged attachments", () => {
  it("sends with attachments and no text — an attachment-only message is real", () => {
    // Web shipped this bug once: `!body` returned early, so the send silently
    // no-opped with the chips still on screen and no error.
    const { tree } = renderComposer({
      value: "   ",
      attachments: [attachment()],
      onAttach: vi.fn(),
    });
    expect(byLabel(tree, "Send message").props.disabled).toBe(false);
  });

  it("still refuses a send with neither text nor attachments", () => {
    const { tree } = renderComposer({ value: "   ", attachments: [] });
    expect(byLabel(tree, "Send message").props.disabled).toBe(true);
  });

  it("keeps send disabled while the runtime has no identity, attachments or not", () => {
    const { tree } = renderComposer({
      value: "hello",
      canSend: false,
      attachments: [attachment()],
    });
    expect(byLabel(tree, "Send message").props.disabled).toBe(true);
  });

  it("names each staged file and offers a labelled remove", () => {
    const onRemoveAttachment = vi.fn();
    const { tree } = renderComposer({
      attachments: [attachment(), attachment({
        storagePath: "chapters/c/chat/m/second.png",
        filename: "second.png",
      })],
      onRemoveAttachment,
    });

    const remove = byLabel(tree, "Remove second.png");
    expect(remove).toBeDefined();
    act(() => {
      remove.props.onPress();
    });
    // Keyed on the storage path, not the index or the filename: two files can
    // share a name, and the path is what the send actually claims.
    expect(onRemoveAttachment).toHaveBeenCalledWith(
      "chapters/c/chat/m/second.png",
    );
  });

  it("renders a chip without a size when the byte count is unknown", () => {
    const { tree } = renderComposer({
      attachments: [attachment({ byteSize: null })],
    });
    expect(byLabel(tree, "Remove photo.jpg")).toBeDefined();
  });
});

describe("ChatComposer reply and edit strip (#2775)", () => {
  it("shows a staged reply with a cancel", () => {
    const onCancel = vi.fn();
    const { tree } = renderComposer({
      context: {
        kind: "reply",
        title: "Replying to Casey",
        preview: "see you at chapter",
        onCancel,
      },
    });
    const drawn = JSON.stringify(tree.toJSON());
    expect(drawn).toContain("Replying to Casey");
    expect(drawn).toContain("see you at chapter");
    act(() => byLabel(tree, "Cancel reply")!.props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(byLabel(tree, "Send message")).toBeDefined();
  });

  it("says the send saves the edit while one is open", () => {
    const { tree } = renderComposer({
      value: "fixed",
      context: {
        kind: "edit",
        title: "Editing message",
        preview: null,
        onCancel: vi.fn(),
      },
    });
    expect(byLabel(tree, "Save edit")).toBeDefined();
    expect(byLabel(tree, "Send message")).toBeUndefined();
    expect(byLabel(tree, "Cancel edit")).toBeDefined();
  });

  it("draws no strip for an ordinary send", () => {
    const { tree } = renderComposer();
    expect(byLabel(tree, "Cancel reply")).toBeUndefined();
    expect(byLabel(tree, "Cancel edit")).toBeUndefined();
  });
});

/** A pressable's resting style, its array flattened left to right. */
function restingStyle(node: ReactTestInstance) {
  return Object.assign(
    {},
    ...((node.props.style as (state: object) => unknown[])({
      pressed: false,
    }).filter(Boolean) as object[]),
  ) as { backgroundColor?: string; borderColor?: string };
}

function glyphColor(tree: ReactTestRenderer) {
  const glyph = byLabel(tree, "Send message")!.findByType("Text" as never);
  return Object.assign(
    {},
    ...[glyph.props.style].flat().filter(Boolean),
  ).color as string;
}

describe("ChatComposer accent", () => {
  it("paints send with the chapter's solid accent, not house gold (owner's rule, 2026-11-04)", () => {
    const { tree } = renderComposer({ value: "hi" });
    const style = restingStyle(byLabel(tree, "Send message")!);
    // The mocked chapter's solid fill and its contrast-corrected ink, the
    // pairing the chat cards use, never the step-11 text accent or gold ink.
    expect(style.backgroundColor).toBe("#8E4EC6");
    expect(glyphColor(tree)).toBe("#FFFFFF");
  });

  it("rests in the attach button's neutral recipe when nothing can be sent", () => {
    const { tree } = renderComposer({ value: "  " });
    const send = byLabel(tree, "Send message")!;
    const attach = renderComposer({ onAttach: vi.fn() }).tree;
    const style = restingStyle(send);
    const attachStyle = restingStyle(byLabel(attach, "Attach photo")!);

    // Not a faded accent: no opacity, no accent anywhere on it.
    expect(style).not.toHaveProperty("opacity");
    expect(style.backgroundColor).toBe(attachStyle.backgroundColor);
    expect(style.borderColor).toBe(attachStyle.borderColor);
    expect(JSON.stringify(style)).not.toContain("#8E4EC6");
    expect(glyphColor(tree)).not.toBe("#FFFFFF");
  });
});

describe("ChatComposer input", () => {
  it("measures one line at exactly the buttons' 44pt, so the three line up", () => {
    const { tree } = renderComposer();
    const input = tree.root.findByType("TextInput" as never);
    const style = input.props.style as {
      minHeight: number;
      paddingTop: number;
      paddingBottom: number;
      lineHeight: number;
      borderWidth: number;
      includeFontPadding: boolean;
      textAlignVertical: string;
    };
    expect(
      style.paddingTop +
        style.paddingBottom +
        style.lineHeight +
        2 * style.borderWidth,
    ).toBe(44);
    expect(style.minHeight).toBe(44);
    // Android's font padding would add to that line; off, it can't.
    expect(style.includeFontPadding).toBe(false);
    expect(style.textAlignVertical).toBe("center");
  });
});

describe("ChatComposer @-mention picker", () => {
  const ROSTER = [
    { user_id: "u-paul", display_name: "Paul Carlson" },
    { user_id: "u-pat", display_name: "Pat O'Brien" },
    { user_id: "u-sam", display_name: "Sam (VP)" },
  ];

  /** The draft, focused, with the caret at `caret` (default: the end). */
  function typed(value: string, caret = value.length, overrides: Partial<ChatComposerProps> = {}) {
    const result = renderComposer({ value, mentionCandidates: ROSTER, ...overrides });
    const input = result.tree.root.findByType("TextInput" as never);
    act(() => {
      input.props.onFocus?.();
      input.props.onSelectionChange?.({
        nativeEvent: { selection: { start: caret, end: caret } },
      });
    });
    return result;
  }

  const offered = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(
        (node) =>
          typeof node.props?.accessibilityLabel === "string" &&
          node.props.accessibilityLabel.startsWith("Mention ") &&
          typeof node.props.onPress === "function",
      )
      .map((node) => node.props.accessibilityLabel as string);

  it("offers the members whose name holds what follows the `@`", () => {
    // Anywhere in the name: "Sam (VP)" holds a "p" too, and "pa" narrows it.
    expect(offered(typed("@p").tree)).toHaveLength(3);
    expect(offered(typed("@pa").tree)).toEqual([
      "Mention Paul Carlson",
      "Mention Pat O'Brien",
    ]);
    expect(offered(typed("hey @sa").tree)).toEqual(["Mention Sam (VP)"]);
  });

  it("offers the roles this member may ping after the members", () => {
    const roles = [
      { role_id: "r-off", name: "Officers", mentionable: true },
      { role_id: "r-mem", name: "Member", mentionable: false },
    ];
    expect(offered(typed("@", 1, { mentionRoles: roles }).tree)).toEqual([
      "Mention Paul Carlson",
      "Mention Pat O'Brien",
      "Mention Sam (VP)",
      "Mention everyone in the Officers role",
    ]);
    // Picking a role writes its folded name, which the server resolves.
    const onChangeText = vi.fn();
    const { tree } = typed("cc @off", 7, { mentionRoles: roles, onChangeText });
    const row = tree.root.find(
      (node) =>
        node.props?.accessibilityLabel ===
          "Mention everyone in the Officers role" &&
        typeof node.props.onPress === "function",
    );
    act(() => row.props.onPress());
    expect(onChangeText).toHaveBeenCalledWith("cc @Officers ");
  });

  it("offers everyone on a bare `@`", () => {
    expect(offered(typed("@").tree)).toHaveLength(3);
  });

  it("stays closed until the input is focused", () => {
    const { tree } = renderComposer({ value: "@p", mentionCandidates: ROSTER });
    expect(offered(tree)).toEqual([]);
  });

  it("closes after a space, and away from a handle", () => {
    expect(offered(typed("@paul ").tree)).toEqual([]);
    expect(offered(typed("me@p").tree)).toEqual([]);
    expect(offered(typed("@p and more", 11).tree)).toEqual([]);
  });

  it("says so when nobody matches, and offers nothing while the roster loads", () => {
    const { tree } = typed("@zz");
    expect(byLabel(tree, "Members to mention")).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).toContain("No matching members");

    const loading = typed("@p", 2, { mentionCandidates: undefined });
    expect(JSON.stringify(loading.tree.toJSON())).not.toContain(
      "No matching members",
    );
    expect(offered(loading.tree)).toEqual([]);
  });

  it("writes the picked member's label in place of the typed handle", () => {
    const { tree, props } = typed("hi @pa");
    act(() => byLabel(tree, "Mention Paul Carlson")!.props.onPress());
    expect(props.onChangeText).toHaveBeenCalledWith("hi @PaulCarlson ");
  });

  it("closes on blur", () => {
    const { tree } = typed("@pa");
    act(() => tree.root.findByType("TextInput" as never).props.onBlur?.());
    expect(offered(tree)).toEqual([]);
  });

  it("stays closed while a range is selected", () => {
    const { tree } = typed("@pa");
    act(() =>
      tree.root.findByType("TextInput" as never).props.onSelectionChange?.({
        nativeEvent: { selection: { start: 0, end: 3 } },
      }),
    );
    expect(offered(tree)).toEqual([]);
  });

  it("replaces the whole handle when the caret sits inside one", () => {
    // `@PaulCarlson tomorrow`, caret after `@Pa`: the tail must go too.
    const { tree, props } = typed("@PaulCarlson tomorrow", 3);
    act(() => byLabel(tree, "Mention Pat O'Brien")!.props.onPress());
    expect(props.onChangeText).toHaveBeenCalledWith("@PatOBrien tomorrow");
  });

  it("keeps text after the caret, reusing a space already there", () => {
    const { tree, props } = typed("@sa how are you", 3);
    act(() => byLabel(tree, "Mention Sam (VP)")!.props.onPress());
    expect(props.onChangeText).toHaveBeenCalledWith("@SamVP how are you");
  });
});
