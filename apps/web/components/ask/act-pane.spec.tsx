import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACT_COPY } from "@repo/validation";

/**
 * The Do side of Ask (#718): a request is answered with a card, and nothing
 * is sent to be done until Confirm.
 */

const ME = "22222222-2222-4222-8222-222222222222";
const JORDAN = "33333333-3333-4333-8333-333333333333";
const JACOB = "44444444-4444-4444-8444-444444444444";
const SAM = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  request: vi.fn(),
  audience: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  consent: vi.fn(),
}));

vi.mock("@/components/ai/report-ai", () => ({
  ReportAiButton: () => null,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActRequest: () => ({ mutateAsync: state.request }),
  useActEventAudience: () => ({ mutateAsync: state.audience }),
  useAcceptAiSuggestion: () => ({
    mutateAsync: state.accept,
    isPending: false,
  }),
  useDismissAiSuggestion: () => ({
    mutateAsync: state.dismiss,
    isPending: false,
  }),
  useCurrentUser: () => ({ data: { id: ME } }),
  useMembers: () => ({
    isSuccess: true,
    data: [
      { user_id: ME, display_name: "Paul Carlson" },
      { user_id: JORDAN, display_name: "Jordan Reyes" },
      { user_id: JACOB, display_name: "Jacob Miller" },
      { user_id: SAM, display_name: "Sam Ortiz" },
    ],
  }),
}));

const { ActPane, useActSession } = await import("./act-pane");

const base = {
  status: "proposed",
  action: null,
  suggestion: null,
  notes: [],
  event_choice: null,
  missing: null,
  reason: null,
  available_actions: [],
};

function suggestion(
  kind: "points" | "task" | "new_event",
  payload: unknown,
) {
  return {
    id: "suggestion-1",
    kind,
    status: "pending",
    source: { type: "request", id: ME, title: "Ask Frapp" },
    batch_id: "batch",
    task: null,
    points: null,
    event: null,
    new_event: null,
    quote: null,
    edited: false,
    result_id: null,
    created_at: "2026-11-12T23:00:00.000Z",
    expires_at: "2026-11-13T23:00:00.000Z",
    [kind]: payload,
  };
}

const pointsCard = (targets: string[], notes: unknown[] = []) => ({
  ...base,
  action: "give_points",
  notes,
  suggestion: suggestion("points", {
    amount: 5,
    reason: "Attended Chapter Meeting",
    target_user_ids: targets,
    event_id: null,
    event_name: null,
    event_start_time: null,
  }),
});

/** The panel: it holds the session, and shows the pane only on the Do side. */
function Panel({ doing }: { doing: boolean }) {
  const session = useActSession();
  return doing ? (
    <ActPane
      session={session}
      actions={["give_points"]}
      ensureConsent={state.consent}
    />
  ) : (
    <p>Ask side</p>
  );
}

const open = (actions = ["give_points", "create_task", "create_event"]) =>
  render(<ActPane actions={actions} ensureConsent={state.consent} />);

async function say(text: string) {
  await userEvent.type(screen.getByPlaceholderText(ACT_COPY.placeholder), text);
  await userEvent.click(screen.getByRole("button", { name: ACT_COPY.send }));
}

