import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageReminderMenu } from "./message-reminder-menu";

afterEach(() => {
  vi.useRealTimers();
});

const open = async () =>
  userEvent.click(screen.getByRole("button", { name: "Remind me about this" }));

describe("MessageReminderMenu (#4957)", () => {
  it("lists Slack's five presets, then Custom…", async () => {
    render(<MessageReminderMenu onRemind={vi.fn()} />);
    await open();

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "In 20 minutes",
      "In 1 hour",
      "In 3 hours",
      "Tomorrow",
      "Next week",
      "Custom…",
    ]);
  });

  it("hands on a preset's time", async () => {
    const onRemind = vi.fn();
    render(<MessageReminderMenu onRemind={onRemind} />);
    await open();
    const before = Date.now();

    await userEvent.click(
      await screen.findByRole("menuitem", { name: "In 20 minutes" }),
    );

    const at = onRemind.mock.calls[0]![0] as Date;
    expect(at.getTime() - before).toBeGreaterThanOrEqual(20 * 60_000 - 1000);
    expect(at.getTime() - before).toBeLessThanOrEqual(20 * 60_000 + 5000);
  });

  it("Custom… picks a day and a time, tomorrow at 9:00 AM to start", async () => {
    const onRemind = vi.fn();
    render(<MessageReminderMenu onRemind={onRemind} />);
    await open();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Custom…" }),
    );

    const time = await screen.findByLabelText("Time");
    expect(time).toHaveValue("09:00");
    await userEvent.clear(time);
    await userEvent.type(time, "17:30");
    await userEvent.click(screen.getByRole("button", { name: "Set reminder" }));

    const at = onRemind.mock.calls[0]![0] as Date;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(at.getDate()).toBe(tomorrow.getDate());
    expect(at.getHours()).toBe(17);
    expect(at.getMinutes()).toBe(30);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refuses a time that has passed", async () => {
    const onRemind = vi.fn();
    render(<MessageReminderMenu onRemind={onRemind} />);
    await open();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Custom…" }),
    );

    const day = await screen.findByLabelText("Day");
    await userEvent.clear(day);
    await userEvent.type(day, "yesterday");
    await userEvent.click(screen.getByRole("button", { name: "Set reminder" }));

    expect(onRemind).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/That time has already passed/),
    ).toBeInTheDocument();
  });
});
