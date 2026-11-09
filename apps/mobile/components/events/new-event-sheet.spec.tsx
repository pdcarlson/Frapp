/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
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
import { EVENT_CREATE_UNCONFIRMED } from "@repo/hooks";
const TRY_AGAIN = "That didn't save. Your event is still here, so try again.";

type Options = {
  onSuccess: () => void;
  onError: (error: unknown) => void;
};
let outcome: { ok: true } | { ok: false; error: unknown } = { ok: true };
const mutate = vi.fn((_body: unknown, options: Options) =>
  outcome.ok ? options.onSuccess() : options.onError(outcome.error),
);

/** The chat path's create (#3865): the same outcome, as a promise. */
const mutateAsync = vi.fn<(body: unknown) => Promise<unknown>>(async () => {
  if (outcome.ok) return undefined;
  throw outcome.error;
});

const updateMutate = vi.fn((_body: unknown, options: Options) =>
  options.onSuccess(),
);
const deleteMutate = vi.fn((_body: unknown, options: Options) =>
  options.onSuccess(),
);
let permissions: string[] = ["*"];

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCreateEvent: () => ({ mutate, mutateAsync, isPending: false }),
  useUpdateEvent: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteEvent: () => ({ mutate: deleteMutate, isPending: false }),
  usePermissionList: () => permissions,
  useRoles: () => ({
    data: [
      { id: "role-officers", name: "Officers" },
      { id: "role-new", name: "New Members" },
      { id: "role-alumni", name: "Alumni" },
    ],
    isPending: false,
    isError: false,
  }),
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
import type { EventEditTarget } from "@/lib/events/edit-event";
import type { EventDetail } from "@/lib/events/select";

/** A Thursday afternoon, local time. */
const NOW = new Date(2026, 10, 5, 14, 0);
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute);

const open = vi.mocked(DateTimePickerAndroid.open);

