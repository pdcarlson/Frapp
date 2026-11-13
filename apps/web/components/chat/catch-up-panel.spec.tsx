import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_CATCH_UP_COPY,
  chatCatchUpUnavailableLine,
  type ChatCatchUp,
  type ChatCatchUpPoint,
} from "@repo/validation";

/**
 * The summary panel's own rules (#3946): consent before the first request
 * leaves, the stretch it asks for, every honest state in plain words, and a
 * summary that ends when the member leaves the channel.
 */

const state = vi.hoisted(() => ({
  run: vi.fn(),
  reset: vi.fn(),
  current: null as unknown,
  consent: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useChatCatchUp: () => ({
    current: state.current,
    run: state.run,
    reset: state.reset,
  }),
}));

vi.mock("@/components/ai/report-ai", () => ({
  ReportAiButton: ({
    target,
  }: {
    target: { subject: string; subjectId: string; receipt?: string | null };
  }) => (
    <button
      data-testid="report"
      data-subject={target.subject}
      data-id={target.subjectId}
      data-receipt={target.receipt ?? ""}
    >
      Report this
    </button>
  ),
}));

vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({ ensureConsent: state.consent, consentDialog: null }),
}));

const { CATCH_UP_OPEN_ATTRIBUTE, CatchUpOffer, useCatchUpPanel } = await import(
  "./catch-up-panel"
);
type CatchUpScope = import("./catch-up-panel").CatchUpScope;

const CHANNEL = "channel-1";
const UNREAD = { count: 140, as_of: "2026-11-12T15:00:00.000Z" };
const CHANNEL_SCOPE: CatchUpScope = {
  kind: "channel",
  channelId: CHANNEL,
  channelName: "general",
  unread: UNREAD,
};

const SUMMARY: ChatCatchUp = {
  status: "summarized",
  reason: null,
  points: [],
  messages_read: 140,
  messages_total: 140,
  left_out_messages: 0,
  unverified_points: 0,
  covers_from: "2026-11-12T09:00:00.000Z",
  covers_to: "2026-11-12T15:00:00.000Z",
};

function point(fields: Partial<ChatCatchUpPoint>): ChatCatchUpPoint {
  return {
    kind: "topic",
    text: "A point.",
    message_id: "message-1",
    thread_root_id: null,
    author_id: "user-1",
    sent_at: "2026-11-12T10:00:00.000Z",
    quote: "a point",
    ...fields,
  };
}

function done(summary: Partial<ChatCatchUp>) {
  return {
    channelId: CHANNEL,
    target: { unread: UNREAD },
    phase: "done",
    summary: { ...SUMMARY, ...summary },
    failure: null,
  };
}

const onOpenPoint = vi.fn();

function Harness({
  activeChannelId = CHANNEL,
  scope = CHANNEL_SCOPE,
}: {
  activeChannelId?: string | null;
  scope?: CatchUpScope;
}) {
  const panel = useCatchUpPanel({
    activeChannelId,
    nameFor: (id) => (id === "user-1" ? "Sam Okafor" : null),
    onOpenPoint,
  });
  return (
    <main>
      <button type="button" onClick={() => panel.start(scope)}>
        open
      </button>
      {panel.element}
    </main>
  );
}

async function openPanel(props: Parameters<typeof Harness>[0] = {}) {
  const view = render(<Harness {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "open" }));
  return view;
}

