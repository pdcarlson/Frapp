import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActResponse,
  AskCardEnd,
  AskProposalResolution,
} from "@repo/hooks";
import { ACT_COPY, ASK_CARDS_COPY } from "@repo/validation";

/**
 * A proposal in the Ask conversation (#718): something the member asked to
 * have done is answered with a card, and nothing is sent to be done until
 * Confirm.
 */

const ME = "22222222-2222-4222-8222-222222222222";
const JORDAN = "33333333-3333-4333-8333-333333333333";
const JACOB = "44444444-4444-4444-8444-444444444444";
const SAM = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  audience: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  eventForm: undefined as
    | undefined
    | {
        open: boolean;
        template?: Record<string, unknown> | null;
        initialStartAt?: string;
        initialEndAt?: string;
        initialRepeatRule?: string | null;
        keptDraft?: string;
        onCreated?: (eventId: string) => Promise<void> | void;
      },
  cards: {
    byId: new Map<string, unknown>(),
    settled: true,
    failed: false,
    asked: [] as string[][],
  },
}));

vi.mock("@/components/ai/report-ai", () => ({
  ReportAiDialog: () => null,
}));

// The form itself has its own spec (`event-editor-dialog.spec.tsx`).
vi.mock("@/components/events/event-editor-dialog", () => ({
  EventEditorDialog: (props: NonNullable<typeof state.eventForm>) => {
    state.eventForm = props;
    return null;
  },
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActEventAudience: () => ({
    mutateAsync: state.audience,
    isPending: false,
  }),
  useAcceptAiSuggestion: () => ({
    mutateAsync: state.accept,
    isPending: false,
  }),
  useDismissAiSuggestion: () => ({
    mutateAsync: state.dismiss,
    isPending: false,
  }),
  // The hook has its own spec (`use-ask-cards.spec.tsx`).
  useAskCards: (ids: readonly string[]) => {
    state.cards.asked.push([...ids]);
    return {
      byId: state.cards.byId,
      settled: state.cards.settled,
      failed: state.cards.failed,
    };
  },
  useCurrentUser: () => ({ data: { id: ME } }),
  useMyPermissions: () => ({ data: { permissions: ["ai:use"] } }),
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

const { AskAnswerCards, AskProposal, AskCardEditsContext } =
  await import("./ask-proposal");

/** The card's one named action: "Give 5 points", "Create task", "Create event" (#5148). */
const CONFIRM = /^(Give|Take away) \d+ points?$|^Create (event|task)$/;

/** Dismiss sits in the card's ··· menu (Paul, 2026-11-16, #5148). */
async function dismissCard() {
  await userEvent.click(await screen.findByRole("button", { name: /^More/ }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: ACT_COPY.dismiss }),
  );
}
type AskCardEditsStore = import("./ask-proposal").AskCardEditsStore;

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

function suggestion(kind: "points" | "task" | "new_event", payload: unknown) {
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

/** The turn that holds the card: its proposal, and how it ended. */
function Turn({ proposal: first }: { proposal: ActResponse }) {
  const [proposal, setProposal] = useState(first);
  const [resolution, setResolution] = useState<AskProposalResolution | null>(
    null,
  );
  return (
    <AskProposal
      proposal={proposal}
      resolution={resolution}
      onProposal={setProposal}
      onResolved={setResolution}
    />
  );
}

/** The card as the thread shows it once the server answered with `proposal`. */
const show = (proposal: unknown) =>
  render(<Turn proposal={proposal as ActResponse} />);

describe("AskProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says whose attendance a points change was read from", async () => {
    show({
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
    expect(
      await screen.findByText(/marked present or late at Chapter Meeting/),
    ).toBeDefined();
  });

  it("shows a points change with its size in words, and does nothing until Confirm", async () => {
    state.accept.mockResolvedValue({
      result: { kind: "points", id: "t", outcome: { adjusted: 2, skipped: 0 } },
    });
    show(pointsCard([JORDAN, JACOB]));

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
      within(card).getByRole("button", { name: CONFIRM }),
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
    state.accept.mockResolvedValue({ result: null });
    show(pointsCard([JORDAN, JACOB]));
    await userEvent.click(
      await screen.findByRole("button", {
        name: `${ACT_COPY.remove_member} Jacob Miller`,
      }),
    );
    expect(screen.getByText("Give 5 points to 1 member")).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: CONFIRM }),
    );
    expect(state.accept).toHaveBeenCalledWith({
      id: "suggestion-1",
      points: { target_user_ids: [JORDAN] },
    });
  });

  it("will not confirm a points change with nobody on it, and says what was not found", async () => {
    show(pointsCard([], [{ type: "unmatched_name", name: "Jake" }]));
    expect(
      await screen.findByText(
        'Nobody in the chapter matched "Jake". Add them below if they should be included.',
      ),
    ).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: CONFIRM }),
    );
    expect(state.accept).not.toHaveBeenCalled();
    expect(screen.getByText(ACT_COPY.no_members)).toBeDefined();
  });

  it("names the member a short name was read as", async () => {
    show(
      pointsCard(
        [JACOB],
        [{ type: "matched_name", name: "Jake", user_ids: [JACOB] }],
      ),
    );
    expect(
      await screen.findByText(
        '"Jake" was read as Jacob Miller. Check that is who you meant.',
      ),
    ).toBeDefined();
  });

  it("cancels a card without changing anything", async () => {
    state.dismiss.mockResolvedValue({});
    show(pointsCard([JORDAN]));
    await dismissCard();
    expect(state.dismiss).toHaveBeenCalledWith("suggestion-1");
    expect(state.accept).not.toHaveBeenCalled();
    expect(await screen.findByText(ACT_COPY.cancelled)).toBeDefined();
  });

  it("keeps the card when Confirm is refused, and says why", async () => {
    // The shape the API client throws for the 429: without words of its own
    // this code reads "wait a minute", which never helps.
    state.accept.mockRejectedValue({
      status: 429,
      code: "ai.suggestion.points.over_limit",
      message:
        "This changes points for 60 members, and your chapter allows 50 point adjustments an hour.",
    });
    show(pointsCard([JORDAN]));
    await userEvent.click(
      await screen.findByRole("button", { name: CONFIRM }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      ACT_COPY.refused_confirm["ai.suggestion.points.over_limit"],
    );
    expect(
      screen.getByRole("button", { name: CONFIRM }),
    ).toBeDefined();
  });

  it.each([
    ["decided somewhere else", "ai.suggestion.decided"],
    ["a day old", "ai.suggestion.expired"],
    ["withdrawn", "ai.suggestion.not_found"],
  ])(
    "says a card that is %s is no longer waiting when Confirm finds out, with no buttons left",
    async (_name, code) => {
      state.accept.mockRejectedValue({ status: 409, code });
      show(pointsCard([JORDAN]));
      await userEvent.click(
        await screen.findByRole("button", { name: CONFIRM }),
      );
      expect(await screen.findByText(ACT_COPY.gone)).toBeDefined();
      expect(
        screen.queryByRole("button", { name: CONFIRM }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /^More/ })).toBeNull();
      expect(screen.queryByText(ACT_COPY.cancelled)).toBeNull();
    },
  );

  it("does not say cancelled for a card that was decided somewhere else: it may have been confirmed", async () => {
    state.dismiss.mockRejectedValue({
      status: 409,
      code: "ai.suggestion.decided",
    });
    show(pointsCard([JORDAN]));
    await dismissCard();
    expect(await screen.findByText(ACT_COPY.gone)).toBeDefined();
    expect(screen.queryByText(ACT_COPY.cancelled)).toBeNull();
  });

  it("says cancelled for a card that was already gone: that is what Cancel wanted", async () => {
    state.dismiss.mockRejectedValue({
      status: 404,
      code: "ai.suggestion.not_found",
    });
    show(pointsCard([JORDAN]));
    await dismissCard();
    expect(await screen.findByText(ACT_COPY.cancelled)).toBeDefined();
  });

  it("keeps a member taken off a card when the panel takes the thread off the page and puts it back", async () => {
    state.accept.mockResolvedValue({ result: null });
    const edits: AskCardEditsStore = new Map();
    const thread = (
      <AskCardEditsContext.Provider value={edits}>
        <Turn proposal={pointsCard([JORDAN, JACOB]) as ActResponse} />
      </AskCardEditsContext.Provider>
    );
    const first = render(thread);
    await userEvent.click(
      await screen.findByRole("button", {
        name: `${ACT_COPY.remove_member} Jacob Miller`,
      }),
    );
    // The panel closes: the card is gone from the page, not from the thread.
    first.unmount();
    render(thread);
    expect(await screen.findByText("Give 5 points to 1 member")).toBeDefined();
    expect(screen.queryByText("Jacob Miller")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: CONFIRM }),
    );
    expect(state.accept).toHaveBeenCalledWith({
      id: "suggestion-1",
      points: { target_user_ids: [JORDAN] },
    });
  });

  describe("Edit (#5117)", () => {
    // Paul's request on 2026-11-15: "Chapter, every Sunday night at 6:48 PM".
    const series = () =>
      show({
        ...base,
        action: "create_event",
        suggestion: suggestion("new_event", {
          name: "Chapter",
          description: null,
          location: null,
          start_time: "2026-11-15T23:48:00.000Z",
          end_time: "2026-11-16T00:48:00.000Z",
          point_value: null,
          is_mandatory: false,
          recurrence_rule:
            "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=13;TZID=America/New_York",
        }),
      });

    beforeEach(() => {
      state.eventForm = undefined;
    });

    it("says a series repeats, written out", async () => {
      series();
      expect(
        await screen.findByText("Every Sunday until February 7, 2027"),
      ).toBeDefined();
      expect(screen.getByText("13 times")).toBeDefined();
    });

    it("opens the event form filled in from the card, and Create there is the confirm", async () => {
      state.accept.mockResolvedValue({ result: null });
      series();
      expect(state.eventForm).toBeUndefined();
      await userEvent.click(
        await screen.findByRole("button", { name: ACT_COPY.edit }),
      );
      const form = state.eventForm!;
      expect(form.open).toBe(true);
      expect(form.template).toMatchObject({
        name: "Chapter",
        is_mandatory: false,
      });
      expect(form.initialRepeatRule).toBe(
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=13;TZID=America/New_York",
      );
      expect(form.initialStartAt).toBeTruthy();
      expect(form.keptDraft).toBe("ask-event:suggestion-1");
      expect(state.accept).not.toHaveBeenCalled();

      await form.onCreated?.("event-9");
      expect(state.accept).toHaveBeenCalledWith({
        id: "suggestion-1",
        newEventId: "event-9",
      });
      expect(await screen.findByText(ACT_COPY.done_event)).toBeDefined();
    });

    it("turns a points card's amount and reason into fields, and sends only what changed", async () => {
      state.accept.mockResolvedValue({
        result: {
          kind: "points",
          id: "t",
          outcome: { adjusted: 2, skipped: 0 },
        },
      });
      show(pointsCard([JORDAN, JACOB]));
      await userEvent.click(
        await screen.findByRole("button", { name: ACT_COPY.edit }),
      );
      const amount = screen.getByLabelText(ACT_COPY.field_amount);
      await userEvent.clear(amount);
      await userEvent.type(amount, "0");
      await userEvent.click(
        screen.getByRole("button", { name: CONFIRM }),
      );
      expect(state.accept).not.toHaveBeenCalled();
      expect(screen.getByText(ACT_COPY.bad_amount)).toBeDefined();

      await userEvent.clear(amount);
      await userEvent.type(amount, "-10");
      expect(
        screen.getByText("Take 10 points away from 2 members"),
      ).toBeDefined();
      await userEvent.click(
        screen.getByRole("button", { name: CONFIRM }),
      );
      expect(state.accept).toHaveBeenCalledWith({
        id: "suggestion-1",
        points: { amount: -10 },
      });
    });

    it("turns a task's name and details into fields", async () => {
      state.accept.mockResolvedValue({ result: null });
      show({
        ...base,
        action: "create_task",
        suggestion: suggestion("task", {
          title: "Book the bus",
          description: null,
          assignee_id: JORDAN,
          due_date: "2099-11-13",
          due_at: null,
          subtasks: [],
        }),
      });
      await userEvent.click(
        await screen.findByRole("button", { name: ACT_COPY.edit }),
      );
      const name = screen.getByLabelText(ACT_COPY.field_task_name);
      await userEvent.clear(name);
      await userEvent.click(
        screen.getByRole("button", { name: CONFIRM }),
      );
      expect(screen.getByText(ACT_COPY.no_task_name)).toBeDefined();
      await userEvent.type(name, "Book the bus for formal");
      await userEvent.type(
        screen.getByLabelText(ACT_COPY.field_details),
        "Two buses, 60 seats",
      );
      await userEvent.click(
        screen.getByRole("button", { name: CONFIRM }),
      );
      expect(state.accept).toHaveBeenCalledWith({
        id: "suggestion-1",
        task: {
          title: "Book the bus for formal",
          description: "Two buses, 60 seats",
        },
      });
    });
  });

  it("asks who a task is for before it can be confirmed", async () => {
    show({
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
    expect(await screen.findByText("Book the bus")).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: CONFIRM }),
    );
    expect(state.accept).not.toHaveBeenCalled();
    expect(screen.getByText(ACT_COPY.need_assignee)).toBeDefined();
  });

  it("shows an event written out in full", async () => {
    state.accept.mockResolvedValue({ result: { kind: "new_event", id: "e" } });
    show({
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
    expect(await screen.findByText("Tuesday, November 17")).toBeDefined();
    expect(screen.getByText(/^7:00 to 8:00\sPM · Library$/)).toBeDefined();
    expect(screen.getByText("TUE")).toBeDefined();
    expect(screen.getByText(ACT_COPY.everyone_optional)).toBeDefined();
    // Nobody said the points and nothing matched (Paul, 2026-11-16): the
    // field is empty and marked, and the card waits for it.
    expect(screen.getByText(ACT_COPY.points_missing)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: CONFIRM }));
    expect(state.accept).not.toHaveBeenCalled();
    expect(
      (await screen.findByRole("alert")).textContent,
    ).toBe(ACT_COPY.bad_event_points);
    await userEvent.type(
      screen.getByLabelText(ACT_COPY.points_label),
      "0",
    );
    await userEvent.click(screen.getByRole("button", { name: CONFIRM }));
    expect(state.accept).toHaveBeenCalledWith({
      id: "suggestion-1",
      newEventPoints: 0,
    });
    // It stays in place, greyed, with what was made and a link to it.
    expect(await screen.findByText(ACT_COPY.done_event)).toBeDefined();
    expect(screen.getByText("Study night")).toBeDefined();
    expect(screen.getByText("No points")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: ACT_COPY.open_event })
        .getAttribute("href"),
    ).toBe("/events?event=e");
  });

  it("shows points copied from the chapter's event type, and where from", async () => {
    show({
      ...base,
      action: "create_event",
      suggestion: suggestion("new_event", {
        name: "Chapter",
        description: null,
        location: null,
        start_time: "2026-11-22T18:48:00",
        end_time: "2026-11-22T19:48:00",
        point_value: 10,
        points_from: { kind: "type", name: "Chapter meeting" },
        event_type_id: null,
        is_mandatory: true,
        recurrence_rule: null,
      }),
    });
    expect(await screen.findByText("10 points")).toBeDefined();
    expect(
      screen.getByText("From your Chapter meeting event type"),
    ).toBeDefined();
    expect(screen.getByText(ACT_COPY.everyone_required)).toBeDefined();
    expect(screen.queryByText(ACT_COPY.points_missing)).toBeNull();
  });

  it("asks which event, and sends the pick with the amount it was given", async () => {
    state.audience.mockResolvedValue(pointsCard([JORDAN]));
    show({
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
    expect(await screen.findByText(ACT_COPY.pick_event)).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: /Chapter Meeting/ }),
    );
    expect(state.audience).toHaveBeenCalledWith({
      eventId: "e1",
      amount: 5,
      reason: "",
      // The thread's other cards stay waiting.
      keepEarlier: true,
    });
    expect(await screen.findByText("Give 5 points to 1 member")).toBeDefined();
  });

  it("says what it can do when the request is not one of them", async () => {
    show({
      ...base,
      status: "no_action",
      available_actions: ["create_task", "something_new"],
    });
    expect(await screen.findByText(ACT_COPY.no_action)).toBeDefined();
    expect(screen.getByText(ACT_COPY.action_labels.create_task)).toBeDefined();
  });

  it("says what was left out of an unclear request", async () => {
    show({
      ...base,
      status: "unclear",
      action: "give_points",
      missing: "amount",
    });
    expect(await screen.findByText(ACT_COPY.missing.amount)).toBeDefined();
  });

  it("becomes one line once dismissed, and a pick that fails keeps the choices", async () => {
    state.audience.mockRejectedValue(new Error("network"));
    show({
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
        ],
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: /Chapter Meeting/ }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      ACT_COPY.failed,
    );
    expect(
      screen.getByRole("button", { name: /Chapter Meeting/ }),
    ).toBeDefined();
  });

  it("names what a confirmed card was about beside what happened", async () => {
    state.accept.mockResolvedValue({ result: { kind: "task", id: "t" } });
    show({
      ...base,
      action: "create_task",
      suggestion: suggestion("task", {
        title: "Book the bus",
        description: null,
        assignee_id: JORDAN,
        due_date: "2099-11-13",
        due_at: null,
        subtasks: [],
      }),
    });
    await userEvent.click(
      screen.getByRole("button", { name: CONFIRM }),
    );
    expect(await screen.findByText(ACT_COPY.done_task)).toBeDefined();
    expect(screen.getByText("Book the bus")).toBeDefined();
    expect(screen.queryByRole("button", { name: CONFIRM })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: ACT_COPY.open_tasks })
        .getAttribute("href"),
    ).toBe("/tasks");
  });
});

