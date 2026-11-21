import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EventAgendaItem, EventAttachment } from "@repo/validation";

/**
 * An event's agenda and attachments on its sheet (#4934): read by everyone
 * who sees the event, edited in place by an `events:update` holder through
 * one coalescing editor (`useEventListsEditor`, which has its own spec).
 */

const state = vi.hoisted(() => ({
  signed: vi.fn(),
  documents: [] as unknown[],
  toast: vi.fn(),
  toastFailure: vi.fn(),
  gateAllowed: true,
  change: vi.fn(),
  flush: vi.fn(async () => {}),
  suggestions: [] as unknown[],
  aiAvailable: false,
  writing: false,
  refresh: vi.fn(),
  add: vi.fn(async () => {}),
  dismiss: vi.fn(async () => {}),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useDocumentDownloadUrl: () => ({ mutateAsync: state.signed }),
  useDocuments: () => ({
    data: state.documents,
    isPending: false,
    isError: false,
  }),
  useEventListsEditor: (
    _eventId: string,
    lists: { agenda: EventAgendaItem[]; attachments: EventAttachment[] },
  ) => ({
    ...lists,
    saving: false,
    change: state.change,
    flush: state.flush,
    settle: state.flush,
  }),
  useAgendaSuggestions: () => ({
    suggestions: state.suggestions,
    aiAvailable: state.aiAvailable,
    loading: false,
    writing: state.writing,
    refreshFailed: false,
    refresh: state.refresh,
  }),
  useAgendaSuggestionActions: () => ({
    add: state.add,
    dismiss: state.dismiss,
    adding: false,
  }),
}));

vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => ({ allowed: state.gateAllowed }),
}));

vi.mock("@/lib/failure-toast", () => ({ toastFailure: state.toastFailure }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

import {
  AgendaDraftList,
  EventAgendaSection,
  EventAttachmentsSection,
  EventMeetingLists,
} from "./event-agenda";

const agenda: EventAgendaItem[] = [
  { id: "a1", text: "Treasurer report", done: false },
  { id: "a2", text: "Rush recap", done: true },
];
const budgetLink: EventAttachment = {
  id: "x1",
  kind: "link",
  url: "https://docs.example.com/budget",
  title: "Budget",
};
const bylaws: EventAttachment = {
  id: "x2",
  kind: "document",
  document_id: "doc-1",
  title: "Bylaws",
};
const attachments: EventAttachment[] = [budgetLink, bylaws];

/** The entry at `index`, or a failure naming it. */
function at<T>(list: readonly T[], index: number): T {
  const entry = list[index];
  if (entry === undefined) throw new Error(`nothing at ${index}`);
  return entry;
}

/** Run each update the section hands up against `current`. */
function applied<T>(onChange: ReturnType<typeof vi.fn>, current: T[]): T[][] {
  return onChange.mock.calls.map(([update]) =>
    (update as (c: T[]) => T[])(current),
  );
}

beforeEach(() => {
  state.signed.mockReset();
  state.toast.mockReset();
  state.toastFailure.mockReset();
  state.change.mockReset();
  state.documents = [];
  state.gateAllowed = true;
});

describe("EventAgendaSection", () => {
  it("shows a member the agenda in order, with no controls", () => {
    render(
      <EventAgendaSection agenda={agenda} canEdit={false} onChange={vi.fn()} />,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      ["1.Treasurer report", "2.Done: Rush recap"],
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("draws nothing for a member when the meeting has no agenda", () => {
    const { container } = render(
      <EventAgendaSection agenda={[]} canEdit={false} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hands up a check-off, an add, a move and a remove as updates of the latest list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EventAgendaSection agenda={agenda} canEdit onChange={onChange} />);
    await user.click(
      screen.getByRole("checkbox", { name: "Treasurer report" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Add an agenda item" }),
      "  New   business {Enter}",
    );
    // The grip moves its row: dragged, or its arrow keys.
    screen.getByRole("button", { name: "Reorder Rush recap" }).focus();
    await user.keyboard("{ArrowUp}");
    await user.click(
      screen.getByRole("button", { name: 'Remove "Treasurer report"' }),
    );
    const runs = applied(onChange, agenda);
    expect(at(at(runs, 0), 0).done).toBe(true);
    expect(at(runs, 1)).toHaveLength(3);
    expect(at(at(runs, 1), 2)).toMatchObject({
      text: "New business",
      done: false,
    });
    expect(at(at(runs, 1), 2).id).toEqual(expect.any(String));
    expect(at(runs, 2).map((item) => item.id)).toEqual(["a2", "a1"]);
    expect(at(runs, 3)).toEqual([at(agenda, 1)]);
  });

  it("keeps focus on the moved row's grip, and says where it went", async () => {
    const user = userEvent.setup();
    function Held() {
      const [items, setItems] = useState(agenda);
      return (
        <EventAgendaSection
          agenda={items}
          canEdit
          onChange={(update) => setItems(update)}
        />
      );
    }
    render(<Held />);
    screen.getByRole("button", { name: "Reorder Treasurer report" }).focus();
    await user.keyboard("{ArrowDown}");
    const grip = screen.getByRole("button", {
      name: "Reorder Treasurer report",
    });
    expect(grip).toHaveFocus();
    expect(screen.getByText("Treasurer report, 2 of 2")).toBeInTheDocument();
    // A second press still reaches it: nothing further down to go.
    await user.keyboard("{ArrowUp}");
    expect(
      screen.getByRole("button", { name: "Reorder Treasurer report" }),
    ).toHaveFocus();
  });

  it("moves a row dragged by its grip past its neighbour's middle", () => {
    // Each row 40px tall, stacked from the top: the second's middle is 60.
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const index = this.parentElement
          ? Array.from(this.parentElement.children).indexOf(this)
          : 0;
        const top = index * 40;
        return {
          top,
          bottom: top + 40,
          height: 40,
          left: 0,
          right: 300,
          width: 300,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      });
    const onChange = vi.fn();
    render(<EventAgendaSection agenda={agenda} canEdit onChange={onChange} />);
    const grip = screen.getByRole("button", {
      name: "Reorder Treasurer report",
    });
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 20 });
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 70 });
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 70 });
    rect.mockRestore();
    const runs = applied(onChange, agenda);
    expect(at(runs, 0).map((item) => item.id)).toEqual(["a2", "a1"]);
  });

  it("applies a move to the list as it stands when the update runs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EventAgendaSection agenda={agenda} canEdit onChange={onChange} />);
    screen.getByRole("button", { name: "Reorder Rush recap" }).focus();
    await user.keyboard("{ArrowUp}");
    // A newer item landed first in the meantime.
    const newer = [{ id: "n", text: "New", done: false }, ...agenda];
    expect(at(applied(onChange, newer), 0).map((item) => item.id)).toEqual([
      "n",
      "a2",
      "a1",
    ]);
  });
});

