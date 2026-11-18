/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { Keyboard } from "react-native";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageMenuCell,
  MessageMenuFocusProvider,
  SETTLE_MS,
  keyboardFromScreenBottom,
  messageMenuHeight,
  resetKeyboardHeightForTests,
  revealFor,
  useMessageMenuHeight,
  useMessageMenuRoom,
} from "./message-menu-room";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accentSubtle: "#123456" }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
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

  it("is never taller than a short software keyboard", () => {
    expect(messageMenuHeight(900, 260)).toBe(260);
  });

  it("ignores a hardware keyboard's bar", () => {
    expect(messageMenuHeight(800, 60)).toBe(320);
  });
});

describe("keyboardFromScreenBottom", () => {
  it("adds back the navigation bar Android's event leaves out", () => {
    expect(keyboardFromScreenBottom(280, 48, "android")).toBe(328);
  });

  it("takes iOS's height as it is", () => {
    expect(keyboardFromScreenBottom(336, 34, "ios")).toBe(336);
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

describe("revealFor", () => {
  const list = { top: 100, height: 400 };

  it("leaves a message wholly in view alone", () => {
    expect(
      revealFor(list, { top: 200, height: 40 }, { top: 200, height: 40 }),
    ).toBeNull();
  });

  it("brings back a message under the menu by its bottom", () => {
    expect(
      revealFor(list, { top: 480, height: 40 }, { top: 480, height: 40 }),
    ).toEqual({ edge: "bottom", below: 0 });
  });

  it("brings back one cut off at the top by its top", () => {
    expect(
      revealFor(list, { top: 80, height: 40 }, { top: 80, height: 40 }),
    ).toEqual({ edge: "top", below: 0 });
  });

  it("counts what the cell draws under the message, for the offset", () => {
    expect(
      revealFor(list, { top: 470, height: 40 }, { top: 470, height: 140 }),
    ).toEqual({ edge: "bottom", below: 100 });
  });

  it("brings a message taller than the list to its bottom edge", () => {
    expect(
      revealFor(list, { top: 50, height: 500 }, { top: 50, height: 500 }),
    ).toEqual({ edge: "bottom", below: 0 });
  });
});

function measured(top: number, height: number) {
  return {
    measureInWindow: (
      callback: (x: number, y: number, w: number, h: number) => void,
    ) => callback(0, top, 390, height),
  } as never;
}

describe("useMessageMenuRoom", () => {
  it("leaves the sheet's room and highlights its message while it's open", () => {
    const { result } = renderHook(() => useMessageMenuRoom(vi.fn()));
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

  it("measures once the menu has settled, not while it opens", async () => {
    const reveal = vi.fn();
    const { result } = renderHook(() => useMessageMenuRoom(reveal));
    (result.current.listRef as { current: unknown }).current = measured(
      100,
      400,
    );
    act(() => result.current.onMenuOpenChange("m1"));
    result.current.focus.register("m1", {
      outer: measured(80, 40),
      message: measured(80, 40),
    });
    await act(async () => vi.advanceTimersByTime(SETTLE_MS - 1));
    expect(reveal).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(reveal).toHaveBeenCalledWith("m1", { edge: "top", below: 0 });
  });

  it("doesn't scroll for a menu closed before it settled", async () => {
    const reveal = vi.fn();
    const { result } = renderHook(() => useMessageMenuRoom(reveal));
    (result.current.listRef as { current: unknown }).current = measured(
      100,
      400,
    );
    act(() => result.current.onMenuOpenChange("m1"));
    result.current.focus.register("m1", {
      outer: measured(80, 40),
      message: measured(80, 40),
    });
    act(() => result.current.onMenuOpenChange(null));
    await act(async () => vi.advanceTimersByTime(SETTLE_MS));
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe("MessageMenuCell", () => {
  it("lights only the menu's message, not what's drawn under it", () => {
    const register = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <MessageMenuFocusProvider
          value={{ highlightedId: "b", fill: "#123456", register }}
        >
          <MessageMenuCell messageId="a">{null}</MessageMenuCell>
          <MessageMenuCell messageId="b" below={<Below />}>
            {null}
          </MessageMenuCell>
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
    expect(lit[0]?.findAllByType(Below)).toHaveLength(0);
  });
});

function Below() {
  return null;
}
