import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelList,
  type ChannelCategory,
  type ChannelReorderControls,
  type ChatChannel,
} from "./channel-list";

/**
 * Drag to reorder the rail (owner, 2026-11-11, #4178). The rail works out the
 * whole new order of the section a drop changed, and hands it to the caller;
 * these pin that order, who can drag, and that a drag never opens a channel.
 */
const CATEGORIES: ChannelCategory[] = [
  { id: "cat-exec", name: "Executive" },
  { id: "cat-comm", name: "Committees" },
  { id: "cat-empty", name: "Archive" },
];
const general: ChatChannel = { id: "c-gen", name: "general", type: "PUBLIC" };
const random: ChatChannel = { id: "c-rand", name: "random", type: "PUBLIC" };
const alumni: ChatChannel = { id: "c-alum", name: "alumni", type: "PUBLIC" };
const exec: ChatChannel = {
  id: "c-exec",
  name: "exec-board",
  type: "PRIVATE",
  category_id: "cat-exec",
};
const rush: ChatChannel = {
  id: "c-rush",
  name: "rush",
  type: "PUBLIC",
  category_id: "cat-comm",
};
const dm: ChatChannel = {
  id: "c-dm",
  name: "dm",
  type: "DM",
  member_ids: ["me", "them"],
};

function setup({
  reorder = true,
  channels = [general, random, alumni, exec, rush, dm],
  sort,
}: {
  reorder?: boolean;
  channels?: ChatChannel[];
  sort?: "chapter" | "recent" | "alpha";
} = {}) {
  const controls: ChannelReorderControls = {
    onReorderChannels: vi.fn(),
    onReorderCategories: vi.fn(),
  };
  const onPick = vi.fn();
  const utils = render(
    <ChannelList
      channels={channels}
      categories={CATEGORIES}
      activeChannelId={null}
      viewerId="me"
      memberNames={{ me: "Me", them: "Them" }}
      onPick={onPick}
      reorder={reorder ? controls : undefined}
      sidebar={
        sort
          ? {
              preferences: {
                pinnedIds: new Set(),
                collapsed: new Set(),
                filters: { unreadOnly: false, hideMuted: false },
                sort,
              },
              mutedChannelIds: new Set(),
              onSetPinned: vi.fn(),
              onSetCollapsed: vi.fn(),
              onSetFilters: vi.fn(),
              onClearFilters: vi.fn(),
            }
          : undefined
      }
    />,
  );
  return { ...utils, controls, onPick };
}