describe("checking items off (Paul 2026-11-19)", () => {
  it("holds the checkboxes until the meeting starts, and says so once", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EventAgendaSection
        agenda={agenda}
        canEdit
        checkOffOpen={false}
        onChange={onChange}
      />,
    );
    const box = screen.getByRole("checkbox", { name: "Treasurer report" });
    expect(box).toBeDisabled();
    expect(
      screen.getAllByText("Items can be checked off once the meeting starts."),
    ).toHaveLength(1);
    await user.click(box);
    expect(onChange).not.toHaveBeenCalled();
    // The list itself can still be written before the start.
    expect(
      screen.getByRole("textbox", { name: "Add an agenda item" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Reorder Rush recap" }),
    ).toBeEnabled();
  });

  it("counts what is done once it has started", () => {
    render(
      <EventAgendaSection
        agenda={agenda}
        canEdit
        checkOffOpen
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("1 of 2 done")).toBeInTheDocument();
  });

  it("draws the event form's list with no checkboxes", () => {
    render(
      <AgendaDraftList
        agenda={agenda}
        onChange={vi.fn()}
        draft=""
        onDraftChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Add an agenda item" }),
    ).toBeInTheDocument();
  });
});

describe("EventAttachmentsSection", () => {
  it("opens a link in a new tab and a document to read, with no edit controls for a member", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    state.signed.mockResolvedValue({ downloadUrl: "https://files.example/x" });
    render(
      <EventAttachmentsSection
        attachments={attachments}
        canEdit={false}
        documentsOn
        onChange={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /Budget/ });
    expect(link).toHaveAttribute("href", "https://docs.example.com/budget");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await user.click(screen.getByRole("button", { name: /Bylaws/ }));
    expect(state.signed).toHaveBeenCalledWith("doc-1");
    expect(open).toHaveBeenCalledWith(
      "https://files.example/x",
      "_blank",
      "noopener",
    );
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    open.mockRestore();
  });

  it("says a document is gone when Chapter Files no longer has it", async () => {
    const user = userEvent.setup();
    state.signed.mockRejectedValue({ status: 404 });
    render(
      <EventAttachmentsSection
        attachments={[bylaws]}
        canEdit={false}
        documentsOn
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Bylaws/ }));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "This file is gone from Chapter Files",
      }),
    );
  });

  it("keeps a document openable while the module read can't say, and disables it only when it's off", () => {
    const { rerender } = render(
      <EventAttachmentsSection
        attachments={[bylaws]}
        canEdit
        documentsOn={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^Bylaws/ })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Attach from Chapter Files" }),
    ).toBeNull();
    rerender(
      <EventAttachmentsSection
        attachments={[bylaws]}
        canEdit
        documentsOn={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^Bylaws/ })).toBeDisabled();
    expect(screen.getByText("Chapter Files is off")).toBeInTheDocument();
  });

  it("draws nothing for a member when the meeting has none", () => {
    const { container } = render(
      <EventAttachmentsSection
        attachments={[]}
        canEdit={false}
        documentsOn
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("refuses a bad or too-long link with its reason, and titles an untitled one by its domain", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EventAttachmentsSection
        attachments={[]}
        canEdit
        documentsOn={false}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add a link" }));
    const field = screen.getByRole("textbox", { name: "Link" });
    await user.type(field, "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByText(/starting with http/)).toBeInTheDocument();
    await user.clear(field);
    await user.click(field);
    await user.paste(`https://a.example/${"x".repeat(2100)}`);
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByText(/too long/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, "https://www.docs.example.com/agenda");
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(at(applied(onChange, [] as EventAttachment[]), 0)).toEqual([
      expect.objectContaining({
        kind: "link",
        url: "https://www.docs.example.com/agenda",
        title: "docs.example.com",
      }),
    ]);
  });

  it("attaches a file it doesn't hold yet, with its name cut to the limit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const long = "Spring budget ".repeat(20);
    state.documents = [
      { id: "doc-1", title: "Bylaws", folder: null },
      { id: "doc-2", title: long, folder: "Treasury" },
    ];
    render(
      <EventAttachmentsSection
        attachments={[bylaws]}
        canEdit
        documentsOn
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Attach from Chapter Files" }),
    );
    // Bylaws is attached already, so it isn't offered again.
    expect(screen.queryByRole("button", { name: "Bylaws" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Spring budget/ }));
    const next = at(applied(onChange, [bylaws]), 0);
    expect(at(next, 1)).toMatchObject({
      kind: "document",
      document_id: "doc-2",
    });
    expect(at(next, 1).title).toHaveLength(120);
  });

  it("offers no add controls once the event holds ten", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      id: `l${i}`,
      kind: "link" as const,
      url: "https://a.example",
      title: `L${i}`,
    }));
    render(
      <EventAttachmentsSection
        attachments={ten}
        canEdit
        documentsOn
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add a link" })).toBeNull();
    expect(
      screen.getByText("An event holds 10 attachments."),
    ).toBeInTheDocument();
  });
});

