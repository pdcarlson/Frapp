import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