const rowOf = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-reorder-row="${id}"]`);

/** Row titles under a section header, in DOM order. */
function titlesUnder(container: HTMLElement, label: string): string[] {
  const header = Array.from(container.querySelectorAll("p.uppercase")).find(
    (node) => node.textContent === label,
  );
  const list = header?.parentElement?.querySelector("ul");
  return Array.from(list?.querySelectorAll("li") ?? []).map(
    (li) => li.querySelector("span.truncate")?.textContent ?? "",
  );
}

/** Press on `from`, travel past the threshold, release over `over`. */
function drag(from: HTMLElement, over: Element) {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => over;
  try {
    fireEvent.pointerDown(from, {
      button: 0,
      pointerType: "mouse",
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    act(() => {
      window.dispatchEvent(
        Object.assign(
          new MouseEvent("pointermove", { clientX: 10, clientY: 40 }),
          {
            pointerId: 1,
          },
        ),
      );
    });
    act(() => {
      window.dispatchEvent(
        Object.assign(
          new MouseEvent("pointerup", { clientX: 10, clientY: 40 }),
          {
            pointerId: 1,
          },
        ),
      );
    });
  } finally {
    document.elementFromPoint = original;
  }
}

/** Press on `from` and travel past the threshold over `over`, without releasing. */
function hold(from: HTMLElement, over: Element) {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => over;
  fireEvent.pointerDown(from, {
    button: 0,
    pointerType: "mouse",
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });
  act(() => {
    window.dispatchEvent(
      Object.assign(
        new MouseEvent("pointermove", { clientX: 10, clientY: 40 }),
        {
          pointerId: 1,
        },
      ),
    );
  });
  return () => {
    document.elementFromPoint = original;
  };
}

const slotOf = (container: HTMLElement) =>
  container.querySelector("[data-reorder-gap]");

afterEach(() => {
  document.body.style.removeProperty("cursor");
  // A test that ends mid-drag leaves its window listeners; Escape clears them.
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});

describe("ChannelList reorder", () => {
  it("sorts a section by the chapter's order, unarranged rows after A to Z", () => {
    const { container } = setup({
      channels: [
        { ...general, display_order: 1 },
        { ...random, display_order: 0 },
        alumni,
      ],
    });
    expect(titlesUnder(container, "Channels")).toEqual([
      "random",
      "general",
      "alumni",
    ]);
  });

  it("gives a member who can't manage channels nothing to drag and no empty category", () => {
    const { container } = setup({ reorder: false });
    expect(container.querySelector("[data-reorder-row]")).toBeNull();
    expect(container.querySelector("[data-reorder-rail]")).toBeNull();
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("lets an officer drag a channel or a category, but never a DM", () => {
    const { container } = setup();
    expect(rowOf(container, "c-gen")).not.toBeNull();
    expect(rowOf(container, "c-exec")).not.toBeNull();
    expect(rowOf(container, "c-dm")).toBeNull();
    expect(
      container.querySelector('[data-reorder-category="cat-exec"]'),
    ).not.toBeNull();
  });

  it("drops a channel below another, sending the whole section", () => {
    const { container, controls } = setup();
    // A to Z is alumni, general, random; drop alumni after random.
    drag(rowOf(container, "c-alum")!, rowOf(container, "c-rand")!);
    expect(controls.onReorderChannels).toHaveBeenCalledWith(null, [
      "c-gen",
      "c-rand",
      "c-alum",
    ]);
  });

  it("moves a channel into another category", () => {
    const { container, controls } = setup();
    drag(rowOf(container, "c-gen")!, rowOf(container, "c-rush")!);
    expect(controls.onReorderChannels).toHaveBeenCalledWith("cat-comm", [
      "c-rush",
      "c-gen",
    ]);
  });

  it("draws an empty category for an officer and drops onto its heading", () => {
    const { container, controls } = setup();
    const heading = container.querySelector(
      '[data-reorder-header="category:cat-empty"]',
    )!;
    expect(heading.textContent).toBe("Archive");
    drag(rowOf(container, "c-gen")!, heading);
    expect(controls.onReorderChannels).toHaveBeenCalledWith("cat-empty", [
      "c-gen",
    ]);
  });

  it("does not open the channel the drag ends on", () => {
    const { container, onPick } = setup();
    const target = rowOf(container, "c-rand")!;
    drag(rowOf(container, "c-alum")!, target);
    fireEvent.click(target.querySelector("button")!);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("treats a press that doesn't travel as a click, not a drag", () => {
    const { container, controls, onPick } = setup();
    const row = rowOf(container, "c-gen")!;
    fireEvent.pointerDown(row, {
      button: 0,
      pointerType: "mouse",
      pointerId: 1,
    });
    fireEvent.click(row.querySelector("button")!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(controls.onReorderChannels).not.toHaveBeenCalled();
  });

  it("moves a focused row one place with Alt+Up and announces it", () => {
    const { container, controls } = setup();
    const button = rowOf(container, "c-rand")!.querySelector("button")!;
    fireEvent.keyDown(button, { key: "ArrowUp", altKey: true });
    expect(controls.onReorderChannels).toHaveBeenCalledWith(null, [
      "c-alum",
      "c-rand",
      "c-gen",
    ]);
    expect(screen.getByText("random moved to 2 of 3 in Channels")).toBeTruthy();
  });

  it("does nothing on Alt+Up at the top of a section", () => {
    const { container, controls } = setup();
    const button = rowOf(container, "c-alum")!.querySelector("button")!;
    fireEvent.keyDown(button, { key: "ArrowUp", altKey: true });
    expect(controls.onReorderChannels).not.toHaveBeenCalled();
  });

  it("moves a category with Alt+Down on its heading", () => {
    const { container, controls } = setup();
    const heading = container.querySelector<HTMLElement>(
      '[data-reorder-header="category:cat-exec"]',
    )!;
    fireEvent.keyDown(heading, { key: "ArrowDown", altKey: true });
    expect(controls.onReorderCategories).toHaveBeenCalledWith([
      "cat-comm",
      "cat-exec",
      "cat-empty",
    ]);
  });

  it("lifts the row into a held copy and opens a slot where it would land", () => {
    const { container } = setup();
    const restore = hold(
      rowOf(container, "c-alum")!,
      rowOf(container, "c-rand")!,
    );
    try {
      // The row leaves the rail; a copy of it follows the pointer.
      expect(rowOf(container, "c-alum")).toBeNull();
      const copy = document.body.querySelector("[data-reorder-ghost]");
      expect(copy?.textContent).toContain("alumni");
      // The slot sits after random, the last row: general, random, slot.
      const items = Array.from(slotOf(container)!.parentElement!.children).map(
        (li) =>
          li.hasAttribute("data-reorder-gap")
            ? "slot"
            : (li.querySelector("span.truncate")?.textContent ?? ""),
      );
      expect(items).toEqual(["general", "random", "slot"]);
    } finally {
      restore();
    }
  });

  it("opens the slot in an empty category the drag is over", () => {
    const { container } = setup();
    const hint = screen.getByText("Drag channels here");
    const restore = hold(rowOf(container, "c-gen")!, hint);
    try {
      const block = container.querySelector(
        '[data-reorder-category="cat-empty"]',
      )!;
      expect(block.querySelector("[data-reorder-gap]")).not.toBeNull();
      expect(screen.queryByText("Drag channels here")).toBeNull();
    } finally {
      restore();
    }
  });

  it("settles back home on Escape and saves nothing", async () => {
    const { container, controls } = setup();
    const restore = hold(
      rowOf(container, "c-alum")!,
      rowOf(container, "c-rand")!,
    );
    try {
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(controls.onReorderChannels).not.toHaveBeenCalled();
      // The copy glides home first, then the row takes its place again.
      await waitFor(() => expect(rowOf(container, "c-alum")).not.toBeNull());
      expect(slotOf(container)).toBeNull();
      expect(document.body.querySelector("[data-reorder-ghost]")).toBeNull();
    } finally {
      restore();
    }
  });

  it("folds every category to its heading while a category is dragged", () => {
    const { container } = setup();
    const heading = container.querySelector<HTMLElement>(
      '[data-reorder-header="category:cat-exec"]',
    )!;
    const restore = hold(heading, heading);
    try {
      expect(
        container.querySelector('[data-reorder-category="cat-exec"]'),
      ).toBeNull();
      expect(rowOf(container, "c-rush")).toBeNull();
      expect(screen.queryByText("Drag channels here")).toBeNull();
      // The default Channels group is not a category and stays open.
      expect(rowOf(container, "c-gen")).not.toBeNull();
      expect(slotOf(container)).not.toBeNull();
    } finally {
      restore();
    }
  });
});

// The member's own sort (#2877): under Recent or A–Z the rows aren't drawn in
// the chapter's order, so they stop dragging; categories still are, so they
// keep dragging, and an empty one keeps its heading.
describe("drag under the member's sort (#2877)", () => {
  it("keeps rows still and categories draggable under A–Z", () => {
    const { container } = setup({ sort: "alpha" });

    expect(rowOf(container, "c-gen")).toBeNull();
    expect(
      container.querySelector('[data-reorder-category="cat-exec"]'),
    ).not.toBeNull();
    expect(screen.getByText("Archive")).toBeInTheDocument();
  });

  it("drags rows again under Chapter order", () => {
    const { container } = setup({ sort: "chapter" });

    expect(rowOf(container, "c-gen")).not.toBeNull();
  });
});
