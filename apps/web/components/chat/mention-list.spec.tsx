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

describe("MentionList — loading (@tiptap/suggestion's intermediate dispatch)", () => {
  // `@tiptap/suggestion` always fires an `{ items: [], loading: true }`
  // update before the real one on every keystroke (confirmed against
  // node_modules/@tiptap/suggestion/dist/index.js — `willFetch` is always
  // true here since no `minQueryLength`/`initialItems` is configured). The
  // popup must not flash "No matching members." during that tick.
  it("keeps showing the previous results during a loading update instead of clearing to empty", () => {
    const { ref, command, rerender } = renderList(ITEMS);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();

    act(() => {
      rerender(<MentionList ref={ref} items={[]} command={command} loading />);
    });
    // Stale-while-revalidate: still the previous list, not the empty state.
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("No matching members.")).not.toBeInTheDocument();
  });

  it("shows the real empty state once a non-loading update actually has zero matches", () => {
    const ref = createRef<MentionListHandle>();
    const command = vi.fn();
    const { rerender } = render(
      <MentionList ref={ref} items={ITEMS} command={command} loading />,
    );
    act(() => {
      rerender(<MentionList ref={ref} items={[]} command={command} />);
    });
    expect(screen.getByText("No matching members.")).toBeInTheDocument();
  });

  it("renders the real items immediately when there is no prior result to hold onto", () => {
    render(
      <MentionList ref={createRef()} items={[]} command={vi.fn()} loading />,
    );
    expect(screen.getByText("No matching members.")).toBeInTheDocument();
  });
});

describe("MentionList — selectedIndex clamped synchronously, not only via effect", () => {
  it("Enter still selects the last remaining row in the same render the list shrinks to it", () => {
    // Regression case: highlight the 3rd of 3 rows, then re-render with only
    // 1 row *without* letting the `useEffect` that resets selectedIndex run
    // first (act() flushes effects, so simulate the race by pressing Enter
    // synchronously inside the same act() as the narrowing re-render).
    const command = vi.fn();
    const ref = createRef<MentionListHandle>();
    const { rerender } = render(
      <MentionList ref={ref} items={ITEMS} command={command} />,
    );
    press(ref, "ArrowDown");
    press(ref, "ArrowDown");
    expect(screen.getAllByRole("option")[2]).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const narrowed = [ITEMS[2]!];
    act(() => {
      rerender(<MentionList ref={ref} items={narrowed} command={command} />);
      // Same act() batch as the narrowing render — the clamp must already
      // be in effect for this render, not only after a subsequent one.
      ref.current!.onKeyDown({ event: { key: "Enter" } as KeyboardEvent } as never);
    });
    expect(command).toHaveBeenCalledWith(ITEMS[2]);
  });
});
