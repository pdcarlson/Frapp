/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { HIDE_SETUP_CHECKLIST_LABEL, type SetupChecklist } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import {
  MOBILE_SETUP_CHECKLIST_OMIT,
  SETUP_CHECKLIST_OPEN_FAILED_TITLE,
  SETUP_CHECKLIST_WEB_NOTE,
  SetupChecklistView,
  setupChecklistOpenFailedBody,
  setupChecklistWebUrl,
} from "./setup-checklist";

// What the shared hook hands mobile: dues is omitted.
const TWO_OF_FOUR: SetupChecklist = {
  doneCount: 2,
  lines: [
    { key: "invite", label: "Invite members", done: true },
    { key: "event", label: "Schedule the first event", done: false },
    { key: "study-zone", label: "Add a study zone", done: false },
    { key: "document", label: "Upload the bylaws", done: true },
  ],
};

function render({
  onHide = vi.fn(),
  onReturnFromWeb = vi.fn(),
}: { onHide?: () => void; onReturnFromWeb?: () => void } = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SetupChecklistView
          checklist={TWO_OF_FOUR}
          onHide={onHide}
          onReturnFromWeb={onReturnFromWeb}
        />
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
    expect(text).toContain("2 of 4");
  });

  it("opens Documents in the app, where the upload sheet is", () => {
    const tree = render();
    act(() => pressable(tree, "Upload the bylaws, done").props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/documents");
  });

  it("opens Invite members in the app, with the way back to Chat", () => {
    const tree = render();
    act(() => pressable(tree, "Invite members, done").props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/invite?from=chat",
    );
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalledWith(
      "https://app.frapp.live/members",
    );
  });

  it("opens Events in the app, where the New event sheet is", () => {
    const tree = render();
    act(() => pressable(tree, "Schedule the first event").props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/events");
  });

  it("opens the web app for a step the phone has no screen for, and says so first", async () => {
    const onReturnFromWeb = vi.fn();
    const tree = render({ onReturnFromWeb });
    const row = pressable(tree, "Add a study zone");
    expect(row.props.accessibilityHint).toBe("Opens this step in the web app.");
    await act(async () => row.props.onPress());
    // No EXPO_PUBLIC_APP_URL in tests, so the production dashboard.
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      "https://app.frapp.live/geofences",
    );
    // The step may have been done there, so the lists are read again.
    expect(onReturnFromWeb).toHaveBeenCalledTimes(1);
    expect(setupChecklistWebUrl("study-zone", "https://staging.example")).toBe(
      "https://staging.example/geofences",
    );
  });

  it("opens one browser for a double tap, not a false failure", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    vi.mocked(WebBrowser.openBrowserAsync).mockClear();
    const tree = render();
    const row = pressable(tree, "Add a study zone");
    await act(async () => {
      row.props.onPress();
      row.props.onPress();
    });
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("says where to go when the browser won't open, naming the build's host", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    vi.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(
      new Error("no browser"),
    );
    const onReturnFromWeb = vi.fn();
    const tree = render({ onReturnFromWeb });
    await act(async () => pressable(tree, "Add a study zone").props.onPress());
    expect(alert).toHaveBeenCalledWith(
      SETUP_CHECKLIST_OPEN_FAILED_TITLE,
      "Sign in at app.frapp.live on a computer to finish this step.",
    );
    expect(onReturnFromWeb).not.toHaveBeenCalled();
    expect(setupChecklistOpenFailedBody("https://app.staging.frapp.live")).toBe(
      "Sign in at app.staging.frapp.live on a computer to finish this step.",
    );
    alert.mockRestore();
  });

  it("marks every web step as on the web, done or not", () => {
    const notes = render().root.findAll(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.children === SETUP_CHECKLIST_WEB_NOTE,
    );
    // Study zone alone. Invite, documents and events are in the app.
    expect(notes).toHaveLength(1);
  });

  it("never draws dues on the phone", () => {
    expect(MOBILE_SETUP_CHECKLIST_OMIT).toEqual(["dues"]);
  });

  it("hides from an icon button with its own label", () => {
    const onHide = vi.fn();
    const tree = render({ onHide });
    act(() => pressable(tree, HIDE_SETUP_CHECKLIST_LABEL).props.onPress());
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
