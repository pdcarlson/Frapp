/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { RecordMeetingRow } from "./record-meeting-row";

/**
 * The + panel's Record meeting row (#5287): at rest it says Record meeting
 * and the meeting it will use; while the phone holds a recording it says
 * what the recorder is doing, as the pill does, and nothing else.
 */
function render(
  entry: { detail: string; held: boolean; onPress: () => void },
  onPress = vi.fn(),
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <RecordMeetingRow entry={entry} onPress={onPress} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => node.props.children);
const button = (tree: ReactTestRenderer) =>
  tree.root.find((node) => node.props.accessibilityRole === "button");

describe("RecordMeetingRow", () => {
  it("names the meeting it will record", () => {
    const tree = render({
      detail: "Chapter Meeting is on now",
      held: false,
      onPress: vi.fn(),
    });
    expect(texts(tree)).toEqual([
      "Record meeting",
      "Chapter Meeting is on now",
    ]);
    expect(button(tree).props.accessibilityLabel).toBe("Record meeting");
  });

  it("says what the recorder is doing while the phone holds a recording", () => {
    const tree = render({
      detail: "Recording 12:04",
      held: true,
      onPress: vi.fn(),
    });
    expect(texts(tree)).toEqual(["Recording 12:04"]);
    expect(button(tree).props.accessibilityLabel).toBe("Recording 12:04");
  });

  it("runs its press", () => {
    const onPress = vi.fn();
    const tree = render(
      { detail: "Starts a new meeting, today", held: false, onPress: vi.fn() },
      onPress,
    );
    act(() => button(tree).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
