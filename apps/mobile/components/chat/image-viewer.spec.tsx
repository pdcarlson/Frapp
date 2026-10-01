/** @vitest-environment jsdom */
import React, { useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo, BackHandler, Keyboard } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

const share = vi.hoisted(() => ({ result: true }));
const attachments = vi.hoisted(() => ({
  data: undefined as Record<string, unknown>[] | undefined,
  calls: [] as unknown[][],
}));
vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    // The viewer reads the message's images through the row's query.
    useMessageAttachments: (...args: unknown[]) => {
      attachments.calls.push(args);
      return { isPending: false, isError: false, data: attachments.data };
    },
  };
});
vi.mock("@/lib/chat/share-attachment", () => ({
  shareAttachment: vi.fn(async () => share.result),
}));

import { shareAttachment } from "@/lib/chat/share-attachment";
import {
  ImageViewer,
  useImageViewer,
  type ImageViewerState,
  type ViewerImage,
} from "./image-viewer";

/**
 * The chat thread's image viewer on mobile (#2874). A real pinch needs a
 * device; `lib/chat/image-zoom.spec.ts` pins the zoom arithmetic, and this pins
 * the rest: it opens on the tapped image, steps through the message's others,
 * closes (Android's back button included), shares the image it is showing,
 * and feeds its gestures to that arithmetic the right way round. The gesture
 * mock in `vitest.setup.ts` records each callback so a test can run it.
 */
function image(n: number): ViewerImage {
  return {
    id: `att-${n}`,
    filename: `photo-${n}.png`,
    contentType: "image/png",
    url: `https://example.test/signed/photo-${n}.png`,
  };
}

let viewer!: ImageViewerState;

/** The attachment rows the query hands back for these images. */
function rows(images: ViewerImage[]) {
  return images.map((picked) => ({
    id: picked.id,
    message_id: "msg-1",
    filename: picked.filename,
    content_type: picked.contentType,
    byte_size: 1024,
    width: null,
    height: null,
    download_url: picked.url,
  }));
}

/** Opens the viewer on message `msg-1`'s images, at `index`. */
function openOn(images: ViewerImage[], index: number) {
  attachments.data = rows(images);
  act(() =>
    viewer.open({
      channelId: "chan-1",
      messageId: "msg-1",
      imageId: images[index]!.id,
    }),
  );
}

/** Hands the test the screen's viewer state after every commit. */
function Harness({ onState }: { onState: (state: ImageViewerState) => void }) {
  const state = useImageViewer();
  useEffect(() => onState(state));
  return <ImageViewer viewer={state} />;
}

function screen() {
  return (
    <FrappThemeProvider>
      <Harness
        onState={(state) => {
          viewer = state;
        }}
      />
    </FrappThemeProvider>
  );
}

/**
 * `nodes` resolves host refs to a stand-in that remembers its element, so a
 * spec can tell which node the viewer moved focus to. Off by default: the
 * stand-in's element points back at its own ref, which `textOf` can't
 * serialise.
 */
function render({ nodes = false }: { nodes?: boolean } = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      screen(),
      nodes ? { createNodeMock: (element) => ({ element }) } : undefined,
    );
  });
  return tree;
}

/** Renders again, as a refetch landing would. */
function rerender(tree: ReactTestRenderer) {
  act(() => tree.update(screen()));
}

function button(tree: ReactTestRenderer, label: string) {
  return tree.root
    .findAllByProps({ accessibilityRole: "button" })
    .find((node) => node.props.accessibilityLabel === label)!;
}

function shownImage(tree: ReactTestRenderer) {
  return tree.root.findByType("Animated.Image" as unknown as React.ElementType);
}

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  vi.clearAllMocks();
  share.result = true;
  attachments.data = undefined;
  attachments.calls = [];
});

