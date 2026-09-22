/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
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
