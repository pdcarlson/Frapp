import { createRef } from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  MentionList,
  type MentionListHandle,
  type MentionSuggestionItem,
} from "./mention-list";

const ITEMS: MentionSuggestionItem[] = [
  { id: "u1", label: "JaneDoe", displayName: "Jane Doe", avatarUrl: null },
  { id: "u2", label: "JohnSmith", displayName: "John Smith", avatarUrl: null },
  { id: "u3", label: "AlexKim", displayName: "Alex Kim", avatarUrl: null },
];

function renderList(items: MentionSuggestionItem[], command = vi.fn()) {
  const ref = createRef<MentionListHandle>();
  const { rerender } = render(
    <MentionList ref={ref} items={items} command={command} />,
  );
  return { ref, command, rerender };
}

/**
 * `ref.current.onKeyDown` is called imperatively, the same way the tiptap
 * suggestion plugin forwards editor keydowns to it — not through a real DOM
 * event — so the resulting `setSelectedIndex` update needs `act()` the same
 * way any out-of-React-event state change does.
 */
function press(ref: React.RefObject<MentionListHandle | null>, key: string) {
  let handled = false;
  act(() => {
    handled = ref.current!.onKeyDown({ event: { key } as KeyboardEvent } as never);
  });
  return handled;
}

describe("MentionList", () => {
  it("renders 'No matching members.' when the filtered list is empty", () => {
    renderList([]);
    expect(screen.getByText("No matching members.")).toBeInTheDocument();
  });

  it("lists every candidate's display name", () => {
    renderList(ITEMS);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getByText("Alex Kim")).toBeInTheDocument();
  });

  it("highlights the first row by default", () => {
    renderList(ITEMS);
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("ArrowDown moves the highlight forward and wraps past the last row", () => {
    const { ref } = renderList(ITEMS);

    press(ref, "ArrowDown");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );

    press(ref, "ArrowDown");
    expect(screen.getAllByRole("option")[2]).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Wraps back to the first row.
    press(ref, "ArrowDown");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("ArrowUp wraps to the last row from the first", () => {
    const { ref } = renderList(ITEMS);
    press(ref, "ArrowUp");
    expect(screen.getAllByRole("option")[2]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("Enter selects the highlighted item", () => {
    const command = vi.fn();
    const { ref } = renderList(ITEMS, command);
    press(ref, "ArrowDown");
    press(ref, "Enter");
    expect(command).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("Tab also selects the highlighted item — a common autocomplete convention", () => {
    const command = vi.fn();
    const { ref } = renderList(ITEMS, command);
    press(ref, "Tab");
    expect(command).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("clicking a row selects it regardless of which row is highlighted", () => {
    const command = vi.fn();
    renderList(ITEMS, command);
    screen.getByText("Alex Kim").click();
    expect(command).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("an unrecognized key is not consumed, so typing keeps flowing into the editor", () => {
    const { ref } = renderList(ITEMS);
    expect(press(ref, "a")).toBe(false);
  });

  it("arrow keys are not consumed when there are no items to navigate", () => {
    const { ref } = renderList([]);
    expect(press(ref, "ArrowDown")).toBe(false);
  });

  it("resets the highlight to the first row when the item list changes (re-filtered)", () => {
    const { ref, command, rerender } = renderList(ITEMS);
    press(ref, "ArrowDown");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Re-render with a narrower, re-filtered list — mirrors what happens on
    // every keystroke while the `@` query changes.
    const narrowed = [ITEMS[2]!];
    act(() => {
      rerender(<MentionList ref={ref} items={narrowed} command={command} />);
    });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
