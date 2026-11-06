/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { moduleDisabledMessage } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";

/**
 * The New event sheet, rendered: what Create sends, that nothing reads as
 * wrong until Create is pressed, and the gate refusals that withdraw Create.
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
  usePermissionList: () => ["events:create"],
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

import { formatClock } from "@/lib/events/create-event";
import { NewEventSheet } from "./new-event-sheet";

/** A Thursday afternoon, local time. */
const NOW = new Date(2026, 10, 5, 14, 0);

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

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === label && typeof node.type === "string",
  );
/** The outermost pressable whose label starts with `prefix`. */
function byLabelStart(tree: ReactTestRenderer, prefix: string) {
  const [first] = tree.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith(prefix) &&
      typeof node.props.onPress === "function",
  );
  if (!first) throw new Error(`nothing pressable is labelled ${prefix}…`);
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
function press(tree: ReactTestRenderer, prefix: string) {
  act(() => byLabelStart(tree, prefix).props.onPress());
}

beforeEach(() => {
  mutate.mockClear();
  successHaptic.mockClear();
  outcome = { ok: true };
});

describe("New event", () => {
  it("creates the event an officer picked", () => {
    const onCreated = vi.fn();
    const tree = render(onCreated);
    type(tree, "Event name", "Formal");
    type(tree, "Location", "Great Hall");

    // Saturday the 7th, from the month grid.
    press(tree, "Day:");
    press(
      tree,
      new Date(2026, 10, 7).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    );

    // Starts 9:30 PM: the end follows, an hour on.
    press(tree, "Starts");
    press(tree, "9 o'clock");
    press(tree, "30 minutes past");
    expect(byLabelStart(tree, "Ends").props.accessibilityLabel).toBe(
      `Ends ${formatClock(22 * 60 + 30)}`,
    );
    expect(screenText(tree)).not.toContain("+1 day");

    // Ends 1:30 AM, which is the next morning.
    press(tree, "Ends");
    press(tree, "1 o'clock");
    press(tree, "AM");
    expect(screenText(tree)).toContain("+1 day");

    act(() => createButton(tree).props.onPress());

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({
      name: "Formal",
      location: "Great Hall",
      start_time: new Date(2026, 10, 7, 21, 30).toISOString(),
      end_time: new Date(2026, 10, 8, 1, 30).toISOString(),
      point_value: 10,
      is_mandatory: false,
    });
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("says nothing is wrong until Create is pressed", () => {
    const tree = render();
    expect(createButton(tree).props.disabled).toBe(false);
    expect(screenText(tree)).not.toContain("Give the event a name.");

    act(() => createButton(tree).props.onPress());

    expect(mutate).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain("Give the event a name.");

    // Fixed, the line goes without another press.
    type(tree, "Event name", "Formal");
    expect(screenText(tree)).not.toContain("Give the event a name.");
    act(() => tree.unmount());
  });

  it("opens one picker at a time", () => {
    const tree = render();
    press(tree, "Day:");
    expect(() => byLabel(tree, "Event day")).not.toThrow();

    press(tree, "Starts");
    expect(() => byLabel(tree, "Event day")).toThrow();
    expect(() => byLabel(tree, "Start time")).not.toThrow();

    press(tree, "Starts");
    expect(() => byLabel(tree, "Start time")).toThrow();
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
