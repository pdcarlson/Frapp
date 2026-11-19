import { describe, expect, it } from "vitest";
import {
  agendaProblem,
  attachmentLinkTitle,
  EVENT_AGENDA_ITEM_MAX,
  agendaCheckOffOpen,
  reorderEventEntry,
  attachmentLinkProblem,
  attachmentTitle,
  readEventAgenda,
  readEventAttachments,
  toggleAgendaItem,
} from "./event-agenda";

describe("event agenda helpers (#4934)", () => {
  it("reads a malformed agenda as empty and skips bad entries", () => {
    expect(readEventAgenda(undefined)).toEqual([]);
    expect(readEventAgenda("x")).toEqual([]);
    expect(
      readEventAgenda([
        { id: "a", text: "One", done: true },
        { id: "b", text: "Two" },
        { text: "no id" },
        null,
      ]),
    ).toEqual([
      { id: "a", text: "One", done: true },
      { id: "b", text: "Two", done: false },
    ]);
  });

  it("reads attachments by kind and drops ones it can't open", () => {
    expect(
      readEventAttachments([
        { id: "1", kind: "link", url: "https://a.example", title: "A" },
        { id: "2", kind: "document", document_id: "d1", title: "Bylaws" },
        { id: "3", kind: "link", title: "no url" },
        { id: "5", kind: "link", url: "javascript:alert(1)", title: "bad" },
        { id: "4", kind: "file", title: "unknown kind" },
      ]),
    ).toEqual([
      { id: "1", kind: "link", url: "https://a.example", title: "A" },
      { id: "2", kind: "document", document_id: "d1", title: "Bylaws" },
    ]);
  });

  it("toggles one item", () => {
    const items = [
      { id: "a", text: "A", done: false },
      { id: "b", text: "B", done: false },
    ];
    expect(toggleAgendaItem(items, "b")[1].done).toBe(true);
  });

  it("titles an untitled link by its domain", () => {
    expect(attachmentLinkTitle("  ", "https://www.docs.example.com/x")).toBe(
      "docs.example.com",
    );
    expect(attachmentLinkTitle(" Budget ", "https://a.example")).toBe("Budget");
  });

  it("says why an agenda can't be saved", () => {
    expect(agendaProblem([{ text: "ok" }])).toBeNull();
    expect(agendaProblem([{ text: " " }])).toMatch(/needs some text/);
    expect(
      agendaProblem([{ text: "x".repeat(EVENT_AGENDA_ITEM_MAX + 1) }]),
    ).toMatch(/under/);
  });

  it("cuts every attachment title to the API's limit", () => {
    expect(attachmentTitle(`  ${"x".repeat(300)}  `)).toHaveLength(120);
    expect(attachmentTitle(" Spring   budget ")).toBe("Spring budget");
  });

  it("says why a link can't be attached", () => {
    expect(attachmentLinkProblem("https://a.example")).toBeNull();
    expect(attachmentLinkProblem("ftp://a.example")).toMatch(/http/);
    expect(
      attachmentLinkProblem(`https://a.example/${"x".repeat(2100)}`),
    ).toMatch(/too long/);
  });
});

describe("agendaCheckOffOpen (Paul 2026-11-19)", () => {
  const start = "2026-11-19T20:00:00.000Z";
  it("waits for the meeting to start", () => {
    expect(agendaCheckOffOpen(start, new Date("2026-11-19T19:59:00Z"))).toBe(
      false,
    );
  });
  it("opens at the start and stays open after the end", () => {
    expect(agendaCheckOffOpen(start, new Date(start))).toBe(true);
    expect(agendaCheckOffOpen(start, new Date("2026-11-20T09:00:00Z"))).toBe(
      true,
    );
  });
  it("never locks on a start it can't read", () => {
    expect(agendaCheckOffOpen(null, new Date())).toBe(true);
    expect(agendaCheckOffOpen("soon", new Date())).toBe(true);
  });
});

describe("reorderEventEntry", () => {
  const ids = (items: { id: string }[]) => items.map((item) => item.id);
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  it("moves an entry to where it is dropped", () => {
    expect(ids(reorderEventEntry(items, 0, 2))).toEqual(["b", "c", "a", "d"]);
    expect(ids(reorderEventEntry(items, 3, 0))).toEqual(["d", "a", "b", "c"]);
  });
  it("leaves the list as it is for an index off either end", () => {
    expect(ids(reorderEventEntry(items, 1, 9))).toEqual(["a", "b", "c", "d"]);
    expect(ids(reorderEventEntry(items, -1, 0))).toEqual(["a", "b", "c", "d"]);
  });
});
