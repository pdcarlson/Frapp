/** @vitest-environment jsdom */
import React, { act } from "react";
import { Text } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import type { ReleaseNote } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { ReleaseNoteCard } from "./release-note-card";

function texts(note: ReleaseNote): string[] {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ReleaseNoteCard note={note} />
      </FrappThemeProvider>,
    );
  });
  return tree.root
    .findAllByType(Text)
    .map((node) => [node.props.children].flat().join(""));
}

describe("ReleaseNoteCard", () => {
  it("lists the lines for both first, then Web and Mobile under subheadings", () => {
    expect(
      texts({
        date: "2026-11-12",
        title: "A title",
        changes: ["Both."],
        web: ["Web one.", "Web two."],
        phone: ["Phone."],
      }),
    ).toEqual([
      "November 12, 2026",
      "A title",
      "Both.",
      "Web",
      "Web one.",
      "Web two.",
      "Mobile",
      "Phone.",
    ]);
  });

  it("shows an entry from before the split as one list with no subheadings", () => {
    expect(
      texts({ date: "2026-11-07", title: "Old", changes: ["A.", "B."] }),
    ).toEqual(["November 7, 2026", "Old", "A.", "B."]);
  });
});
