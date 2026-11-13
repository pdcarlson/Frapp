import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

import {
  addableQuickActions,
  addQuickAction,
  availableQuickActions,
  mergeSavedQuickActions,
  moveQuickAction,
  QUICK_ACTION_COLUMNS,
  QUICK_ACTION_LIMIT,
  QUICK_ACTION_START,
  quickActionCellWidth,
  quickActionsStorageKey,
  readSavedQuickActions,
  removeQuickAction,
  resolveQuickActions,
  writeSavedQuickActions,
} from "./quick-actions";

const OFFICER = ["*"];

describe("which actions a member can use", () => {
  it("gives an officer every action", () => {
    expect(
      availableQuickActions({
        permissions: OFFICER,
        enabledModules: undefined,
      }),
    ).toEqual([
      "newEvent",
      "newTask",
      "invite",
      "message",
      "checkIn",
      "hostCheckIn",
      "logHours",
      "study",
      "upload",
    ]);
  });

  it("gives a member only what needs no officer permission", () => {
    expect(
      availableQuickActions({
        permissions: ["members:view", "service:log"],
        enabledModules: undefined,
      }),
    ).toEqual(["message", "checkIn", "logHours", "study"]);
  });

  it("asks each action for the permission its endpoint does", () => {
    const keys = (permissions: string[]) =>
      availableQuickActions({
        permissions,
        enabledModules: undefined,
      });
    // New Member and Alumni hold members:view but not service:log.
    expect(keys(["members:view"])).toEqual(["message", "checkIn", "study"]);
    // No roster, no Directory and no study sessions; check-in needs none.
    expect(keys(["service:log"])).toEqual(["checkIn", "logHours"]);
    // `POST /v1/tasks` also needs the controller's members:view (#3865).
    expect(keys(["tasks:manage"])).not.toContain("newTask");
    expect(keys(["tasks:manage", "members:view"])).toContain("newTask");
  });

  it("lets officers check themselves in, not only host", () => {
    const officer = availableQuickActions({
      permissions: ["events:update", "events:create"],
      enabledModules: undefined,
    });
    expect(officer).toContain("checkIn");
    expect(officer).toContain("hostCheckIn");
  });

  it("leaves out an action whose module the chapter turned off", () => {
    const keys = availableQuickActions({
      permissions: OFFICER,
      enabledModules: { events: false, hours: false, documents: false },
    });
    // Invites have no module switch.
    expect(keys).toEqual(["newTask", "invite", "message"]);
    expect(
      availableQuickActions({
        permissions: OFFICER,
        enabledModules: { tasks: false },
      }),
    ).not.toContain("newTask");
  });

  it("needs both hours and study zones for Study", () => {
    const keys = (modules: Record<string, boolean>) =>
      availableQuickActions({
        permissions: ["members:view"],
        enabledModules: modules,
      });
    expect(keys({ geofences: false })).not.toContain("study");
    expect(keys({ hours: false })).not.toContain("study");
    expect(keys({})).toContain("study");
  });

  it("offers Invite only to a role that can invite", () => {
    const keys = (permissions: string[]) =>
      availableQuickActions({
        permissions,
        enabledModules: undefined,
      });
    expect(keys(["members:view", "service:log"])).not.toContain("invite");
    expect(keys(["members:invite"])).toContain("invite");
  });

  it("offers New event only with the sheet's own permissions", () => {
    const keys = (permissions: string[]) =>
      availableQuickActions({
        permissions,
        enabledModules: undefined,
      });
    expect(keys(["events:create"])).not.toContain("newEvent");
    expect(keys(["events:create", "members:view"])).toContain("newEvent");
  });
});

describe("what the panel shows", () => {
  const officer = availableQuickActions({
    permissions: OFFICER,
    enabledModules: undefined,
  });

  it("starts an officer on the first six, Invite among them", () => {
    expect(resolveQuickActions(null, officer)).toEqual([
      "newEvent",
      "newTask",
      "invite",
      "message",
      "checkIn",
      "hostCheckIn",
    ]);
  });

  it("starts a member on the four they can use", () => {
    const member = availableQuickActions({
      permissions: ["members:view", "service:log"],
      enabledModules: undefined,
    });
    expect(resolveQuickActions(null, member)).toEqual([
      "message",
      "checkIn",
      "logHours",
      "study",
    ]);
  });

  it("keeps a saved arrangement's order", () => {
    expect(resolveQuickActions(["study", "message"], officer)).toEqual([
      "study",
      "message",
    ]);
  });

  it("drops what the member can no longer use, and anything unknown", () => {
    expect(
      resolveQuickActions(
        ["newTask", "polls", "message", "message"],
        ["message", "checkIn"],
      ),
    ).toEqual(["message"]);
  });

  it("keeps an emptied panel empty rather than refilling it", () => {
    expect(resolveQuickActions([], officer)).toEqual([]);
  });

  it("starts on two rows, and keeps all nine once a member places them", () => {
    expect(QUICK_ACTION_START).toBe(6);
    expect(QUICK_ACTION_LIMIT).toBe(9);
    expect(resolveQuickActions(null, officer)).toHaveLength(QUICK_ACTION_START);
    expect(resolveQuickActions([...officer], officer)).toEqual(officer);
    expect(officer).toHaveLength(QUICK_ACTION_LIMIT);
  });
});

