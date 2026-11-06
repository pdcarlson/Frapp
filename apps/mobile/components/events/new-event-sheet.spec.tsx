/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { moduleDisabledMessage } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";

/**
 * The New event sheet, rendered: what Create sends, that nothing reads as
 * wrong until Create is pressed, the platform pickers it opens, and the gate
 * refusals that withdraw Create.
 */

const SUBSCRIPTION_OFF = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
};
const MODULE_OFF = {
  statusCode: 403,
  error: "Forbidden",
  message: moduleDisabledMessage("events"),
};
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Event service is unavailable.",
};
const TRY_AGAIN = "That didn't save. Your event is still here, so try again.";

type Options = {
  onSuccess: () => void;
  onError: (error: unknown) => void;
};
let outcome: { ok: true } | { ok: false; error: unknown } = { ok: true };
const mutate = vi.fn((_body: unknown, options: Options) =>
  outcome.ok ? options.onSuccess() : options.onError(outcome.error),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateEvent: () => ({ mutate, isPending: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#1A1405",
  }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import { NewEventSheet, WhenRow } from "./new-event-sheet";

/** A Thursday afternoon, local time. */
const NOW = new Date(2026, 10, 5, 14, 0);
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute);

const open = vi.mocked(DateTimePickerAndroid.open);

function render(onCreated = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewEventSheet now={NOW} onCreated={onCreated} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** The outermost node whose label starts with `prefix`. */
function byLabel(tree: ReactTestRenderer, prefix: string) {
  const [first] = tree.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith(prefix),
  );
  if (!first) throw new Error(`nothing is labelled ${prefix}…`);
  return first;
}
const createButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label === "Create event" && typeof node.type === "function",
  );

function type(tree: ReactTestRenderer, label: string, text: string) {
  act(() => byLabel(tree, label).props.onChangeText(text));
}

/**
 * Answer the system picker labelled `prefix` with `picked`. The suite's
 * react-native stub reports iOS, so these are the compact pickers; the
 * Android dialogs have their own spec below.
 */
