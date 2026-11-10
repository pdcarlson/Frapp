import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReorderList, moveItem } from "./reorder-list";

const ITEMS = ["Alpha", "Beta", "Gamma"];

function renderList(onReorder = vi.fn(), disabled = false) {
  render(
    <ReorderList
      aria-label="Classes"
      items={ITEMS}
      getId={(item) => item}
      getLabel={(item) => item}
      onReorder={onReorder}
      disabled={disabled}
      renderItem={(item) => <span>{item}</span>}
    />,
  );
  return onReorder;
}

describe("moveItem", () => {
  it("moves one entry and leaves the input alone", () => {
    expect(moveItem(ITEMS, 0, 2)).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(moveItem(ITEMS, 2, 0)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(ITEMS).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("ignores a move off either end", () => {
    expect(moveItem(ITEMS, 0, -1)).toEqual(ITEMS);
    expect(moveItem(ITEMS, 1, 3)).toEqual(ITEMS);
  });
});

describe("ReorderList", () => {
  it("moves a row with the arrow keys on its grip, and announces where it went", () => {
    const onReorder = renderList();
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), {
      key: "ArrowDown",
    });
    expect(onReorder).toHaveBeenCalledWith(["Beta", "Alpha", "Gamma"]);
    expect(screen.getByText("Alpha, 2 of 3")).toBeInTheDocument();
  });

  it("does nothing at the end of the list", () => {
    const onReorder = renderList();
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Alpha" }), {
      key: "ArrowUp",
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Gamma" }), {
      key: "ArrowDown",
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("moves a row with the touch buttons", () => {
    const onReorder = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Move Gamma up" }));
    expect(onReorder).toHaveBeenCalledWith(["Alpha", "Gamma", "Beta"]);
    expect(screen.getByRole("button", { name: "Move Alpha up" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Gamma down" }),
    ).toBeDisabled();
  });

  it("drops a dragged row where it is let go", () => {
    const onReorder = renderList();
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    fireEvent.dragStart(screen.getByRole("button", { name: "Reorder Gamma" }), {
      dataTransfer,
    });
    const target = screen.getByText("Alpha").closest("li")!;
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(onReorder).toHaveBeenCalledWith(["Gamma", "Alpha", "Beta"]);
  });

  it("keeps focus on the grip of a row moved by keyboard", () => {
    function Harness() {
      const [items, setItems] = useState(ITEMS);
      return (
        <ReorderList
          aria-label="Classes"
          items={items}
          getId={(item) => item}
          getLabel={(item) => item}
          onReorder={setItems}
          renderItem={(item) => <span>{item}</span>}
        />
      );
    }
    render(<Harness />);
    const grip = () => screen.getByRole("button", { name: "Reorder Alpha" });
    grip().focus();
    fireEvent.keyDown(grip(), { key: "ArrowDown" });
    expect(grip()).toHaveFocus();
    fireEvent.keyDown(grip(), { key: "ArrowDown" });
    expect(grip()).toHaveFocus();
    // At the end of the list the touch button it pressed is disabled, so
    // focus goes to its pair rather than nowhere.
    // Order is now Beta, Gamma, Alpha; Gamma moves to the top.
    fireEvent.click(screen.getByRole("button", { name: "Move Gamma up" }));
    expect(
      screen.getByRole("button", { name: "Move Gamma down" }),
    ).toHaveFocus();
  });

  it("draws the grip as something Firefox will drag, not a button element", () => {
    renderList();
    expect(
      screen.getByRole("button", { name: "Reorder Alpha" }).tagName,
    ).toBe("DIV");
  });

  it("draws no handles when disabled", () => {
    renderList(vi.fn(), true);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
