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
function render(onLongPress?: () => void) {
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageGifImage gif={GIF} onLongPress={onLongPress} />
      </FrappThemeProvider>,
    );
  });
  return tree!;
}

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
  reduceMotion = false;
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
});
