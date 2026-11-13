import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChannelRowMenu, type ChannelRowActions } from "./channel-row-menu";

function actions(over: Partial<ChannelRowActions> = {}): ChannelRowActions {
  return {
    permissions: [],
    onMarkRead: vi.fn(),
    notificationLevelFor: () => "mentions",
    onSetNotificationLevel: vi.fn(),
    onCopyLink: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
}

function renderRow(props: Partial<Parameters<typeof ChannelRowMenu>[0]> = {}) {
  return render(
    <ul>
      <ChannelRowMenu
        channel={{ id: "c-gen", type: "PUBLIC", name: "general" }}
        unread={false}
        pinned={false}
        onTogglePin={vi.fn()}
        onHide={undefined}
        actions={actions()}
        {...props}
      >
        <li>
          <button type="button">general</button>
        </li>
      </ChannelRowMenu>
    </ul>,
  );
}

async function open(): Promise<string[]> {
  fireEvent.contextMenu(screen.getByRole("button", { name: "general" }));
  const items = await screen.findAllByRole("menuitem");
  return items.map((i) => i.textContent ?? "");
}

describe("ChannelRowMenu", () => {
  it("gives a member their own actions only", async () => {
    renderRow();
    expect(await open()).toEqual([
      "Pin to top",
      "NotificationsMentions",
      "Copy link",
    ]);
  });

  it("draws chat's pin, solid once the channel is pinned (#4292)", async () => {
    renderRow({ pinned: true });
    await open();
    const item = screen.getByRole("menuitem", { name: "Unpin from top" });
    expect(item.querySelector("svg path")).toHaveAttribute("fill-opacity", "1");
  });

  it("adds Mark as read on an unread row", async () => {
    const markRead = vi.fn();
    renderRow({ unread: true, actions: actions({ onMarkRead: markRead }) });
    expect((await open())[0]).toBe("Mark as read");
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
    expect(markRead).toHaveBeenCalledWith("c-gen");
  });

  it("adds Edit and Delete for channels:manage, Delete last and destructive", async () => {
    const onDelete = vi.fn();
    renderRow({
      actions: actions({ permissions: ["channels:manage"], onDelete }),
    });
    const labels = await open();
    expect(labels.slice(-2)).toEqual(["Edit channel", "Delete channel"]);
    expect(screen.getByRole("separator")).toBeInTheDocument();
    const del = screen.getByRole("menuitem", { name: "Delete channel" });
    expect(del.className).toMatch(/text-destructive-text/);
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith("c-gen");
  });

  it("sets a level from the Notifications submenu, with the current one checked", async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    renderRow({ actions: actions({ onSetNotificationLevel: onSet }) });
    await open();
    await user.click(screen.getByRole("menuitem", { name: /Notifications/ }));
    const radios = await screen.findAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Every message",
      "Only @mentions",
      "Mute",
    ]);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    // The checked level again writes nothing: Radix still calls back, and a
    // write would pin an explicit level over the channel's default.
    fireEvent.click(radios[1]!);
    expect(onSet).not.toHaveBeenCalled();

    await open();
    await user.click(screen.getByRole("menuitem", { name: /Notifications/ }));
    const again = await screen.findAllByRole("menuitemradio");
    fireEvent.click(again[2]!);
    expect(onSet).toHaveBeenCalledWith("c-gen", "off");
  });

  it("marks the checked level as your default when Chat messages set it (#4124)", async () => {
    const user = userEvent.setup();
    renderRow({
      actions: actions({ notificationFromChapterLevel: () => true }),
    });
    await open();
    await user.click(screen.getByRole("menuitem", { name: /Notifications/ }));
    const radios = await screen.findAllByRole("menuitemradio");
    expect(radios[1]).toHaveTextContent("Only @mentions (your default)");
    expect(radios[0]).not.toHaveTextContent("your default");
  });

  it("locks Notifications while the level is unknown", async () => {
    renderRow({ actions: actions({ notificationLevelFor: () => undefined }) });
    await open();
    expect(
      screen.getByRole("menuitem", { name: /Notifications/ }),
    ).toHaveAttribute("data-disabled");
  });

  it("opens nothing when the row has no action at all", () => {
    renderRow({ pinned: null, actions: undefined });
    fireEvent.contextMenu(screen.getByRole("button", { name: "general" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