function renderAt(now: Date, onCreated = vi.fn()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewEventSheet now={now} onCreated={onCreated} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const render = (onCreated = vi.fn()) => renderAt(NOW, onCreated);

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

/** The chip whose text is `label`. */
function chip(tree: ReactTestRenderer, label: string) {
  const [node] = tree.root.findAll(
    (each) =>
      typeof each.props.onPress === "function" &&
      each.findAll((child) => child.props.children === label).length > 0,
  );
  if (!node) throw new Error(`no chip ${label}`);
  return node;
}

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
    // The options start closed, and say what they hold.
    expect(screenText(tree)).not.toContain("Points for attending");
    expect(byLabel(tree, "More options").props.accessibilityLabel).toBe(
      "More options: 10 pts · Optional for everyone · Doesn't repeat",
    );
    act(() => byLabel(tree, "More options").props.onPress());
    type(tree, "Points for attending", "25");
    // Required for everyone, but alumni only optional: set in the stacked
    // Who's coming sheet (its own spec drives its controls).
    const attendance = tree.root.find(
      (node) =>
        typeof node.props.onChange === "function" &&
        node.props.value?.everyone !== undefined,
    );
    act(() =>
      attendance.props.onChange({
        everyone: "required",
        roles: { "role-alumni": "optional" },
      }),
    );
    expect(byLabel(tree, "Who's coming").props.accessibilityLabel).toBe(
      "Who's coming: Required for everyone, optional for Alumni",
    );
    act(() => chip(tree, "Every week").props.onPress());
    // Read against the default start, Thursday the 5th at 7 PM.
    expect(screenText(tree)).toContain(
      "13 meetings, the last on Jan 28, 2027.",
    );

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
      optional_role_ids: ["role-alumni"],
      recurrence_rule: "WEEKLY",
    });
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(byLabel(tree, "Event name").props.value).toBe("");
    expect(byLabel(tree, "More options").props.accessibilityLabel).toBe(
      "More options: 10 pts · Optional for everyone · Doesn't repeat",
    );
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

  it("sends the start on screen, even when the clock passes 7 PM under it", () => {
    // The host's clock ticks every 30 seconds: the sheet still shows today's
    // 7 PM when Create is pressed at 7:00:05. It must not post tomorrow's.
    const tree = renderAt(new Date(2026, 10, 5, 18, 59, 50));
    vi.setSystemTime(new Date(2026, 10, 5, 19, 0, 5));
    type(tree, "Event name", "Formal");
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

  it("says to check Events, not to try again, when the server's answer was lost (#1717)", () => {
    outcome = { ok: false, error: new Error(EVENT_CREATE_UNCONFIRMED) };
    const tree = render();
    type(tree, "Event name", "Formal");
    act(() => createButton(tree).props.onPress());

    expect(screenText(tree)).toContain("We couldn't confirm it saved");
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    act(() => tree.unmount());
  });

  it("opens the options to show an error inside them", () => {
    const tree = render();
    type(tree, "Event name", "Formal");
    act(() => byLabel(tree, "More options").props.onPress());
    type(tree, "Points for attending", "1.5");
    act(() => byLabel(tree, "Fewer options").props.onPress());
    act(() => createButton(tree).props.onPress());

    expect(mutate).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(
      "Points must be a whole number, up to 100,000.",
    );
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
    // Every minute, as Calendar allows: a 5-minute step couldn't set 6:48.
    expect(pickers[1]!.props.minuteInterval).toBe(1);

    // A new time keeps the held day.
    act(() => pickers[1]!.props.onValueChange({}, local(1, 20, 15)));
    expect(onChange).toHaveBeenLastCalledWith(local(7, 20, 15));
    act(() => tree.unmount());
  });

  it("lowers the day's floor to a kept start that has passed, so it shows that day", () => {
    // Picked Wednesday, reopened Thursday: iOS would draw Wednesday as the
    // minimum, Thursday, while the draft still held Wednesday.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <WhenRow
            label="Starts"
            value={local(4, 20)}
            now={NOW}
            minimumDate={NOW}
            disabled={false}
            onChange={vi.fn()}
            platform="ios"
          />
        </FrappThemeProvider>,
      );
    });
    const [dayPicker] = tree.root.findAll(
      (node) => node.type === ("DateTimePicker" as never),
    );
    expect(dayPicker!.props.minimumDate).toEqual(local(4, 0));
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
    // The pill says its day: it used to be blank, the label too.
    expect(dayPill!.props.accessibilityLabel).toBe("Ends day, Sat, Nov 7");
    expect(screenText(tree)).toContain("Sat, Nov 7");
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

describe("Edit event", () => {
  const EVENT: EventDetail = {
    id: "evt-1",
    name: "Chapter",
    location: "Sanctuary",
    start_time: local(9, 18, 45).toISOString(),
    end_time: local(9, 20, 15).toISOString(),
    point_value: 10,
    check_in_opens_minutes: 10,
    attendance: {
      is_mandatory: true,
      others_invited: true,
      required_role_ids: [],
      optional_role_ids: [],
      excluded_role_ids: [],
    },
    description: null,
    notes: null,
    check_in_zone_name: null,
    hasCheckInZone: false,
    recurrence_rule: null,
    parent_event_id: null,
  };
  const single: EventEditTarget = {
    event: EVENT,
    seriesRule: null,
    parent: null,
  };
  const alert = vi.mocked(Alert.alert);

  beforeEach(() => {
    updateMutate.mockClear();
    deleteMutate.mockClear();
    alert.mockReset();
    permissions = ["*"];
  });

  function renderEdit(target: EventEditTarget, handlers = {}) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NewEventSheet now={NOW} editing={target} {...handlers} />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }
  const saveButton = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) =>
        node.props.label === "Save changes" && typeof node.type === "function",
    );

  it("opens filled in from the event", () => {
    const tree = renderEdit(single);
    expect(screenText(tree)).toContain("Edit event");
    expect(byLabel(tree, "Event name").props.value).toBe("Chapter");
    expect(byLabel(tree, "Location").props.value).toBe("Sanctuary");
    expect(byLabel(tree, "More options").props.accessibilityLabel).toBe(
      "More options: 10 pts · Required for everyone · Doesn't repeat",
    );
  });

  it("saves only the changed room, without asking, for a one-time event", async () => {
    const onSaved = vi.fn();
    const tree = renderEdit(single, { onSaved });
    type(tree, "Location", "Great Hall");
    await act(async () => saveButton(tree).props.onPress());
    expect(alert).not.toHaveBeenCalled();
    expect(updateMutate).toHaveBeenCalledWith(
      { id: "evt-1", body: { location: "Great Hall", scope: "instance" } },
      expect.anything(),
    );
    expect(onSaved).toHaveBeenCalledWith({ leave: false });
  });

  it("says what to do when the server refuses the change, and keeps Save", async () => {
    updateMutate.mockImplementationOnce((_body, options) =>
      options.onError({
        statusCode: 400,
        message: "end_time must be after start_time",
      }),
    );
    const tree = renderEdit(single);
    type(tree, "Location", "Great Hall");
    await act(async () => saveButton(tree).props.onPress());
    expect(screenText(tree)).toContain("That change can't be saved.");
    expect(saveButton(tree).props.disabled).toBe(false);
    // Editing clears the line.
    type(tree, "Location", "Great Hall 2");
    expect(screenText(tree)).not.toContain("That change can't be saved.");
  });

  it("saves nothing for an untouched form", async () => {
    const tree = renderEdit(single);
    await act(async () => saveButton(tree).props.onPress());
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("asks this event or all upcoming for a repeating event", async () => {
    alert.mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.text === "All upcoming events")?.onPress?.();
    });
    const occurrence: EventEditTarget = {
      event: { ...EVENT, parent_event_id: "evt-parent" },
      seriesRule: "WEEKLY",
      parent: {
        id: "evt-parent",
        start_time: local(2, 18, 45).toISOString(),
        end_time: local(2, 20, 15).toISOString(),
      },
    };
    const tree = renderEdit(occurrence);
    type(tree, "Event name", "Chapter meeting");
    await act(async () => saveButton(tree).props.onPress());
    expect(alert.mock.calls[0]?.[0]).toBe("This is a repeating event");
    expect(alert.mock.calls[0]?.[2]?.map((b) => b.text)).toEqual([
      "This event only",
      "All upcoming events",
      "Cancel",
    ]);
    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: "evt-parent",
        body: { name: "Chapter meeting", scope: "series" },
      },
      expect.anything(),
    );
  });

  it("saves nothing when the officer cancels the question", async () => {
    alert.mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.text === "Cancel")?.onPress?.();
    });
    const tree = renderEdit({
      ...single,
      event: { ...EVENT, recurrence_rule: "WEEKLY" },
      seriesRule: "WEEKLY",
    });
    type(tree, "Event name", "Chapter meeting");
    await act(async () => saveButton(tree).props.onPress());
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("offers Delete only with events:delete, and confirms first", async () => {
    permissions = ["members:view", "events:update"];
    expect(screenText(renderEdit(single))).not.toContain("Delete event");

    permissions = ["*"];
    alert.mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.text === "Delete")?.onPress?.();
    });
    const onDeleted = vi.fn();
    const tree = renderEdit(single, { onDeleted });
    await act(async () => byLabel(tree, "Delete event").props.onPress());
    expect(alert.mock.calls[0]?.[0]).toBe("Delete this event?");
    expect(deleteMutate).toHaveBeenCalledWith(
      { id: "evt-1", scope: "instance" },
      expect.anything(),
    );
    expect(onDeleted).toHaveBeenCalled();
  });
});

