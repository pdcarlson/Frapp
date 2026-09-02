import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  ChannelList,
  badgeLabel,
  unreadAnnouncement,
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
) {
  return render(
    <ChannelList
      channels={channels}
      activeChannelId={null}
      viewerId={VIEWER}
      memberNames={NAMES}
      unreadByChannelId={unreadByChannelId}
      onPick={vi.fn()}
    />,
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
    expect(unreadAnnouncement({ unreadCount: 3, mentionCount: 0 }, true)).toBe(
      "3 unread direct messages",
    );
    expect(unreadAnnouncement({ unreadCount: 3, mentionCount: 0 }, false)).toBe(
      "3 unread messages",
    );
  });
});

describe("ChannelList unread badges", () => {
  it("shows the neutral badge with the unread count on a plain unread channel", () => {
    renderList(
      [general],
      new Map([["c-gen", { unreadCount: 4, mentionCount: 0 }]]),
    );

    const badge = screen.getByText("4");
    expect(badge).toBeInTheDocument();
  });

  it("shows the mention badge, not the raw total, when the channel has an @-mention", () => {
    renderList(
      [general],
      new Map([["c-gen", { unreadCount: 9, mentionCount: 1 }]]),
    );

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
