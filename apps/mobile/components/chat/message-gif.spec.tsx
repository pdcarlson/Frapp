import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageGif } from "@repo/chat-core/types";
import { FrappThemeProvider } from "@/lib/theme";
import { MessageGifImage } from "./message-gif";

let reduceMotion = false;
vi.mock("@/lib/use-reduce-motion", () => ({
  useReduceMotion: () => reduceMotion,
}));

const GIF: MessageGif = {
  provider: "klipy",
  id: "g1",
  title: "wave",
  url: "https://static.klipy.com/g1.webp",
  width: 200,
  height: 150,
};

let tree: ReactTestRenderer | null = null;
// expo-image's handle calls are async native calls that return promises.
const animation = {
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
};
const ui = (onLongPress?: () => void) => (
  <FrappThemeProvider>
    <MessageGifImage gif={GIF} onLongPress={onLongPress} />
  </FrappThemeProvider>
);
function render(onLongPress?: () => void) {
  act(() => {
    tree = create(ui(onLongPress), {
      // expo-image's handle, so the play and pause calls can be seen.
      createNodeMock: () => ({
        startAnimating: animation.start,
        stopAnimating: animation.stop,
      }),
    });
  });
  return tree!;
}

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
  reduceMotion = false;
  animation.start.mockReset().mockImplementation(() => Promise.resolve());
  animation.stop.mockReset().mockImplementation(() => Promise.resolve());
});

const image = (t: ReactTestRenderer) => t.root.findByType("ExpoImage" as never);
const paused = (t: ReactTestRenderer) =>
  t.root.findAll((node) => node.props.testID === "message-gif-paused");

describe("MessageGifImage (#4657)", () => {
  it("plays for a member with Reduce Motion off", () => {
    const t = render();
    expect(image(t).props.autoplay).toBe(true);
    expect(paused(t)).toHaveLength(0);
    const frame = t.root.findByType(Pressable);
    expect(frame.props.accessibilityRole).toBe("image");
    expect(frame.props.onPress).toBeUndefined();
  });

  it("holds its first frame with Reduce Motion on, and a tap plays and pauses it", () => {
    reduceMotion = true;
    const onLongPress = vi.fn();
    const t = render(onLongPress);
    const frame = () => t.root.findByType(Pressable);
    expect(image(t).props.autoplay).toBe(false);
    expect(paused(t).length).toBeGreaterThan(0);
    expect(frame().props.accessibilityRole).toBe("button");
    expect(frame().props.accessibilityHint).toBe("Plays the GIF");

    act(() => frame().props.onPress());
    expect(image(t).props.autoplay).toBe(true);
    expect(paused(t)).toHaveLength(0);
    expect(frame().props.accessibilityHint).toBe("Pauses the GIF");

    act(() => frame().props.onPress());
    expect(image(t).props.autoplay).toBe(false);
    // A long press still opens the row's actions.
    expect(frame().props.onLongPress).toBe(onLongPress);
  });

  it("pauses and plays through the image's handle, and stills a playing GIF when Reduce Motion goes on", () => {
    reduceMotion = true;
    const t = render();
    const frame = () => t.root.findByType(Pressable);
    act(() => frame().props.onPress());
    expect(animation.start).toHaveBeenCalled();

    // Off: it plays. On again: the tap's play is forgotten, so it is still.
    reduceMotion = false;
    act(() => t.update(ui()));
    expect(image(t).props.autoplay).toBe(true);
    animation.stop.mockClear();
    reduceMotion = true;
    act(() => t.update(ui()));
    expect(image(t).props.autoplay).toBe(false);
    expect(paused(t).length).toBeGreaterThan(0);
    expect(animation.stop).toHaveBeenCalled();
  });

  // FRAPP-MOBILE-14: the first render's state comes from `autoplay`, so a
  // GIF mounting in a thread makes no native call that could race the view.
  it("makes no native call when it mounts, playing or still", () => {
    render();
    act(() => tree?.unmount());
    reduceMotion = true;
    render();
    expect(animation.start).not.toHaveBeenCalled();
    expect(animation.stop).not.toHaveBeenCalled();
  });

  // FRAPP-MOBILE-14: a row the list unmounted before the native call landed
  // rejects with ViewNotFound; that must not surface as an unhandled rejection.
  it("handles a play or pause that rejects because the view is gone", () => {
    reduceMotion = true;
    const t = render();
    const gone = Promise.reject(
      new Error(
        "ViewNotFound<UIView>: Unable to find the 'ImageView' view with tag '4032'",
      ),
    );
    // `catch` goes through `then`, so either way of handling it shows here.
    const then = vi.spyOn(gone, "then");
    animation.start.mockImplementationOnce(() => gone);
    act(() => t.root.findByType(Pressable).props.onPress());
    expect(animation.start).toHaveBeenCalledTimes(1);
    expect(then).toHaveBeenCalledWith(undefined, expect.any(Function));
  });
});
