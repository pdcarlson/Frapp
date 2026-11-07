/** @vitest-environment jsdom */
import React from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
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

import * as WebBrowser from "expo-web-browser";
import { ImageViewerContext } from "./image-viewer";
import { MessageAttachments } from "./message-attachments";
import {
  attachmentMatchKey,
  clearLocalPhotosForTest,
  rememberLocalPhotos,
} from "@/lib/chat/local-photos";
import { chatPhotoCacheKey } from "@/lib/chat/photo-cache";

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
  openViewer: React.ContextType<typeof ImageViewerContext> = null,
) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ImageViewerContext.Provider value={openViewer}>
          <MessageAttachments
            channelId="chan-1"
            messageId="msg-1"
            count={1}
            {...props}
          />
        </ImageViewerContext.Provider>
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
      "ExpoImage" as unknown as React.ElementType,
    );

    expect(images).toHaveLength(1);
    expect(images[0]!.props.source).toEqual({
      uri: "https://example.test/signed/composite.png",
      cacheKey: chatPhotoCacheKey("att-1", "original"),
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
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button",
    );

    expect(JSON.stringify(row.props.style)).toContain('"aspectRatio":2');
  });

  it("sizes a photo with no stored size from the image once it loads, against the start of the column", () => {
    hookState.result = {
      isPending: false,
      isError: false,
      data: [attachment({ content_type: "image/jpeg", filename: "old.jpg" })],
    };

    const tree = render();
    const row = () =>
      tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "button",
      );
    expect(JSON.stringify(row().props.style)).not.toContain("aspectRatio");

    const image = tree.root.findAllByType(
      "ExpoImage" as unknown as React.ElementType,
    )[0]!;
    act(() => image.props.onLoad({ source: { width: 600, height: 800 } }));

    const style = JSON.stringify(row().props.style);
    expect(style).toContain('"aspectRatio":0.75');
    expect(style).toContain('"alignSelf":"flex-start"');
  });

  it("caps a tall preview so it cannot push the thread off screen", () => {
    // A 400x2000 phone screenshot is the ordinary case, not a pathological one:
    // width:100% plus its aspect ratio would derive a height many times the
    // bubble's width.
    hookState.result = {
      isPending: false,
      isError: false,
      data: [
        attachment({ content_type: "image/png", width: 400, height: 2000 }),
      ],
    };

    const tree = render();
    const image = tree.root.findAllByType(
      "ExpoImage" as unknown as React.ElementType,
    )[0]!;
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button",
    );

    expect(JSON.stringify(image.props.style)).toContain('"maxHeight":256');
    // The row narrows to the width at which the photo reaches the cap.
    expect(JSON.stringify(row.props.style)).toContain('"maxWidth":51.2');
  });

  it("draws a photo bare and a file in its frame", () => {
    hookState.result = {
      isPending: false,
      isError: false,
      data: [
        attachment({
          id: "photo",
          content_type: "image/png",
          width: 800,
          height: 400,
        }),
        attachment({
          id: "file",
          content_type: "application/pdf",
          filename: "dues.pdf",
        }),
      ],
    };

    const tree = render();
    const [photo, file] = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button",
    );
    expect(JSON.stringify(photo!.props.style)).not.toContain("borderWidth");
    expect(JSON.stringify(file!.props.style)).toContain('"borderWidth":1');
  });

  // Any shape the column's width would push past the cap: a portrait photo,
  // and on a ~314pt column a square one too. A full-width box would leave
  // `contain` empty sides with the rounded corners on them.
  it.each([
    ["portrait", 400, 2000, 0.2, 51.2],
    ["square", 1080, 1080, 1, 256],
    ["4:3", 1600, 1200, 4 / 3, (256 * 4) / 3],
  ])(
    "hugs a %s photo with its row, at its own shape under the cap",
    (_shape, width, height, aspect, maxWidth) => {
      hookState.result = {
        isPending: false,
        isError: false,
        data: [attachment({ content_type: "image/png", width, height })],
      };

      const tree = render();
      const row = tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityRole === "button",
      );
      const rowStyle = JSON.stringify(row.props.style);
      expect(rowStyle).toContain('"alignSelf":"flex-start"');
      expect(rowStyle).toContain('"width":"100%"');
      expect(rowStyle).toContain(`"maxWidth":${maxWidth}`);
      expect(rowStyle).toContain(`"aspectRatio":${aspect}`);
      const image = tree.root.findAllByType(
        "ExpoImage" as unknown as React.ElementType,
      )[0]!;
      const imageStyle = JSON.stringify(image.props.style);
      expect(imageStyle).toContain('"height":"100%"');
      expect(imageStyle).not.toContain("aspectRatio");
    },
  );

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
      "ExpoImage" as unknown as React.ElementType,
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

