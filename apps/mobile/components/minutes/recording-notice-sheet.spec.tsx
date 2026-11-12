/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEETING_RECORDER_NOTICE,
  MEETING_RECORDING_NOTICE,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import { RecordingNoticeSheet } from "./recording-notice-sheet";

/**
 * The recording notice (`spec/behavior/meetings.md` § Recording notice):
 * the room is told before the phone records, and the officer says so with
 * one tick. Nothing starts without it.
 */
const onStart = vi.fn();
function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <RecordingNoticeSheet
          ref={React.createRef<never>()}
          maxSeconds={7200}
          onStart={onStart}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const start = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.onPress === "function" &&
      drawnText(node) === MEETING_RECORDER_NOTICE.start,
  )[0];
const checkbox = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "checkbox",
  )[0];

beforeEach(() => vi.clearAllMocks());

describe("RecordingNoticeSheet", () => {
  it("says the upload step's rule and script, and never to record Standards", () => {
    const text = screenText(render());
    expect(text).toContain(MEETING_RECORDING_NOTICE.rule);
    expect(text).toContain(MEETING_RECORDING_NOTICE.script);
    expect(text).toContain("Never record a Standards hearing");
    expect(text).toContain("Up to 2 hours");
  });

  it("starts nothing until the box is ticked, and says what to do", () => {
    const tree = render();
    expect(checkbox(tree).props.accessibilityState).toEqual({ checked: false });
    act(() => start(tree).props.onPress());
    expect(onStart).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(MEETING_RECORDER_NOTICE.unconfirmed);

    act(() => checkbox(tree).props.onPress());
    expect(checkbox(tree).props.accessibilityState).toEqual({ checked: true });
    expect(screenText(tree)).not.toContain(MEETING_RECORDER_NOTICE.unconfirmed);
    act(() => start(tree).props.onPress());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("forgets the tick when it closes: each meeting is told afresh", () => {
    const tree = render();
    act(() => checkbox(tree).props.onPress());
    const modal = tree.root.findAll(
      (node) => (node.type as unknown) === "BottomSheetModal",
    )[0];
    act(() => modal.props.onDismiss());
    expect(checkbox(tree).props.accessibilityState).toEqual({ checked: false });
    act(() => start(tree).props.onPress());
    expect(onStart).not.toHaveBeenCalled();
  });
});
