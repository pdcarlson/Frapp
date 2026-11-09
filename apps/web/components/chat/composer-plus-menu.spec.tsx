import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { plusMenuModel, type PlusMenuContext } from "@repo/chat-core/plus-menu";
import { ComposerPlusMenu } from "./composer-plus-menu";

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
    expect(
      screen.getByText(/in the message box for shortcuts/),
    ).toBeInTheDocument();
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
    // A greyed row still teaches its shortcut.
    expect(event).toHaveTextContent("/event");
  });
});
