/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * Quiet hours on s16 (the owner's iOS testing, 2026-11-06): one switch while
 * off, native time pickers while on, and the zone shown only when it isn't
 * this phone's.
 */

const picker = vi.hoisted(() => ({
  androidOpen: vi.fn(),
}));

// The native module has no JS half under vitest. The iOS picker renders as a
// host element whose props the tests drive; Android's is an imperative call.
vi.mock("@react-native-community/datetimepicker", () => ({
  default: "DateTimePicker",
  DateTimePickerAndroid: { open: picker.androidOpen },
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  dateToTimeOfDay,
  formatTimeOfDay,
  QUIET_HOURS_COMMIT_DELAY_MS,
  QuietHoursSection,
  timeOfDayToDate,
} from "@/components/settings/quiet-hours-section";

const WINDOW = { start: "22:00", end: "07:00", tz: "America/New_York" };

const mounted: ReactTestRenderer[] = [];

function render(
  props: Partial<React.ComponentProps<typeof QuietHoursSection>> = {},
) {
  const onWindowChange = vi.fn();
  const onEnabledChange = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <QuietHoursSection
          enabled
          onEnabledChange={onEnabledChange}
          quietHoursWindow={WINDOW}
          onWindowChange={onWindowChange}
          deviceTimeZone="America/New_York"
          windowEditable
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return { tree, onWindowChange, onEnabledChange };
}

function pickers(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) => (node.type as unknown) === "DateTimePicker",
  );
}

function pickerFor(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === "DateTimePicker" &&
      node.props.accessibilityLabel === label,
  );
}

/** A picked time as the native module reports it. */
function pick(time: string): [{ type: "set" }, Date] {
  return [{ type: "set" }, timeOfDayToDate(time)];
}

beforeEach(() => {
  vi.useFakeTimers();
  Platform.OS = "ios";
  picker.androidOpen.mockReset();
  vi.mocked(Alert.alert).mockReset();
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
  vi.useRealTimers();
  Platform.OS = "ios";
});

