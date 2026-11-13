/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

// These screens paint with the chapter accent (`useChapterBranding`), which
// reads the current chapter through the client provider these specs don't
// mount. A purple chapter's values, deliberately not house gold; the hook
// itself has its own spec.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
    textMark: null,
  }),
}));
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { AuditGlyph, LockGlyph } from "./card-glyphs";
import { ChannelStart } from "./channel-start";

/**
 * The mobile channel start's mark: one conversation, one mark, the same one
 * its channel-list row draws (`channel-row.tsx`).
 */

function render(props: React.ComponentProps<typeof ChannelStart>) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChannelStart {...props} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("ChannelStart mark", () => {
  it("draws a # for a plain channel", () => {
    const tree = render({
      type: "PUBLIC",
      channelName: "general",
      displayName: "general",
    });
    expect(tree.root.findAllByType(AuditGlyph)).toHaveLength(0);
    expect(screenText(tree).split("\n")[0]).toBe("#");
  });

  it("draws the audit shield for #chapter-audit", () => {
    const tree = render({
      type: "PUBLIC",
      channelName: "chapter-audit",
      displayName: "chapter-audit",
    });
    expect(tree.root.findAllByType(AuditGlyph)).toHaveLength(1);
    expect(screenText(tree)).not.toMatch(/^#$/m);
  });

  it("draws the lock its chat-home row draws for a private or role-gated channel (#4134)", () => {
    for (const type of ["PRIVATE", "ROLE_GATED"]) {
      const tree = render({ type, channelName: "exec", displayName: "exec" });
      expect(tree.root.findAllByType(LockGlyph)).toHaveLength(1);
      expect(screenText(tree)).not.toMatch(/^#$/m);
    }
  });

  it("draws a DM's initials from the other member's name, not the channel's", () => {
    const tree = render({
      type: "DM",
      channelName: "dm-7f3a",
      displayName: "Sam Lee",
    });
    const lines = screenText(tree).split("\n");
    expect(lines[0]).toBe("SL");
    expect(lines).toContain(
      "This is the start of your conversation with Sam Lee.",
    );
  });

  it("draws initials for a group DM too", () => {
    const tree = render({
      type: "GROUP_DM",
      channelName: "gdm-1",
      displayName: "Sam, Alex",
    });
    expect(screenText(tree).split("\n")[0]).toBe("SA");
  });

  it("reads an unknown type as a plain channel", () => {
    const tree = render({
      type: "SOMETHING_NEW",
      channelName: "lounge",
      displayName: "lounge",
    });
    const lines = screenText(tree).split("\n");
    expect(lines[0]).toBe("#");
    expect(lines).toContain("This is the start of #lounge.");
  });
});