describe("New event from a chat's + (#3865)", () => {
  const card = { clientMessageId: "cm-1", failed: vi.fn(), lost: vi.fn() };
  const trackCard = vi.fn(() => card);

  function renderFromChat(onCreated = vi.fn()): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NewEventSheet
            now={NOW}
            onCreated={onCreated}
            chat={{ channelId: "ch-1", trackCard }}
          />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }

  beforeEach(() => {
    mutateAsync.mockClear();
    trackCard.mockClear();
    card.failed.mockClear();
    card.lost.mockClear();
    outcome = { ok: true };
  });

  it("asks the server to post its card in the channel, under the placeholder's id", async () => {
    const onCreated = vi.fn();
    const tree = renderFromChat(onCreated);
    type(tree, "Event name", "Formal");
    await act(async () => createButton(tree).props.onPress());
    expect(trackCard).toHaveBeenCalledWith("Formal");
    expect(mutate).not.toHaveBeenCalled();
    expect(mutateAsync.mock.calls.at(-1)![0]).toEqual(
      expect.objectContaining({
        name: "Formal",
        channel_id: "ch-1",
        client_message_id: "cm-1",
      }),
    );
    expect(onCreated).toHaveBeenCalledWith({
      name: "Formal",
      cardKeptOut: false,
      cardLost: false,
    });
    act(() => tree.unmount());
  });

  it("keeps the recorded row when the event saved but its card didn't post", async () => {
    mutateAsync.mockResolvedValueOnce({ card_posted: false });
    const onCreated = vi.fn();
    const tree = renderFromChat(onCreated);
    type(tree, "Event name", "Formal");
    await act(async () => createButton(tree).props.onPress());
    expect(card.lost).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ cardLost: true }),
    );
    act(() => tree.unmount());
  });

  it("drops the placeholder when the create fails", async () => {
    outcome = { ok: false, error: new Error("nope") };
    const tree = renderFromChat();
    type(tree, "Event name", "Formal");
    await act(async () => createButton(tree).props.onPress());
    expect(card.failed).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("settles the placeholder even when the member leaves the thread mid-create", async () => {
    // `mutate`'s per-call callbacks don't fire after an unmount; the chat
    // path's promise does, so the card's row is never stranded.
    let settle!: (created: unknown) => void;
    mutateAsync.mockImplementationOnce(
      () => new Promise((resolve) => (settle = resolve)),
    );
    const onCreated = vi.fn();
    const tree = renderFromChat(onCreated);
    type(tree, "Event name", "Formal");
    act(() => createButton(tree).props.onPress());
    act(() => tree.unmount());
    await act(async () => settle({ card_posted: false }));
    expect(card.lost).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ cardLost: true }),
    );
  });

  it("asks for no card when the event keeps anyone out, and says so", async () => {
    const onCreated = vi.fn();
    const tree = renderFromChat(onCreated);
    type(tree, "Event name", "Formal");
    act(() => byLabel(tree, "More options").props.onPress());
    const attendance = tree.root.find(
      (node) =>
        typeof node.props.onChange === "function" &&
        node.props.value?.everyone !== undefined,
    );
    act(() =>
      attendance.props.onChange({
        everyone: "optional",
        roles: { "role-alumni": "not_invited" },
      }),
    );
    await act(async () => createButton(tree).props.onPress());
    expect(trackCard).not.toHaveBeenCalled();
    // Still the promise path, so the alert lands even after an unmount.
    expect(mutate).not.toHaveBeenCalled();
    expect(mutateAsync.mock.calls.at(-1)![0]).not.toHaveProperty("channel_id");
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ cardKeptOut: true }),
    );
    act(() => tree.unmount());
  });
});
