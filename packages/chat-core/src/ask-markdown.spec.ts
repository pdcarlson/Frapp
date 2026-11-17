import { describe, expect, it } from "vitest";
import {
  askMarkers,
  askPlainWords,
  askPreviewMarkdown,
  remarkAskAnswer,
  remarkAskLists,
} from "./ask-markdown";

/** The Ask answer's markdown (#5429): markers, names, lists, previews, copy. */

const cite = (source: number, at: number) => ({ source, at, quote: "" });

interface Node {
  type: string;
  value?: string;
  position?: unknown;
  ordered?: boolean;
  start?: number;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}
const text = (value: string): Node => ({ type: "text", value });

describe("askMarkers", () => {
  it("lists each marker where the server put it, one per source at one place", () => {
    expect(
      askMarkers({
        text: "Quorum is half. It was voted.",
        citations: [cite(0, 15), cite(0, 15), cite(1, 29)],
      }),
    ).toEqual([
      { at: 15, source: 0, index: 0 },
      { at: 29, source: 1, index: 2 },
    ]);
  });
});

/** A text node the parser would have made for `source.slice(start, end)`. */
const at = (value: string, start: number): Node => ({
  type: "text",
  value,
  position: { start: { offset: start }, end: { offset: start + value.length } },
});

describe("remarkAskAnswer", () => {
  const entities = [{ type: "member" as const, id: "u1", name: "Ana Ruiz" }];
  const kinds = (nodes: Node[]) =>
    nodes.map((node) => node.data?.hName ?? node.value);

  it("puts a marker in the text that holds its offset, and lifts listed names", () => {
    // "Ask @Ana Ruiz now. Then go."
    const paragraph: Node = {
      type: "paragraph",
      children: [at("Ask @Ana Ruiz now. Then go.", 0)],
    };
    remarkAskAnswer({
      entities,
      markers: [{ at: 18, source: 0, index: 0 }],
    })({ type: "root", children: [paragraph] } as never);
    expect(kinds(paragraph.children!)).toEqual([
      "Ask ",
      "span",
      " now.",
      "sup",
      " Then go.",
    ]);
    expect(paragraph.children![1]!.data!.hProperties).toEqual({
      "data-ask-entity": "member",
      "data-ask-id": "u1",
    });
    expect(paragraph.children![3]!.data!.hProperties).toEqual({
      "data-ask-marker": "0",
    });
  });

  it("puts a marker that falls after a closing ** at the end of the bold", () => {
    // "**Photos.** Bring one." with the marker at 11, after the "**".
    const strong: Node = { type: "strong", children: [at("Photos.", 2)] };
    const paragraph: Node = {
      type: "paragraph",
      children: [strong, at(" Bring one.", 11)],
    };
    remarkAskAnswer({
      entities: [],
      markers: [{ at: 11, source: 0, index: 0 }],
    })({ type: "root", children: [paragraph] } as never);
    expect(kinds(strong.children!)).toEqual(["Photos.", "sup"]);
    expect(kinds(paragraph.children!.slice(1))).toEqual([" Bring one."]);
  });

  it("leaves a link's label alone", () => {
    const link: Node = { type: "link", children: [at("@Ana Ruiz", 1)] };
    const paragraph: Node = { type: "paragraph", children: [link] };
    remarkAskAnswer({ entities, markers: [] })({
      type: "root",
      children: [paragraph],
    } as never);
    expect(kinds(link.children!)).toEqual(["@Ana Ruiz"]);
  });
});

describe("remarkAskLists", () => {
  it("draws a list as lines led by a bullet, a nested one indented", () => {
    const item = (...children: Node[]): Node => ({
      type: "listItem",
      children,
    });
    const paragraph = (value: string): Node => ({
      type: "paragraph",
      children: [text(value)],
    });
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "list",
          ordered: false,
          children: [
            item(paragraph("Tickets")),
            item(paragraph("Photos"), {
              type: "list",
              ordered: true,
              start: 1,
              children: [item(paragraph("Camera"))],
            }),
          ],
        },
      ],
    };
    remarkAskLists()(tree as never);
    const lines = tree.children![0]!;
    expect(lines.type).toBe("paragraph");
    expect(
      lines
        .children!.map((node) => (node.type === "break" ? "\n" : node.value))
        .join(""),
    ).toBe("• Tickets\n• Photos\n  1. Camera");
  });
});

describe("askPreviewMarkdown", () => {
  it("holds back an unclosed bold until the chunk that closes it", () => {
    expect(askPreviewMarkdown("Bring **Pho")).toBe("Bring Pho");
    expect(askPreviewMarkdown("Bring **Photos**")).toBe("Bring **Photos**");
    expect(askPreviewMarkdown("Run `npm")).toBe("Run npm");
  });
});

describe("askPlainWords", () => {
  it("copies the words without the markdown", () => {
    expect(
      askPlainWords("**Photos.** Bring *one* camera:\n- `Canon`\n- Nikon"),
    ).toBe("Photos. Bring one camera:\n• Canon\n• Nikon");
  });
});
