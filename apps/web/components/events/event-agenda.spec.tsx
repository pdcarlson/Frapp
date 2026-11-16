import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * An event's agenda and attachments on its sheet (#4934): read by everyone
 * who sees the event, edited in place by an `events:update` holder, each
 * save the meeting's whole list.
 */

const state = vi.hoisted(() => ({
  save: vi.fn(),
  download: vi.fn(),
  documents: [] as unknown[],
  toastFailure: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useSaveEventLists: () => ({ mutateAsync: state.save, isPending: false }),
  useDocuments: () => ({
    data: state.documents,
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/components/documents/use-document-download", () => ({
  useDocumentDownload: () => ({ download: state.download, fetchingId: null }),
}));

vi.mock("@/lib/failure-toast", () => ({
  toastFailure: state.toastFailure,
}));

import { EventAgendaSection, EventAttachmentsSection } from "./event-agenda";

const agenda = [
  { id: "a1", text: "Treasurer report", done: false },
  { id: "a2", text: "Rush recap", done: true },
];

beforeEach(() => {
  state.save.mockReset().mockResolvedValue({});
  state.download.mockReset();
  state.toastFailure.mockReset();
  state.documents = [];
});

describe("EventAgendaSection", () => {
  it("shows a member the agenda in order, with no controls", () => {
    render(<EventAgendaSection eventId="e1" agenda={agenda} canEdit={false} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "1.Treasurer report",
      "2.Done: Rush recap",
    ]);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("draws nothing for a member when the meeting has no agenda", () => {
    const { container } = render(
      <EventAgendaSection eventId="e1" agenda={[]} canEdit={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("checks an item off for an editor, saving the whole list", async () => {
    const user = userEvent.setup();
    render(<EventAgendaSection eventId="e1" agenda={agenda} canEdit />);
    await user.click(
      screen.getByRole("checkbox", { name: "Treasurer report" }),
    );
    expect(state.save).toHaveBeenCalledWith({
      agenda: [
        { id: "a1", text: "Treasurer report", done: true },
        { id: "a2", text: "Rush recap", done: true },
      ],
    });
  });

  it("adds a trimmed item at the end, and moves and removes items", async () => {
    const user = userEvent.setup();
    render(<EventAgendaSection eventId="e1" agenda={agenda} canEdit />);
    await user.type(
      screen.getByRole("textbox", { name: "Add an agenda item" }),
      "  New   business {Enter}",
    );
    const added = state.save.mock.calls[0][0].agenda;
    expect(added).toHaveLength(3);
    expect(added[2]).toMatchObject({ text: "New business", done: false });
    expect(added[2].id).toEqual(expect.any(String));

    await user.click(
      screen.getByRole("button", { name: 'Move "Rush recap" up' }),
    );
    expect(
      state.save.mock.calls[1][0].agenda.map((i: { id: string }) => i.id),
    ).toEqual(["a2", "a1"]);

    await user.click(
      screen.getByRole("button", { name: 'Remove "Treasurer report"' }),
    );
    expect(state.save.mock.calls[2][0]).toEqual({ agenda: [agenda[1]] });
  });

  it("says so when a save is refused", async () => {
    const user = userEvent.setup();
    state.save.mockRejectedValue(new Error("nope"));
    render(<EventAgendaSection eventId="e1" agenda={agenda} canEdit />);
    await user.click(screen.getByRole("checkbox", { name: "Rush recap" }));
    expect(state.toastFailure).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't save that check-off" }),
    );
  });
});

describe("EventAttachmentsSection", () => {
  const attachments = [
    {
      id: "x1",
      kind: "link" as const,
      url: "https://docs.example.com/budget",
      title: "Budget",
    },
    {
      id: "x2",
      kind: "document" as const,
      document_id: "doc-1",
      title: "Bylaws",
    },
  ];

  it("opens a link in a new tab and a document through Chapter Files", async () => {
    const user = userEvent.setup();
    render(
      <EventAttachmentsSection
        eventId="e1"
        attachments={attachments}
        canEdit={false}
        documentsOn
      />,
    );
    const link = screen.getByRole("link", { name: /Budget/ });
    expect(link).toHaveAttribute("href", "https://docs.example.com/budget");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await user.click(screen.getByRole("button", { name: /Bylaws/ }));
    expect(state.download).toHaveBeenCalledWith("doc-1");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("adds a link titled by its domain when the title is left empty", async () => {
    const user = userEvent.setup();
    render(
      <EventAttachmentsSection
        eventId="e1"
        attachments={[]}
        canEdit
        documentsOn={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Attach from Chapter Files" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add a link" }));
    await user.type(
      screen.getByRole("textbox", { name: "Link" }),
      "javascript:alert(1)",
    );
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByText(/starting with http/)).toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("textbox", { name: "Link" }));
    await user.type(
      screen.getByRole("textbox", { name: "Link" }),
      "https://www.docs.example.com/agenda",
    );
    await user.click(screen.getByRole("button", { name: "Add link" }));
    expect(state.save.mock.calls[0][0].attachments).toEqual([
      expect.objectContaining({
        kind: "link",
        url: "https://www.docs.example.com/agenda",
        title: "docs.example.com",
      }),
    ]);
  });

  it("attaches a Chapter Files document it doesn't already hold", async () => {
    const user = userEvent.setup();
    state.documents = [
      { id: "doc-1", title: "Bylaws", folder: null },
      { id: "doc-2", title: "Spring budget", folder: "Treasury" },
    ];
    render(
      <EventAttachmentsSection
        eventId="e1"
        attachments={[attachments[1]]}
        canEdit
        documentsOn
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Attach from Chapter Files" }),
    );
    // Bylaws is attached already, so only the other file is offered.
    expect(screen.queryByRole("button", { name: "Bylaws" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Spring budget/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Spring budget/ }));
    expect(state.save.mock.calls[0][0].attachments).toEqual([
      attachments[1],
      expect.objectContaining({
        kind: "document",
        document_id: "doc-2",
        title: "Spring budget",
      }),
    ]);
  });
});
