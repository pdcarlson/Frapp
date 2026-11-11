/** @vitest-environment jsdom */
/**
 * The dot's shapes and colors per status (#3845, #3917), as web draws them:
 * each status differs by shape as well as color, and Offline is a faint grey
 * fill rather than nothing.
 */
import React from "react";
import { act } from "react";
import { StyleSheet } from "react-native";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { PresenceStatus } from "@repo/hooks/presence-status";
import { StatusDot } from "./status-dot";

function dotStyle(status: PresenceStatus) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <StatusDot status={status} testID="dot" />
      </FrappThemeProvider>,
    );
  });
  const outer = tree.root.find(
    (node) => node.type === ("View" as never) && node.props.testID === "dot",
  );
  const inner = outer.findAll((node) => node.type === ("View" as never))[1]!;
  return {
    style: StyleSheet.flatten(inner.props.style) as Record<string, unknown>,
    children: inner.findAll((node) => node.type === ("View" as never)).length,
  };
}

describe("StatusDot", () => {
  it("fills Online and DND, and bars DND", () => {
    const online = dotStyle("online");
    const dnd = dotStyle("dnd");
    expect(online.style.backgroundColor).toBeTruthy();
    expect(dnd.style.backgroundColor).toBeTruthy();
    expect(dnd.style.backgroundColor).not.toBe(online.style.backgroundColor);
    expect(online.children).toBe(1);
    expect(dnd.children).toBe(2);
  });

  it("rings Idle and Invisible in different colors", () => {
    const idle = dotStyle("idle");
    const invisible = dotStyle("invisible");
    expect(idle.style.borderWidth).toBeGreaterThan(0);
    expect(invisible.style.borderWidth).toBeGreaterThan(0);
    expect(idle.style.borderColor).not.toBe(invisible.style.borderColor);
  });

  it("draws Offline as a faint fill, not an empty dot", () => {
    const offline = dotStyle("offline");
    expect(offline.style.backgroundColor).toBeTruthy();
    expect(offline.style.opacity).toBe(0.4);
    expect(offline.style.borderWidth).toBeUndefined();
  });
});
