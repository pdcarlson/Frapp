import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sheet } from "@/components/ui/sheet";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
  PanelTitle,
  OWNS_ESCAPE,
} from "./panel";

/**
 * The panel's shape is the § Surface size rule (`components.md`): one width
 * from the right edge, a title row and footer that stay put, and a body that
 * is the only thing that scrolls. Nothing else checks it, so a regression to a
 * narrow sheet or a footer that scrolls away would otherwise pass.
 */
function renderPanel() {
  render(
    <Sheet open>
      <PanelContent aria-describedby={undefined}>
        <PanelHeader>Create channel</PanelHeader>
        <PanelBody>
          <p>Body</p>
        </PanelBody>
        <PanelFooter>
          <button type="button">Save</button>
        </PanelFooter>
      </PanelContent>
    </Sheet>,
  );
}

describe("Panel", () => {
  it("opens from the right at the one panel width", () => {
    renderPanel();
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveClass("right-0", "sm:w-[576px]", "sm:max-w-[576px]");
    expect(panel).toHaveAccessibleName("Create channel");
  });

  it("scrolls only the body, so the title row and footer stay on screen", () => {
    renderPanel();
    const body = screen.getByText("Body").parentElement!;
    expect(body).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    const footer = screen.getByRole("button", { name: "Save" }).parentElement!;
    expect(footer).toHaveClass("shrink-0");
    expect(footer).not.toHaveClass("overflow-y-auto");
  });
});

/**
 * Docked (Paul, 2026-11-11): a page's own record opens inside the tool column
 * instead of over the app, so nothing outside the column is dimmed or blocked.
 */
function DockedHarness({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <section aria-label="Chat">
        <button type="button">Send</button>
      </section>
      <div data-tool-column="">
        <div data-tool-page="">
          <button type="button">New event</button>
        </div>
        <Panel
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) onClosed?.();
          }}
          docked
          backLabel="Back to events"
        >
          <PanelContent>
            <PanelHeader>Create event</PanelHeader>
            <PanelBody>
              <input aria-label="Event name" />
            </PanelBody>
          </PanelContent>
        </Panel>
      </div>
    </div>
  );
}

describe("Panel docked", () => {
  it("opens inside the tool column as a region, not a modal dialog", () => {
    render(<DockedHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const region = screen.getByRole("region", { name: "Create event" });
    expect(region.parentElement).toHaveAttribute("data-tool-column");
    expect(region).toHaveFocus();
  });

  it("leaves chat usable and the page under it inert", () => {
    render(<DockedHarness />);
    expect(screen.getByRole("button", { name: "Send" })).not.toHaveAttribute(
      "inert",
    );
    const page = document.querySelector("[data-tool-page]") as HTMLElement;
    expect(page.inert).toBe(true);
  });

  it("goes back with the back arrow and with Escape, and un-inerts the page", () => {
    const onClosed = vi.fn();
    const { unmount } = render(<DockedHarness onClosed={onClosed} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to events" }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Create event" })).toBeNull();
    const page = document.querySelector("[data-tool-page]") as HTMLElement;
    expect(page.inert).toBe(false);
    unmount();

    render(<DockedHarness onClosed={onClosed} />);
    fireEvent.keyDown(screen.getByRole("region", { name: "Create event" }), {
      key: "Escape",
    });
    expect(onClosed).toHaveBeenCalledTimes(2);
  });

  it("keeps Escape typed in a field for the field", () => {
    const onClosed = vi.fn();
    render(<DockedHarness onClosed={onClosed} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Event name" }), {
      key: "Escape",
    });
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("falls back to the sheet when there is no tool column", () => {
    render(
      <Panel open onOpenChange={() => undefined} docked>
        <PanelContent aria-describedby={undefined}>
          <PanelHeader>Create event</PanelHeader>
        </PanelContent>
      </Panel>,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Create event");
  });
});

/**
 * A record whose name heads its body (the member profile) draws a header with
 * no title: the back arrow and its actions only. `PanelTitle` then names the
 * surface from the body, docked or as a sheet.
 */
function HeadlessRecord({
  docked,
  removable,
}: {
  docked: boolean;
  removable?: boolean;
}) {
  const [showRow, setShowRow] = useState(true);
  return (
    <div data-tool-column="">
      <Panel
        open
        onOpenChange={() => undefined}
        docked={docked}
        backLabel="Back to directory"
      >
        <PanelContent aria-describedby={undefined}>
          <PanelHeader actions={<button type="button">More</button>} />
          <PanelBody>
            <PanelTitle>Trevor Nakamura</PanelTitle>
            {removable && showRow ? (
              <button type="button" onClick={() => setShowRow(false)}>
                Revoke
              </button>
            ) : null}
          </PanelBody>
          <PanelFooter>
            <button type="button">Message</button>
          </PanelFooter>
        </PanelContent>
      </Panel>
    </div>
  );
}

/** A page whose button opens a docked panel, beside a chat field. */
function OpenerHarness({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <input aria-label="Message" />
      <div data-tool-column="">
        <div data-tool-page="">
          <button type="button" onClick={onOpen}>
            New minutes
          </button>
        </div>
        <Panel
          open={open}
          onOpenChange={(next) => (next ? onOpen() : onClose())}
          docked
          backLabel="Back to meetings"
        >
          <PanelContent>
            <PanelHeader>New minutes</PanelHeader>
          </PanelContent>
        </Panel>
      </div>
    </div>
  );
}

describe("Panel docked focus on close", () => {
  it("hands focus back to the button pressed to open it, though a click left it unfocused (Safari)", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <OpenerHarness open={false} onOpen={() => undefined} onClose={onClose} />,
    );
    const opener = screen.getByRole("button", { name: "New minutes" });
    // fireEvent.click, unlike a real Chrome click, doesn't focus the button.
    fireEvent.pointerDown(opener);
    fireEvent.click(opener);
    expect(opener).not.toHaveFocus();
    rerender(<OpenerHarness open onOpen={() => undefined} onClose={onClose} />);
    expect(screen.getByRole("region", { name: "New minutes" })).toHaveFocus();

    rerender(
      <OpenerHarness open={false} onOpen={() => undefined} onClose={onClose} />,
    );
    expect(opener).toHaveFocus();
  });

  it("leaves focus in chat when the panel closes while the member is typing there", () => {
    const noop = () => undefined;
    const { rerender } = render(
      <OpenerHarness open={false} onOpen={noop} onClose={noop} />,
    );
    const opener = screen.getByRole("button", { name: "New minutes" });
    fireEvent.pointerDown(opener);
    opener.focus();
    rerender(<OpenerHarness open onOpen={noop} onClose={noop} />);

    const chat = screen.getByRole("textbox", { name: "Message" });
    fireEvent.pointerDown(chat);
    chat.focus();
    rerender(<OpenerHarness open={false} onOpen={noop} onClose={noop} />);
    expect(chat).toHaveFocus();
  });
});

