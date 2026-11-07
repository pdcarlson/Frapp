/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#1A1405",
  }),
}));

import { DueDateField } from "./due-date-field";

/** A task due weeks out, not only on a preset chip's day (#3597). */

function render(platform: string, onChange = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <DueDateField
          value="2026-11-06"
          today="2026-11-06"
          disabled={false}
          onChange={onChange}
          platform={platform}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("the New task due date", () => {
  it("draws the compact system picker on iOS, from today on", () => {
    const onChange = vi.fn();
    const tree = render("ios", onChange);
    const picker = tree.root.find(
      (node) => node.type === ("DateTimePicker" as never),
    );
    expect(picker.props.mode).toBe("date");
    expect(picker.props.display).toBe("compact");
    expect(picker.props.minimumDate.getDate()).toBe(6);
    act(() => picker.props.onValueChange({}, new Date(2026, 11, 18, 9)));
    expect(onChange).toHaveBeenLastCalledWith("2026-12-18");
    act(() => tree.unmount());
  });

  it("opens the system dialog on Android", () => {
    const open = vi.mocked(DateTimePickerAndroid.open);
    open.mockClear();
    const onChange = vi.fn();
    const tree = render("android", onChange);
    const button = tree.root.find(
      (node) =>
        String(node.props.accessibilityLabel).startsWith("Due ") &&
        typeof node.props.onPress === "function",
    );
    act(() => button.props.onPress());
    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0]![0] as {
      mode: string;
      onValueChange: (event: unknown, date: Date) => void;
    };
    expect(options.mode).toBe("date");
    act(() => options.onValueChange({}, new Date(2027, 0, 4, 12)));
    expect(onChange).toHaveBeenLastCalledWith("2027-01-04");
    act(() => tree.unmount());
  });
});
