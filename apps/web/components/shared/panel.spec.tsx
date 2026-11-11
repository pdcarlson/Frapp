import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "@/components/ui/sheet";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
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
