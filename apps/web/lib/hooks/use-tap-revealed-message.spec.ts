import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTapRevealedMessage } from "./use-tap-revealed-message";

const A = { id: "a", client_message_id: "ca" };
const B = { id: "b", client_message_id: "cb" };

function press(pointerType: string) {
  const event = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  act(() => {
    document.body.dispatchEvent(event);
  });
}

describe("useTapRevealedMessage", () => {
  it("reveals one row at a time", () => {
    const { result } = renderHook(() => useTapRevealedMessage());
    act(() => result.current.toggle(A));
    expect(result.current.isRevealed(A)).toBe(true);
    act(() => result.current.toggle(B));
    expect(result.current.isRevealed(A)).toBe(false);
    expect(result.current.isRevealed(B)).toBe(true);
  });

  it("clears on a mouse press anywhere, since a mouse never sets it", () => {
    // A touchscreen laptop: a finger pins a row open, then the member goes
    // back to the trackpad. Nothing else would clear it (2026-11-06).
    const { result } = renderHook(() => useTapRevealedMessage());
    act(() => result.current.toggle(A));
    press("touch");
    expect(result.current.isRevealed(A)).toBe(true);
    press("mouse");
    expect(result.current.isRevealed(A)).toBe(false);
  });
});
