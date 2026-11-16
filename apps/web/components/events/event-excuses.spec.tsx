import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  mine: { excuse: null, receiver: null } as unknown,
  own: { attendance: null } as unknown,
  list: [] as unknown[],
  send: vi.fn(),
  withdraw: vi.fn(),
  edit: vi.fn(),
  decide: vi.fn(),
  toast: vi.fn(),
  now: 0,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  // The view rule stays real; only the data hooks are stubbed.
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyEventExcuse: () => ({
    data: state.mine,
    isPending: false,
    fetchStatus: "idle",
  }),
  useMyAttendance: () => ({
    data: state.own,
    isPending: false,
    fetchStatus: "idle",
  }),
  useEventExcuses: () => ({ data: state.list }),
  useSendEventExcuse: () => ({ mutateAsync: state.send, isPending: false }),
  useWithdrawEventExcuse: () => ({
    mutateAsync: state.withdraw,
    isPending: false,
  }),
  useDecideEventExcuse: () => ({ mutateAsync: state.decide, isPending: false }),
  useEditEventExcuse: () => ({ mutateAsync: state.edit, isPending: false }),
  useNow: () => state.now,
}));

vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => ({
    controlProps: (disabled: boolean) => ({ disabled }),
  }),
  SubscriptionNotice: () => null,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

import { ExcuseReview, MyExcuse } from "./event-excuses";

const start = new Date(2026, 10, 15, 19, 0);
const end = new Date(2026, 10, 15, 20, 0);

const excuse = (status: string, extra: Record<string, unknown> = {}) => ({
  id: `x-${status}`,
  chapter_id: "c",
  event_id: "e1",
  user_id: "u-me",
  reason: "Exam review",
  status,
  decided_by: null,
  decided_at: null,
  created_at: "2026-11-12T12:00:00Z",
  updated_at: "2026-11-12T12:00:00Z",
  ...extra,
});

function mine(required = true, writeAsk = 0) {
  return (
    <MyExcuse
      eventId="e1"
      required={required}
      start={start.toISOString()}
      end={end.toISOString()}
      opensMinutes={15}
      writeAsk={writeAsk}
    />
  );
}

function renderMine(required = true, writeAsk = 0) {
  return render(mine(required, writeAsk));
}

beforeEach(() => {
  state.mine = { excuse: null, receiver: null };
  state.own = { attendance: null };
  state.list = [];
  state.send.mockReset().mockResolvedValue({});
  state.withdraw.mockReset().mockResolvedValue(null);
  state.decide.mockReset().mockResolvedValue({});
  state.edit.mockReset().mockResolvedValue({});
  state.toast.mockReset();
  state.now = new Date(2026, 10, 12, 12, 0).getTime();
});

