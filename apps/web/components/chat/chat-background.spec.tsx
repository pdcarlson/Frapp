import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA } from "@repo/theme/chat-backgrounds";
import { ChatBackground } from "./chat-background";

const state = vi.hoisted(() => ({
  data: undefined as
    | { background: string; source: string; photo_url: string | null }
    | undefined,
}));

vi.mock("@repo/hooks", () => ({
  useChatBackground: () => ({ data: state.data }),
  useCurrentChapter: () => ({ data: { name: "Beta Theta Pi", branding: {} } }),
}));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (pick: (s: { activeChapterId: string }) => unknown) =>
    pick({ activeChapterId: "chapter-1" }),
}));

function layer(container: HTMLElement) {
  return container.querySelector(
    "[data-chat-background]",
  ) as HTMLElement | null;
}

describe("ChatBackground (#3973)", () => {
  it("draws a photo under the AA scrim, blurred", () => {
    state.data = {
      background: "photo",
      source: "channel",
      photo_url: "https://x/p.jpg",
    };
    const { container } = render(<ChatBackground channelId="ch-1" />);
    expect(layer(container)?.dataset.chatBackground).toBe("photo");
    const scrim = Array.from(layer(container)!.querySelectorAll("div")).find(
      (el) => el.style.opacity !== "",
    );
    // The opacity the contrast guard measured, on the rendered layer.
    expect(Number(scrim?.style.opacity)).toBe(
      CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA,
    );
    expect(container.innerHTML).toContain("blur(");
  });

  it("draws plain for a photo it couldn't sign", () => {
    state.data = { background: "photo", source: "channel", photo_url: null };
    const { container } = render(<ChatBackground channelId="ch-1" />);
    expect(layer(container)?.dataset.chatBackground).toBe("plain");
  });

  it("draws plain, rather than throwing, for a key this bundle doesn't know", () => {
    state.data = { background: "sunset", source: "channel", photo_url: null };
    const { container } = render(<ChatBackground channelId="ch-1" />);
    expect(layer(container)?.dataset.chatBackground).toBe("plain");
  });

  it("draws a built-in", () => {
    state.data = { background: "midnight", source: "chapter", photo_url: null };
    const { container } = render(<ChatBackground channelId="ch-1" />);
    expect(layer(container)?.dataset.chatBackground).toBe("midnight");
    expect(layer(container)?.style.backgroundImage).toContain(
      "linear-gradient",
    );
  });
});
