import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageGif } from "@repo/chat-core/types";
import { MessageGifImage } from "./message-gif";

const GIF: MessageGif = {
  provider: "klipy",
  id: "g1",
  title: "wave",
  url: "https://static.klipy.com/g1.webp",
  width: 200,
  height: 150,
};

/** A `matchMedia` whose reduced-motion answer the test can change. */
function mockReducedMotion(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    })),
  );
  return (next: boolean) => {
    matches = next;
    act(() => listeners.forEach((listener) => listener()));
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MessageGifImage (#4657)", () => {
  it("plays the GIF for a member with no motion preference", () => {
    mockReducedMotion(false);
    render(<MessageGifImage gif={GIF} />);
    expect(screen.getByRole("img", { name: "GIF: wave" })).toHaveAttribute(
      "src",
      GIF.url,
    );
    expect(screen.queryByTestId("message-gif-still")).toBeNull();
  });

  it("holds a still with reduced motion, and plays while hovered or focused", () => {
    mockReducedMotion(true);
    render(<MessageGifImage gif={GIF} />);
    const gif = screen.getByRole("button", { name: "GIF: wave" });
    expect(screen.getByTestId("message-gif-still")).toBeInTheDocument();
    expect(gif.querySelector("img")).toBeNull();

    fireEvent.pointerEnter(gif);
    expect(gif.querySelector("img")).toHaveAttribute("src", GIF.url);
    fireEvent.pointerLeave(gif);
    expect(gif.querySelector("img")).toBeNull();

    fireEvent.focus(gif);
    expect(gif.querySelector("img")).toHaveAttribute("src", GIF.url);
    fireEvent.blur(gif);
    expect(gif.querySelector("img")).toBeNull();
    // The still stays mounted throughout, so it never repaints blank.
    expect(screen.getByTestId("message-gif-still")).toBeInTheDocument();
  });

  it("stills a playing GIF when the member turns reduced motion on", () => {
    const setReduced = mockReducedMotion(false);
    render(<MessageGifImage gif={GIF} />);
    setReduced(true);
    expect(screen.getByTestId("message-gif-still")).toBeInTheDocument();
  });
});