describe("EventMeetingLists", () => {
  it("offers the controls only when the chapter's writes are allowed", () => {
    state.gateAllowed = false;
    render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda, attachments }}
        canEdit
        upcoming={false}
        checkOffOpen
        documentsOn
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    // The lists still read.
    expect(screen.getByText("Treasurer report")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Budget/ })).toBeInTheDocument();
  });

  it("routes both sections through the one editor", async () => {
    const user = userEvent.setup();
    render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda, attachments }}
        canEdit
        upcoming={false}
        checkOffOpen
        documentsOn
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Rush recap" }));
    await user.click(screen.getByRole("button", { name: 'Remove "Budget"' }));
    expect(state.change.mock.calls.map(([field]) => field)).toEqual([
      "agenda",
      "attachments",
    ]);
  });
});

describe("A started meeting's agenda (Paul 2026-11-20)", () => {
  it("is checked off, and offers no add, move or remove", () => {
    render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda, attachments }}
        canEdit
        upcoming
        checkOffOpen
        documentsOn
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Rush recap" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Remove "Rush recap"/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Move/ })).toBeNull();
    expect(screen.queryByLabelText("Add an agenda item")).toBeNull();
    // Attachments still take a link in the room.
    expect(
      screen.getByRole("button", { name: 'Remove "Budget"' }),
    ).toBeEnabled();
  });

  it("before the start, is edited and not checked off", () => {
    render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda, attachments }}
        canEdit
        upcoming
        checkOffOpen={false}
        documentsOn
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Rush recap" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: 'Remove "Rush recap"' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Add an agenda item")).toBeInTheDocument();
  });
});

