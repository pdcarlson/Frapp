import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionMenuButton } from "./row-menu";

describe("ActionMenuButton", () => {
  it("shows the same entries from an always-visible header ⋯", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ActionMenuButton
        label="More for Chapter Meeting"
        entries={[{ type: "item", key: "dup", label: "Duplicate", onSelect }]}
      />,
    );
    const button = screen.getByRole("button", {
      name: "More for Chapter Meeting",
    });
    expect(button.className).not.toMatch(/\bopacity-0\b/);
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onSelect).toHaveBeenCalled();
  });

  it("draws a link item as a link, opening an outside page in a new tab", async () => {
    const user = userEvent.setup();
    render(
      <ActionMenuButton
        label="More for Chapter Meeting"
        entries={[
          { type: "item", key: "tasks", label: "Open Tasks", href: "/tasks" },
          {
            type: "item",
            key: "gcal",
            label: "Open Google Calendar",
            href: "https://calendar.google.com",
            external: true,
          },
        ]}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "More for Chapter Meeting" }),
    );
    const tasks = await screen.findByRole("menuitem", { name: "Open Tasks" });
    expect(tasks).toHaveAttribute("href", "/tasks");
    expect(tasks).not.toHaveAttribute("target");
    const gcal = screen.getByRole("menuitem", { name: "Open Google Calendar" });
    expect(gcal).toHaveAttribute("href", "https://calendar.google.com");
    expect(gcal).toHaveAttribute("target", "_blank");
    expect(gcal).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("can be switched off, or show a spinner while an action runs", () => {
    const entries = [
      { type: "item" as const, key: "x", label: "Remove", onSelect: vi.fn() },
    ];
    const { rerender } = render(
      <ActionMenuButton label="More for Jane" entries={entries} disabled />,
    );
    expect(
      screen.getByRole("button", { name: "More for Jane" }),
    ).toBeDisabled();
    rerender(<ActionMenuButton label="More for Jane" entries={entries} busy />);
    const button = screen.getByRole("button", { name: "More for Jane" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("says when the menu opens", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ActionMenuButton
        label="More for Subscription link"
        onOpenChange={onOpenChange}
        entries={[
          { type: "item", key: "r", label: "Reset", onSelect: vi.fn() },
        ]}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "More for Subscription link" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