// A one-line caption that a photo up to 256pt tall then replaced pushed the
// thread with every photo that landed (components.md §10).
describe("the loading tiles", () => {
  const tiles = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "View" &&
        node.props.testID === "attachment-loading-tile",
    );

  it("reserves a bare preview's room and an unsized preview's height for one file", () => {
    hookState.result = { isPending: true, isError: false, data: undefined };
    const tree = render({ count: 1 });

    expect(tiles(tree)).toHaveLength(1);
    // No caption line to grow out of.
    expect(tree.root.findAllByType("Text" as never)).toHaveLength(0);

    const tile = tiles(tree)[0]!;
    const frame = JSON.stringify(tile.props.style);
    const block = JSON.stringify(
      (tile.children[0] as ReactTestInstance).props.style,
    );
    expect(frame).toContain(
      `"borderRadius":${signetDarkTokens.radius.control}`,
    );
    // Bare like the photo it becomes (components.md § Chrome weight): no
    // file-row frame to drop when the photo lands.
    expect(frame).not.toContain("borderWidth");
    expect(frame).not.toContain(signetDarkTokens.color.surface.surface1);
    expect(block).toContain('"height":180');
    expect(block).toContain(
      `"borderRadius":${signetDarkTokens.radius.control}`,
    );
    expect(block).toContain(
      `"backgroundColor":"${signetDarkTokens.color.surface.popover}"`,
    );
  });

  it("keeps the loading line's name for a screen reader", () => {
    hookState.result = { isPending: true, isError: false, data: undefined };
    const one = render({ count: 1 });
    const [status] = one.root.findAll(
      (node) => node.props.accessibilityRole === "progressbar",
    );
    expect(status!.props.accessibilityLabel).toBe("Loading attachment…");
    expect(status!.props.accessible).toBe(true);

    const two = render({ count: 2 });
    expect(
      two.root.find((node) => node.props.accessibilityRole === "progressbar")
        .props.accessibilityLabel,
    ).toBe("Loading 2 attachments…");
  });

  it("draws the tile as tall as the photo it stands in for, when that photo is unsized", () => {
    hookState.result = { isPending: true, isError: false, data: undefined };
    const loading = render({ count: 1 });
    const tileBlock = tiles(loading)[0]!.children[0] as ReactTestInstance;

    hookState.result = {
      isPending: false,
      isError: false,
      data: [attachment({ content_type: "image/jpeg" })],
    };
    const loaded = render({ count: 1 });
    const image = loaded.root.findAllByType(
      "ExpoImage" as unknown as React.ElementType,
    )[0]!;

    const height = (style: unknown) =>
      (JSON.stringify(style).match(/"height":(\d+)/) ?? [])[1];
    expect(height(tileBlock.props.style)).toBe(height(image.props.style));
  });

  // The row knows the count, not the types, until the files are read. The tile
  // bets on a photo; a web-sent document loses that bet and settles into its
  // one-line file row (the docblock says why that is still the smaller jump).
  it("draws a photo tile for a pending file, then settles into its file row", () => {
    hookState.result = { isPending: true, isError: false, data: undefined };
    // A fresh element per render: React skips re-rendering an identical one.
    const element = () => (
      <FrappThemeProvider>
        <ImageViewerContext.Provider value={null}>
          <MessageAttachments channelId="chan-1" messageId="msg-1" count={1} />
        </ImageViewerContext.Provider>
      </FrappThemeProvider>
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(element());
    });
    expect(tiles(tree)).toHaveLength(1);

    hookState.result = {
      isPending: false,
      isError: false,
      data: [attachment()],
    };
    act(() => tree.update(element()));

    expect(tiles(tree)).toHaveLength(0);
    expect(
      tree.root.findAllByType("ExpoImage" as unknown as React.ElementType),
    ).toHaveLength(0);
    const [row] = tree.root.findAllByProps({ accessibilityRole: "button" });
    expect(row!.props.accessibilityLabel).toBe("Open minutes.pdf");
    expect(textOf(tree)).toContain("minutes.pdf");
    expect(textOf(tree)).not.toMatch(/"height":180/);
  });
});

