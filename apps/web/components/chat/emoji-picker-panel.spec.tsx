import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_EMOJI_STORAGE_KEY } from "@repo/chat-core/emoji-recent";
import { resetRecentEmojiForTests } from "@/lib/chat/recent-emoji";
import { EmojiPickerPanel } from "./emoji-picker-panel";

// jsdom has no 2D canvas; the drawability check has its own browser behavior.
const undrawable = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock("@/lib/chat/drawable-emoji", () => ({
  undrawableEmoji: () => undrawable.set,
}));

function field() {
  return screen.getByRole("combobox", { name: "Search emoji" });
}

describe("EmojiPickerPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRecentEmojiForTests();
  });
  afterEach(() => {
    window.localStorage.clear();
    resetRecentEmojiForTests();
  });

  it("opens on the catalog, focused in the search field, with no Recent before any use", () => {
    render(<EmojiPickerPanel onPick={vi.fn()} />);
    expect(field()).toHaveFocus();
    expect(screen.queryByText("Recent")).toBeNull();
    expect(screen.getByText("Smileys & emotion")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "grinning face" }),
    ).toBeInTheDocument();
  });

  it("opens on the member's recent emoji, newest first", () => {
    window.localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, "🎉 🔥");
    render(<EmojiPickerPanel onPick={vi.fn()} />);
    expect(screen.getByText("Recent")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("🎉");
    expect(options[1]).toHaveTextContent("🔥");
  });

  it("picks the first match on Enter, and remembers it as recent", () => {
    const onPick = vi.fn();
    render(<EmojiPickerPanel onPick={onPick} />);
    fireEvent.change(field(), { target: { value: "fire" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("🔥");
    expect(window.localStorage.getItem(RECENT_EMOJI_STORAGE_KEY)).toBe("🔥");
  });

  it("moves through the grid with the arrow keys and names the active emoji", () => {
    const onPick = vi.fn();
    render(<EmojiPickerPanel onPick={onPick} />);
    fireEvent.keyDown(field(), { key: "ArrowRight" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    const active = screen.getByRole("option", { selected: true });
    expect(field()).toHaveAttribute("aria-activedescendant", active.id);
    fireEvent.keyDown(field(), { key: "Enter" });
    // Second column, second line of Smileys.
    expect(onPick).toHaveBeenCalledWith(active.textContent);
    expect(active.textContent).not.toBe("😃");
  });

  it("picks on click", () => {
    const onPick = vi.fn();
    render(<EmojiPickerPanel onPick={onPick} />);
    fireEvent.click(screen.getByRole("option", { name: "grinning face" }));
    expect(onPick).toHaveBeenCalledWith("😀");
  });

  it("leaves out what this browser can't draw", () => {
    undrawable.set = new Set(["\u{1F600}"]);
    render(<EmojiPickerPanel onPick={vi.fn()} />);
    expect(screen.queryByRole("option", { name: "grinning face" })).toBeNull();
    undrawable.set = new Set();
  });

  it("ignores Enter while an IME is composing", () => {
    const onPick = vi.fn();
    render(<EmojiPickerPanel onPick={onPick} />);
    fireEvent.change(field(), { target: { value: "fire" } });
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("says so when nothing matches", () => {
    render(<EmojiPickerPanel onPick={vi.fn()} />);
    fireEvent.change(field(), { target: { value: "zzqx" } });
    expect(screen.getByText("No emoji match that search.")).toBeInTheDocument();
  });
});
