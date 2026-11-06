/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

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

import { HIDE_SETUP_CHECKLIST_LABEL, type SetupChecklist } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import {
  SETUP_CHECKLIST_WEB_NOTE,
  SetupChecklistView,
  setupChecklistWebUrl,
} from "./setup-checklist";

const TWO_OF_FIVE: SetupChecklist = {
  doneCount: 2,
  lines: [
    { key: "invite", label: "Invite members", done: true },
    { key: "event", label: "Schedule the first event", done: false },
    { key: "study-zone", label: "Add a study zone", done: false },
    { key: "document", label: "Upload the bylaws", done: true },
    { key: "dues", label: "Send the first dues", done: false },
  ],
};

function render(onHide = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SetupChecklistView checklist={TWO_OF_FIVE} onHide={onHide} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function pressable(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );
}

describe("SetupChecklistView (mobile)", () => {
  it("names the list and how far along it is", () => {
    const text = screenText(render());
    expect(text).toContain("Set up your chapter");
    expect(text).toContain("2 of 5");
  });

  it("opens Documents in the app, where the upload sheet is", () => {
    const tree = render();
    act(() => pressable(tree, "Upload the bylaws, done").props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/documents");
  });

  it("opens the web app for a step the phone has no screen for, and says so first", () => {
    const tree = render();
    const row = pressable(tree, "Schedule the first event");
    expect(row.props.accessibilityHint).toBe(
      "Opens this step in the web app.",
    );
    act(() => row.props.onPress());
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      setupChecklistWebUrl("event"),
    );
    expect(setupChecklistWebUrl("study-zone", "https://app.frapp.live")).toBe(
      "https://app.frapp.live/geofences",
    );
  });

  it("marks only the open web steps as on the web", () => {
    const notes = render().root.findAll(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.children === SETUP_CHECKLIST_WEB_NOTE,
    );
    // Event, study zone and dues: open and web-only. Invite is done.
    expect(notes).toHaveLength(3);
  });

  it("hides from an icon button with its own label", () => {
    const onHide = vi.fn();
    const tree = render(onHide);
    act(() => pressable(tree, HIDE_SETUP_CHECKLIST_LABEL).props.onPress());
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
