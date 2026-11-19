/** @vitest-environment jsdom */
import React, { useEffect, useState } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_MEETING_CONTENT,
  MEETING_COPY,
  MINUTES_EDITOR_COPY,
  MINUTES_FLOW_COPY,
  minutesEditDraftOf,
  type MeetingContent,
  type MeetingSectionKey,
} from "@repo/validation";
import { localIsoDate } from "@repo/formatting";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import type { MinutesEditing } from "@/lib/minutes/use-minutes-editor";

/**
 * The phone's section editor (#4412): each kind of section in its own
 * controls, the web editor's rules for which show, and nothing stored by
 * accident (a day is only set when picked, an empty row isn't kept).
 */
const state = vi.hoisted(() => ({
  agenda: [] as unknown[],
  menu: null as { actions: { label: string; run: () => void }[] } | null,
  picker: null as Record<string, unknown> | null,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useEvent: () => ({ data: { agenda: state.agenda } }),
  useMemberDisplayNames: () => ({
    nameFor: (id: string) => (id === "u2" ? "Shawn Lee" : null),
    avatarFor: () => null,
    avatarTintFor: () => null,
  }),
}));
vi.mock("@/lib/tasks/use-who-directory", () => ({
  useWhoDirectory: () => ({
    directory: {},
    people: "ready",
    sets: "ready",
    followers: [],
  }),
}));
vi.mock("@/components/tasks/who-picker-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    WhoPickerSheet: forwardRef(function WhoPickerSheet(
      props: Record<string, unknown>,
    ) {
      state.picker = props;
      return null;
    }),
  };
});
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63", accentOnPrimary: "#131211" }),
}));

import { MinutesEditor } from "./minutes-editor";

// The meeting's day in whatever zone the suite runs in (CI runs it in
// Tokyo too), and the week after it, which an action item's due offers.
const MEETING_START = "2026-11-09T12:00:00Z";
const MEETING_DAY = localIsoDate(new Date(MEETING_START));
const WEEK_AFTER = localIsoDate(
  new Date(new Date(MEETING_START).getTime() + 7 * 24 * 60 * 60 * 1000),
);

function meeting(content: Partial<MeetingContent>, sections: string[] = []) {
  return {
    id: "m1",
    event_id: "e1",
    event_start_time: MEETING_START,
    meeting_type: "chapter",
    other_label: null,
    updated_at: "v1",
    sections,
    attendees: null,
    content: { ...EMPTY_MEETING_CONTENT, ...content },
  } as never;
}

const seen: { content: MeetingContent } = {
  content: EMPTY_MEETING_CONTENT,
};
/** The editor over a draft held in plain state, as the hook would hold it. */
function Harness({
  start,
  byHand,
}: {
  start: ReturnType<typeof meeting>;
  byHand: boolean;
}) {
  const [draft, setDraft] = useState(() => minutesEditDraftOf(start));
  const [kept, setKept] = useState<MeetingSectionKey[]>([]);
  useEffect(() => {
    seen.content = draft.content;
  });
  const editing = {
    draft,
    kept,
    stale: false,
    edit: (patch: Partial<MeetingContent>) => {
      setKept((current) => [
        ...current,
        ...(Object.keys(patch) as MeetingSectionKey[]),
      ]);
      setDraft((current) => ({
        ...current,
        content: { ...current.content, ...patch },
      }));
    },
    keep: (key: MeetingSectionKey) => setKept((current) => [...current, key]),
    loadTheirs: vi.fn(),
  } as unknown as MinutesEditing;
  return (
    <MinutesEditor
      meeting={start}
      editing={editing}
      byHand={byHand}
      disabled={false}
      quoteFor={() => null}
      menuFor={(menu) => ({
        ...menu,
        open: () => {
          state.menu = menu;
        },
      })}
    />
  );
}

function render(start: ReturnType<typeof meeting>, byHand = false) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Harness start={start} byHand={byHand} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.onPress === "function" &&
      (node.props.accessibilityLabel === label || drawnText(node) === label),
  )[0];
const field = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "TextInput" &&
      node.props.accessibilityLabel === label,
  )[0];

beforeEach(() => {
  state.agenda = [];
  state.menu = null;
  state.picker = null;
});

