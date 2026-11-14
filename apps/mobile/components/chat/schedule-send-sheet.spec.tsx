/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { FrappThemeProvider } from "@/lib/theme";
import { errorCopy } from "@repo/hooks/error-copy";
import { drawnText, screenText } from "@/test/screen-text";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

import { ScheduleSendSheet, ScheduleWhenField } from "./schedule-send-sheet";

/**
 * Schedule message (#4956). The harness fires `onPress` on a disabled
 * `Pressable`, so a greyed row is asserted through `disabled`, not a press.
 */

const dismiss = vi.fn();

function render(props: {
  refusal?: string | null;
  onSchedule?: (at: Date) => Promise<void>;
}) {
  const onSchedule = props.onSchedule ?? vi.fn(() => Promise.resolve());
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ScheduleSendSheet
          ref={React.createRef<never>()}
          preview="Chapter is at 8 tonight"
          refusal={props.refusal ?? null}
          onSchedule={onSchedule}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { dismiss, present: vi.fn() }
            : null,
      },
    );
  });
  return { tree, onSchedule };
}

const row = (tree: ReactTestRenderer, text: RegExp | string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      (typeof text === "string"
        ? drawnText(node) === text
        : text.test(drawnText(node))),
  );

describe("ScheduleSendSheet", () => {
  it("shows the draft and schedules a preset at 9 the next morning", async () => {
    dismiss.mockClear();
    const { tree, onSchedule } = render({});
    expect(screenText(tree)).toContain("Chapter is at 8 tonight");
    await act(async () => {
      row(tree, /^Tomorrow at /).props.onPress();
    });
    const at = vi.mocked(onSchedule).mock.calls[0]![0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(at.getDate()).toBe(tomorrow.getDate());
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(0);
    expect(dismiss).toHaveBeenCalled();
  });

  it("keeps the sheet open with the reason when scheduling fails", async () => {
    dismiss.mockClear();
    const refusal = new Error("refused");
    const { tree } = render({ onSchedule: () => Promise.reject(refusal) });
    await act(async () => {
      row(tree, /^Tomorrow at /).props.onPress();
    });
    expect(dismiss).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(errorCopy(refusal));
  });

  it("greys every row under the reason it can't be scheduled", () => {
    const { tree } = render({ refusal: "Replies can't be scheduled yet." });
    expect(screenText(tree)).toContain("Replies can't be scheduled yet.");
    expect(row(tree, /^Tomorrow at /).props.disabled).toBe(true);
    expect(row(tree, "Custom time").props.disabled).toBe(true);
  });

  it("schedules a custom time from the next preset", async () => {
    const { tree, onSchedule } = render({});
    act(() => row(tree, "Custom time").props.onPress());
    const button = tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) && drawnText(node) === "Schedule",
    );
    expect(button.props.disabled).toBe(false);
    await act(async () => button.props.onPress());
    expect(vi.mocked(onSchedule).mock.calls[0]![0].getHours()).toBe(9);
  });
});

describe("ScheduleWhenField", () => {
  it("opens Android's date dialog no earlier than today and keeps the time", () => {
    const onChange = vi.fn();
    const value = new Date(2026, 10, 20, 9, 30);
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ScheduleWhenField
            value={value}
            onChange={onChange}
            disabled={false}
            brand={{ accent: "#CB9FFF" }}
            platform="android"
          />
        </FrappThemeProvider>,
      );
    });
    const day = tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        String(node.props.accessibilityLabel).startsWith("Day, "),
    );
    const open = vi.mocked(DateTimePickerAndroid.open);
    open.mockClear();
    act(() => day.props.onPress());
    const options = open.mock.calls[0]![0];
    expect(options.mode).toBe("date");
    expect(options.minimumDate!.getHours()).toBe(0);
    act(() =>
      options.onValueChange!(
        { type: "set" } as never,
        new Date(2026, 10, 25, 0, 0),
      ),
    );
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 10, 25, 9, 30));
  });
});
