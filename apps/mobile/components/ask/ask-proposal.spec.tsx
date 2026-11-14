/** @vitest-environment jsdom */
import React, { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActResponse,
  AskCardEnd,
  AskProposalResolution,
} from "@repo/hooks";
import {
  ACT_COPY,
  AI_REPORT_COPY,
  actConfirmRefusalLine,
  actMissingLine,
  actNoteLine,
  actPointsDoneLine,
  actPointsHeadline,
} from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * A proposal in the Ask conversation on the phone (#718): an officer says
 * what to do, sees exactly what would happen and to whom, and nothing changes
 * until they press Confirm. The sheet around it is `ask-sheet.spec.tsx`'s.
 */
const hooks = vi.hoisted(() => ({
  audience: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  seed: undefined as unknown,
  cards: { byId: new Map<string, unknown>(), settled: true },
}));
// A purple chapter: Confirm takes its solid accent pair (#4702).
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#8B5CF6",
    accentPrimary: "#7C3AED",
    accentOnPrimary: "#FFFFFF",
  }),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
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
  // The hook has its own spec (`use-ask-cards.spec.tsx`).
  useAskCards: () => hooks.cards,
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

import {
  AskAnswerCards,
  AskProposal,
  type ActLink,
  type KeptTargets,
} from "./ask-proposal";

const reporting = {
  offered: true,
  isReported: () => false,
  report: vi.fn(),
  reportSheet: null,
};
const onOpen = vi.fn<(link: ActLink) => void>();

/**
 * The turn around the card, as the sheet holds it: the proposal, how it
 * ended, and the members left on it. The card itself comes and goes with the
 * sheet (`shown`).
 */
function Turn({ first, shown = true }: { first: unknown; shown?: boolean }) {
  const [proposal, setProposal] = useState(first as ActResponse);
  const [resolution, setResolution] = useState<AskProposalResolution | null>(
    null,
  );
  const [kept, setKept] = useState<KeptTargets>({});
  if (!shown) return null;
  return (
    <AskProposal
      proposal={proposal}
      resolution={resolution}
      kept={kept}
      onKeep={(id, targets) =>
        setKept((current) => ({ ...current, [id]: targets }))
      }
      report={reporting as never}
      onProposal={setProposal}
      onResolved={setResolution}
      onOpen={onOpen}
    />
  );
}

function show(proposal: unknown): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Turn first={proposal} />
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
  hooks.accept.mockResolvedValue({
    result: { outcome: { adjusted: 2, skipped: 0 } },
  });
  hooks.dismiss.mockResolvedValue({});
});

const MISSING_WHO = {
  ...TASK,
  suggestion: {
    ...TASK.suggestion,
    task: { ...TASK.suggestion.task, assignee_id: null },
  },
};

