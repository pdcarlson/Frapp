import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  sendNow: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useScheduledMessages: () => ({ data: mocks.rows }),
    useSendScheduledMessageNow: () => ({
      mutate: mocks.sendNow,
      isPending: false,
    }),
    useDeleteScheduledMessage: () => ({
      mutate: mocks.remove,
      isPending: false,
    }),
    useUpdateScheduledMessage: () => ({
      mutate: mocks.update,
      isPending: false,
    }),
  };
});

const { ScheduleSendButton, ScheduledMessagesBar } =
  await import("./schedule-send");

const row = (over: Record<string, unknown> = {}) => ({
  id: "s-1",
  channel_id: "chan-1",
  content: "Chapter at 8",
  mention_picks: null,
  send_at: new Date(Date.now() + 86_400_000).toISOString(),
  status: "pending",
  failure_reason: null,
  created_at: "2026-11-13T20:00:00.000Z",
  updated_at: "2026-11-13T20:00:00.000Z",
  ...over,
});

beforeEach(() => {
  mocks.rows = [];
  mocks.sendNow.mockReset();
  mocks.remove.mockReset();
  mocks.update.mockReset();
});

describe("ScheduleSendButton (#4956)", () => {
  it("schedules for tomorrow at 9 from the menu", async () => {
    const onSchedule = vi.fn().mockResolvedValue(undefined);
    render(<ScheduleSendButton disabled={false} onSchedule={onSchedule} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Schedule message" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /^Tomorrow at/ }),
    );
    const at: Date = onSchedule.mock.calls[0][0];
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(0);
    expect(at.getTime()).toBeGreaterThan(Date.now());
  });

  it("is disabled with nothing to schedule", () => {
    render(<ScheduleSendButton disabled onSchedule={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Schedule message" }),
    ).toBeDisabled();
  });
});

describe("ScheduledMessagesBar (#4956)", () => {
  it("draws nothing when the member has nothing scheduled here", () => {
    const { container } = render(<ScheduledMessagesBar channelId="chan-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts them, says how many didn't send, and opens the list", async () => {
    mocks.rows = [
      row(),
      row({ id: "s-2", status: "failed", failure_reason: "no_access" }),
    ];
    render(<ScheduledMessagesBar channelId="chan-1" />);
    const bar = screen.getByRole("button", { name: /2 scheduled messages/ });
    expect(bar).toHaveTextContent("1 not sent");
    await userEvent.click(bar);
    expect(
      await screen.findByText("Not sent: you can no longer post here."),
    ).toBeInTheDocument();
    // A failed one is edited to go again; it offers no Send now.
    expect(screen.getAllByRole("button", { name: "Send now" })).toHaveLength(1);
  });

  it("sends one now and deletes one", async () => {
    mocks.rows = [row()];
    render(<ScheduledMessagesBar channelId="chan-1" />);
    await userEvent.click(screen.getByRole("button", { name: /1 scheduled/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Send now" }),
    );
    expect(mocks.sendNow).toHaveBeenCalledWith("s-1", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("s-1", expect.anything());
  });

  it("edits the text and keeps the time", async () => {
    const sendAt = new Date(Date.now() + 2 * 86_400_000);
    sendAt.setSeconds(0, 0);
    mocks.rows = [row({ send_at: sendAt.toISOString() })];
    render(<ScheduledMessagesBar channelId="chan-1" />);
    await userEvent.click(screen.getByRole("button", { name: /1 scheduled/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.clear(box);
    await userEvent.type(box, "Chapter at 9");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.update).toHaveBeenCalledWith(
      { id: "s-1", content: "Chapter at 9", sendAt },
      expect.anything(),
    );
  });
});