describe("opening and closing", () => {
  it("draws nothing until an image is opened", () => {
    expect(render().toJSON()).toBeNull();
  });

  it("opens on the tapped image, drawn from its signed URL", () => {
    const tree = render();
    openOn([image(1), image(2), image(3)], 1);

    expect(shownImage(tree).props.source).toEqual({ uri: image(2).url });
    expect(textOf(tree)).toContain("photo-2.png");
    expect(textOf(tree)).toContain('["2"," of ","3"]');
  });

  it("dismisses the keyboard, which would cover the image", () => {
    render();
    openOn([image(1)], 0);
    expect(Keyboard.dismiss).toHaveBeenCalled();
  });

  it("closes from its close button", () => {
    const tree = render();
    openOn([image(1)], 0);
    act(() => button(tree, "Close image").props.onPress());

    expect(tree.toJSON()).toBeNull();
  });

  it("closes on Android's back button instead of leaving the thread", () => {
    const tree = render();
    openOn([image(1)], 0);

    const addListener = vi.mocked(BackHandler.addEventListener);
    expect(addListener).toHaveBeenCalledWith(
      "hardwareBackPress",
      expect.any(Function),
    );
    const handler = addListener.mock.calls.at(-1)![1];
    let handled: boolean | null | undefined;
    act(() => {
      handled = (handler as () => boolean)();
    });

    expect(handled).toBe(true);
    expect(tree.toJSON()).toBeNull();
  });

  it("moves a screen reader's focus onto its title, once it is mounted", () => {
    // Opening hides the image that had focus, which clears it rather than
    // moving it. The send itself is `lib/overlay.spec.tsx`'s to pin.
    vi.useFakeTimers();
    try {
      render({ nodes: true });
      openOn([image(1), image(2)], 1);
      expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

      act(() => {
        vi.runAllTimers();
      });

      const calls = vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock
        .calls as unknown as [
        { element: { props: { children?: unknown } } },
        string,
      ][];
      expect(calls).toHaveLength(1);
      expect(calls[0]![1]).toBe("focus");
      expect(calls[0]![0].element.props.children).toBe("photo-2.png");
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers the container it is drawn in, and is modal to VoiceOver", () => {
    const tree = render();
    openOn([image(1)], 0);
    const root = tree.root.findAll(
      (node) => node.props.accessibilityViewIsModal === true,
    )[0]!;

    expect(JSON.stringify(root.props.style)).toContain('"position":"absolute"');
  });
});

describe("stepping through a message's images", () => {
  it("steps forward and back, wrapping at each end", () => {
    const tree = render();
    openOn([image(1), image(2), image(3)], 0);

    act(() => button(tree, "Next image").props.onPress());
    expect(shownImage(tree).props.source).toEqual({ uri: image(2).url });

    // No control is ever disabled: disabling the one a screen reader is on
    // would drop its focus.
    expect(button(tree, "Previous image").props.disabled).toBeUndefined();

    act(() => button(tree, "Previous image").props.onPress());
    act(() => button(tree, "Previous image").props.onPress());
    expect(shownImage(tree).props.source).toEqual({ uri: image(3).url });

    act(() => button(tree, "Next image").props.onPress());
    expect(shownImage(tree).props.source).toEqual({ uri: image(1).url });
  });

  it("has no step controls for a single image", () => {
    const tree = render();
    openOn([image(1)], 0);
    expect(button(tree, "Next image")).toBeUndefined();
  });
});

describe("saving or sharing", () => {
  it("shares the image it is showing", async () => {
    const tree = render();
    openOn([image(1), image(2)], 1);

    await act(async () => {
      button(tree, "Share image").props.onPress();
    });

    expect(shareAttachment).toHaveBeenCalledWith(
      image(2),
      expect.any(Function),
    );
    expect(textOf(tree)).not.toContain("Couldn");
  });

  it("says so when it couldn't, and forgets it on the next image", async () => {
    share.result = false;
    const tree = render();
    openOn([image(1), image(2)], 0);

    await act(async () => {
      button(tree, "Share image").props.onPress();
    });
    expect(textOf(tree)).toContain("Couldn");

    act(() => button(tree, "Next image").props.onPress());
    expect(textOf(tree)).not.toContain("Couldn");
  });
});

describe("fresh signed URLs", () => {
  it("reads the images through the row's own query, live, without refetching on open", () => {
    // Enabled, so it refetches the hour-long signed URLs when the app comes
    // back to the foreground; no refetch on mount, which would mint new URLs
    // and reload the image under a pinch.
    render();
    openOn([image(1)], 0);

    expect(attachments.calls).toContainEqual([
      "chan-1",
      "msg-1",
      true,
      { refetchOnMount: false },
    ]);
  });

  it("shows the URL a refetch hands back, not the one it opened with", () => {
    // Signed URLs last an hour; the query refetches when the app comes back
    // to the foreground, and an open viewer must use the new one.
    const tree = render();
    openOn([image(1)], 0);

    attachments.data = rows([
      { ...image(1), url: "https://example.test/signed/fresh.png" },
    ]);
    rerender(tree);

    expect(shownImage(tree).props.source).toEqual({
      uri: "https://example.test/signed/fresh.png",
    });
  });

  it("closes when a refetch no longer lists the image", () => {
    const tree = render();
    openOn([image(1), image(2)], 1);

    attachments.data = rows([image(1)]);
    rerender(tree);

    expect(tree.toJSON()).toBeNull();
    expect(viewer.target).toBeNull();
  });
});

describe("state that belongs to one open", () => {
  it("forgets a failed share once the viewer closes", async () => {
    share.result = false;
    const tree = render();
    openOn([image(1)], 0);
    await act(async () => {
      button(tree, "Share image").props.onPress();
    });
    expect(textOf(tree)).toContain("Couldn");

    act(() => button(tree, "Close image").props.onPress());
    openOn([image(1)], 0);

    expect(textOf(tree)).not.toContain("Couldn");
  });

  it("presents no share sheet for an image the member has since closed", async () => {
    // The download can take seconds. `shareAttachment` asks before it
    // presents, and the answer must be no once the viewer has closed.
    let finish!: (shared: boolean) => void;
    vi.mocked(shareAttachment).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finish = resolve)),
    );
    const tree = render();
    openOn([image(1)], 0);
    act(() => button(tree, "Share image").props.onPress());
    const shouldPresent = vi.mocked(shareAttachment).mock.calls[0]![1]!;
    expect(shouldPresent()).toBe(true);

    act(() => button(tree, "Close image").props.onPress());
    expect(shouldPresent()).toBe(false);

    await act(async () => finish(true));
    expect(tree.toJSON()).toBeNull();
  });

  it("presents no share sheet for an image the member has stepped away from", () => {
    vi.mocked(shareAttachment).mockImplementationOnce(
      () => new Promise<boolean>(() => {}),
    );
    const tree = render();
    openOn([image(1), image(2)], 0);
    act(() => button(tree, "Share image").props.onPress());
    const shouldPresent = vi.mocked(shareAttachment).mock.calls[0]![1]!;

    act(() => button(tree, "Next image").props.onPress());

    expect(shouldPresent()).toBe(false);
  });
});

