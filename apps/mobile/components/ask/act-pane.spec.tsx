/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACT_COPY,
  AI_REPORT_COPY,
  actConfirmRefusalLine,
  actMissingLine,
  actNoteLine,
  actPointsDoneLine,
  actPointsHeadline,
  actUnavailableLine,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The Do side of Ask on the phone (#718): an officer says what to do, sees
 * exactly what would happen and to whom, and nothing changes until they press
 * Confirm. The sheet around it is `ask-sheet.spec.tsx`'s.
 */
const hooks = vi.hoisted(() => ({
  request: vi.fn(),
  audience: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  seed: undefined as unknown,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActRequest: () => ({ mutateAsync: hooks.request }),
  useActEventAudience: () => ({ mutateAsync: hooks.audience }),
  useAcceptAiSuggestion: () => ({
    mutateAsync: hooks.accept,
    isPending: false,
  }),
  useDismissAiSuggestion: () => ({
    mutateAsync: hooks.dismiss,
    isPending: false,
  }),
  useChapterRoster: () => ({
    data: [
      { user_id: "me", display_name: "Paul Carlson" },
      { user_id: "u1", display_name: "Ana Ruiz" },
      { user_id: "u2", display_name: "Jordan Lee" },
      { user_id: "u3", display_name: "Sam Park" },
    ],
    isSuccess: true,
    isPending: false,
  }),
  useCurrentUser: () => ({ data: { id: "me" } }),
}));
vi.mock("@/components/tasks/new-task-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    NewTaskSheet: forwardRef(function NewTaskSheet(props: {
      suggestion?: unknown;
    }) {
      hooks.seed = props.suggestion;
      return null;
    }),
  };
});

import { ActBody, AskModeSwitch, useActSession, type ActLink } from "./act-pane";

const reporting = {
  offered: true,
  isReported: () => false,
  report: vi.fn(),
  reportSheet: null,
};
const ensureConsent = vi.fn<() => Promise<boolean>>();
const onOpen = vi.fn<(link: ActLink) => void>();
let session!: ReturnType<typeof useActSession>;

const keep = (value: ReturnType<typeof useActSession>) => {
  session = value;
};
function Harness({
  onValue,
  shown = true,
}: {
  onValue: typeof keep;
  shown?: boolean;
}) {
  const value = useActSession(ensureConsent);
  onValue(value);
  // The sheet holds the session; the body comes and goes with the Do side.
  if (!shown) return null;
  return (
    <ActBody
      session={value}
      actions={["give_points", "create_task"]}
      report={reporting as never}
      onOpen={onOpen}
    />
  );
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Harness onValue={keep} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  )[0];
async function say(tree: ReactTestRenderer, text: string) {
  await act(async () => {
    session.submit(text);
  });
  return tree;
}

const BASE = {
  action: null,
  suggestion: null,
  notes: [],
  event_choice: null,
  missing: null,
  reason: null,
  available_actions: [],
};
const POINTS = {
  ...BASE,
  status: "proposed",
  action: "give_points",
  suggestion: {
    id: "sg-1",
    kind: "points",
    points: {
      amount: 5,
      reason: "Came to chapter",
      target_user_ids: ["u1", "u2"],
      event_name: null,
      event_start_time: null,
    },
    task: null,
    new_event: null,
  },
};
const TASK = {
  ...BASE,
  status: "proposed",
  action: "create_task",
  suggestion: {
    id: "sg-2",
    kind: "task",
    points: null,
    task: {
      title: "Book the bus",
      description: null,
      assignee_id: "u2",
      due_date: "2026-11-20",
      due_at: null,
      subtasks: [],
    },
    new_event: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.seed = undefined;
  ensureConsent.mockResolvedValue(true);
  hooks.request.mockResolvedValue(POINTS);
  hooks.accept.mockResolvedValue({
    result: { outcome: { adjusted: 2, skipped: 0 } },
  });
  hooks.dismiss.mockResolvedValue({});
});