// #2874: an image opens the thread's viewer, not the browser.
describe("opening an image", () => {
  const photo = (n: number) =>
    attachment({
      id: `att-${n}`,
      filename: `photo-${n}.png`,
      content_type: "image/png",
      download_url: `https://example.test/signed/photo-${n}.png`,
    });

  beforeEach(() => {
    vi.mocked(WebBrowser.openBrowserAsync).mockClear();
  });

  it("opens the viewer on the tapped image of this message", () => {
    // The PDF sits between the images and is not one of them.
    hookState.result = {
      isPending: false,
      isError: false,
      data: [photo(1), attachment(), photo(2)],
    };
    const openViewer = vi.fn();
    const tree = render({ count: 3 }, openViewer);

    const row = tree.root
      .findAllByProps({ accessibilityRole: "button" })
      .find((node) => node.props.accessibilityLabel === "View photo-2.png")!;
    act(() => row.props.onPress());

    expect(openViewer).toHaveBeenCalledWith({
      channelId: "chan-1",
      messageId: "msg-1",
      imageId: "att-2",
    });
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  it("still opens any other file through the signed URL", () => {
    const openViewer = vi.fn();
    const tree = render({}, openViewer);
    const [row] = tree.root.findAllByProps({ accessibilityRole: "button" });
    act(() => row!.props.onPress());

    expect(openViewer).not.toHaveBeenCalled();
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://example.test/signed/minutes.pdf",
    );
  });

  it("opens an image in the browser where no screen hosts a viewer", () => {
    hookState.result = { isPending: false, isError: false, data: [photo(1)] };
    const tree = render();
    const [row] = tree.root.findAllByProps({ accessibilityRole: "button" });

    expect(row!.props.accessibilityLabel).toBe("Open photo-1.png");
    act(() => row!.props.onPress());
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://example.test/signed/photo-1.png",
    );
  });

  it("keeps an SVG a file row, never drawn and never in the viewer", () => {
    hookState.result = {
      isPending: false,
      isError: false,
      data: [
        attachment({ filename: "logo.svg", content_type: "image/svg+xml" }),
      ],
    };
    const openViewer = vi.fn();
    const tree = render({}, openViewer);

    expect(
      tree.root.findAllByType("ExpoImage" as unknown as React.ElementType),
    ).toHaveLength(0);
    expect(textOf(tree)).toContain("logo.svg");
    const [row] = tree.root.findAllByProps({ accessibilityRole: "button" });
    act(() => row!.props.onPress());
    expect(openViewer).not.toHaveBeenCalled();
  });
});

