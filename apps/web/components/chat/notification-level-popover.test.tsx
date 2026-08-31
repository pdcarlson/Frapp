import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { NotificationLevelPopover } from "./notification-level-popover";

/**
 * The mute control in the channel header (#296).
 *
 * The behaviours pinned here are the ones a reskin or refactor would silently
 * break: that the muted state is announced rather than only drawn, that
 * re-picking the current level does not fire a pointless write, and that the
 * three options stay the schema's three levels.
 */
describe("NotificationLevelPopover", () => {
  it("announces the muted state to assistive tech, not just visually", async () => {
    render(<NotificationLevelPopover level="off" onChange={vi.fn()} />);

    // A screen reader user must learn the channel is muted without opening the
    // popover — the visible "Muted" text alone would leave the trigger's
    // accessible name generic.
    expect(
      screen.getByRole("button", { name: /notifications: muted/i }),
    ).toBeInTheDocument();
  });

  it("names the current level when not muted", () => {
    render(<NotificationLevelPopover level="all" onChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /notifications: every message/i }),
    ).toBeInTheDocument();
  });

  it("offers exactly the three levels the schema allows", async () => {
    const user = userEvent.setup();
    render(<NotificationLevelPopover level="mentions" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button"));

    // Scoped to the popover: the trigger's accessible name deliberately
    // restates the current level, so an unscoped query matches it too.
    const panel = within(screen.getByRole("dialog"));

    // `chat_notification_preferences.level` is CHECK-constrained to these
    // three; a fourth option here would 500 on write rather than fail visibly.
    expect(panel.getAllByRole("button")).toHaveLength(3);
    expect(
      panel.getByRole("button", { name: /every message/i }),
    ).toBeInTheDocument();
    expect(
      panel.getByRole("button", { name: /only @mentions/i }),
    ).toBeInTheDocument();
    expect(panel.getByRole("button", { name: /^mute/i })).toBeInTheDocument();
  });

  it("writes the picked level", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotificationLevelPopover level="mentions" onChange={onChange} />);

    await user.click(screen.getByRole("button"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^mute/i,
      }),
    );

    expect(onChange).toHaveBeenCalledWith("off");
  });

  it("does not write when the already-selected level is picked again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotificationLevelPopover level="off" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^mute/i,
      }),
    );

    // A no-op round trip would still bump `updated_at` for nothing.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is disabled when no channel is active", () => {
    render(
      <NotificationLevelPopover level="mentions" onChange={vi.fn()} disabled />,
    );
    // components.md §5 bans dead-end controls: with no channel selected there
    // is nothing to mute, so the control says so rather than silently no-oping.
    expect(screen.getByRole("button")).toBeDisabled();
  });

  /**
   * A write that fails must say so. Before this the popover closed on click,
   * so a rejected PUT dismissed the menu exactly as a successful one did and
   * the member walked away believing a setting had been saved that had not.
   */
  it("surfaces a failed save instead of closing silently", async () => {
    const user = userEvent.setup();
    render(
      <NotificationLevelPopover level="mentions" onChange={vi.fn()} hasError />,
    );

    await user.click(screen.getByRole("button", { name: /notifications:/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not save/i);
  });

  it("says nothing about errors when the save succeeded", async () => {
    const user = userEvent.setup();
    render(<NotificationLevelPopover level="mentions" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /notifications:/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * The popover stays open while the write is in flight, so the error has
   * somewhere to land. Closing is driven by the save completing, not by the
   * click — see the effect in the component.
   */
  it("keeps the menu open while a write is in flight", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <NotificationLevelPopover
        level="mentions"
        onChange={onChange}
        isSaving
      />,
    );

    await user.click(screen.getByRole("button", { name: /notifications:/i }));
    const menu = screen.getByRole("button", { name: /every message/i });
    expect(menu).toBeInTheDocument();
  });

  /**
   * The commit that introduced close-on-save shipped without pinning it: the
   * three tests added alongside it all passed with the component reverted to
   * closing on click. These two are the actual pins.
   */
  it("stays open until a controlled save completes, then closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <NotificationLevelPopover
        level="mentions"
        onChange={onChange}
        isSaving={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /notifications:/i }));
    await user.click(screen.getByRole("button", { name: /mute/i }));
    expect(onChange).toHaveBeenCalledWith("off");

    // Still open while the write is in flight — this is what gives a failure
    // somewhere to render.
    rerender(
      <NotificationLevelPopover
        level="mentions"
        onChange={onChange}
        isSaving={true}
      />,
    );
    expect(
      screen.getByRole("button", { name: /every message/i }),
    ).toBeInTheDocument();

    // Save lands with no error -> dismisses.
    rerender(
      <NotificationLevelPopover
        level="off"
        onChange={onChange}
        isSaving={false}
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /every message/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the menu open when the completed save failed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <NotificationLevelPopover
        level="mentions"
        onChange={onChange}
        isSaving={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /notifications:/i }));
    await user.click(screen.getByRole("button", { name: /mute/i }));

    rerender(
      <NotificationLevelPopover
        level="mentions"
        onChange={onChange}
        isSaving={true}
      />,
    );
    rerender(
      <NotificationLevelPopover
        level="mentions"
        onChange={onChange}
        isSaving={false}
        hasError
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/could not save/i);
    expect(
      screen.getByRole("button", { name: /every message/i }),
    ).toBeInTheDocument();
  });

  /**
   * `isSaving` is optional. Without it there is no in-flight transition for the
   * effect to close on, so the click must dismiss directly — otherwise such a
   * consumer gets a menu that never goes away.
   */
  it("dismisses immediately for a consumer that does not wire isSaving", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotificationLevelPopover level="mentions" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /notifications:/i }));
    await user.click(screen.getByRole("button", { name: /mute/i }));

    expect(onChange).toHaveBeenCalledWith("off");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /every message/i }),
      ).not.toBeInTheDocument(),
    );
  });
});
