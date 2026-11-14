/** @vitest-environment jsdom */
import React, { createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

// The sheet "Remind me about this" opens (#4957): Slack's presets, each with
// the time it lands on, then Custom…, the platform's own picker.

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  REMINDER_CUSTOM_LABEL,
  REMINDER_PAST_NOTE,
  REMINDER_SET_LABEL,
  RemindSheet,
  type RemindSheetHandle,
} from "./remind-sheet";
import { MESSAGE_REMINDER_PRESETS } from "@repo/hooks/use-message-reminders";

/** Saturday, Nov 14 2026, 2:00 PM local. */
const NOW = new Date(2026, 10, 14, 14, 0, 0, 0);

const modal = { present: vi.fn(), dismiss: vi.fn() };

function render(platform: string, onRemind = vi.fn()) {
  const handle = createRef<RemindSheetHandle>();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <RemindSheet
          ref={handle}
          messageId="m1"
          onRemind={onRemind}
          platform={platform}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal" ? modal : null,
      },
    );
  });
  act(() => handle.current?.present());
  return { tree, onRemind };
}

/** A row by its accessible name, or a button by the words it shows. */
const press = (tree: ReactTestRenderer, label: string) =>
  act(() =>
    tree.root
      .find(
        (node) =>
          typeof node.props.onPress === "function" &&
          (node.props.accessibilityLabel === label ||
            (node.props.accessibilityLabel === undefined &&
              node.findAll(
                (child) =>
                  (child.type as unknown) === "Text" &&
                  child.props.children === label,
              ).length > 0)),
      )
      .props.onPress(),
  );

const androidOpen = vi.mocked(DateTimePickerAndroid.open);
type AndroidArgs = Parameters<typeof DateTimePickerAndroid.open>[0];
const androidCall = (index: number) =>
  androidOpen.mock.calls[index]![0] as AndroidArgs & {
    onValueChange: (event: unknown, date: Date) => void;
  };

describe("RemindSheet (#4957)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    androidOpen.mockReset();
    modal.present.mockReset();
    modal.dismiss.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers Slack's presets, each with the time it lands on, then Custom…", () => {
    const { tree } = render("ios");
    const text = screenText(tree);
    for (const preset of MESSAGE_REMINDER_PRESETS) {
      expect(text).toContain(preset.label);
    }
    expect(text).toContain(REMINDER_CUSTOM_LABEL);
    // In 20 minutes is today's clock; Tomorrow names its day.
    expect(text).toContain("2:20 PM");
    expect(text).toMatch(/Sun 9:00 AM/);
  });

  it("sets a preset's time on the message and closes", () => {
    const { tree, onRemind } = render("ios");
    press(tree, "In 1 hour");
    expect(onRemind).toHaveBeenCalledWith(
      "m1",
      new Date(NOW.getTime() + 60 * 60_000),
    );
    expect(modal.dismiss).toHaveBeenCalled();
  });

  it("on iOS, picks a day and time in the sheet, then sets it", () => {
    const { tree, onRemind } = render("ios");
    press(tree, REMINDER_CUSTOM_LABEL);
    const pickers = tree.root.findAll(
      (node) => (node.type as unknown) === "DateTimePicker",
    );
    expect(pickers.map((picker) => picker.props.mode)).toEqual([
      "date",
      "time",
    ]);
    // Starts on the next whole hour.
    expect(pickers[0]!.props.value).toEqual(new Date(2026, 10, 14, 15, 0));
    act(() =>
      pickers[0]!.props.onValueChange({}, new Date(2026, 10, 20, 12, 0)),
    );
    press(tree, REMINDER_SET_LABEL);
    expect(onRemind).toHaveBeenCalledWith("m1", new Date(2026, 10, 20, 15, 0));
  });

  it("on iOS, holds Set reminder on a time already gone, and says why", () => {
    const { tree, onRemind } = render("ios");
    press(tree, REMINDER_CUSTOM_LABEL);
    const time = tree.root.find(
      (node) =>
        (node.type as unknown) === "DateTimePicker" &&
        node.props.mode === "time",
    );
    act(() => time.props.onValueChange({}, new Date(2026, 10, 14, 9, 0)));
    expect(screenText(tree)).toContain(REMINDER_PAST_NOTE);
    press(tree, REMINDER_SET_LABEL);
    expect(onRemind).not.toHaveBeenCalled();
  });

  it("on Android, asks the day then the time in the system dialogs, then sets it", () => {
    const { tree, onRemind } = render("android");
    press(tree, REMINDER_CUSTOM_LABEL);
    expect(androidCall(0).mode).toBe("date");
    act(() => androidCall(0).onValueChange({}, new Date(2026, 10, 16, 0, 0)));
    expect(androidCall(1).mode).toBe("time");
    act(() => androidCall(1).onValueChange({}, new Date(2026, 0, 1, 8, 30)));
    expect(onRemind).toHaveBeenCalledWith("m1", new Date(2026, 10, 16, 8, 30));
  });

  it("on Android, sets nothing for a time already gone, and says so", () => {
    const { tree, onRemind } = render("android");
    press(tree, REMINDER_CUSTOM_LABEL);
    act(() => androidCall(0).onValueChange({}, new Date(2026, 10, 14, 0, 0)));
    act(() => androidCall(1).onValueChange({}, new Date(2026, 0, 1, 9, 0)));
    expect(onRemind).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(REMINDER_PAST_NOTE);
  });
});