/** The cards an answer came with (`answer.proposals`, #4904). */
describe("AskAnswerCards", () => {
  const task = (id: string, title: string) => ({
    ...suggestion("task", {
      title,
      description: null,
      assignee_id: JORDAN,
      due_date: "2026-11-20",
      due_at: null,
    }),
    id,
  });

  function Cards({ ids }: { ids: string[] }) {
    const [ended, setEnded] = useState<Record<string, AskCardEnd>>({});
    return (
      <AskAnswerCards
        ids={ids}
        ended={ended}
        onEnded={(id, end) => setEnded((now) => ({ ...now, [id]: end }))}
      />
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.cards.byId = new Map();
    state.cards.settled = true;
    state.cards.failed = false;
    state.cards.asked = [];
  });

  it("draws each card, and one that ends becomes a line while the other waits", async () => {
    state.cards.byId = new Map<string, unknown>([
      ["s1", task("s1", "Buy cups")],
      ["s2", task("s2", "Book the hall")],
    ]);
    state.dismiss.mockResolvedValue({});
    render(<Cards ids={["s1", "s2"]} />);
    expect(screen.getByText("Buy cups")).toBeDefined();
    expect(screen.getByText("Book the hall")).toBeDefined();
    const menus = screen.getAllByRole("button", { name: /^More/ });
    expect(menus).toHaveLength(2);
    await userEvent.click(menus[0]!);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: ACT_COPY.dismiss }),
    );
    expect(state.dismiss).toHaveBeenCalledWith("s1");
    expect(await screen.findByText(ACT_COPY.cancelled)).toBeDefined();
    // The line still says what the card was about.
    expect(screen.getByText("Buy cups")).toBeDefined();
    expect(
      screen.getAllByRole("button", { name: CONFIRM }),
    ).toHaveLength(1);
    // Only the card still waiting is asked for again.
    expect(state.cards.asked.at(-1)).toEqual(["s2"]);
  });

  it("holds a frame while the cards are read, and says so when one is no longer waiting", () => {
    state.cards.settled = false;
    const view = render(<Cards ids={["s1"]} />);
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(ACT_COPY.gone)).toBeNull();
    state.cards.settled = true;
    view.rerender(<Cards ids={["s1"]} />);
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText(ACT_COPY.gone)).toBeDefined();
  });

  it("does not call a card gone when the list could not be read", () => {
    state.cards.settled = false;
    state.cards.failed = true;
    render(<Cards ids={["s1"]} />);
    expect(screen.getByText(ASK_CARDS_COPY.unread)).toBeDefined();
    expect(screen.queryByText(ACT_COPY.gone)).toBeNull();
  });
});