describe("several photos and the sender's own", () => {
  const photo = (id: string, extra: Record<string, unknown> = {}) =>
    attachment({
      id,
      filename: `${id}.jpg`,
      content_type: "image/jpeg",
      byte_size: 1000,
      download_url: `https://example.test/signed/${id}.jpg`,
      ...extra,
    });
  const uris = (tree: ReactTestRenderer) =>
    tree.root
      .findAll(
        (node) =>
          (node.type as unknown) === "ExpoImage" &&
          typeof node.props.source?.uri === "string",
      )
      .map((node) => node.props.source.uri as string);

  beforeEach(() => {
    clearLocalPhotosForTest();
  });

  it("draws two or more photos as one grid, four tiles, the last saying +N", () => {
    hookState.result = {
      isPending: false,
      isError: false,
      data: ["a", "b", "c", "d", "e", "f"].map((id) => photo(id)),
    };
    const tree = render({ count: 6 }, vi.fn());
    expect(uris(tree)).toHaveLength(4);
    const texts = tree.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => [node.props.children].flat().join(""));
    expect(texts).toContain("+2");
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "View 6 photos",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("reserves a grid, not a stack, while several photos load", () => {
    hookState.result = { isPending: true };
    const tree = render({ count: 6 });
    expect(
      tree.root.findAll(
        (node) =>
          node.props.testID === "attachment-loading-tile" &&
          (node.type as unknown) === "View",
      ),
    ).toHaveLength(4);
  });

  it("draws the sender's photos from the phone while the message sends, fetching nothing", () => {
    rememberLocalPhotos("c-1", [
      { uri: "file:///a.jpg", width: 3, height: 4, match: null },
      { uri: "file:///b.jpg", width: 4, height: 3, match: null },
    ]);
    hookState.result = { isPending: true };
    const tree = render({ count: 2, clientMessageId: "c-1", confirmed: false });
    expect(uris(tree)).toEqual(["file:///a.jpg", "file:///b.jpg"]);
    expect(hookState.calls.at(-1)?.enabled).toBe(false);
  });

  it("keeps drawing the sender's own file once the message is confirmed", () => {
    rememberLocalPhotos("c-1", [
      {
        uri: "file:///a.jpg",
        width: 3,
        height: 4,
        match: attachmentMatchKey("a.jpg", 1000),
      },
    ]);
    hookState.result = { isPending: false, isError: false, data: [photo("a")] };
    const tree = render({ count: 1, clientMessageId: "c-1" }, vi.fn());
    expect(uris(tree)).toEqual(["file:///a.jpg"]);
  });

  describe("previews (2026-11-07)", () => {
    const THUMBHASH = "3OcRJYB4d3h/iIeHeEh3eIhw+j3A";
    const photoRow = attachment({
      filename: "IMG_1.jpg",
      content_type: "image/jpeg",
      width: 2560,
      height: 1920,
      thumbhash: THUMBHASH,
      download_url: "https://example.test/signed/IMG_1.jpg",
      preview_url: "https://example.test/signed/preview.jpg",
    });
    const images = (tree: ReactTestRenderer) =>
      tree.root.findAllByType("ExpoImage" as unknown as React.ElementType);

    it("draws the preview copy, keyed by file, over a blur of the photo", () => {
      hookState.result = { isPending: false, isError: false, data: [photoRow] };

      const tree = render();
      const [picture] = images(tree);

      expect(picture!.props.source).toEqual({
        uri: "https://example.test/signed/preview.jpg",
        cacheKey: chatPhotoCacheKey("att-1", "preview"),
      });
      expect(picture!.props.placeholder).toEqual({ thumbhash: THUMBHASH });
      expect(picture!.props.cachePolicy).toBe("disk");
    });

    it("hits the cache when the same photo comes back with a freshly signed URL", () => {
      hookState.result = { isPending: false, isError: false, data: [photoRow] };
      const first = images(render())[0]!.props.source.cacheKey;
      hookState.result = {
        isPending: false,
        isError: false,
        data: [
          { ...photoRow, preview_url: "https://example.test/signed/again.jpg" },
        ],
      };
      const second = images(render())[0]!.props.source.cacheKey;

      expect(second).toBe(first);
    });

    it("crops a grid tile's blur like the photo, and fills a lone photo's box", () => {
      hookState.result = { isPending: false, isError: false, data: [photoRow] };
      expect(images(render())[0]!.props.placeholderContentFit).toBe("fill");

      hookState.result = {
        isPending: false,
        isError: false,
        data: [photoRow, { ...photoRow, id: "att-2" }],
      };
      expect(images(render({ count: 2 }))[0]!.props.placeholderContentFit).toBe(
        "cover",
      );
    });

    it("falls back to the original when the preview fails to load", () => {
      hookState.result = { isPending: false, isError: false, data: [photoRow] };
      const tree = render();

      act(() => images(tree).at(-1)!.props.onError());

      expect(images(tree).at(-1)!.props.source).toEqual({
        uri: "https://example.test/signed/IMG_1.jpg",
        cacheKey: chatPhotoCacheKey("att-1", "original"),
      });
    });

    it("draws an older photo, with no preview or hash, from the original with no blur", () => {
      hookState.result = {
        isPending: false,
        isError: false,
        data: [
          attachment({
            filename: "old.jpg",
            content_type: "image/jpeg",
            download_url: "https://example.test/signed/old.jpg",
          }),
        ],
      };

      const tree = render();

      expect(images(tree)).toHaveLength(1);
      expect(images(tree)[0]!.props.source).toEqual({
        uri: "https://example.test/signed/old.jpg",
        cacheKey: chatPhotoCacheKey("att-1", "original"),
      });
      expect(images(tree)[0]!.props.placeholder).toBeNull();
    });
  });
});
