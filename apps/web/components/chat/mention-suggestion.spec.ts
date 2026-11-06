import { describe, it, expect } from "vitest";
import { createMentionSuggestion } from "./mention-suggestion";
import type { MentionSuggestionItem } from "./mention-list";

describe("createMentionSuggestion — items()", () => {
  const roster = [
    { user_id: "u1", display_name: "Jane Doe", avatar_url: null },
    { user_id: "u2", display_name: "John Smith", avatar_url: "https://x/avatar.png" },
    { user_id: "u3", display_name: "", avatar_url: null },
  ];

  function itemsFor(query: string): MentionSuggestionItem[] {
    const rosterRef = { current: roster };
    const suggestion = createMentionSuggestion(rosterRef);
    return suggestion.items!({ query, editor: {} as never, signal: new AbortController().signal }) as MentionSuggestionItem[];
  }

  it("returns every roster member with a non-empty name when the query is empty", () => {
    const result = itemsFor("");
    expect(result.map((item) => item.id)).toEqual(["u1", "u2"]);
  });

  it("excludes members with an empty display_name — there's nothing usable to @mention them by", () => {
    const result = itemsFor("");
    expect(result.some((item) => item.id === "u3")).toBe(false);
  });

  it("filters case-insensitively against display_name", () => {
    const result = itemsFor("jane");
    expect(result.map((item) => item.id)).toEqual(["u1"]);
  });

  it("computes label as the display name with whitespace stripped, not the raw name", () => {
    const result = itemsFor("jane");
    expect(result[0]).toMatchObject({
      id: "u1",
      label: "JaneDoe",
      displayName: "Jane Doe",
      avatarUrl: null,
    });
  });

  it("returns nothing for a query matching no member", () => {
    expect(itemsFor("zzz")).toEqual([]);
  });

  it("excludes a digit-led display name — its label could never be recognized as a mention token", () => {
    const rosterRef = {
      current: [
        { user_id: "u5", display_name: "123 Squad", avatar_url: null },
        { user_id: "u6", display_name: "Jane Doe", avatar_url: null },
      ],
    };
    const suggestion = createMentionSuggestion(rosterRef);
    const result = suggestion.items!({
      query: "",
      editor: {} as never,
      signal: new AbortController().signal,
    }) as MentionSuggestionItem[];
    expect(result.map((item) => item.id)).toEqual(["u6"]);
  });

  it("reads the roster fresh from the ref on every call, not a snapshot from construction", () => {
    const rosterRef = { current: roster };
    const suggestion = createMentionSuggestion(rosterRef);
    const before = suggestion.items!({
      query: "",
      editor: {} as never,
      signal: new AbortController().signal,
    }) as MentionSuggestionItem[];
    expect(before).toHaveLength(2);

    rosterRef.current = [
      ...roster,
      { user_id: "u4", display_name: "Alex Kim", avatar_url: null },
    ];
    const after = suggestion.items!({
      query: "",
      editor: {} as never,
      signal: new AbortController().signal,
    }) as MentionSuggestionItem[];
    expect(after.map((item) => item.id)).toEqual(["u1", "u2", "u4"]);
  });

  it("caps results at 8 matches", () => {
    const bigRoster = Array.from({ length: 20 }, (_, i) => ({
      user_id: `u${i}`,
      display_name: `Member ${i}`,
      avatar_url: null,
    }));
    const rosterRef = { current: bigRoster };
    const suggestion = createMentionSuggestion(rosterRef);
    const result = suggestion.items!({
      query: "",
      editor: {} as never,
      signal: new AbortController().signal,
    }) as MentionSuggestionItem[];
    expect(result).toHaveLength(8);
  });
});
