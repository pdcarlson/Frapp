import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  ChannelList,
  badgeLabel,
  unreadAnnouncement,
  type ChannelCategory,
  type ChatChannel,
  type ChannelUnread,
} from "./channel-list";

/**
 * Before display-name resolution landed, this sidebar rendered a DM channel's
 * stored name verbatim — `dm-<uuidA>-<uuidB>` — and filtered on it, so typing a
 * name the row visibly showed matched nothing.
 */
const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DM_NAME = `dm-${VIEWER}-${OTHER}`;

const NAMES = { [VIEWER]: "Viewer Self", [OTHER]: "Alice Chen" };

const dm: ChatChannel = {
  id: "c-dm",
  name: DM_NAME,
  type: "DM",
  member_ids: [VIEWER, OTHER],
};
const general: ChatChannel = { id: "c-gen", name: "general", type: "PUBLIC" };

function renderList(
  channels: ChatChannel[],
  unreadByChannelId?: Map<string, ChannelUnread>,
  categories?: ChannelCategory[],
) {
  return render(
    <ChannelList
      channels={channels}
      activeChannelId={null}
      viewerId={VIEWER}
      memberNames={NAMES}
      unreadByChannelId={unreadByChannelId}
      categories={categories}
      onPick={vi.fn()}
    />,
  );
}

/**
 * Section headers, in DOM order.
 *
 * Read off the rendered rail rather than asserted one at a time, because the
 * *order* of the groups is half of what these tests are about — an assertion
 * per header would pass on a rail that rendered them backwards.
 */
function sectionLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("p.uppercase")).map(
    (node) => node.textContent ?? "",
  );
}

/** Row titles under one section header, in DOM order. */
function channelsUnder(container: HTMLElement, label: string): string[] {
  const header = Array.from(container.querySelectorAll("p.uppercase")).find(
    (node) => node.textContent === label,
  );
  if (!header) return [];
  const list = header.parentElement?.querySelector("ul");
  return Array.from(list?.querySelectorAll("li") ?? []).map((li) =>
    li.querySelector("span.truncate")?.textContent ?? "",
  );
}

describe("ChannelList display names", () => {
  it("shows the other participant instead of the stored uuid name", () => {
    renderList([general, dm]);

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText(DM_NAME)).not.toBeInTheDocument();
  });

  it("never renders the viewer's own name as the DM title", () => {
    renderList([dm]);

    expect(screen.queryByText("Viewer Self")).not.toBeInTheDocument();
  });

  it("searches the name the member can see, not the stored one", async () => {
    const user = userEvent.setup();
    renderList([general, dm]);

    await user.type(screen.getByLabelText("Search channels"), "alice");

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText("general")).not.toBeInTheDocument();
  });

  it("leaves a non-direct channel's name alone", () => {
    renderList([general]);

    expect(screen.getByText("general")).toBeInTheDocument();
  });
});

