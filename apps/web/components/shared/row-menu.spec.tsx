import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowMenu, keepsBrowserMenu, type RowMenuEntry } from "./row-menu";

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

function Row({ entries }: { entries: readonly RowMenuEntry[] }) {
  return (
    <RowMenu entries={entries} label="More for Homework 2">
      {(menuButton) => (
        <div data-testid="row" className="group">
          <span data-testid="title">Homework 2</span>
          <a href="/somewhere">link</a>
          <input aria-label="note" />
          {menuButton}
        </div>
      )}
    </RowMenu>
  );
}

describe("keepsBrowserMenu", () => {
  it("leaves links and fields to the browser", () => {
    render(<Row entries={[]} />);
    const row = screen.getByTestId("row");
    expect(keepsBrowserMenu(screen.getByRole("link"), row)).toBe(true);
    expect(keepsBrowserMenu(screen.getByRole("textbox"), row)).toBe(true);
    expect(keepsBrowserMenu(screen.getByTestId("title"), row)).toBe(false);
  });

  it("leaves a text selection inside the row to the browser", () => {
    render(<Row entries={[]} />);
    const row = screen.getByTestId("row");
    const title = screen.getByTestId("title");
    const range = document.createRange();
    range.selectNodeContents(title);
    window.getSelection()!.addRange(range);
    expect(keepsBrowserMenu(title, row)).toBe(true);
  });

  it("ignores a selection somewhere else on the page", () => {
    render(
      <>
        <p data-testid="elsewhere">Other text</p>
        <Row entries={[]} />
      </>,
    );
    const range = document.createRange();
    range.selectNodeContents(screen.getByTestId("elsewhere"));
    window.getSelection()!.addRange(range);
    expect(keepsBrowserMenu(screen.getByTestId("title"), screen.getByTestId("row"))).toBe(
      false,
    );
  });
});

describe("RowMenu", () => {
  const onDownload = vi.fn();
  const onDelete = vi.fn();
  const entries: RowMenuEntry[] = [
    { type: "item", key: "download", label: "Download", onSelect: onDownload },
    { type: "separator", key: "sep" },
    { type: "label", key: "officer", label: "Officer" },
    { type: "item", key: "delete", label: "Delete file…", onSelect: onDelete, destructive: true },
  ];

  it("opens the same list from right-click and from the ⋯ button", async () => {
    const user = userEvent.setup();
    render(<Row entries={entries} />);

    fireEvent.contextMenu(screen.getByTestId("title"));
    const fromRightClick = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "More for Homework 2" }));
    const fromButton = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);

    expect(fromRightClick).toEqual(["Download", "Delete file…"]);
    expect(fromButton).toEqual(fromRightClick);
  });

  it("runs an item's action when picked", async () => {
    const user = userEvent.setup();
    render(<Row entries={entries} />);
    fireEvent.contextMenu(screen.getByTestId("title"));
    await user.click(await screen.findByRole("menuitem", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
  });

  const selectTitle = () => {
    const range = document.createRange();
    range.selectNodeContents(screen.getByTestId("title"));
    window.getSelection()!.addRange(range);
  };

  it("leaves a right-click on selected text to the browser", async () => {
    render(<Row entries={entries} />);
    selectTitle();
    const title = screen.getByTestId("title");
    fireEvent.pointerDown(title, { button: 2, pointerType: "mouse" });
    fireEvent.contextMenu(title);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("treats a Mac Ctrl+click on selected text like a right-click", () => {
    render(<Row entries={entries} />);
    selectTitle();
    const title = screen.getByTestId("title");
    fireEvent.pointerDown(title, { button: 0, ctrlKey: true, pointerType: "mouse" });
    fireEvent.contextMenu(title);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the row menu from the menu key after a right-click left the browser its menu", async () => {
    render(<Row entries={entries} />);
    selectTitle();
    const title = screen.getByTestId("title");
    fireEvent.pointerDown(title, { button: 2, pointerType: "mouse" });
    fireEvent.contextMenu(title);
    window.getSelection()!.removeAllRanges();

    fireEvent.keyDown(title, { key: "ContextMenu" });
    fireEvent.contextMenu(title);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("clears the browser-menu verdict once its event has passed", async () => {
    // Radix skips its long-press timer while the trigger is disabled, so the
    // verdict must not still stand when the next touch press lands.
    render(<Row entries={entries} />);
    selectTitle();
    const title = screen.getByTestId("title");
    fireEvent.pointerDown(title, { button: 2, pointerType: "mouse" });
    fireEvent.contextMenu(title);
    expect(screen.queryByRole("menu")).toBeNull();
    window.getSelection()!.removeAllRanges();

    // No pointerdown first, as on a device whose long-press only fires
    // `contextmenu`: the trigger must already be live again.
    fireEvent.contextMenu(title);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("opens the row menu from a touch long-press even right after such a right-click", async () => {
    render(<Row entries={entries} />);
    selectTitle();
    const title = screen.getByTestId("title");
    fireEvent.pointerDown(title, { button: 2, pointerType: "mouse" });
    fireEvent.contextMenu(title);

    fireEvent.pointerDown(title, { button: 0, pointerType: "touch" });
    fireEvent.contextMenu(title);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("does not stack the row menu on an open ⋯ menu when an item is right-clicked", async () => {
    const user = userEvent.setup();
    render(<Row entries={entries} />);
    await user.click(screen.getByRole("button", { name: "More for Homework 2" }));
    const item = await screen.findByRole("menuitem", { name: "Download" });
    fireEvent.contextMenu(item);
    expect(screen.getAllByRole("menu", { hidden: true })).toHaveLength(1);
  });

  it("does not stack the row menu from a long-press on an open ⋯ menu", async () => {
    const user = userEvent.setup();
    render(<Row entries={entries} />);
    await user.click(screen.getByRole("button", { name: "More for Homework 2" }));
    const item = await screen.findByRole("menuitem", { name: "Download" });

    // Radix opens a touch long-press from a 700ms timer started on pointerdown,
    // with no `contextmenu` event (iOS Safari fires none).
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(item, { button: 0, pointerType: "touch" });
      act(() => {
        vi.advanceTimersByTime(800);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getAllByRole("menu", { hidden: true })).toHaveLength(1);
  });
});
