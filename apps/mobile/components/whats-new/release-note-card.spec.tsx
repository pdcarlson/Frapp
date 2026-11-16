/** @vitest-environment jsdom */
import React, { act } from "react";
import { Text } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import type { ReleaseNote } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { ReleaseNoteCard } from "./release-note-card";

function renderCard(note: ReleaseNote, fresh?: string[]): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ReleaseNoteCard note={note} fresh={fresh} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function texts(note: ReleaseNote, fresh?: string[]): string[] {
  return renderCard(note, fresh)
    .root.findAllByType(Text)
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

  it("sets apart the lines the latest update brought, under a caption saying so", () => {
    const note: ReleaseNote = {
      date: "2026-11-16",
      title: "A title",
      changes: ["Old.", "New."],
    };
    expect(texts(note, ["New."])).toEqual([
      "November 16, 2026",
      "A title",
      "Lines in bold came with your latest update.",
      "Old.",
      "New.",
    ]);
    const labels = renderCard(note, ["New."])
      .root.findAllByType(Text)
      .map((node) => node.props.accessibilityLabel as string | undefined);
    expect(labels.filter(Boolean)).toEqual(["New: New."]);
  });

  it("marks nothing when every line of the entry is new", () => {
    expect(
      texts({ date: "2026-11-16", title: "T", changes: ["A."] }, ["A."]),
    ).toEqual(["November 16, 2026", "T", "A."]);
  });
});
