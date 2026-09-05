import { describe, expect, it } from "vitest";
import {
  defaultNotificationCategoryState,
  isNotificationCategoryKey,
  NOTIFICATION_CATEGORIES,
  rowsToNotificationCategoryState,
} from "./notification-categories";

describe("NOTIFICATION_CATEGORIES", () => {
  // Pinned rather than asserted loosely, because this list is a contract with
  // `notification_preferences.category` and nothing else checks it: the column
  // has no CHECK constraint and the DTO only length-limits the string. A
  // category added to the API without a row here would otherwise be
  // unswitchable in silence, and one renamed here would start writing rows the
  // server never reads.
  it("exposes exactly the six member-facing categories", () => {
    expect(NOTIFICATION_CATEGORIES.map((category) => category.key)).toEqual([
      "chat",
      "events",
      "points",
      "billing",
      "tasks",
      "service",
    ]);
  });

  // See the module docblock: `announcements` carries only URGENT traffic, and
  // URGENT bypasses the preference gate since #1041, so a switch would suppress
  // nothing until routine announcements are separated from emergencies
  // (#1323); `admin` is chapter operations delivered chapter-wide; `default` is
  // the service's fallback for a payload that omits a category. None is a
  // member preference.
  it("omits the categories that are not a member's to switch", () => {
    const keys = NOTIFICATION_CATEGORIES.map((category) => category.key);
    expect(keys).not.toContain("announcements");
    expect(keys).not.toContain("admin");
    expect(keys).not.toContain("default");
  });

  // Not cosmetic: the row-absent branch of the server's gate treats a missing
  // preference as enabled, so a `false` here would render a switch that
  // disagrees with delivery until the first GET lands.
  it("defaults every category to enabled, matching the server", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(category.defaultEnabled).toBe(true);
    }
  });

  it("gives every category a label and a description", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
    }
  });
});

describe("isNotificationCategoryKey", () => {
  it("accepts every catalog key", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(isNotificationCategoryKey(category.key)).toBe(true);
    }
  });

  // A stored row can name a category this catalog does not expose — an
  // `announcements` row written by an older client, or anything at all, since
  // the column is unconstrained. Surfaces drop those rather than growing state
  // for a switch they do not draw.
  it("rejects categories the catalog does not expose", () => {
    expect(isNotificationCategoryKey("announcements")).toBe(false);
    expect(isNotificationCategoryKey("admin")).toBe(false);
    expect(isNotificationCategoryKey("default")).toBe(false);
    expect(isNotificationCategoryKey("whatever-was-patched")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isNotificationCategoryKey(null)).toBe(false);
    expect(isNotificationCategoryKey(undefined)).toBe(false);
    expect(isNotificationCategoryKey(42)).toBe(false);
    expect(isNotificationCategoryKey({ key: "chat" })).toBe(false);
  });
});

describe("defaultNotificationCategoryState", () => {
  it("maps every catalog key to its default", () => {
    expect(defaultNotificationCategoryState()).toEqual({
      chat: true,
      events: true,
      points: true,
      billing: true,
      tasks: true,
      service: true,
    });
  });

  // Callers fold server rows onto this, so handing out a shared object would
  // let one surface's edits leak into another's.
  it("returns a fresh object each call", () => {
    const first = defaultNotificationCategoryState();
    first.chat = false;
    expect(defaultNotificationCategoryState().chat).toBe(true);
  });
});

describe("rowsToNotificationCategoryState", () => {
  // The load-bearing one. An absent row means enabled — that is what
  // `notifyUser` does with it — so the fold must return every key, not only
  // the ones the server had something to say about. A surface rendering only
  // the returned keys would otherwise draw no switch for an untouched
  // category.
  it("returns every catalog key, defaulting the ones with no row", () => {
    expect(
      rowsToNotificationCategoryState([{ category: "points", is_enabled: false }]),
    ).toEqual({
      chat: true,
      events: true,
      points: false,
      billing: true,
      tasks: true,
      service: true,
    });
  });

  it("applies an explicit false and an explicit true", () => {
    const state = rowsToNotificationCategoryState([
      { category: "chat", is_enabled: false },
      { category: "billing", is_enabled: true },
      { category: "service", is_enabled: false },
    ]);
    expect(state.chat).toBe(false);
    expect(state.billing).toBe(true);
    expect(state.service).toBe(false);
    expect(state.events).toBe(true);
  });

  // `notification_preferences.category` is unconstrained `text`, so the server
  // can hand back rows for categories no surface draws. Folding one in would
  // widen the state past the switches that exist.
  it("drops rows for categories outside the catalog", () => {
    const state = rowsToNotificationCategoryState([
      { category: "announcements", is_enabled: false },
      { category: "admin", is_enabled: false },
      { category: "whatever-was-patched", is_enabled: false },
    ]);
    expect(state).toEqual(defaultNotificationCategoryState());
    expect(Object.keys(state)).toHaveLength(NOTIFICATION_CATEGORIES.length);
  });

  // The endpoint declares no response schema, so a caller cannot lean on the
  // SDK's type to guarantee the shape — the fold is the narrowing.
  it("falls back to defaults for anything that is not an array of rows", () => {
    const defaults = defaultNotificationCategoryState();
    expect(rowsToNotificationCategoryState(undefined)).toEqual(defaults);
    expect(rowsToNotificationCategoryState(null)).toEqual(defaults);
    expect(rowsToNotificationCategoryState({})).toEqual(defaults);
    expect(rowsToNotificationCategoryState("nope")).toEqual(defaults);
    expect(rowsToNotificationCategoryState([])).toEqual(defaults);
  });

  it("skips malformed rows without discarding the good ones", () => {
    const state = rowsToNotificationCategoryState([
      null,
      "chat",
      { category: "tasks" },
      { category: "events", is_enabled: "false" },
      { is_enabled: false },
      { category: "points", is_enabled: false },
    ]);
    expect(state.points).toBe(false);
    expect(state.tasks).toBe(true);
    expect(state.events).toBe(true);
  });

  // Same reason `defaultNotificationCategoryState` is asserted fresh: two
  // surfaces call this, and a shared object would cross-contaminate them.
  it("returns a fresh object each call", () => {
    const first = rowsToNotificationCategoryState([]);
    first.chat = false;
    expect(rowsToNotificationCategoryState([]).chat).toBe(true);
  });
});