describe("the zoom gestures", () => {
  type Handlers = Record<string, (...args: unknown[]) => void>;
  type Built = { kind: string; handlers?: Handlers; gestures?: Built[] };

  const STAGE = { width: 400, height: 800 };

  /** The viewer's gestures, found by kind in the composed tree. */
  function gestures(tree: ReactTestRenderer) {
    const root = tree.root.findByType(
      "GestureDetector" as unknown as React.ElementType,
    ).props.gesture as Built;
    const found: Record<string, Handlers> = {};
    const walk = (node: Built) => {
      if (node.handlers) found[node.kind] = node.handlers;
      node.gestures?.forEach(walk);
    };
    walk(root);
    return found;
  }

  function transform(tree: ReactTestRenderer) {
    const [, zoom] = shownImage(tree).props.style as [
      unknown,
      { transform: Record<string, number>[] },
    ];
    return Object.assign({}, ...zoom.transform) as {
      translateX: number;
      translateY: number;
      scale: number;
    };
  }

  function openZoomable(natural?: { width: number; height: number }) {
    const tree = render();
    openOn([image(1)], 0);
    const stage = tree.root.findByType(
      "GestureDetector" as unknown as React.ElementType,
    ).children[0] as ReactTestRenderer["root"];
    act(() =>
      stage.props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, ...STAGE } },
      }),
    );
    if (natural) {
      act(() =>
        shownImage(tree).props.onLoad({ nativeEvent: { source: natural } }),
      );
    }
    return tree;
  }

  it("composes a pinch, a pan and a double-tap", () => {
    const found = gestures(openZoomable());
    expect(Object.keys(found).sort()).toEqual(["pan", "pinch", "tap"]);
  });

  it("zooms a pinch into the fingers, measured from the stage's centre", () => {
    const tree = openZoomable();
    // Fingers 100pt right of the centre: that point must stay put.
    gestures(tree).pinch!.onChange!({
      scaleChange: 2,
      focalX: STAGE.width / 2 + 100,
      focalY: STAGE.height / 2,
    });

    expect(transform(tree)).toEqual({
      translateX: -100,
      translateY: 0,
      scale: 2,
    });
  });

  it("pans only once zoomed", () => {
    const tree = openZoomable();
    const found = gestures(tree);

    found.pan!.onChange!({ changeX: 30, changeY: 0 });
    expect(transform(tree).translateX).toBe(0);

    found.pinch!.onChange!({
      scaleChange: 2,
      focalX: STAGE.width / 2,
      focalY: STAGE.height / 2,
    });
    found.pan!.onChange!({ changeX: 30, changeY: 0 });
    expect(transform(tree).translateX).toBe(30);
  });

  it("brings a letterboxed image back to its own edges, not the stage's, when the fingers lift", () => {
    // A 4:3 photo draws 400x300 on the 400x800 stage.
    const tree = openZoomable({ width: 4000, height: 3000 });
    const found = gestures(tree);
    found.pinch!.onChange!({
      scaleChange: 4,
      focalX: STAGE.width / 2,
      focalY: STAGE.height / 2,
    });
    found.pan!.onChange!({ changeX: 0, changeY: 900 });

    found.pan!.onEnd!();

    // 4x300 = 1200 tall on an 800 stage: 200 of travel either way.
    expect(transform(tree).translateY).toBe(200);
  });

  it("double-tap zooms in, and again fits", () => {
    const tree = openZoomable();
    const tap = gestures(tree).tap!;

    tap.onEnd!({ x: STAGE.width / 2, y: STAGE.height / 2 }, true);
    expect(transform(tree).scale).toBe(2.5);

    tap.onEnd!({ x: STAGE.width / 2, y: STAGE.height / 2 }, true);
    expect(transform(tree)).toEqual({ translateX: 0, translateY: 0, scale: 1 });
  });
});
