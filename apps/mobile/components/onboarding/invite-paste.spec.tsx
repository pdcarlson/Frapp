/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * #5626. On iOS 16 and later Paste is the system's own button
 * (`UIPasteControl`), which reads the clipboard with no prompt and no banner,
 * so Frapp never calls `getStringAsync` there.
 */

const h = vi.hoisted(() => ({
  pasteProps: null as Record<string, unknown> | null,
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return { ...actual, Platform: { ...actual.Platform, OS: "ios" } };
});
vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(),
  getStringAsync: vi.fn().mockResolvedValue(""),
  isPasteButtonAvailable: true,
  ClipboardPasteButton: (props: Record<string, unknown>) => {
    h.pasteProps = props;
    return null;
  },
}));

import * as Clipboard from "expo-clipboard";
import { FrappThemeProvider } from "@/lib/theme";
import { InvitePasteButton } from "./invite-paste";

function render(onText: (text: string | null) => void, disabled = false) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <InvitePasteButton onText={onText} size="large" disabled={disabled} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("InvitePasteButton on iOS 16 and later (#5626)", () => {
  it("draws the system Paste in house gold, and hands over what it pasted", () => {
    const onText = vi.fn();
    render(onText);
    expect(h.pasteProps).toMatchObject({
      backgroundColor: signetDarkTokens.color.gold.house,
      foregroundColor: signetDarkTokens.color.gold.onHouse,
      acceptedContentTypes: ["plain-text", "url"],
    });
    act(() => {
      (h.pasteProps!.onPress as (data: unknown) => void)({
        type: "text",
        text: "https://app.frapp.live/join?token=abc",
      });
    });
    expect(onText).toHaveBeenCalledWith(
      "https://app.frapp.live/join?token=abc",
    );
    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
  });

  it("treats a pasted image as nothing to paste", () => {
    const onText = vi.fn();
    render(onText);
    act(() => {
      (h.pasteProps!.onPress as (data: unknown) => void)({ type: "image" });
    });
    expect(onText).toHaveBeenCalledWith(null);
  });

  it("holds the system button from outside while the screen waits", () => {
    const tree = render(vi.fn(), true);
    const holder = tree.root.find(
      (node) => node.props.testID === "invite-paste-system",
    );
    expect(holder.props.pointerEvents).toBe("none");
  });
});
