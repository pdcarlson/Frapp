import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECENT_EMOJI_STORAGE_KEY } from "@repo/chat-core/emoji-recent";
import { reactionActionType } from "@repo/chat-core/types";
import { resetRecentEmojiForTests } from "@/lib/chat/recent-emoji";

// The real panel is the picker's lazy chunk; this stand-in picks the
// catalog's spelling of thumbs up, `👍️` with U+FE0F.
vi.mock("./emoji-picker", () => ({
  preloadEmojiPicker: vi.fn(),
  EmojiPicker: ({ onPick }: { onPick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onPick("\u{1F44D}️")}>
      pick thumbs up
    </button>
  ),
}));

import { ReactionQuickPick } from "./reaction-bar";

describe("ReactionQuickPick", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRecentEmojiForTests();
  });

  it("joins the chip already on the message, whatever spelling the picker hands back", () => {
    const onReact = vi.fn();
    render(
      <ReactionQuickPick
        reactions={{ [reactionActionType("\u{1F44D}")]: ["someone"] }}
        viewerId="me"
        onReact={onReact}
        onUnreact={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open emoji picker" }));
    fireEvent.click(screen.getByRole("button", { name: "pick thumbs up" }));
    expect(onReact).toHaveBeenCalledWith("\u{1F44D}");
  });

  it("remembers a quick reaction as recent, and not taking one back", () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    render(
      <ReactionQuickPick
        reactions={{ [reactionActionType("\u{1F64F}")]: ["me"] }}
        viewerId="me"
        onReact={onReact}
        onUnreact={onUnreact}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "React with \u{1F525}" }),
    );
    expect(onReact).toHaveBeenCalledWith("\u{1F525}");
    fireEvent.click(
      screen.getByRole("button", { name: "React with \u{1F64F}" }),
    );
    expect(onUnreact).toHaveBeenCalledWith("\u{1F64F}");
    expect(window.localStorage.getItem(RECENT_EMOJI_STORAGE_KEY)).toBe(
      "\u{1F525}",
    );
  });
});