/** A page whose ⋯ menu opens the panel, closing the menu as it does. */
function MenuOpenerHarness({
  menuOpen,
  open,
  onChoose,
}: {
  menuOpen: boolean;
  open: boolean;
  onChoose: () => void;
}) {
  return (
    <div data-tool-column="">
      <div data-tool-page="">
        <button type="button" id="page-more" aria-haspopup="menu">
          More
        </button>
        {menuOpen ? (
          <div role="menu" aria-labelledby="page-more">
            <div role="menuitem" tabIndex={-1} onClick={onChoose}>
              Clean up
            </div>
          </div>
        ) : null}
      </div>
      <Panel
        open={open}
        onOpenChange={() => undefined}
        docked
        backLabel="Back to backwork"
      >
        <PanelContent>
          <PanelHeader>Clean up</PanelHeader>
        </PanelContent>
      </Panel>
    </div>
  );
}

describe("Panel docked, opened from a menu", () => {
  it.each([
    ["a press", (item: HTMLElement) => fireEvent.pointerDown(item)],
    [
      "Enter",
      (item: HTMLElement) => {
        item.focus();
        fireEvent.keyDown(item, { key: "Enter" });
      },
    ],
  ])(
    "hands focus back to the menu's button after %s on an item, which is gone by then",
    (_how, choose) => {
      const noop = () => undefined;
      const { rerender } = render(
        <MenuOpenerHarness menuOpen open={false} onChoose={noop} />,
      );
      choose(screen.getByRole("menuitem", { name: "Clean up" }));
      // Choosing closes the menu and opens the panel in one render.
      rerender(<MenuOpenerHarness menuOpen={false} open onChoose={noop} />);
      expect(screen.getByRole("region", { name: "Clean up" })).toHaveFocus();

      rerender(
        <MenuOpenerHarness menuOpen={false} open={false} onChoose={noop} />,
      );
      expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
    },
  );
});

describe("Panel with the title in its body", () => {
  it("names the docked region from PanelTitle and draws no header title", () => {
    render(<HeadlessRecord docked />);
    const region = screen.getByRole("region", { name: "Trevor Nakamura" });
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Back to directory" }),
    ).toBeInTheDocument();
    expect(region).toContainElement(
      screen.getByRole("button", { name: "More" }),
    );
  });

  it("names the sheet from PanelTitle when there is no tool column", () => {
    render(
      <Panel open onOpenChange={() => undefined} docked>
        <PanelContent aria-describedby={undefined}>
          <PanelHeader />
          <PanelBody>
            <PanelTitle>Trevor Nakamura</PanelTitle>
          </PanelBody>
        </PanelContent>
      </Panel>,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Trevor Nakamura");
  });

  it("centres a docked body and footer at the panel width", () => {
    render(<HeadlessRecord docked />);
    const body = screen.getByText("Trevor Nakamura").parentElement!;
    expect(body.className).toContain(
      "px-[max(1.25rem,calc((100%_-_576px)/2_+_1.25rem))]",
    );
    const footer = screen.getByRole("button", {
      name: "Message",
    }).parentElement!;
    expect(footer.className).toContain("calc((100%_-_576px)/2_+_1.25rem)");
  });

  it("keeps focus in the docked panel when the focused control goes away", async () => {
    render(<HeadlessRecord docked removable />);
    const region = screen.getByRole("region", { name: "Trevor Nakamura" });
    const revoke = screen.getByRole("button", { name: "Revoke" });
    fireEvent.pointerDown(revoke);
    revoke.focus();
    fireEvent.click(revoke);
    await waitFor(() => expect(region).toHaveFocus());
  });
});

describe("PanelContent's Escape (#4512)", () => {
  function EscapeHarness() {
    const [open, setOpen] = useState(true);
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <PanelContent aria-describedby={undefined}>
          <PanelHeader>Task</PanelHeader>
          <PanelBody>
            <div {...{ [OWNS_ESCAPE]: "" }}>
              <input aria-label="Inside" />
            </div>
            <input aria-label="Outside" />
          </PanelBody>
        </PanelContent>
      </Sheet>
    );
  }

  it("stays open for Escape pressed inside content that answers it", () => {
    render(<EscapeHarness />);
    fireEvent.keyDown(screen.getByLabelText("Inside"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("still closes on Escape anywhere else", () => {
    render(<EscapeHarness />);
    fireEvent.keyDown(screen.getByLabelText("Outside"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