describe("QuietHoursSection", () => {
  it("is a single switch while off, with no times or zone", () => {
    const { tree } = render({ enabled: false });

    expect(pickers(tree)).toHaveLength(0);
    const text = screenText(tree);
    expect(text).toContain("Quiet hours");
    expect(text).not.toContain("From");
    expect(text).not.toContain("Time zone");
    expect(text).not.toContain("silently");
  });

  it("draws a native time picker for each end while on", () => {
    const { tree } = render();

    const start = pickerFor(tree, "Quiet hours start");
    const end = pickerFor(tree, "Quiet hours end");
    expect(start.props.mode).toBe("time");
    expect(start.props.display).toBe("compact");
    expect(dateToTimeOfDay(start.props.value)).toBe("22:00");
    expect(dateToTimeOfDay(end.props.value)).toBe("07:00");
    expect(start.props.accentColor).toBe("#8E4EC6");
    expect(screenText(tree)).not.toContain("Notifications arrive silently.");
  });

  it("saves the wheel once it rests, not every position it passes", () => {
    const { tree, onWindowChange } = render();
    const start = () => pickerFor(tree, "Quiet hours start");

    act(() => start().props.onChange(...pick("22:30")));
    act(() => start().props.onChange(...pick("23:00")));
    // The picker shows the latest position straight away.
    expect(dateToTimeOfDay(start().props.value)).toBe("23:00");
    expect(onWindowChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(QUIET_HOURS_COMMIT_DELAY_MS));
    expect(onWindowChange).toHaveBeenCalledTimes(1);
    expect(onWindowChange).toHaveBeenCalledWith({ ...WINDOW, start: "23:00" });
  });

  // Leaving mid-spin drops the half-turned value rather than saving it from a
  // stale render: an unmount flush once switched quiet hours back on when a
  // member turned them off with a wheel still settling.
  it("saves nothing when the times close mid-spin", () => {
    const { tree, onWindowChange } = render();

    act(() =>
      pickerFor(tree, "Quiet hours end").props.onChange(...pick("06:30")),
    );
    act(() => tree.unmount());
    mounted.splice(mounted.indexOf(tree), 1);
    act(() => vi.advanceTimersByTime(QUIET_HOURS_COMMIT_DELAY_MS));

    expect(onWindowChange).not.toHaveBeenCalled();
  });

  it("drops a spin that comes back to where it started", () => {
    const { tree, onWindowChange } = render();
    const start = () => pickerFor(tree, "Quiet hours start");

    act(() => start().props.onChange(...pick("22:30")));
    act(() => start().props.onChange(...pick("22:00")));
    act(() => vi.advanceTimersByTime(QUIET_HOURS_COMMIT_DELAY_MS));

    expect(onWindowChange).not.toHaveBeenCalled();
    expect(dateToTimeOfDay(start().props.value)).toBe("22:00");
  });

  it("can't be changed while the account's first read is in flight", () => {
    const { tree } = render({ windowEditable: false });

    expect(pickerFor(tree, "Quiet hours start").props.disabled).toBe(true);
  });

  it("opens the Android clock dialog and saves on OK", () => {
    Platform.OS = "android";
    const { tree, onWindowChange } = render();

    expect(pickers(tree)).toHaveLength(0);
    expect(screenText(tree)).toContain("10:00 PM");
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "From",
    );
    act(() => row.props.onPress());

    expect(picker.androidOpen).toHaveBeenCalledTimes(1);
    const options = picker.androidOpen.mock.calls[0][0];
    expect(options.mode).toBe("time");
    act(() => options.onChange({ type: "dismissed" }, undefined));
    expect(onWindowChange).not.toHaveBeenCalled();
    act(() => options.onChange(...pick("21:15")));
    expect(onWindowChange).toHaveBeenCalledWith({ ...WINDOW, start: "21:15" });
  });

  it("names no zone when the window is in this phone's", () => {
    const { tree } = render();

    expect(screenText(tree)).not.toContain("Time zone");
  });

  // The server evaluates a window stored with no zone in UTC.
  it("names UTC when the account has a window but no zone", () => {
    const { tree, onWindowChange } = render({ storedZoneMissing: true });

    const text = screenText(tree);
    expect(text).toContain("Time zone");
    expect(text).toContain("UTC");

    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Time zone",
    );
    act(() => row.props.onPress());
    const buttons = vi.mocked(Alert.alert).mock.calls[0][2] ?? [];
    act(() => buttons.find((b) => b.text === "Use New York")?.onPress?.());

    expect(onWindowChange).toHaveBeenCalledWith({
      ...WINDOW,
      tz: "America/New_York",
    });
  });

  it("offers this phone's zone when the stored one differs, and only on a tap", () => {
    const { tree, onWindowChange } = render({
      quietHoursWindow: { ...WINDOW, tz: "America/Los_Angeles" },
    });

    const text = screenText(tree);
    expect(text).toContain("Time zone");
    expect(text).toContain("Los Angeles");
    expect(text).toContain("This phone is on New York time.");
    expect(onWindowChange).not.toHaveBeenCalled();

    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Time zone",
    );
    act(() => row.props.onPress());
    const buttons = vi.mocked(Alert.alert).mock.calls[0][2] ?? [];
    const use = buttons.find((button) => button.text === "Use New York");
    act(() => use?.onPress?.());

    expect(onWindowChange).toHaveBeenCalledWith({
      ...WINDOW,
      tz: "America/New_York",
    });
  });
});

describe("time helpers", () => {
  it("formats a window end for reading", () => {
    expect(formatTimeOfDay("22:00")).toBe("10:00 PM");
    expect(formatTimeOfDay("00:05")).toBe("12:05 AM");
    expect(formatTimeOfDay("12:00")).toBe("12:00 PM");
    expect(formatTimeOfDay("nope")).toBe("nope");
  });

  it("round-trips a time through the picker's Date", () => {
    for (const time of ["00:00", "07:30", "23:59"]) {
      expect(dateToTimeOfDay(timeOfDayToDate(time))).toBe(time);
    }
  });
});
