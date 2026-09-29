/** @vitest-environment jsdom */
import React, { useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { BackHandler, Keyboard } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

const share = vi.hoisted(() => ({ result: true }));
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
 * The chat thread's image viewer on mobile (#2874). What a device would show
 * (the pinch, the full-screen overlay) can't run here; `lib/chat/image-zoom.spec.ts`
 * pins the zoom arithmetic, and this pins the rest: it opens on the tapped
 * image, steps through the message's others, closes (Android's back button
 * included), and saves or shares the image it is showing.
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

/** Hands the test the screen's viewer state after every commit. */
function Harness({ onState }: { onState: (state: ImageViewerState) => void }) {
  const state = useImageViewer();
  useEffect(() => onState(state));
  return <ImageViewer viewer={state} />;
}

function render() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Harness
          onState={(state) => {
            viewer = state;
          }}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
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
});

describe("opening and closing", () => {
  it("draws nothing until an image is opened", () => {
    expect(render().toJSON()).toBeNull();
  });

  it("opens on the tapped image, drawn from its signed URL", () => {
    const tree = render();
    act(() => viewer.open([image(1), image(2), image(3)], 1));

    expect(shownImage(tree).props.source).toEqual({ uri: image(2).url });
    expect(textOf(tree)).toContain("photo-2.png");
    expect(textOf(tree)).toContain('["2"," of ","3"]');
  });

  it("dismisses the keyboard, which would cover the image", () => {
    render();
    act(() => viewer.open([image(1)], 0));
    expect(Keyboard.dismiss).toHaveBeenCalled();
  });

  it("closes from its close button", () => {
    const tree = render();
    act(() => viewer.open([image(1)], 0));
    act(() => button(tree, "Close image").props.onPress());

    expect(tree.toJSON()).toBeNull();
  });

  it("closes on Android's back button instead of leaving the thread", () => {
    const tree = render();
    act(() => viewer.open([image(1)], 0));

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

  it("covers the container it is drawn in, and is modal to VoiceOver", () => {
    const tree = render();
    act(() => viewer.open([image(1)], 0));
    const root = tree.root.findAll(
      (node) => node.props.accessibilityViewIsModal === true,
    )[0]!;

    expect(JSON.stringify(root.props.style)).toContain('"position":"absolute"');
  });
});

describe("stepping through a message's images", () => {
  it("steps forward and back, wrapping at each end", () => {
    const tree = render();
    act(() => viewer.open([image(1), image(2), image(3)], 0));

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
    act(() => viewer.open([image(1)], 0));
    expect(button(tree, "Next image")).toBeUndefined();
  });
});

describe("saving or sharing", () => {
  it("shares the image it is showing", async () => {
    const tree = render();
    act(() => viewer.open([image(1), image(2)], 1));

    await act(async () => {
      button(tree, "Save or share image").props.onPress();
    });

    expect(shareAttachment).toHaveBeenCalledWith(image(2));
    expect(textOf(tree)).not.toContain("Couldn");
  });

  it("says so when it couldn't, and forgets it on the next image", async () => {
    share.result = false;
    const tree = render();
    act(() => viewer.open([image(1), image(2)], 0));

    await act(async () => {
      button(tree, "Save or share image").props.onPress();
    });
    expect(textOf(tree)).toContain("Couldn");

    act(() => viewer.step(1));
    expect(textOf(tree)).not.toContain("Couldn");
  });
});