describe("Suggested agenda items (#5534)", () => {
  const tabled = {
    id: "s1",
    kind: "tabled",
    text: "Formal budget",
    tabled_from: {
      meeting_id: "m-first",
      start_time: "2026-11-11T23:00:00.000Z",
      times: 2,
    },
    source_meeting_id: "m-last",
    reason: null,
  };
  const suggested = {
    id: "s2",
    kind: "ai",
    text: "Venue check-in",
    tabled_from: null,
    source_meeting_id: "m-last",
    reason: "Still open from last week",
  };

  beforeEach(() => {
    state.suggestions = [tabled, suggested];
    state.aiAvailable = true;
    state.writing = false;
  });

  it("lists tabled matters with where they came from, then the model's, for an upcoming meeting", () => {
    render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda: [], attachments: [] }}
        canEdit
        upcoming
        checkOffOpen={false}
        documentsOn
      />,
    );
    const section = screen.getByRole("region", { name: "Suggested" });
    expect(section).toHaveTextContent("Formal budget");
    expect(
      screen.getByRole("link", { name: /Tabled from .* · 2nd time/ }),
    ).toHaveAttribute("href", "/meetings/m-first");
    expect(section).toHaveTextContent("Still open from last week");
  });

  it("labels an action item sent from minutes with those minutes, linking to them (#5790)", () => {
    state.suggestions = [
      {
        id: "s3",
        kind: "minutes",
        text: "Plan backup activities for rush",
        tabled_from: null,
        from_minutes: {
          meeting_id: "m-last",
          start_time: "2026-11-18T23:00:00.000Z",
        },
        source_meeting_id: "m-last",
        reason: null,
      },
    ];
    render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda: [], attachments: [] }}
        canEdit
        upcoming
        checkOffOpen={false}
        documentsOn
      />,
    );
    const section = screen.getByRole("region", { name: "Suggested" });
    expect(section).toHaveTextContent("Plan backup activities for rush");
    expect(
      screen.getByRole("link", { name: /^From the minutes of / }),
    ).toHaveAttribute("href", "/meetings/m-last");
  });

  it("adds and dismisses", async () => {
    const user = userEvent.setup();
    render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda: [], attachments: [] }}
        canEdit
        upcoming
        checkOffOpen={false}
        documentsOn
      />,
    );
    await user.click(
      screen.getByRole("button", { name: 'Add "Formal budget" to the agenda' }),
    );
    expect(state.add).toHaveBeenCalledWith("s1");
    await user.click(
      screen.getByRole("button", { name: 'Dismiss "Venue check-in"' }),
    );
    expect(state.dismiss).toHaveBeenCalledWith("s2");
  });

  it("shows nothing once the meeting has started, or to a member who can't edit", () => {
    const { rerender } = render(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda: [], attachments: [] }}
        canEdit
        upcoming
        checkOffOpen
        documentsOn
      />,
    );
    expect(screen.queryByRole("region", { name: "Suggested" })).toBeNull();
    rerender(
      <EventMeetingLists
        eventId="e1"
        lists={{ agenda: [], attachments: [] }}
        canEdit={false}
        upcoming
        checkOffOpen
        documentsOn
      />,
    );
    expect(screen.queryByRole("region", { name: "Suggested" })).toBeNull();
  });

  it("shows an added tabled item's chip on the agenda, to everyone", () => {
    render(
      <EventAgendaSection
        agenda={[
          {
            id: "a1",
            text: "Formal budget",
            done: false,
            tabled_from: tabled.tabled_from,
          },
        ]}
        canEdit={false}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Tabled from .* · 2nd time/ }),
    ).toHaveAttribute("href", "/meetings/m-first");
  });
});
