import { describe, expect, it } from "vitest";
import {
  askAnswerEntities,
  askEntityParts,
  type AskNamedEntity,
} from "./ask-entities";

const sam: AskNamedEntity = { type: "member", id: "m-sam", name: "Sam" };
const samA: AskNamedEntity = { type: "member", id: "m-sama", name: "Sam Abernathy" };
const general: AskNamedEntity = { type: "channel", id: "c-gen", name: "general" };

describe("askEntityParts", () => {
  it("leaves text with no listed name as one plain part", () => {
    expect(askEntityParts("Ask @Sam in #general.", [])).toEqual([
      { type: "text", text: "Ask @Sam in #general." },
    ]);
  });

  it("cuts a member and a channel out of the sentence", () => {
    expect(askEntityParts("Ask @Sam in #general.", [sam, general])).toEqual([
      { type: "text", text: "Ask " },
      { type: "member", id: "m-sam", name: "Sam", text: "@Sam" },
      { type: "text", text: " in " },
      { type: "channel", id: "c-gen", name: "general", text: "#general" },
      { type: "text", text: "." },
    ]);
  });

  it("takes the longest listed name", () => {
    const parts = askEntityParts("@Sam Abernathy has it", [sam, samA]);
    expect(parts[0]).toMatchObject({ id: "m-sama", text: "@Sam Abernathy" });
    expect(parts[1]).toEqual({ type: "text", text: " has it" });
  });

  it("never links a name that is not in the list", () => {
    expect(askEntityParts("@Samuel and @Trevor", [sam])).toEqual([
      { type: "text", text: "@Samuel and @Trevor" },
    ]);
  });

  it("does not read an address or a mid-word sigil as a mention", () => {
    expect(askEntityParts("paul@Sam and x#general", [sam, general])).toEqual([
      { type: "text", text: "paul@Sam and x#general" },
    ]);
  });

  it("keeps the sigil apart: a member's name is not a channel", () => {
    expect(askEntityParts("#Sam", [sam])).toEqual([
      { type: "text", text: "#Sam" },
    ]);
  });

  it("matches a name with punctuation in it, at the end of the text", () => {
    const obrien: AskNamedEntity = { type: "member", id: "m-ob", name: "Pat O'Brien" };
    expect(askEntityParts("Thanks @Pat O'Brien", [obrien])).toEqual([
      { type: "text", text: "Thanks " },
      { type: "member", id: "m-ob", name: "Pat O'Brien", text: "@Pat O'Brien" },
    ]);
  });

  it("is exact about case", () => {
    expect(askEntityParts("@sam", [sam])).toEqual([
      { type: "text", text: "@sam" },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(askEntityParts("", [sam])).toEqual([]);
  });
});

describe("askAnswerEntities", () => {
  it("is empty for an answer from a server without the list", () => {
    expect(askAnswerEntities({ text: "hi" })).toEqual([]);
    expect(askAnswerEntities(null)).toEqual([]);
  });

  it("drops entries it does not know how to draw", () => {
    expect(
      askAnswerEntities({
        entities: [
          sam,
          { type: "event", id: "e1", name: "Formal" },
          { type: "member", id: "", name: "Nobody" },
          { type: "channel", id: "c2", name: "  " },
          "general",
        ],
      }),
    ).toEqual([sam]);
  });
});