describe("a proposal in the Ask conversation", () => {
  it("says exactly what will happen and to whom, and changes nothing until Confirm", async () => {
    const tree = show(POINTS);
    const text = screenText(tree);
    expect(text).toContain(actPointsHeadline(5, 2));
    expect(text).toContain("Came to chapter");
    expect(text).toContain("Ana Ruiz");
    expect(text).toContain("Jordan Lee");
    expect(text).toContain(ACT_COPY.mine_only);
    expect(hooks.accept).not.toHaveBeenCalled();

    // Confirm is the chapter's solid accent, as web's is (#4702).
    const confirmStyle: Record<string, unknown> = Object.assign(
      {},
      ...[byLabel(tree, ACT_COPY.confirm).props.style({ pressed: false })]
        .flat(Infinity)
        .filter(Boolean),
    );
    expect(confirmStyle.backgroundColor).toBe("#7C3AED");

    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    // Nothing was changed on the card, so nothing is sent but the yes.
    expect(hooks.accept).toHaveBeenCalledWith({ id: "sg-1" });
    const after = screenText(tree);
    // One line in the card's place: what it was about, and what happened.
    expect(after).toContain("Came to chapter");
    expect(after).toContain(actPointsDoneLine(5, 2, 0));
    expect(byLabel(tree, ACT_COPY.confirm)).toBeUndefined();
    // The phone has no points page to open.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("removes a member, adds one from the roster, and confirms the list as it stands", async () => {
    const tree = show(POINTS);
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
    const tree = show(POINTS);
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
    const tree = show(POINTS);
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(screenText(tree)).toContain(actPointsDoneLine(5, 1, 1));
  });

  it.each([
    "ai.suggestion.decided",
    "ai.suggestion.expired",
    "ai.suggestion.not_found",
  ])(
    "says a card is no longer waiting when Confirm finds it gone (%s), with no buttons left",
    async (code) => {
      hooks.accept.mockRejectedValue({ code });
      const tree = show(POINTS);
      await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
      const text = screenText(tree);
      expect(text).toContain(ACT_COPY.gone);
      expect(text).not.toContain(ACT_COPY.cancelled);
      expect(byLabel(tree, ACT_COPY.confirm)).toBeUndefined();
      expect(byLabel(tree, ACT_COPY.cancel)).toBeUndefined();
    },
  );

  it("uses the shared words for a refusal the server names", async () => {
    const code = "ai.act.partial";
    const line = actConfirmRefusalLine(code);
    hooks.accept.mockRejectedValue({ code });
    const tree = show(POINTS);
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    // Whatever the shared map says for a code, or the plain failure line.
    expect(screenText(tree)).toContain(line ?? ACT_COPY.failed);
  });

  it("cancels a proposal, and treats one already gone as cancelled", async () => {
    const tree = show(POINTS);
    await act(async () => byLabel(tree, ACT_COPY.cancel).props.onPress());
    expect(hooks.dismiss).toHaveBeenCalledWith("sg-1");
    expect(screenText(tree)).toContain(ACT_COPY.cancelled);

    hooks.dismiss.mockRejectedValue({ code: "ai.suggestion.expired" });
    const again = show(POINTS);
    await act(async () => byLabel(again, ACT_COPY.cancel).props.onPress());
    expect(screenText(again)).toContain(ACT_COPY.cancelled);
  });

  it("does not say cancelled for a card decided somewhere else: it may have been confirmed", async () => {
    hooks.dismiss.mockRejectedValue({ code: "ai.suggestion.decided" });
    const tree = show(POINTS);
    await act(async () => byLabel(tree, ACT_COPY.cancel).props.onPress());
    const text = screenText(tree);
    expect(text).toContain(ACT_COPY.gone);
    expect(text).not.toContain(ACT_COPY.cancelled);
  });

  it("confirms a complete task, and links to Tasks", async () => {
    const tree = show(TASK);
    expect(screenText(tree)).toContain("Book the bus");
    expect(screenText(tree)).toContain("Jordan Lee");
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).toHaveBeenCalledWith({ id: "sg-2" });
    const text = screenText(tree);
    expect(text).toContain("Book the bus");
    expect(text).toContain(ACT_COPY.done_task);
    act(() => byLabel(tree, ACT_COPY.open_tasks).props.onPress());
    expect(onOpen).toHaveBeenCalledWith({
      href: "/tasks",
      label: ACT_COPY.open_tasks,
    });
  });

  it("opens the task form, not a task, when who or when is missing", async () => {
    const tree = show(MISSING_WHO);
    expect(screenText(tree)).toContain(ACT_COPY.pick_member);
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).not.toHaveBeenCalled();
    expect((hooks.seed as { title: string }).title).toBe("Book the bus");
  });

  it("confirms an event proposal, and links to Events", async () => {
    const tree = show({
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

  it("says which names it couldn't place, above the control that adds them", () => {
    const tree = show({
      ...POINTS,
      notes: [
        { type: "unmatched_name", name: "Jordy" },
        { type: "ambiguous_name", name: "Sam" },
      ],
    });
    const text = screenText(tree);
    expect(text).toContain(
      actNoteLine({ type: "unmatched_name", name: "Jordy" }),
    );
    expect(text).toContain(
      actNoteLine({ type: "ambiguous_name", name: "Sam" }),
    );
    expect(byLabel(tree, ACT_COPY.add_member)).toBeDefined();
  });

  it("accepts a task finished in the form with what the officer set there", async () => {
    const tree = show(MISSING_WHO);
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
    const tree = show(POINTS);
    act(() =>
      byLabel(tree, `${ACT_COPY.remove_member} Jordan Lee`).props.onPress(),
    );
    // The sheet closes: the card goes, and the sheet's state stays.
    for (const shown of [false, true]) {
      act(() =>
        tree.update(
          <FrappThemeProvider>
            <Turn first={POINTS} shown={shown} />
          </FrappThemeProvider>,
        ),
      );
    }
    expect(screenText(tree)).toContain(actPointsHeadline(5, 1));
    await act(async () => byLabel(tree, ACT_COPY.confirm).props.onPress());
    expect(hooks.accept).toHaveBeenCalledWith({
      id: "sg-1",
      points: { target_user_ids: ["u1"] },
    });
  });

  it("holds the card's controls while a Confirm is out", async () => {
    let land!: (value: unknown) => void;
    hooks.accept.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    const tree = show(POINTS);
    await act(async () => {
      void byLabel(tree, ACT_COPY.confirm).props.onPress();
    });
    expect(byLabel(tree, ACT_COPY.confirm).props.disabled).toBe(true);
    expect(byLabel(tree, ACT_COPY.cancel).props.disabled).toBe(true);
    await act(async () =>
      land({ result: { outcome: { adjusted: 2, skipped: 0 } } }),
    );
    expect(screenText(tree)).toContain(actPointsDoneLine(5, 2, 0));
  });

  it("asks which event, and sends the pick so the thread's other cards stay", async () => {
    hooks.audience.mockResolvedValue(POINTS);
    const tree = show({
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
      keepEarlier: true,
    });
    expect(screenText(tree)).toContain(actPointsHeadline(5, 2));
  });

  it("says a pick didn't go through, and keeps the choices", async () => {
    hooks.audience.mockRejectedValue(new Error("Network request failed"));
    const tree = show({
      ...BASE,
      status: "needs_event",
      event_choice: {
        amount: 5,
        reason: "",
        events: [
          { id: "e1", name: "Chapter", start_time: "2026-11-09T23:00:00Z" },
        ],
      },
    });
    const choice = () =>
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          String(node.props.accessibilityLabel).startsWith("Chapter."),
      )[0]!;
    await act(async () => choice().props.onPress());
    expect(
      tree.root.findAll((node) => node.props.accessibilityRole === "alert"),
    ).not.toHaveLength(0);
    expect(choice().props.disabled).toBe(false);
  });

  it("says what it still needs for a request it couldn't place", () => {
    const tree = show({ ...BASE, status: "unclear", missing: "members" });
    expect(screenText(tree)).toContain(actMissingLine("members" as never));
  });

  it("reports a proposal by its suggestion id", () => {
    const tree = show(POINTS);
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

/** The cards an answer came with (`answer.proposals`, #4904). */
describe("AskAnswerCards", () => {
  const task = (id: string, title: string) => ({
    ...TASK.suggestion,
    id,
    task: { ...TASK.suggestion.task, title },
  });

  function Cards({ ids }: { ids: string[] }) {
    const [ended, setEnded] = useState<Record<string, AskCardEnd>>({});
    return (
      <AskAnswerCards
        ids={ids}
        ended={ended}
        onEnded={(id, end) => setEnded((now) => ({ ...now, [id]: end }))}
        kept={{}}
        onKeep={() => undefined}
        report={reporting as never}
        onOpen={onOpen}
      />
    );
  }
  const showCards = (ids: string[]): ReactTestRenderer => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <Cards ids={ids} />
        </FrappThemeProvider>,
      );
    });
    return tree;
  };
  const labelled = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === label,
    );

  beforeEach(() => {
    hooks.cards = { byId: new Map(), settled: true };
  });

  it("draws each card, and one that ends becomes a line while the other waits", async () => {
    hooks.cards = {
      byId: new Map<string, unknown>([
        ["s1", task("s1", "Buy cups")],
        ["s2", task("s2", "Book the hall")],
      ]),
      settled: true,
    };
    hooks.dismiss.mockResolvedValue({});
    const tree = showCards(["s1", "s2"]);
    expect(screenText(tree)).toContain("Buy cups");
    expect(screenText(tree)).toContain("Book the hall");
    expect(labelled(tree, ACT_COPY.cancel)).toHaveLength(2);
    await act(async () => labelled(tree, ACT_COPY.cancel)[0]!.props.onPress());
    expect(hooks.dismiss).toHaveBeenCalledWith("s1");
    const text = screenText(tree);
    expect(text).toContain(ACT_COPY.cancelled);
    // The line still says what the card was about.
    expect(text).toContain("Buy cups");
    expect(labelled(tree, ACT_COPY.confirm)).toHaveLength(1);
  });

  it("holds a frame while the cards are read, and says so when one is no longer waiting", () => {
    hooks.cards = { byId: new Map(), settled: false };
    const waiting = showCards(["s1"]);
    expect(screenText(waiting)).not.toContain(ACT_COPY.gone);
    expect(
      waiting.root.findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          node.props.accessibilityState?.busy === true,
      ),
    ).toHaveLength(1);
    hooks.cards = { byId: new Map(), settled: true };
    expect(screenText(showCards(["s1"]))).toContain(ACT_COPY.gone);
  });
});
