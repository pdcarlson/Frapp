/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

const hookState = vi.hoisted(() => ({
  calls: [] as Array<{
    channelId: string;
    messageId: string;
    enabled: boolean;
  }>,
  result: {} as Record<string, unknown>,
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMessageAttachments: (
      channelId: string,
      messageId: string,
      enabled: boolean,
    ) => {
      hookState.calls.push({ channelId, messageId, enabled });
      return hookState.result;
    },
  };
});

import { isPreviewable, MessageAttachments } from "./message-attachments";

/**
 * The behaviours this file exists for, all from #1229.
 *
 * The one that is easy to regress silently is the **count gate**: the query hook
 * reaches for `FrappClientProvider`, so a message with no attachments must not
 * issue a request — and the overwhelming majority of chat rows have none. It is
 * asserted here rather than left to review because nothing about the rendered
 * output would show it.
 */
function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    message_id: "msg-1",
    filename: "minutes.pdf",
    content_type: "application/pdf",
    byte_size: 2048,
    width: null,
    height: null,
    download_url: "https://example.test/signed/minutes.pdf",
    ...overrides,
  };
}

function render(
  props: Partial<React.ComponentProps<typeof MessageAttachments>> = {},
) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageAttachments
          channelId="chan-1"
          messageId="msg-1"
          count={1}
          isMine={false}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** Every string rendered anywhere in the tree. */
function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  hookState.calls = [];
  hookState.result = { isPending: false, isError: false, data: [attachment()] };
});

describe("the count gate", () => {
  it("issues no request for a message with no attachments", () => {
    hookState.result = { isPending: true, isError: false, data: undefined };
    const tree = render({ count: 0 });

    expect(hookState.calls).toEqual([
      { channelId: "chan-1", messageId: "msg-1", enabled: false },
    ]);
    expect(tree.toJSON()).toBeNull();
  });

  it("enables the query once a message has one", () => {
    render({ count: 1 });
    expect(hookState.calls[0]!.enabled).toBe(true);
  });
});

describe("rendering", () => {
  it("lists a non-image attachment as a row with its filename and size", () => {
    const tree = render();
    const rendered = textOf(tree);

    expect(rendered).toContain("minutes.pdf");
    // 2048 bytes through `formatBytes`.
    expect(rendered).toContain("2 KB");
  });

  it("labels the row with a verb, since it is the only way to reach the file", () => {
    const tree = render();
    const [row] = tree.root.findAllByProps({ accessibilityRole: "button" });

    expect(row!.props.accessibilityLabel).toBe("Open minutes.pdf");
  });

  it("previews an image inline instead of drawing a filename row", () => {
    hookState.result = {
      isPending: false,
      isError: false,
      data: [
        attachment({
          filename: "composite.png",
          content_type: "image/png",
          download_url: "https://example.test/signed/composite.png",
          width: 800,
          height: 400,
        }),
      ],
    };

    const tree = render();
    const images = tree.root.findAllByType(
      "Image" as unknown as React.ElementType,
    );

    expect(images).toHaveLength(1);
    expect(images[0]!.props.source).toEqual({
      uri: "https://example.test/signed/composite.png",
    });
  });

  it("sizes a preview from the stored dimensions so the row does not jump", () => {
    hookState.result = {
      isPending: false,
      isError: false,
      data: [
        attachment({ content_type: "image/png", width: 800, height: 400 }),
      ],
    };

    const tree = render();
    const image = tree.root.findAllByType(
      "Image" as unknown as React.ElementType,
    )[0]!;
    const style = JSON.stringify(image.props.style);

    expect(style).toContain('"aspectRatio":2');
  });

  it("falls back to a fixed height when the dimensions are null", () => {
    // `chat_message_attachments` allows both to be null, so an aspect ratio
    // computed from nothing would be NaN.
    hookState.result = {
      isPending: false,
      isError: false,
      data: [attachment({ content_type: "image/jpeg" })],
    };

    const tree = render();
    const image = tree.root.findAllByType(
      "Image" as unknown as React.ElementType,
    )[0]!;
    const style = JSON.stringify(image.props.style);

    expect(style).not.toContain("aspectRatio");
    expect(style).toContain('"height":180');
  });
});

describe("the states that must stay visible", () => {
  it("says it is loading rather than rendering nothing", () => {
    // Degrading to nothing would read as data loss to anyone who remembers
    // seeing the file — the filename used to be literal text in the body.
    hookState.result = { isPending: true, isError: false, data: undefined };
    expect(textOf(render({ count: 2 }))).toContain("Loading 2 attachments…");
  });

  it("reports a failed fetch rather than rendering nothing", () => {
    hookState.result = { isPending: false, isError: true, data: undefined };
    expect(textOf(render())).toContain("couldn");
  });
});

describe("isPreviewable", () => {
  it("is true only for image content types", () => {
    expect(isPreviewable("image/png")).toBe(true);
    expect(isPreviewable("application/pdf")).toBe(false);
    // The column is nullable, and a null must not preview as an image.
    expect(isPreviewable(null)).toBe(false);
  });
});
