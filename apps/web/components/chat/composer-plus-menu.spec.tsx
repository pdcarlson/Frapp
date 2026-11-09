import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ComposerPlusMenu,
  plusMenuModel,
  type PlusMenuContext,
} from "./composer-plus-menu";

function ctx(overrides: Partial<PlusMenuContext> = {}): PlusMenuContext {
  return {
    forms: [
      { command: "poll", roleAllows: true },
      { command: "event", roleAllows: true },
    ],
    moduleStatus: "ready",
    isModuleEnabled: () => true,
    replying: false,
    filesStaged: 0,
    fileLimit: 10,
    offline: false,
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
      ctx({ forms: [{ command: "event", roleAllows: null }] }),
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
      plusMenuModel(ctx({ filesStaged: 1 })).rows[0]!.disabledReason,
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

  it("greys Attach a file at the file limit", () => {
    expect(plusMenuModel(ctx({ filesStaged: 10 })).attachDisabledReason).toBe(
      "Up to 10 files",
    );
  });
});

describe("ComposerPlusMenu", () => {
  it("always opens, with the footer, even when Attach a file is all it holds", async () => {
    const user = userEvent.setup();
    const model = plusMenuModel(
      ctx({
        forms: [
          { command: "poll", roleAllows: false },
          { command: "event", roleAllows: false },
        ],
      }),
    );
    render(
      <ComposerPlusMenu
        model={model}
        triggerClassName=""
        onAttach={vi.fn()}
        onOpenForm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add a file/i }));
    expect(
      await screen.findByRole("menuitem", { name: /attach a file/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your role can't create polls or events."),
    ).toBeInTheDocument();
    expect(screen.getByText(/in the message box for shortcuts/)).toBeInTheDocument();
  });

  it("opens a row's form and shows its shortcut", async () => {
    const user = userEvent.setup();
    const onOpenForm = vi.fn();
    render(
      <ComposerPlusMenu
        model={plusMenuModel(ctx())}
        triggerClassName=""
        onAttach={vi.fn()}
        onOpenForm={onOpenForm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add a file/i }));
    const poll = await screen.findByRole("menuitem", { name: /poll/i });
    expect(poll).toHaveTextContent("/poll");
    await user.click(poll);
    expect(onOpenForm).toHaveBeenCalledWith("poll");
  });

  it("won't open a greyed row", async () => {
    const user = userEvent.setup();
    const onOpenForm = vi.fn();
    render(
      <ComposerPlusMenu
        model={plusMenuModel(ctx({ offline: true }))}
        triggerClassName=""
        onAttach={vi.fn()}
        onOpenForm={onOpenForm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add a file/i }));
    const event = await screen.findByRole("menuitem", { name: /event/i });
    expect(event).toHaveAttribute("aria-disabled", "true");
    expect(event).toHaveTextContent("Reconnect first");
  });
});
