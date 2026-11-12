/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Switch } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { getSignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { Toggle } from "./toggle";

// A purple stand-in, so a toggle painted house gold or info blue fails.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
  }),
}));

const tokens = getSignetTokens();

function renderToggle(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

function switchProps(tree: ReactTestRenderer) {
  return tree.root.findByType(Switch).props;
}

describe("Toggle (components.md § Toggle)", () => {
  it("paints an on toggle in the chapter's solid accent under its contrast thumb", () => {
    const props = switchProps(
      renderToggle(
        <Toggle value onValueChange={() => {}} accessibilityLabel="Chat" />,
      ),
    );

    expect(props.trackColor.true).toBe("#8E4EC6");
    expect(props.thumbColor).toBe("#FFFFFF");
    // react-native-web paints an on thumb its fixed teal without this.
    expect(props.activeThumbColor).toBe("#FFFFFF");
    expect(props.accessibilityLabel).toBe("Chat");
  });

  it("paints an off toggle on the elevated surface, edged, under a muted thumb", () => {
    const props = switchProps(
      renderToggle(
        <Toggle
          value={false}
          onValueChange={() => {}}
          accessibilityLabel="Chat"
        />,
      ),
    );

    // The border's 14% white is the off track, so it stays visible on a
    // card; the elevated surface is iOS's fill behind it.
    expect(props.trackColor.false).toBe(tokens.color.border.input);
    expect(props.ios_backgroundColor).toBe(tokens.color.surface.popover);
    expect(props.thumbColor).toBe(tokens.color.text.muted);
  });

  it("stays house gold where there is no chapter yet", () => {
    const props = switchProps(
      renderToggle(
        <Toggle
          house
          value
          onValueChange={() => {}}
          accessibilityLabel="Show Greek letters"
        />,
      ),
    );

    expect(props.trackColor.true).toBe(tokens.color.gold.house);
    expect(props.thumbColor).toBe(tokens.color.gold.onHouse);
    expect(props.activeThumbColor).toBe(tokens.color.gold.onHouse);
  });

  it("hands every change to its owner", () => {
    const onValueChange = vi.fn();
    const props = switchProps(
      renderToggle(
        <Toggle
          value={false}
          onValueChange={onValueChange}
          accessibilityLabel="Chat"
        />,
      ),
    );

    act(() => props.onValueChange(true));

    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});
