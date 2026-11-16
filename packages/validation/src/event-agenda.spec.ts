import { describe, expect, it } from "vitest";
import {
  agendaProblem,
  attachmentLinkTitle,
  EVENT_AGENDA_ITEM_MAX,
  moveEventEntry,
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

  it("toggles one item and moves entries within bounds", () => {
    const items = [
      { id: "a", text: "A", done: false },
      { id: "b", text: "B", done: false },
    ];
    expect(toggleAgendaItem(items, "b")[1].done).toBe(true);
    expect(moveEventEntry(items, 1, -1).map((i) => i.id)).toEqual(["b", "a"]);
    expect(moveEventEntry(items, 0, -1).map((i) => i.id)).toEqual(["a", "b"]);
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