describe("MyExcuse", () => {
  it("sends one trimmed line from Can't make it", async () => {
    const user = userEvent.setup();
    renderMine();
    await user.click(screen.getByRole("button", { name: "Can't make it?" }));
    await user.type(screen.getByRole("textbox"), "  Away game ");
    await user.click(screen.getByRole("button", { name: "Send excuse" }));
    expect(state.send).toHaveBeenCalledWith({
      eventId: "e1",
      reason: "Away game",
    });
  });

  it("offers it as a quiet underlined link, 44px to a finger (#4933)", () => {
    renderMine();
    const link = screen.getByRole("button", { name: "Can't make it?" });
    expect(link.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "underline",
        "text-muted-foreground",
        "pointer-coarse:min-h-11",
        "justify-self-center",
      ]),
    );
    expect(link.closest("section")).toBeNull();
  });

  it("opens the line on arrival when the chat card asked (#4660)", () => {
    renderMine(true, 1);
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Can't make it/ })).toBeNull();
  });

  it("opens it again for a new ask while already showing (#4660)", async () => {
    const user = userEvent.setup();
    const { rerender } = renderMine(true, 1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    rerender(mine(true, 2));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("offers nothing on an event that doesn't require the viewer", () => {
    renderMine(false);
    expect(screen.queryByRole("button", { name: /^Can't make it/ })).toBeNull();
  });

  it("says who a pending excuse went to, and withdraws it", async () => {
    const user = userEvent.setup();
    state.mine = {
      excuse: excuse("PENDING"),
      receiver: { user_id: "u-jake", display_name: "Jake" },
    };
    renderMine();
    expect(screen.getByText("Your excuse · Sent to Jake")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Withdraw excuse" }));
    expect(state.withdraw).toHaveBeenCalledWith({ eventId: "e1" });
  });

  it("opens the viewer's own row to the whole reason", async () => {
    const user = userEvent.setup();
    state.mine = { excuse: excuse("APPROVED"), receiver: null };
    renderMine();
    const row = screen.getByRole("button", { name: /^Excused: / });
    expect(row).toHaveClass("truncate");
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row).not.toHaveClass("truncate");
  });

  it("names no one when the excuse goes to the officers", () => {
    state.mine = { excuse: excuse("PENDING"), receiver: null };
    renderMine();
    expect(
      screen.getByText("Your excuse · Sent to the officers"),
    ).toBeInTheDocument();
  });

  it("says a declined excuse wasn't accepted, and sends it again from Edit", async () => {
    const user = userEvent.setup();
    state.mine = { excuse: excuse("DECLINED"), receiver: null };
    renderMine();
    expect(screen.getByText("Declined")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.queryByRole("button", { name: "Withdraw excuse" }),
    ).toBeNull();
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Family emergency");
    await user.click(screen.getByRole("button", { name: "Send excuse again" }));
    expect(state.edit).toHaveBeenCalledWith({
      eventId: "e1",
      reason: "Family emergency",
    });
  });

  it("edits a pending excuse in place, saving only a change (#5115)", async () => {
    const user = userEvent.setup();
    state.mine = { excuse: excuse("PENDING"), receiver: null };
    renderMine();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("Exam review");
    expect(screen.getByRole("button", { name: "Save excuse" })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), " at noon");
    await user.click(screen.getByRole("button", { name: "Save excuse" }));
    expect(state.edit).toHaveBeenCalledWith({
      eventId: "e1",
      reason: "Exam review at noon",
    });
  });

  it("offers Withdraw, not Edit, on an approved excuse", () => {
    state.mine = { excuse: excuse("APPROVED"), receiver: null };
    renderMine();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Withdraw excuse" }),
    ).toBeInTheDocument();
  });
});

describe("ExcuseReview", () => {
  it("draws nothing until someone sends an excuse", () => {
    const { container } = render(
      <ExcuseReview eventId="e1" viewerId="u-officer" canUpdateEvents />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the creator's own excuse without Approve or Decline", () => {
    state.list = [excuse("PENDING", { display_name: "Me" })];
    render(
      <ExcuseReview eventId="e1" viewerId="u-me" canUpdateEvents={false} />,
    );
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getByText("Excuses")).toBeInTheDocument();
  });

  it("opens a row to the whole reason and closes it again", async () => {
    const user = userEvent.setup();
    state.list = [excuse("PENDING", { user_id: "u-sam", display_name: "Sam" })];
    render(<ExcuseReview eventId="e1" viewerId="u-officer" canUpdateEvents />);
    const row = screen.getByRole("button", { name: /^Sam: / });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row).toHaveClass("truncate");
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row).not.toHaveClass("truncate");
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("lists pending excuses first and decides one", async () => {
    const user = userEvent.setup();
    state.list = [
      excuse("APPROVED", { user_id: "u-ana", display_name: "Ana" }),
      excuse("PENDING", { user_id: "u-sam", display_name: "Sam" }),
    ];
    render(<ExcuseReview eventId="e1" viewerId="u-officer" canUpdateEvents />);
    expect(
      screen.getByText("Excuses · 1 to decide · 1 excused"),
    ).toBeInTheDocument();
    const names = screen
      .getAllByRole("listitem")
      .map((item) => item.querySelector("span")?.textContent);
    expect(names).toEqual(["Sam", "Ana"]);
    await user.click(
      screen.getByRole("button", { name: "Decline Sam's excuse" }),
    );
    expect(state.decide).toHaveBeenCalledWith({
      eventId: "e1",
      userId: "u-sam",
      decision: "DECLINED",
    });
  });
});