describe("the Do side of Ask", () => {
  it("opens on examples of only what this member can ask for", () => {
    const text = screenText(render());
    expect(text).toContain(ACT_COPY.empty_title);
    expect(text).toContain(ACT_COPY.examples.give_points);
    expect(text).toContain(ACT_COPY.examples.create_task);
    expect(text).not.toContain(ACT_COPY.examples.create_event);
  });

  it("sends nothing for a member who hasn't said yes, and offers the sheet again", async () => {
    ensureConsent.mockResolvedValue(false);
    const tree = await say(render(), "Give Ana 5 points");
    expect(hooks.request).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(actUnavailableLine("consent_required"));

    ensureConsent.mockResolvedValue(true);
    await act(async () => byLabel(tree, ACT_COPY.consent_action).props.onPress());
    expect(hooks.request).toHaveBeenCalledWith("Give Ana 5 points");
  });

  it("says exactly what will happen and to whom, and changes nothing until Confirm", async () => {
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    const text = screenText(tree);
    expect(text).toContain("Give Ana and Jordan 5 points");
    expect(text).toContain(actPointsHeadline(5, 2));
    expect(text).toContain("Came to chapter");
    expect(text).toContain("Ana Ruiz");
    expect(text).toContain("Jordan Lee");
    expect(text).toContain(ACT_COPY.mine_only);
    expect(hooks.accept).not.toHaveBeenCalled();

    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    // Nothing was changed on the card, so nothing is sent but the yes.
    expect(hooks.accept).toHaveBeenCalledWith({ id: "sg-1" });
    expect(screenText(tree)).toContain(actPointsDoneLine(5, 2, 0));
  });

  it("removes a member, adds one from the roster, and confirms the list as it stands", async () => {
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    act(() =>
      byLabel(tree, `${ACT_COPY.remove_member} Jordan Lee`).props.onPress(),
    );
    expect(screenText(tree)).toContain(actPointsHeadline(5, 1));

    const picker = tree.root.findAll(
      (node) =>
        typeof node.props.onPick === "function" &&
        Array.isArray(node.props.members),
    )[0]!;
    // Never the officer themself, never someone already on the card.
    expect(
      picker.props.members.map((member: { userId: string }) => member.userId),
    ).toEqual(["u2", "u3"]);
    act(() => picker.props.onPick("u3"));

    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).toHaveBeenCalledWith({
      id: "sg-1",
      points: { target_user_ids: ["u1", "u3"] },
    });
  });

  it("won't confirm points for nobody", async () => {
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    for (const name of ["Ana Ruiz", "Jordan Lee"]) {
      act(() =>
        byLabel(tree, `${ACT_COPY.remove_member} ${name}`).props.onPress(),
      );
    }
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(ACT_COPY.no_members);
  });

  it("says how many it reached when only some went through", async () => {
    hooks.accept.mockResolvedValue({
      result: { outcome: { adjusted: 1, skipped: 1 } },
    });
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(screenText(tree)).toContain(actPointsDoneLine(5, 1, 1));
  });

  it("keeps the card, and says why, when Confirm is refused", async () => {
    hooks.accept.mockRejectedValue({ code: "ai.suggestion.decided" });
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    const text = screenText(tree);
    expect(text).toContain(ACT_COPY.gone);
    expect(text).toContain(actPointsHeadline(5, 2));
  });

  it("uses the shared words for a refusal the server names", async () => {
    const code = "ai.act.partial";
    const line = actConfirmRefusalLine(code);
    hooks.accept.mockRejectedValue({ code });
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    // Whatever the shared map says for a code, or the plain failure line.
    expect(screenText(tree)).toContain(line ?? ACT_COPY.failed);
  });

  it("cancels a proposal, and treats one already gone as cancelled", async () => {
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    await act(async () => byLabel(tree, ACT_COPY.cancel).props.onPress());
    expect(hooks.dismiss).toHaveBeenCalledWith("sg-1");
    expect(screenText(tree)).toContain(ACT_COPY.cancelled);

    hooks.dismiss.mockRejectedValue({ code: "ai.suggestion.expired" });
    const again = await say(render(), "Give Ana and Jordan 5 points");
    await act(async () => byLabel(again, ACT_COPY.cancel).props.onPress());
    expect(screenText(again)).toContain(ACT_COPY.cancelled);
  });

  it("confirms a complete task, and links to Tasks", async () => {
    hooks.request.mockResolvedValue(TASK);
    const tree = await say(render(), "Make a task for Jordan to book the bus");
    expect(screenText(tree)).toContain("Book the bus");
    expect(screenText(tree)).toContain("Jordan Lee");
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).toHaveBeenCalledWith({ id: "sg-2" });
    expect(screenText(tree)).toContain(ACT_COPY.done_task);
    act(() => byLabel(tree, ACT_COPY.open_tasks).props.onPress());
    expect(onOpen).toHaveBeenCalledWith({
      href: "/tasks",
      label: ACT_COPY.open_tasks,
    });
  });

  it("opens the task form, not a task, when who or when is missing", async () => {
    hooks.request.mockResolvedValue({
      ...TASK,
      suggestion: {
        ...TASK.suggestion,
        task: { ...TASK.suggestion.task, assignee_id: null },
      },
    });
    const tree = await say(render(), "Make a task to book the bus");
    expect(screenText(tree)).toContain(ACT_COPY.pick_member);
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).not.toHaveBeenCalled();
    expect((hooks.seed as { title: string }).title).toBe("Book the bus");
  });

  it("confirms an event proposal, and links to Events", async () => {
    hooks.request.mockResolvedValue({
      ...BASE,
      status: "proposed",
      action: "create_event",
      suggestion: {
        id: "sg-3",
        kind: "event",
        points: null,
        task: null,
        new_event: {
          name: "Study night",
          start_time: "2026-11-17T23:00:00Z",
          end_time: "2026-11-18T01:00:00Z",
          location: "Library",
          is_mandatory: false,
          point_value: null,
          description: null,
        },
      },
    });
    const tree = await say(render(), "Put a study night on the calendar");
    const text = screenText(tree);
    expect(text).toContain("Study night");
    expect(text).toContain("Library");
    expect(text).toContain(ACT_COPY.optional);
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(screenText(tree)).toContain(ACT_COPY.done_event);
    act(() => byLabel(tree, ACT_COPY.open_events).props.onPress());
    expect(onOpen).toHaveBeenCalledWith({
      href: "/events",
      label: ACT_COPY.open_events,
    });
  });

  it("says which names it couldn't place, above the control that adds them", async () => {
    hooks.request.mockResolvedValue({
      ...POINTS,
      notes: [
        { type: "unmatched_name", name: "Jordy" },
        { type: "ambiguous_name", name: "Sam" },
      ],
    });
    const tree = await say(render(), "Give Ana, Jordy and Sam 5 points");
    const text = screenText(tree);
    expect(text).toContain(actNoteLine({ type: "unmatched_name", name: "Jordy" }));
    expect(text).toContain(actNoteLine({ type: "ambiguous_name", name: "Sam" }));
    expect(byLabel(tree, ACT_COPY.add_member)).toBeDefined();
  });

  it("accepts a task finished in the form with what the officer set there", async () => {
    hooks.request.mockResolvedValue({
      ...TASK,
      suggestion: {
        ...TASK.suggestion,
        task: { ...TASK.suggestion.task, assignee_id: null },
      },
    });
    const tree = await say(render(), "Make a task to book the bus");
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    const seed = hooks.seed as { accept: (form: unknown) => Promise<void> };
    await act(async () =>
      seed.accept({
        title: "Book the bus",
        assignee_id: "u1",
        due_date: "2026-11-20",
        subtasks: [],
      }),
    );
    expect(hooks.accept).toHaveBeenCalledWith({
      id: "sg-2",
      task: { assignee_id: "u1" },
    });
    expect(screenText(tree)).toContain(ACT_COPY.done_task);
  });

  it("keeps the members an officer left on the card through a close and reopen", async () => {
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    act(() =>
      byLabel(tree, `${ACT_COPY.remove_member} Jordan Lee`).props.onPress(),
    );
    // The sheet closes, or the officer looks at the Ask side: the pane goes.
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <Harness onValue={keep} shown={false} />
        </FrappThemeProvider>,
      ),
    );
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <Harness onValue={keep} />
        </FrappThemeProvider>,
      ),
    );
    expect(screenText(tree)).toContain(actPointsHeadline(5, 1));
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).toHaveBeenCalledWith({
      id: "sg-1",
      points: { target_user_ids: ["u1"] },
    });
  });

  it("sends nothing else while a Confirm is out", async () => {
    let land!: (value: unknown) => void;
    hooks.accept.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    await act(async () => {
      void byLabel(tree, ACT_COPY.confirm).props.onPress();
    });
    expect(session.working).toBe(true);
    expect(session.submit("Give Sam 2 points")).toBe(false);
    expect(hooks.request).toHaveBeenCalledTimes(1);
    await act(async () =>
      land({ result: { outcome: { adjusted: 2, skipped: 0 } } }),
    );
    expect(session.working).toBe(false);
    expect(screenText(tree)).toContain(actPointsDoneLine(5, 2, 0));
  });

  it("asks which event, and sends the pick with the amount and reason it had", async () => {
    hooks.request.mockResolvedValue({
      ...BASE,
      status: "needs_event",
      event_choice: {
        amount: 5,
        reason: "Came to chapter",
        events: [
          { id: "e1", name: "Chapter", start_time: "2026-11-09T23:00:00Z" },
        ],
      },
    });
    hooks.audience.mockResolvedValue(POINTS);
    const tree = await say(render(), "Give 5 points to everyone at chapter");
    expect(screenText(tree)).toContain(ACT_COPY.pick_event);
    const choice = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel).startsWith("Chapter."),
    )[0]!;
    await act(async () => choice.props.onPress());
    expect(hooks.audience).toHaveBeenCalledWith({
      eventId: "e1",
      amount: 5,
      reason: "Came to chapter",
    });
    expect(screenText(tree)).toContain(actPointsHeadline(5, 2));
  });

  it("says what it still needs for a request it couldn't place", async () => {
    hooks.request.mockResolvedValue({
      ...BASE,
      status: "unclear",
      missing: "members",
    });
    const tree = await say(render(), "Give points");
    expect(screenText(tree)).toContain(actMissingLine("members" as never));
  });

  it("says a request failed, with Try again", async () => {
    hooks.request.mockRejectedValue(new Error("Network request failed"));
    const tree = await say(render(), "Give Ana 5 points");
    hooks.request.mockResolvedValue(POINTS);
    await act(async () => byLabel(tree, ACT_COPY.try_again).props.onPress());
    expect(hooks.request).toHaveBeenCalledTimes(2);
    expect(screenText(tree)).toContain(actPointsHeadline(5, 2));
  });

  it("reports a proposal by its suggestion id", async () => {
    const tree = await say(render(), "Give Ana and Jordan 5 points");
    act(() =>
      byLabel(
        tree,
        `${AI_REPORT_COPY.action}: ${ACT_COPY.card_points_title_give}`,
      ).props.onPress(),
    );
    expect(reporting.report).toHaveBeenCalledWith({
      subject: "ai_suggestion",
      subjectId: "sg-1",
    });
  });
});

describe("AskModeSwitch", () => {
  it("is a two-way radio group that reports only a change", () => {
    const onChange = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <AskModeSwitch mode="ask" onChange={onChange} />
        </FrappThemeProvider>,
      );
    });
    const ask = byLabel(tree, ACT_COPY.mode_ask);
    const doSide = byLabel(tree, ACT_COPY.mode_do);
    expect(ask.props.accessibilityState).toEqual({ checked: true });
    act(() => ask.props.onPress());
    expect(onChange).not.toHaveBeenCalled();
    act(() => doSide.props.onPress());
    expect(onChange).toHaveBeenCalledWith("do");
  });
});