describe("ActPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.consent.mockResolvedValue(true);
  });

  it("offers an example only for what the member can ask for", () => {
    open(["create_task"]);
    expect(screen.getByText(ACT_COPY.examples.create_task)).toBeDefined();
    expect(screen.queryByText(ACT_COPY.examples.give_points)).toBeNull();
  });

  it("still shows a waiting card after a look at the Ask side", async () => {
    state.request.mockResolvedValue(pointsCard([JORDAN]));
    const view = render(<Panel doing />);
    await say("give Jordan 5 points for cleanup");
    await screen.findByRole("button", { name: ACT_COPY.confirm });
    view.rerender(<Panel doing={false} />);
    expect(screen.queryByRole("button", { name: ACT_COPY.confirm })).toBeNull();
    view.rerender(<Panel doing />);
    expect(screen.getByRole("button", { name: ACT_COPY.confirm })).toBeDefined();
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it("says whose attendance a points change was read from", async () => {
    state.request.mockResolvedValue({
      ...base,
      action: "give_points",
      suggestion: suggestion("points", {
        amount: 5,
        reason: "Attended Chapter Meeting",
        target_user_ids: [JORDAN],
        event_id: "event-1",
        event_name: "Chapter Meeting",
        event_start_time: "2026-11-12T23:00:00.000Z",
      }),
    });
    open();
    await say("give 5 points to everyone who came to chapter");
    expect(
      await screen.findByText(/marked present or late at Chapter Meeting/),
    ).toBeDefined();
  });

  it("asks consent before a request leaves, and sends nothing on No", async () => {
    state.consent.mockResolvedValue(false);
    open();
    await say("give Jordan 5 points for cleanup");
    expect(state.request).not.toHaveBeenCalled();
    expect(
      await screen.findByText(ACT_COPY.unavailable.consent_required),
    ).toBeDefined();
  });

  it("shows a points change with its size in words, and does nothing until Confirm", async () => {
    state.request.mockResolvedValue(pointsCard([JORDAN, JACOB]));
    state.accept.mockResolvedValue({
      result: { kind: "points", id: "t", outcome: { adjusted: 2, skipped: 0 } },
    });
    open();
    await say("give 5 points to everyone who came tonight");

    const card = await screen.findByRole("region", {
      name: ACT_COPY.card_points_title_give,
    });
    expect(within(card).getByText("Give 5 points to 2 members")).toBeDefined();
    expect(
      within(card).getByText("10 points in all, in 2 separate changes."),
    ).toBeDefined();
    expect(within(card).getByText("Attended Chapter Meeting")).toBeDefined();
    expect(within(card).getByText("Jordan Reyes")).toBeDefined();
    expect(state.accept).not.toHaveBeenCalled();

    await userEvent.click(
      within(card).getByRole("button", { name: ACT_COPY.confirm }),
    );
    // Unchanged, so no edits are sent.
    expect(state.accept).toHaveBeenCalledWith({ id: "suggestion-1" });
    expect(
      await screen.findByText("Gave 5 points to 2 members."),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: ACT_COPY.open_points })
        .getAttribute("href"),
    ).toBe("/points");
  });

  it("sends the members as the officer left them when one is taken off", async () => {
    state.request.mockResolvedValue(pointsCard([JORDAN, JACOB]));
    state.accept.mockResolvedValue({ result: null });
    open();
    await say("give 5 points to Jordan and Jacob");
    await userEvent.click(
      await screen.findByRole("button", {
        name: `${ACT_COPY.remove_member} Jacob Miller`,
      }),
    );
    expect(screen.getByText("Give 5 points to 1 member")).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: ACT_COPY.confirm }),
    );
    expect(state.accept).toHaveBeenCalledWith({
      id: "suggestion-1",
      points: { target_user_ids: [JORDAN] },
    });
  });

  it("will not confirm a points change with nobody on it, and says what was not found", async () => {
    state.request.mockResolvedValue(
      pointsCard([], [{ type: "unmatched_name", name: "Jake" }]),
    );
    open();
    await say("give Jake 5 points for cleanup");
    expect(
      await screen.findByText(
        'Nobody in the chapter matched "Jake". Add them below if they should be included.',
      ),
    ).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: ACT_COPY.confirm }),
    );
    expect(state.accept).not.toHaveBeenCalled();
    expect(screen.getByText(ACT_COPY.no_members)).toBeDefined();
  });

  it("names the member a short name was read as", async () => {
    state.request.mockResolvedValue(
      pointsCard(
        [JACOB],
        [{ type: "matched_name", name: "Jake", user_ids: [JACOB] }],
      ),
    );
    open();
    await say("give Jake 5 points for cleanup");
    expect(
      await screen.findByText(
        '"Jake" was read as Jacob Miller. Check that is who you meant.',
      ),
    ).toBeDefined();
  });

  it("cancels a card without changing anything", async () => {
    state.request.mockResolvedValue(pointsCard([JORDAN]));
    state.dismiss.mockResolvedValue({});
    open();
    await say("give Jordan 5 points for cleanup");
    await userEvent.click(
      await screen.findByRole("button", { name: ACT_COPY.cancel }),
    );
    expect(state.dismiss).toHaveBeenCalledWith("suggestion-1");
    expect(state.accept).not.toHaveBeenCalled();
    expect(await screen.findByText(ACT_COPY.cancelled)).toBeDefined();
  });

  it("keeps the card when Confirm is refused, and says why", async () => {
    state.request.mockResolvedValue(pointsCard([JORDAN]));
    // The shape the API client throws for the 429: without words of its own
    // this code reads "wait a minute", which never helps.
    state.accept.mockRejectedValue({
      status: 429,
      code: "ai.suggestion.points.over_limit",
      message:
        "This changes points for 60 members, and your chapter allows 50 point adjustments an hour.",
    });
    open();
    await say("give Jordan 5 points for cleanup");
    await userEvent.click(
      await screen.findByRole("button", { name: ACT_COPY.confirm }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      ACT_COPY.refused_confirm["ai.suggestion.points.over_limit"],
    );
    expect(
      screen.getByRole("button", { name: ACT_COPY.confirm }),
    ).toBeDefined();
  });

  it("asks who a task is for before it can be confirmed", async () => {
    state.request.mockResolvedValue({
      ...base,
      action: "create_task",
      suggestion: suggestion("task", {
        title: "Book the bus",
        description: null,
        assignee_id: null,
        due_date: "2026-11-13",
        due_at: null,
        subtasks: [],
      }),
    });
    open();
    await say("make a task to book the bus by Friday");
    expect(await screen.findByText("Book the bus")).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: ACT_COPY.confirm }),
    );
    expect(state.accept).not.toHaveBeenCalled();
    expect(screen.getByText(ACT_COPY.need_assignee)).toBeDefined();
  });

  it("shows an event written out in full", async () => {
    state.request.mockResolvedValue({
      ...base,
      action: "create_event",
      suggestion: suggestion("new_event", {
        name: "Study night",
        description: null,
        location: "Library",
        start_time: "2026-11-17T19:00:00",
        end_time: "2026-11-17T20:00:00",
        point_value: null,
        is_mandatory: false,
      }),
    });
    state.accept.mockResolvedValue({ result: { kind: "new_event", id: "e" } });
    open();
    await say("put a study night on the calendar for Tuesday at 7");
    expect(
      await screen.findByText("Tuesday, November 17, 7:00 PM to 8:00 PM"),
    ).toBeDefined();
    expect(screen.getByText("Library")).toBeDefined();
    expect(screen.getByText(ACT_COPY.optional)).toBeDefined();
    expect(screen.getByText(ACT_COPY.default_points)).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: ACT_COPY.confirm }),
    );
    expect(await screen.findByText(ACT_COPY.done_event)).toBeDefined();
  });

  it("asks which event, and sends the pick with the amount it was given", async () => {
    state.request.mockResolvedValue({
      ...base,
      status: "needs_event",
      action: "give_points",
      event_choice: {
        amount: 5,
        reason: "",
        events: [
          {
            id: "e1",
            name: "Chapter Meeting",
            start_time: "2026-11-12T19:00:00",
          },
          { id: "e2", name: "Study Night", start_time: "2026-11-12T17:00:00" },
        ],
      },
    });
    state.audience.mockResolvedValue(pointsCard([JORDAN]));
    open();
    await say("give 5 points to everyone who came tonight");
    expect(await screen.findByText(ACT_COPY.pick_event)).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: /Chapter Meeting/ }),
    );
    expect(state.audience).toHaveBeenCalledWith({
      eventId: "e1",
      amount: 5,
      reason: "",
    });
    expect(await screen.findByText("Give 5 points to 1 member")).toBeDefined();
  });

  it("says what it can do when the request is not one of them", async () => {
    state.request.mockResolvedValue({
      ...base,
      status: "no_action",
      available_actions: ["create_task", "something_new"],
    });
    open();
    await say("delete the chapter");
    expect(await screen.findByText(ACT_COPY.no_action)).toBeDefined();
    expect(screen.getByText(ACT_COPY.action_labels.create_task)).toBeDefined();
  });

  it("says what was left out of an unclear request", async () => {
    state.request.mockResolvedValue({
      ...base,
      status: "unclear",
      action: "give_points",
      missing: "amount",
    });
    open();
    await say("give Jordan points");
    expect(await screen.findByText(ACT_COPY.missing.amount)).toBeDefined();
  });

  it("offers to try again when the request fails", async () => {
    state.request.mockRejectedValueOnce(new Error("network"));
    state.request.mockResolvedValue({ ...base, status: "refused" });
    open();
    await say("give Jordan 5 points for cleanup");
    await userEvent.click(
      await screen.findByRole("button", { name: ACT_COPY.try_again }),
    );
    expect(await screen.findByText(ACT_COPY.refused)).toBeDefined();
    expect(state.request).toHaveBeenCalledTimes(2);
  });
});