describe("ChannelList category grouping", () => {
  // Deliberately NOT alphabetical, and deliberately not the order a naive
  // `Object.keys` or a sort-by-name would produce: "Executive" before
  // "Committees" is the server's `display_order`, and reproducing it is the
  // whole of AC 4. A client-side sort by name would fail this test, which is
  // the point.
  const CATEGORIES: ChannelCategory[] = [
    { id: "cat-exec", name: "Executive" },
    { id: "cat-comm", name: "Committees" },
  ];

  const exec: ChatChannel = {
    id: "c-exec",
    name: "exec-board",
    type: "PRIVATE",
    category_id: "cat-exec",
  };
  const philanthropy: ChatChannel = {
    id: "c-phil",
    name: "philanthropy",
    type: "PUBLIC",
    category_id: "cat-comm",
  };
  const audit: ChatChannel = {
    id: "c-audit",
    name: "chapter-audit",
    type: "PUBLIC",
  };

  it("nests each channel under its category header", () => {
    const { container } = renderList(
      [general, exec, philanthropy],
      undefined,
      CATEGORIES,
    );

    expect(channelsUnder(container, "Executive")).toEqual(["exec-board"]);
    expect(channelsUnder(container, "Committees")).toEqual(["philanthropy"]);
  });

  it("puts uncategorized channels in the default Channels group", () => {
    const { container } = renderList([general, exec], undefined, CATEGORIES);

    expect(channelsUnder(container, "Channels")).toEqual(["general"]);
  });

  it("renders categories in the API's order, not alphabetically", () => {
    const { container } = renderList(
      [general, exec, philanthropy],
      undefined,
      CATEGORIES,
    );

    expect(sectionLabels(container)).toEqual([
      "Channels",
      "Executive",
      "Committees",
    ]);
  });

  it("keeps DMs and system channels in their own sections, below the categories", () => {
    const { container } = renderList(
      [general, exec, dm, audit],
      undefined,
      CATEGORIES,
    );

    expect(sectionLabels(container)).toEqual([
      "Channels",
      "Executive",
      "Direct messages",
      "System",
    ]);
    expect(channelsUnder(container, "Direct messages")).toEqual(["Alice Chen"]);
    expect(channelsUnder(container, "System")).toEqual(["chapter-audit"]);
  });

  it("hides a category with no channels", () => {
    const { container } = renderList([general, exec], undefined, CATEGORIES);

    // "Committees" has no members here.
    expect(sectionLabels(container)).toEqual(["Channels", "Executive"]);
  });

  it("hides the Channels group when every channel is categorized", () => {
    const { container } = renderList([exec, philanthropy], undefined, CATEGORIES);

    expect(sectionLabels(container)).toEqual(["Executive", "Committees"]);
  });

  it("falls back to uncategorized for a category_id that is not in the list", () => {
    // Deleting a category tells the admin its channels "become uncategorized",
    // and a stale cache produces the same shape. Either way the row must still
    // render — dropping it would hide a channel the member can open.
    const orphan: ChatChannel = {
      id: "c-orphan",
      name: "old-committee",
      type: "PUBLIC",
      category_id: "cat-deleted",
    };
    const { container } = renderList([orphan], undefined, CATEGORIES);

    expect(channelsUnder(container, "Channels")).toEqual(["old-committee"]);
  });

  it("never lets a category pull a DM out of Direct messages", () => {
    // Type is tested before category, so this cannot happen — asserted because
    // the API does not forbid the column being set on a DM row.
    const categorizedDm: ChatChannel = { ...dm, category_id: "cat-exec" };
    const { container } = renderList([categorizedDm], undefined, CATEGORIES);

    expect(channelsUnder(container, "Direct messages")).toEqual(["Alice Chen"]);
    expect(sectionLabels(container)).toEqual(["Direct messages"]);
  });

  it("renders the pre-category layout when no categories are passed", () => {
    // The prop is optional; a caller that has not loaded categories must get
    // the single Channels group, not an empty rail.
    const { container } = renderList([general, exec, dm]);

    expect(sectionLabels(container)).toEqual(["Channels", "Direct messages"]);
    expect(channelsUnder(container, "Channels")).toEqual([
      "exec-board",
      "general",
    ]);
  });

  it("sorts by title inside a category, not by arrival order", () => {
    const zulu: ChatChannel = {
      id: "c-z",
      name: "zulu",
      type: "PUBLIC",
      category_id: "cat-exec",
    };
    const alpha: ChatChannel = {
      id: "c-a",
      name: "alpha",
      type: "PUBLIC",
      category_id: "cat-exec",
    };
    const { container } = renderList([zulu, alpha], undefined, CATEGORIES);

    expect(channelsUnder(container, "Executive")).toEqual(["alpha", "zulu"]);
  });

  it("drops a category header when the search filters out its last channel", async () => {
    const user = userEvent.setup();
    const { container } = renderList(
      [general, exec, philanthropy],
      undefined,
      CATEGORIES,
    );

    await user.type(screen.getByLabelText("Search channels"), "exec");

    // Filtering happens before grouping, so a category whose only match is
    // filtered out disappears along with its header.
    expect(sectionLabels(container)).toEqual(["Executive"]);
    expect(channelsUnder(container, "Executive")).toEqual(["exec-board"]);
  });
});

describe("badgeLabel", () => {
  it("shows the plain unread count with no @ when there is no mention", () => {
    expect(badgeLabel(3, 0)).toBe("3");
  });

  it("leads with @ and shows the mention count, not the total, when both are present", () => {
    expect(badgeLabel(12, 2)).toBe("@ 2");
  });

  it("caps at 99+", () => {
    expect(badgeLabel(140, 0)).toBe("99+");
    expect(badgeLabel(1, 100)).toBe("@ 99+");
  });
});

describe("unreadAnnouncement", () => {
  it("names both the mention count and the unread total when there is a mention", () => {
    expect(unreadAnnouncement({ unreadCount: 5, mentionCount: 2 })).toBe(
      "2 mentions, 5 unread",
    );
  });

  it("pluralizes a single mention correctly", () => {
    expect(unreadAnnouncement({ unreadCount: 1, mentionCount: 1 })).toBe(
      "1 mention, 1 unread",
    );
  });

  it("announces a direct message distinctly from a channel", () => {
    expect(
      unreadAnnouncement({ unreadCount: 3, mentionCount: 0 }, true),
    ).toBe("3 unread direct messages");
    expect(
      unreadAnnouncement({ unreadCount: 3, mentionCount: 0 }, false),
    ).toBe("3 unread messages");
  });
});

describe("ChannelList unread badges", () => {
  it("shows the neutral badge with the unread count on a plain unread channel", () => {
    renderList([general], new Map([["c-gen", { unreadCount: 4, mentionCount: 0 }]]));

    const badge = screen.getByText("4");
    expect(badge).toBeInTheDocument();
  });

  it("shows the mention badge, not the raw total, when the channel has an @-mention", () => {
    renderList([general], new Map([["c-gen", { unreadCount: 9, mentionCount: 1 }]]));

    expect(screen.getByText("@ 1")).toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("folds an unread DM into the mention-styled badge even with no @-mention", () => {
    // foundations.md §5: red means "you were addressed" — an @-mention *or* a
    // direct message — so a DM with plain unread still gets the mention
    // variant rather than the neutral one.
    renderList([dm], new Map([["c-dm", { unreadCount: 2, mentionCount: 0 }]]));

    const badge = screen.getByText("2");
    expect(badge).toHaveAttribute(
      "aria-label",
      unreadAnnouncement({ unreadCount: 2, mentionCount: 0 }, true),
    );
  });

  it("renders no badge for a channel absent from the map (read)", () => {
    renderList([general], new Map());

    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });

  it("renders no badges at all while counts are unknown (undefined map)", () => {
    // `undefined` means loading/errored, distinct from an empty map — the
    // rail must not assert "all caught up" on data it doesn't have.
    renderList([general], undefined);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // No numeric badge text should render either.
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});