describe("MinutesEditor", () => {
  it("shows a draft's filled sections, and adds the rest from Add a section", () => {
    const tree = render(meeting({ summary: "We met." }));
    expect(field(tree, "Summary")).toBeDefined();
    expect(field(tree, "TL;DR")).toBeUndefined();
    act(() =>
      button(tree, MINUTES_FLOW_COPY.review.addSection).props.onPress(),
    );
    const tldr = state.menu?.actions.find((action) => action.label === "TL;DR");
    act(() => tldr!.run());
    expect(field(tree, "TL;DR")).toBeDefined();
    // Added, it stays on screen though still empty.
    expect(field(tree, "TL;DR")?.props.value).toBe("");
  });

  it("gives an action item who and a due day only when picked", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
    try {
      whoAndDue();
    } finally {
      vi.useRealTimers();
    }
  });

  function whoAndDue() {
    const tree = render(meeting({}, ["action_items"]), true);
    act(() => button(tree, MINUTES_EDITOR_COPY.actionItem.add).props.onPress());
    act(() =>
      field(tree, MINUTES_EDITOR_COPY.actionItem.label(1))!.props.onChangeText(
        "Book the hall",
      ),
    );
    expect(seen.content.action_items[0]).toEqual({
      text: "Book the hall",
      owner_user_id: null,
      due_date: null,
    });

    // Who: the Assign to picker, one person.
    act(() =>
      button(
        tree,
        `${MINUTES_EDITOR_COPY.actionItem.who}: ${MINUTES_EDITOR_COPY.actionItem.nobody}`,
      ).props.onPress(),
    );
    expect(state.picker?.single).toBe(true);
    act(() =>
      (state.picker!.onChange as (who: unknown) => void)({
        kind: "person",
        userId: "u2",
      }),
    );
    expect(seen.content.action_items[0]!.owner_user_id).toBe("u2");
    expect(screenText(tree)).toContain("Shawn Lee");

    // Due: a week after the meeting, once asked for, and taken off again.
    act(() =>
      button(tree, MINUTES_EDITOR_COPY.actionItem.addDue).props.onPress(),
    );
    expect(seen.content.action_items[0]!.due_date).toBe(WEEK_AFTER);
    act(() =>
      button(tree, MINUTES_EDITOR_COPY.actionItem.removeDue).props.onPress(),
    );
    expect(seen.content.action_items[0]!.due_date).toBeNull();

    act(() =>
      button(tree, MINUTES_EDITOR_COPY.actionItem.remove(1)).props.onPress(),
    );
    expect(seen.content.action_items).toEqual([]);
  }

  it("says a Coming up line without a day isn't kept, once the officer moves on", () => {
    const tree = render(meeting({}, ["dates"]), true);
    act(() => button(tree, MEETING_COPY.addDate).props.onPress());
    act(() =>
      field(tree, `${MEETING_COPY.dateWhat} 1`)!.props.onChangeText(
        "Installation",
      ),
    );
    // Not on the first letter: nothing moves under the cursor.
    expect(screenText(tree)).not.toContain(MEETING_COPY.dateNeedsDay);
    act(() => field(tree, `${MEETING_COPY.dateWhat} 1`)!.props.onBlur());
    expect(screenText(tree)).toContain(MEETING_COPY.dateNeedsDay);
    act(() => button(tree, MINUTES_EDITOR_COPY.date.pick).props.onPress());
    expect(seen.content.dates[0]).toEqual({
      date: MEETING_DAY,
      text: "Installation",
    });
    expect(screenText(tree)).not.toContain(MEETING_COPY.dateNeedsDay);
  });

  it("tables an agenda item in one tap, carrying where it was first tabled", () => {
    state.agenda = [
      {
        id: "a1",
        text: "Bylaws vote",
        tabled_from: {
          meeting_id: "11111111-1111-4111-8111-111111111111",
          start_time: "2026-11-02T23:00:00.000Z",
          times: 1,
        },
      },
    ];
    const tree = render(meeting({}, ["tabled"]), true);
    act(() =>
      button(
        tree,
        MINUTES_EDITOR_COPY.tabled.tableItem("Bylaws vote"),
      ).props.onPress(),
    );
    expect(seen.content.tabled).toEqual([
      {
        text: "Bylaws vote",
        first_meeting_id: "11111111-1111-4111-8111-111111111111",
        first_start_time: "2026-11-02T23:00:00.000Z",
        times: 2,
      },
    ]);
    // Tabled, it is no longer offered.
    expect(
      button(tree, MINUTES_EDITOR_COPY.tabled.tableItem("Bylaws vote")),
    ).toBeUndefined();
  });

  it("takes a vote count as whole numbers only", () => {
    const tree = render(
      meeting({ decisions: [{ text: "Dues rise", vote: null }] }),
    );
    act(() =>
      button(tree, MINUTES_EDITOR_COPY.decision.addVote).props.onPress(),
    );
    act(() =>
      field(tree, MINUTES_EDITOR_COPY.decision.against)!.props.onChangeText(
        "3x",
      ),
    );
    expect(seen.content.decisions[0]!.vote).toEqual({
      for: 0,
      against: 3,
      abstain: 0,
    });
    act(() =>
      button(tree, MINUTES_EDITOR_COPY.decision.removeVote).props.onPress(),
    );
    expect(seen.content.decisions[0]!.vote).toBeNull();
  });
});
