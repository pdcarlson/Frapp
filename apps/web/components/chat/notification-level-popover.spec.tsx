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
   * Dismissal is unconditional. An earlier revision kept the menu open until
   * the write landed so a failure could render inside it; that made closing
   * depend on an `isPending` transition, which never arrives when TanStack
   * pauses the mutation offline — the menu froze with every option disabled.
   * The failure is reported in the channel header instead.
   */
  it("closes as soon as a level is picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <NotificationLevelPopover
        level="mentions"
        onChange={onChange}
        isSaving={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /notifications:/i }));
    await user.click(screen.getByRole("button", { name: /mute/i }));

    expect(onChange).toHaveBeenCalledWith("off");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /every message/i }),
      ).not.toBeInTheDocument(),
    );
  });

  /**
   * An unknown level must not be reported as a real one. The server sends an
   * entry for every readable channel, so a missing entry means the read has
   * not landed — and a `mentions` stand-in would state a level, which on
   * `#announcements` (`all`) or `#chapter-audit` (`off`) is exactly the wrong
   * one. This is the defect the whole change exists to remove, so it must not
   * come back through the loading path.
   */
  it("reports no level, and refuses interaction, when the level is unknown", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotificationLevelPopover level={null} onChange={onChange} />);

    const trigger = screen.getByRole("button", {
      name: /notification level unavailable/i,
    });
    expect(trigger).toBeDisabled();
    // Critically: it does NOT claim "only @mentions".
    expect(
      screen.queryByRole("button", { name: /only @mentions/i }),
    ).not.toBeInTheDocument();

    await user.click(trigger);
    expect(
      screen.queryByRole("button", { name: /every message/i }),
    ).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