function pick(tree: ReactTestRenderer, prefix: string, picked: Date) {
  const [picker] = tree.root.findAll(
    (node) =>
      node.type === ("DateTimePicker" as never) &&
      String(node.props.accessibilityLabel).startsWith(prefix),
  );
  if (!picker) throw new Error(`no picker is labelled ${prefix}…`);
  act(() => picker.props.onValueChange({}, picked));
  return picker.props as { mode: string; minimumDate?: Date };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mutate.mockClear();
  successHaptic.mockClear();
  outcome = { ok: true };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("New event", () => {
  it("creates the event an officer picked, then starts the next one fresh", () => {
    const onCreated = vi.fn();
    const tree = render(onCreated);
    type(tree, "Event name", "Formal");
    type(tree, "Location", "Great Hall");
    type(tree, "Points for attending", "25");
    act(() => byLabel(tree, "Mandatory").props.onValueChange(true));

    // Saturday the 7th at 9:30 PM; the end follows, an hour on.
    const dayPicker = pick(tree, "Starts day", local(7, 0));
    expect(dayPicker.mode).toBe("date");
    expect(dayPicker.minimumDate).toEqual(local(5, 0));
    pick(tree, "Starts time", local(1, 21, 30));
    expect(byLabel(tree, "Ends time").props.accessibilityLabel).toContain(
      "10:30",
    );

    // Ends 1:30 AM the next morning.
    pick(tree, "Ends day", local(8, 0));
    pick(tree, "Ends time", local(1, 1, 30));

    act(() => createButton(tree).props.onPress());

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      name: "Formal",
      location: "Great Hall",
      start_time: local(7, 21, 30).toISOString(),
      end_time: local(8, 1, 30).toISOString(),
      point_value: 25,
      is_mandatory: true,
    });
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(byLabel(tree, "Event name").props.value).toBe("");
    expect(byLabel(tree, "Mandatory").props.value).toBe(false);
    act(() => tree.unmount());
  });

  it("says nothing is wrong until Create, and only Create brings a line back", () => {
    const tree = render();
    expect(createButton(tree).props.disabled).toBe(false);
    expect(screenText(tree)).not.toContain("Give the event a name.");

    act(() => createButton(tree).props.onPress());
    expect(mutate).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Give the event a name.");

    // Editing clears it, and emptying the field again doesn't redraw it.
    type(tree, "Event name", "F");
    expect(screenText(tree)).not.toContain("Give the event a name.");
    type(tree, "Event name", "");
    expect(screenText(tree)).not.toContain("Give the event a name.");
    act(() => tree.unmount());
  });

  it("refuses a start that has passed", () => {
    const tree = render();
    type(tree, "Event name", "Formal");
    pick(tree, "Starts time", local(5, 9));
    act(() => createButton(tree).props.onPress());

    expect(mutate).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("That start time has already passed.");
    act(() => tree.unmount());
  });

  it.each([
    [
      "a subscription refusal",
      SUBSCRIPTION_OFF,
      SUBSCRIPTION_REFUSAL_COPY.event,
    ],
    ["a module-off refusal", MODULE_OFF, MODULE_REFUSAL_COPY.event],
  ] as const)("withdraws Create after %s", (_label, error, copy) => {
    outcome = { ok: false, error };
    const tree = render();
    type(tree, "Event name", "Formal");
    act(() => createButton(tree).props.onPress());

    expect(screenText(tree)).toContain(copy);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    expect(createButton(tree).props.disabled).toBe(true);
    act(() => createButton(tree).props.onPress());
    expect(mutate).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("keeps the draft and Create after an ordinary failure", () => {
    outcome = { ok: false, error: FAILED };
    const tree = render();
    type(tree, "Event name", "Formal");
    act(() => createButton(tree).props.onPress());

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(byLabel(tree, "Event name").props.value).toBe("Formal");
    expect(createButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});

describe("the When row on iOS", () => {
  it("draws the system's compact day and time pickers", () => {
    const onChange = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <WhenRow
            label="Starts"
            value={local(7, 21, 30)}
            now={NOW}
            minimumDate={NOW}
            disabled={false}
            onChange={onChange}
            platform="ios"
          />
        </FrappThemeProvider>,
      );
    });
    const pickers = tree.root.findAll(
      (node) => node.type === ("DateTimePicker" as never),
    );
    expect(pickers.map((p) => [p.props.mode, p.props.display])).toEqual([
      ["date", "compact"],
      ["time", "compact"],
    ]);
    expect(pickers[0]!.props.minimumDate).toEqual(local(5, 0));
    expect(pickers[1]!.props.minuteInterval).toBe(5);

    // A new time keeps the held day.
    act(() => pickers[1]!.props.onValueChange({}, local(1, 20, 15)));
    expect(onChange).toHaveBeenLastCalledWith(local(7, 20, 15));
    act(() => tree.unmount());
  });
});

describe("the When row on Android", () => {
  it("opens the Material date dialog, then keeps the held time", () => {
    const onChange = vi.fn();
    open.mockClear();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <WhenRow
            label="Ends"
            value={local(7, 22, 30)}
            now={NOW}
            minimumDate={local(7, 21, 30)}
            disabled={false}
            onChange={onChange}
            platform="android"
          />
        </FrappThemeProvider>,
      );
    });
    const [dayPill] = tree.root.findAll(
      (node) =>
        String(node.props.accessibilityLabel).startsWith("Ends day") &&
        typeof node.props.onPress === "function",
    );
    act(() => dayPill!.props.onPress());

    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0]![0];
    expect(options.mode).toBe("date");
    expect(options.minimumDate).toEqual(local(7, 0));
    act(() =>
      options.onValueChange?.(
        { nativeEvent: { timestamp: 0, utcOffset: 0 } },
        local(8, 0),
      ),
    );
    expect(onChange).toHaveBeenLastCalledWith(local(8, 22, 30));
    act(() => tree.unmount());
  });
});
