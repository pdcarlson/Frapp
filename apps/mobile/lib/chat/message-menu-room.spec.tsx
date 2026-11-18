/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { Keyboard } from "react-native";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MessageMenuCell,
  MessageMenuFocusProvider,
  messageMenuHeight,
  resetKeyboardHeightForTests,
  useMessageMenuHeight,
  useMessageMenuRoom,
} from "./message-menu-room";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accentSubtle: "#123456" }),
}));

afterEach(() => {
  resetKeyboardHeightForTests();
  vi.restoreAllMocks();
});

describe("messageMenuHeight (#5479)", () => {
  it("is the keyboard's height when one has opened", () => {
    expect(messageMenuHeight(852, 336)).toBe(336);
  });

  it("is 40% of the window before any keyboard has opened", () => {
    expect(messageMenuHeight(800, null)).toBe(320);
  });

  it("never covers more than half the screen", () => {
    expect(messageMenuHeight(800, 700)).toBe(400);
  });

  it("never drops below 35%, so the reactions and first rows fit", () => {
    expect(messageMenuHeight(800, 120)).toBe(280);
  });
});

describe("useMessageMenuHeight", () => {
  it("follows the keyboard's height as it opens", () => {
    let show: ((event: unknown) => void) | undefined;
    vi.spyOn(Keyboard, "addListener").mockImplementation(((
      _event: string,
      listener: (event: unknown) => void,
    ) => {
      show = listener;
      return { remove: vi.fn() };
    }) as never);
    const { result } = renderHook(() => useMessageMenuHeight());
    const before = result.current;
    act(() => show?.({ endCoordinates: { height: before + 10 } }));
    expect(result.current).toBe(before + 10);
  });
});

describe("useMessageMenuRoom", () => {
  it("leaves the sheet's room and highlights its message while it's open", () => {
    const reveal = vi.fn();
    const { result } = renderHook(() => useMessageMenuRoom(reveal));
    expect(result.current.room).toBe(result.current.sheetHeight);
    expect(result.current.focus.highlightedId).toBeNull();
    expect(result.current.shown.get()).toBe(0);

    act(() => result.current.onMenuOpenChange("m1"));
    expect(result.current.focus.highlightedId).toBe("m1");
    expect(result.current.shown.get()).toBe(1);

    act(() => result.current.onMenuOpenChange(null));
    expect(result.current.focus.highlightedId).toBeNull();
    expect(result.current.shown.get()).toBe(0);
  });

  function measured(top: number, height: number) {
    return {
      measureInWindow: (
        callback: (x: number, y: number, w: number, h: number) => void,
      ) => callback(0, top, 390, height),
    } as never;
  }

  it("scrolls a message the room would push off the top", () => {
    const reveal = vi.fn();
    const { result } = renderHook(() => useMessageMenuRoom(reveal));
    const room = result.current.room;
    (result.current.listRef as { current: unknown }).current = measured(
      100,
      600,
    );
    act(() => result.current.onMenuOpenChange("m1"));
    // The mock's `withTiming` lands at once, so the room is already taken
    // and the cell is measured where it is drawn.
    result.current.focus.onHighlighted("m1", measured(90, 40));
    expect(reveal).toHaveBeenCalledWith("m1");
    reveal.mockClear();
    result.current.focus.onHighlighted("m1", measured(100 + room, 40));
    expect(reveal).not.toHaveBeenCalled();
  });

  it("scrolls a message that sits under the sheet", () => {
    const reveal = vi.fn();
    const { result } = renderHook(() => useMessageMenuRoom(reveal));
    (result.current.listRef as { current: unknown }).current = measured(
      100,
      600,
    );
    act(() => result.current.onMenuOpenChange("m1"));
    result.current.focus.onHighlighted("m1", measured(680, 40));
    expect(reveal).toHaveBeenCalledWith("m1");
  });
});

describe("MessageMenuCell", () => {
  it("draws only the menu's message in the chapter's quiet fill", () => {
    const onHighlighted = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <MessageMenuFocusProvider
          value={{ highlightedId: "b", fill: "#123456", onHighlighted }}
        >
          <MessageMenuCell messageId="a">{null}</MessageMenuCell>
          <MessageMenuCell messageId="b">{null}</MessageMenuCell>
        </MessageMenuFocusProvider>,
      );
    });
    const lit = tree.root.findAll(
      (node) =>
        node.props.testID === "message-menu-highlight" &&
        typeof node.type === "string",
    );
    expect(lit).toHaveLength(1);
    expect(lit[0]?.props.style?.backgroundColor).toBe("#123456");
  });
});