describe("editing", () => {
  it("removes, adds at the end, and refuses a tenth", () => {
    const six = [
      "newTask",
      "message",
      "checkIn",
      "hostCheckIn",
      "logHours",
      "study",
    ] as const;
    expect(removeQuickAction(six, "checkIn")).not.toContain("checkIn");
    expect(addQuickAction(["message"], "study")).toEqual(["message", "study"]);
    // Six is no longer full: a seventh goes on the third row.
    expect(addQuickAction(six, "upload")).toEqual([...six, "upload"]);
    const nine = [...six, "upload", "invite", "newEvent"] as const;
    expect(addQuickAction(nine.slice(0, 8), "newEvent")).toEqual([...nine]);
    expect(addQuickAction(nine.slice(0, 8), "newEvent")).toHaveLength(
      QUICK_ACTION_LIMIT,
    );
    expect(addQuickAction(["message"], "message")).toEqual(["message"]);
  });

  it("moves one action and closes the others up around it", () => {
    expect(moveQuickAction(["message", "checkIn", "study"], 0, 2)).toEqual([
      "checkIn",
      "study",
      "message",
    ]);
    expect(moveQuickAction(["message", "checkIn", "study"], 2, 0)).toEqual([
      "study",
      "message",
      "checkIn",
    ]);
    expect(moveQuickAction(["message", "checkIn"], 1, 9)).toEqual([
      "message",
      "checkIn",
    ]);
  });

  it("keeps what is hidden for now through an unrelated edit", () => {
    // Upload's module is off for a moment (or the role is still loading);
    // reordering what is shown doesn't lose it.
    expect(
      mergeSavedQuickActions(
        ["checkIn", "message"],
        ["message", "upload", "checkIn", "polls"],
        ["message", "checkIn"],
      ),
    ).toEqual(["checkIn", "message", "upload"]);
    // Removing a shown one does remove it.
    expect(
      mergeSavedQuickActions(
        ["message"],
        ["message", "checkIn"],
        ["message", "checkIn"],
      ),
    ).toEqual(["message"]);
    expect(mergeSavedQuickActions(["study"], null, ["study"])).toEqual([
      "study",
    ]);
  });

  it("offers in the Add row only what is not placed", () => {
    expect(
      addableQuickActions(["message"], ["message", "checkIn", "study"]),
    ).toEqual(["checkIn", "study"]);
  });

  it("fits three cells on a row inside the glass border, on every phone", () => {
    // Panel widths: a 320pt, 375pt, 402pt and 430pt screen less the bar's
    // 14pt sides. Hairlines: Android's and the 2x and 3x iPhones'.
    for (const panel of [292, 347, 374, 402]) {
      for (const hairline of [1, 0.5, 1 / 3]) {
        const cell = quickActionCellWidth(panel, 10, hairline);
        const inner = panel - 2 * hairline - 20;
        expect(cell * QUICK_ACTION_COLUMNS).toBeLessThanOrEqual(inner);
        // And it uses the row: under a point each side is left over.
        expect(inner - cell * QUICK_ACTION_COLUMNS).toBeLessThan(3);
      }
    }
  });
});

describe("where the arrangement is kept", () => {
  beforeEach(() => storage.clear());

  it("keeps one per member and chapter", async () => {
    writeSavedQuickActions("user-1", "chapter-1", ["study", "message"]);
    await Promise.resolve();
    expect(await readSavedQuickActions("user-1", "chapter-1")).toEqual([
      "study",
      "message",
    ]);
    expect(await readSavedQuickActions("user-1", "chapter-2")).toBeNull();
    expect(quickActionsStorageKey("user-1", null)).toBe(
      "frapp:quick-actions:v1:user-1:sole",
    );
  });

  it("reads a damaged value as nothing saved", async () => {
    storage.set(quickActionsStorageKey("user-1", "chapter-1"), "{not json");
    expect(await readSavedQuickActions("user-1", "chapter-1")).toBeNull();
  });
});
