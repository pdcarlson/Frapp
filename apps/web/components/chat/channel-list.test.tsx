import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ChannelList, type ChatChannel } from "./channel-list";

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

function renderList(channels: ChatChannel[]) {
  return render(
    <ChannelList
      channels={channels}
      activeChannelId={null}
      viewerId={VIEWER}
      memberNames={NAMES}
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
