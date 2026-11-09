import { describe, expect, it } from "vitest";
import {
  PLUS_MENU_COMMANDS,
  plusMenuForms,
  plusMenuModel,
  type PlusMenuContext,
} from "./plus-menu";

function ctx(overrides: Partial<PlusMenuContext> = {}): PlusMenuContext {
  return {
    forms: [
      { command: "poll", roleAllows: true },
      { command: "event", roleAllows: true },
    ],
    moduleStatus: "ready",
    isModuleEnabled: () => true,
    replying: false,
    attachmentNoun: "file",
    attachmentsStaged: 0,
    attachmentLimit: 10,
    offline: false,
    roleRetryHint: "Reload to try again.",
    ...overrides,
  };
}

describe("plusMenuModel (#3865)", () => {
  it("offers every form the role and modules allow, in the menu's order", () => {
    const model = plusMenuModel(ctx());
    expect(model.rows.map((row) => row.command)).toEqual(["poll", "event"]);
    expect(model.rows.every((row) => row.disabledReason === null)).toBe(true);
    expect(model.footer).toEqual([]);
  });

  it("leaves out what the role can't do and names it once, never a permission", () => {
    const model = plusMenuModel(
      ctx({
        forms: [
          { command: "poll", roleAllows: false },
          { command: "event", roleAllows: false },
        ],
      }),
    );
    expect(model.rows).toEqual([]);
    expect(model.footer).toEqual(["Your role can't create polls or events."]);
  });

  it("hides a row without blaming the role while permissions load", () => {
    const model = plusMenuModel(
      ctx({ forms: [{ command: "event", roleAllows: "loading" }] }),
    );
    expect(model.rows).toEqual([]);
    expect(model.footer).toEqual([]);
  });

  it("says when the chapter turned a module off", () => {
    const model = plusMenuModel(
      ctx({ isModuleEnabled: (key) => key !== "polls" }),
    );
    expect(model.rows.map((row) => row.command)).toEqual(["event"]);
    expect(model.footer).toEqual([
      "Polls are turned off in this chapter's Settings.",
    ]);
  });

  it("greys a queueless form offline but keeps Poll, which queues", () => {
    const model = plusMenuModel(ctx({ offline: true }));
    expect(model.rows).toEqual([
      { command: "poll", label: "Poll", disabledReason: null },
      { command: "event", label: "Event", disabledReason: "Reconnect first" },
    ]);
  });

  it("gives the typed command's refusals as reasons beside the row", () => {
    expect(
      plusMenuModel(ctx({ attachmentsStaged: 1 })).rows[0]!.disabledReason,
    ).toBe("Send the file first");
    expect(plusMenuModel(ctx({ replying: true })).rows[0]!.disabledReason).toBe(
      "Not while replying",
    );
  });

  it("greys rather than guesses while the module read is pending", () => {
    expect(
      plusMenuModel(ctx({ moduleStatus: "loading" })).rows[0]!.disabledReason,
    ).toBe("Still loading");
  });

  it("says the role couldn't be checked when the permissions read failed", () => {
    const model = plusMenuModel(
      ctx({
        forms: [
          { command: "poll", roleAllows: "unknown" },
          { command: "event", roleAllows: true },
        ],
      }),
    );
    expect(model.rows.map((row) => row.command)).toEqual(["event"]);
    expect(model.footer).toEqual([
      "Couldn't check whether your role can create polls. Reload to try again.",
    ]);
  });

  it("greys every row, Poll too, while the module read is offline or failed", () => {
    expect(
      plusMenuModel(ctx({ moduleStatus: "offline" })).rows.map(
        (row) => row.disabledReason,
      ),
    ).toEqual(["Reconnect first", "Reconnect first"]);
    expect(
      plusMenuModel(ctx({ moduleStatus: "error" })).rows[0]!.disabledReason,
    ).toBe("Couldn't check Settings");
  });

  it("names the staged file before the staged reply, as the typed refusals do", () => {
    expect(
      plusMenuModel(ctx({ attachmentsStaged: 1, replying: true })).rows[0]!
        .disabledReason,
    ).toBe("Send the file first");
  });

  it("joins several switched-off modules in one line", () => {
    expect(plusMenuModel(ctx({ isModuleEnabled: () => false })).footer).toEqual(
      ["Polls and Events are turned off in this chapter's Settings."],
    );
  });

  it("greys Attach a file at the file limit", () => {
    expect(
      plusMenuModel(ctx({ attachmentsStaged: 10 })).attachDisabledReason,
    ).toBe("Up to 10 files");
  });

  it("names the phone's photos, and its own retry hint", () => {
    const phone = ctx({
      attachmentNoun: "photo",
      attachmentLimit: 4,
      roleRetryHint: "Close this and try again.",
    });
    expect(
      plusMenuModel({ ...phone, attachmentsStaged: 1 }).rows[0]!.disabledReason,
    ).toBe("Send the photo first");
    expect(
      plusMenuModel({ ...phone, attachmentsStaged: 4 }).attachDisabledReason,
    ).toBe("Up to 4 photos");
    expect(
      plusMenuModel({
        ...phone,
        forms: [{ command: "task", roleAllows: "unknown" }],
      }).footer,
    ).toEqual([
      "Couldn't check whether your role can create tasks. Close this and try again.",
    ]);
  });

  it("orders every row as the menu does, whatever order the host lists them in", () => {
    const model = plusMenuModel(
      ctx({
        forms: plusMenuForms(
          ["points", "hours", "task", "event", "poll"],
          ["*"],
          false,
        ),
      }),
    );
    expect(model.rows.map((row) => row.label)).toEqual([
      "Poll",
      "Event",
      "Task",
      "Service hours",
      "Points",
    ]);
  });
});

describe("plusMenuForms", () => {
  it("checks each form against its route's grants", () => {
    const forms = plusMenuForms(
      PLUS_MENU_COMMANDS,
      ["polls:create", "service:log", "tasks:manage"],
      false,
    );
    expect(forms).toEqual([
      { command: "poll", roleAllows: true },
      { command: "event", roleAllows: false },
      // `tasks:manage` alone isn't enough: the route also needs `members:view`.
      { command: "task", roleAllows: false },
      { command: "hours", roleAllows: true },
      { command: "points", roleAllows: false },
    ]);
  });

  it("is loading until the permissions are read, and unknown if that failed", () => {
    expect(plusMenuForms(["poll"], undefined, false)).toEqual([
      { command: "poll", roleAllows: "loading" },
    ]);
    expect(plusMenuForms(["poll"], undefined, true)).toEqual([
      { command: "poll", roleAllows: "unknown" },
    ]);
  });
});
