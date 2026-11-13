import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  mine: { excuse: null, receiver: null } as unknown,
  own: { attendance: null } as unknown,
  list: [] as unknown[],
  send: vi.fn(),
  withdraw: vi.fn(),
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
  state.toast.mockReset();
  state.now = new Date(2026, 10, 12, 12, 0).getTime();
});

describe("MyExcuse", () => {
  it("sends one trimmed line from Can't make it", async () => {
    const user = userEvent.setup();
    renderMine();
    await user.click(screen.getByRole("button", { name: "Can't make it" }));
    await user.type(screen.getByRole("textbox"), "  Away game ");
    await user.click(screen.getByRole("button", { name: "Send excuse" }));
    expect(state.send).toHaveBeenCalledWith({
      eventId: "e1",
      reason: "Away game",
    });
  });

  it("opens the line on arrival when the chat card asked (#4660)", () => {
    renderMine(true, 1);
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Can't make it" })).toBeNull();
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
    expect(screen.queryByRole("button", { name: "Can't make it" })).toBeNull();
  });

  it("says who a pending excuse went to, and withdraws it", async () => {
    const user = userEvent.setup();
    state.mine = {
      excuse: excuse("PENDING"),
      receiver: { user_id: "u-jake", display_name: "Jake" },
    };
    renderMine();
    expect(screen.getByText("Excuse sent to Jake")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Withdraw excuse" }));
    expect(state.withdraw).toHaveBeenCalledWith({ eventId: "e1" });
  });

  it("names no one when the excuse goes to the officers", () => {
    state.mine = { excuse: excuse("PENDING"), receiver: null };
    renderMine();
    expect(screen.getByText("Excuse sent to the officers")).toBeInTheDocument();
  });

  it("says a declined excuse wasn't accepted, with no Withdraw", () => {
    state.mine = { excuse: excuse("DECLINED"), receiver: null };
    renderMine();
    expect(screen.getByText("Excuse not accepted")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Withdraw excuse" }),
    ).toBeNull();
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
      .map((item) => item.querySelector("p")?.textContent);
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