describe("useCatchUpPanel", () => {
  beforeEach(() => {
    state.run.mockReset().mockResolvedValue(undefined);
    state.reset.mockReset();
    state.consent.mockReset().mockResolvedValue(true);
    state.current = null;
    onOpenPoint.mockReset();
    document.documentElement.removeAttribute(CATCH_UP_OPEN_ATTRIBUTE);
  });

  it("asks for the stretch that was new when the channel had one", async () => {
    await openPanel();
    expect(state.consent).toHaveBeenCalledTimes(1);
    expect(state.run).toHaveBeenCalledWith(CHANNEL, { unread: UNREAD });
    expect(
      screen.getByRole("complementary", { name: CHAT_CATCH_UP_COPY.name }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: CHAT_CATCH_UP_COPY.ranges.unread }),
    ).toBeChecked();
    expect(document.documentElement).toHaveAttribute(CATCH_UP_OPEN_ATTRIBUTE);
  });

  it("asks for the last 24 hours when nothing was new, and offers no new-messages range", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T16:00:00.000Z"));
    try {
      await openPanel({ scope: { ...CHANNEL_SCOPE, unread: null } });
      expect(state.run).toHaveBeenCalledWith(CHANNEL, {
        since: "2026-11-11T16:00:00.000Z",
      });
      expect(
        screen.queryByRole("radio", { name: CHAT_CATCH_UP_COPY.ranges.unread }),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks again when another range is picked", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T16:00:00.000Z"));
    try {
      await openPanel();
      await userEvent.click(
        screen.getByRole("radio", { name: CHAT_CATCH_UP_COPY.ranges.week }),
      );
      expect(state.run).toHaveBeenLastCalledWith(CHANNEL, {
        since: "2026-11-05T16:00:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for a thread by its first message, with no range to pick", async () => {
    await openPanel({
      scope: {
        kind: "thread",
        channelId: CHANNEL,
        channelName: "general",
        rootId: "root-1",
      },
    });
    expect(state.run).toHaveBeenCalledWith(CHANNEL, { thread_root_id: "root-1" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(
      screen.getByRole("heading", { name: CHAT_CATCH_UP_COPY.thread_title }),
    ).toBeInTheDocument();
  });

  it("sends nothing until the member has said yes, and offers the question", async () => {
    state.consent.mockResolvedValue(false);
    await openPanel();
    expect(state.run).not.toHaveBeenCalled();
    expect(
      screen.getByText(chatCatchUpUnavailableLine("consent_required")),
    ).toBeInTheDocument();

    state.consent.mockResolvedValue(true);
    await userEvent.click(
      screen.getByRole("button", { name: CHAT_CATCH_UP_COPY.consent_action }),
    );
    expect(state.run).toHaveBeenCalledWith(CHANNEL, { unread: UNREAD });
  });

  it("says it could not check when the consent read fails", async () => {
    state.consent.mockRejectedValue(new Error("offline"));
    await openPanel();
    expect(state.run).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: CHAT_CATCH_UP_COPY.try_again }),
    ).toBeInTheDocument();
  });

  it("says who it is for, and that it is not saved", async () => {
    await openPanel();
    expect(
      screen.getByText(`#general · ${CHAT_CATCH_UP_COPY.private}`),
    ).toBeInTheDocument();
  });

  it("shows the working line while the request is out", async () => {
    state.current = {
      channelId: CHANNEL,
      target: { unread: UNREAD },
      phase: "working",
      summary: null,
      failure: null,
    };
    await openPanel();
    expect(screen.getByText(CHAT_CATCH_UP_COPY.working)).toBeInTheDocument();
    // The range stays live: a disabled control would drop focus out of the
    // panel, and another pick replaces the request in flight.
    expect(
      screen.getByRole("radio", { name: CHAT_CATCH_UP_COPY.ranges.day }),
    ).toBeEnabled();
  });

  it("groups the points in the fixed order and opens a point's message", async () => {
    state.current = done({
      points: [
        point({ kind: "topic", text: "Formal venue is still open.", message_id: "m3" }),
        point({ kind: "for_you", text: "Sam asked you to bring the speaker.", message_id: "m1" }),
        point({ kind: "decision", text: "Dues are due Friday.", message_id: "m2" }),
        point({ kind: "vote", text: "A kind this build does not know.", message_id: "m4" }),
      ],
    });
    await openPanel();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      CHAT_CATCH_UP_COPY.groups.for_you,
      CHAT_CATCH_UP_COPY.groups.decision,
      CHAT_CATCH_UP_COPY.groups.topic,
    ]);
    expect(screen.getByText("A kind this build does not know.")).toBeInTheDocument();
    expect(screen.getByText("From 140 messages.")).toBeInTheDocument();
    // The author by name, and the time written out.
    expect(screen.getAllByText(/^Sam Okafor · /).length).toBe(4);

    await userEvent.click(
      screen.getByRole("button", { name: /Dues are due Friday\./ }),
    );
    expect(onOpenPoint).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: "m2" }),
    );
  });

  it("offers Report this on a summary that stands, with the server's receipt", async () => {
    state.current = done({
      points: [point({})],
      summary_id: "summary-1",
      report_receipt: "v1.sealed",
    });
    await openPanel();
    const report = screen.getByTestId("report");
    expect(report).toHaveAttribute("data-subject", "chat_summary");
    expect(report).toHaveAttribute("data-id", "summary-1");
    expect(report).toHaveAttribute("data-receipt", "v1.sealed");
  });

  it("offers no report where there is no summary to report", async () => {
    state.current = done({ status: "too_little", messages_read: 2 });
    await openPanel();
    expect(screen.queryByTestId("report")).toBeNull();
  });

  it("says what was left out and what could not be matched", async () => {
    state.current = done({
      points: [point({})],
      messages_read: 300,
      messages_total: 1200,
      left_out_messages: 4,
      unverified_points: 1,
    });
    await openPanel();
    expect(
      screen.getByText("From the most recent 300 of 1,200 messages."),
    ).toBeInTheDocument();
    expect(screen.getByText(CHAT_CATCH_UP_COPY.unverified)).toBeInTheDocument();
    expect(screen.getByText(/4 messages/)).toBeInTheDocument();
  });

  it.each([
    ["nothing_new", {}, CHAT_CATCH_UP_COPY.nothing_new],
    [
      "too_little",
      { messages_read: 2, left_out_messages: 9 },
      "Only 2 messages here can be summarized, which is too few to shorten.",
    ],
    ["not_found", {}, CHAT_CATCH_UP_COPY.not_found],
    ["refused", {}, CHAT_CATCH_UP_COPY.refused],
    [
      "unavailable",
      { reason: "member_limit" },
      CHAT_CATCH_UP_COPY.unavailable.member_limit,
    ],
    [
      "unavailable",
      { reason: "chat_off" },
      CHAT_CATCH_UP_COPY.unavailable.chat_off,
    ],
    // A status from a newer server reads as not available.
    ["later", {}, CHAT_CATCH_UP_COPY.unavailable.not_available],
  ] as const)("says %s in plain words", async (status, fields, line) => {
    state.current = done({ status, ...fields });
    await openPanel();
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("offers Try again after a failure, and asks again", async () => {
    state.current = {
      channelId: CHANNEL,
      target: { unread: UNREAD },
      phase: "failed",
      summary: null,
      failure: CHAT_CATCH_UP_COPY.failed,
    };
    await openPanel();
    expect(screen.getByText(CHAT_CATCH_UP_COPY.failed)).toBeInTheDocument();
    state.run.mockClear();
    await userEvent.click(
      screen.getByRole("button", { name: CHAT_CATCH_UP_COPY.try_again }),
    );
    expect(state.run).toHaveBeenCalledWith(CHANNEL, { unread: UNREAD });
  });

  it("never shows another channel's summary", async () => {
    state.current = { ...done({ points: [point({ text: "Elsewhere." })] }), channelId: "channel-2" };
    await openPanel();
    expect(screen.queryByText("Elsewhere.")).toBeNull();
  });

  it("closes by its X and by Escape, and drops the summary", async () => {
    await openPanel();
    state.reset.mockClear();
    await userEvent.click(
      screen.getByRole("button", { name: CHAT_CATCH_UP_COPY.close }),
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(state.reset).toHaveBeenCalled();
    expect(document.documentElement).not.toHaveAttribute(CATCH_UP_OPEN_ATTRIBUTE);

    await userEvent.click(screen.getByRole("button", { name: "open" }));
    // Focus moved into the panel when it opened, so Escape reaches it.
    expect(screen.getByRole("complementary")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("ends with the channel: leaving it closes the panel", async () => {
    const view = await openPanel();
    state.reset.mockClear();
    view.rerender(<Harness activeChannelId="channel-2" />);
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(state.reset).toHaveBeenCalled();
  });
});

describe("CatchUpOffer", () => {
  it("shows nothing without a line, and stays a live region", () => {
    render(<CatchUpOffer line={null} onStart={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says how many are new, and starts or dismisses", async () => {
    const onStart = vi.fn();
    const onDismiss = vi.fn();
    render(
      <CatchUpOffer
        line="140 new messages since you were last here."
        onStart={onStart}
        onDismiss={onDismiss}
      />,
    );
    expect(
      screen.getByText("140 new messages since you were last here."),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: CHAT_CATCH_UP_COPY.offer_action }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: CHAT_CATCH_UP_COPY.offer_dismiss }),
    );
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
