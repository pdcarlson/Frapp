import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { NotificationLevelPanel } from "./notification-level-popover";

/**
 * The per-channel notification level (#296), rendered as the "Notifications"
 * view of the channel overflow menu — so it is rendered directly here, with no
 * trigger to click: the Popover and its trigger belong to `channel-menu.tsx`.
 *
 * The behaviours pinned here are the ones a reskin or refactor would silently
 * break: that the current level is stated rather than only drawn, that
 * re-picking the current level does not fire a pointless write, and that the
 * three options stay the schema's three levels.
 */
describe("NotificationLevelPanel", () => {
  it("states the muted level in words, not just as a highlighted row", () => {
    render(<NotificationLevelPanel level="off" onChange={vi.fn()} />);

    // The trigger this panel replaced named the level in its accessible name,
    // so a screen reader user learned the channel was muted without opening
    // anything. With the trigger gone that has to be real copy: the selected
    // row's styling alone would leave the state purely visual.
    expect(screen.getByText(/notifications: muted/i)).toBeInTheDocument();
  });

  it("names the current level when not muted", () => {
    render(<NotificationLevelPanel level="all" onChange={vi.fn()} />);
    expect(
      screen.getByText(/notifications: every message/i),
    ).toBeInTheDocument();
  });

  it("offers exactly the three levels the schema allows", () => {
    render(<NotificationLevelPanel level="mentions" onChange={vi.fn()} />);

    // `chat_notification_preferences.level` is CHECK-constrained to these
    // three; a fourth option here would 500 on write rather than fail visibly.
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: /every message/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /only @mentions/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^mute/i })).toBeInTheDocument();
  });

  it("writes the picked level", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotificationLevelPanel level="mentions" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /^mute/i }));

    expect(onChange).toHaveBeenCalledWith("off");
  });

  it("does not write when the already-selected level is picked again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotificationLevelPanel level="off" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /^mute/i }));

    // A no-op round trip would still bump `updated_at` for nothing.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses interaction when no channel is active", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <NotificationLevelPanel level="mentions" onChange={onChange} disabled />,
    );

    // components.md §5 bans dead-end controls: with no channel selected there
    // is nothing to mute, so every option says so rather than silently
    // no-oping.
    for (const option of screen.getAllByRole("button")) {
      expect(option).toBeDisabled();
    }
    await user.click(screen.getByRole("button", { name: /^mute/i }));
    expect(onChange).not.toHaveBeenCalled();
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
    render(<NotificationLevelPanel level={null} onChange={onChange} />);

    expect(
      screen.getByText(/notification level unavailable/i),
    ).toBeInTheDocument();

    // Critically: it does NOT claim "only @mentions", or any other level. No
    // row is marked current, and none of them can be picked while the real
    // level is unknown.
    for (const option of screen.getAllByRole("button")) {
      expect(option).not.toHaveAttribute("aria-current");
      expect(option).toBeDisabled();
    }

    await user.click(screen.getByRole("button", { name: /only @mentions/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
