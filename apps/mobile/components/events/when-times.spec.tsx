/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", async () => {
  const { chapterBrandingMock, MUTED_GOLD_BRANDING } =
    await import("@/test/chapter-branding");
  return chapterBrandingMock(MUTED_GOLD_BRANDING);
});

import { endAtTime, endsAnotherDay, WhenTimes } from "./when-times";

const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute);
const NOW = local(5, 14);

describe("endsAnotherDay", () => {
  it("is false on one day and just past midnight", () => {
    expect(endsAnotherDay(local(5, 19), local(5, 20))).toBe(false);
    // A 10 PM to 1 AM social is one night, not two days.
    expect(endsAnotherDay(local(5, 22), local(6, 1))).toBe(false);
  });

  it("is true for a meeting that runs into the next day's afternoon or on", () => {
    expect(endsAnotherDay(local(5, 9), local(6, 17))).toBe(true);
    expect(endsAnotherDay(local(5, 22), local(7, 1))).toBe(true);
  });
});

describe("endAtTime", () => {
  it("puts an end after the start on the start's day", () => {
    expect(endAtTime(local(5, 19), local(9, 21, 30))).toEqual(
      local(5, 21, 30),
    );
  });

  it("puts an end at or before the start on the next day", () => {
    expect(endAtTime(local(5, 22), local(9, 1))).toEqual(local(6, 1));
    expect(endAtTime(local(5, 22), local(9, 22))).toEqual(local(6, 22));
  });
});

describe("WhenTimes on Android", () => {
  it("opens the time dialog and runs an earlier end past midnight", () => {
    const open = vi.mocked(DateTimePickerAndroid.open);
    open.mockClear();
    const onEnd = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <WhenTimes
            start={local(5, 22)}
            end={local(5, 23)}
            now={NOW}
            minimumDate={NOW}
            disabled={false}
            onStart={vi.fn()}
            onEnd={onEnd}
            platform="android"
          />
        </FrappThemeProvider>,
      );
    });
    const [pill] = tree.root.findAll(
      (node) =>
        String(node.props.accessibilityLabel).startsWith("Ends time") &&
        typeof node.props.onPress === "function",
    );
    act(() => pill!.props.onPress());
    const options = open.mock.calls[0]![0];
    expect(options.mode).toBe("time");
    act(() =>
      options.onValueChange?.(
        { nativeEvent: { timestamp: 0, utcOffset: 0 } } as never,
        local(1, 1, 30),
      ),
    );
    expect(onEnd).toHaveBeenLastCalledWith(local(6, 1, 30));
    act(() => tree.unmount());
  });
});
