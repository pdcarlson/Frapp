import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  ) => ({ ...lists, saving: false, change: state.change }),
}));

vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => ({ allowed: state.gateAllowed }),
}));

vi.mock("@/lib/failure-toast", () => ({ toastFailure: state.toastFailure }));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

import {
  EventAgendaSection,
  EventAttachmentsSection,
  EventMeetingLists,
} from "./event-agenda";

const agenda: EventAgendaItem[] = [
  { id: "a1", text: "Treasurer report", done: false },
  { id: "a2", text: "Rush recap", done: true },
];
const attachments: EventAttachment[] = [
  {
    id: "x1",
    kind: "link",
    url: "https://docs.example.com/budget",
    title: "Budget",
  },
  { id: "x2", kind: "document", document_id: "doc-1", title: "Bylaws" },
];

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
    await user.click(
      screen.getByRole("button", { name: 'Move "Rush recap" up' }),
    );
    await user.click(
      screen.getByRole("button", { name: 'Remove "Treasurer report"' }),
    );
    const [checked, added, moved, removed] = applied(onChange, agenda);
    expect(checked[0].done).toBe(true);
    expect(added).toHaveLength(3);
    expect(added[2]).toMatchObject({ text: "New business", done: false });
    expect(added[2].id).toEqual(expect.any(String));
    expect(moved.map((item) => item.id)).toEqual(["a2", "a1"]);
    expect(removed).toEqual([agenda[1]]);
  });

  it("applies a move to the list as it stands when the update runs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EventAgendaSection agenda={agenda} canEdit onChange={onChange} />);
    await user.click(
      screen.getByRole("button", { name: 'Move "Rush recap" up' }),
    );
    // A newer item landed first in the meantime.
    const newer = [{ id: "n", text: "New", done: false }, ...agenda];
    expect(applied(onChange, newer)[0].map((item) => item.id)).toEqual([
      "n",
      "a2",
      "a1",
    ]);
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
        attachments={[attachments[1]]}
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
        attachments={[attachments[1]]}
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
        attachments={[attachments[1]]}
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
    expect(applied(onChange, [])[0]).toEqual([
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
        attachments={[attachments[1]]}
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
    const [next] = applied(onChange, [attachments[1]]);
    expect(next[1]).toMatchObject({ kind: "document", document_id: "doc-2" });
    expect((next[1] as { title: string }).title).toHaveLength(120);
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
