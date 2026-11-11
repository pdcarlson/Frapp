import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  plusMenuModel,
  type PlusMenuCommand,
  type PlusMenuContext,
} from "@repo/chat-core/plus-menu";
import { ComposerPlusCard } from "./composer-plus-card";

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

/** The card as the composer drives it: open state and view held by the host. */
function Host({
  context = ctx(),
  drafts,
  onAttach = vi.fn(),
}: {
  context?: PlusMenuContext;
  drafts?: ReadonlySet<PlusMenuCommand>;
  onAttach?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PlusMenuCommand | null>(null);
  return (
    <ComposerPlusCard
      model={plusMenuModel(context)}
      triggerClassName=""
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setView(null);
      }}
      view={view}
      onAttach={onAttach}
      onPick={setView}
      onBack={() => setView(null)}
      drafts={drafts}
      form={
        <label>
          Question
          <input data-plus-autofocus />
        </label>
      }
    />
  );
}

const openCard = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /add a file/i }));

describe("ComposerPlusCard", () => {
  it("always opens, with the footer, even when Attach a file is all it holds", async () => {
    const user = userEvent.setup();
    render(
      <Host
        context={ctx({
          forms: [
            { command: "poll", roleAllows: false },
            { command: "event", roleAllows: false },
          ],
        })}
      />,
    );
    await openCard(user);
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

  it("turns into a row's form in place, with no dialog", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openCard(user);
    const poll = await screen.findByRole("menuitem", { name: /poll/i });
    expect(poll).toHaveTextContent("/poll");
    await user.click(poll);
    expect(
      screen.getByRole("heading", { name: "New poll" }),
    ).toBeInTheDocument();
    // A non-modal card: no scrim, and the chat behind it stays live.
    expect(screen.getByRole("dialog", { name: "New poll" })).not.toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByLabelText("Question")).toBeInTheDocument();
  });

  it("goes back to the menu with Back, and Escape steps back once, then closes", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await openCard(user);
    await user.click(await screen.findByRole("menuitem", { name: /poll/i }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("menuitem", { name: /poll/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /poll/i }));
    expect(screen.getByRole("heading", { name: "New poll" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      await screen.findByRole("menuitem", { name: /poll/i }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: /poll/i })).toBeNull();
  });

  it("marks a row whose form holds a draft", async () => {
    const user = userEvent.setup();
    render(<Host drafts={new Set<PlusMenuCommand>(["event"])} />);
    await openCard(user);
    expect(
      await screen.findByRole("menuitem", { name: /event/i }),
    ).toHaveTextContent("Draft");
    expect(screen.getByRole("menuitem", { name: /poll/i })).not.toHaveTextContent(
      "Draft",
    );
  });

  it("won't open a greyed row", async () => {
    const user = userEvent.setup();
    render(<Host context={ctx({ offline: true })} />);
    await openCard(user);
    const event = await screen.findByRole("menuitem", { name: /event/i });
    expect(event).toHaveAttribute("aria-disabled", "true");
    expect(event).toHaveTextContent("Reconnect first");
    // A greyed row still teaches its shortcut.
    expect(event).toHaveTextContent("/event");
  });
});
