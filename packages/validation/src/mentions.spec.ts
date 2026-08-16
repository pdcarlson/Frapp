import { describe, expect, it } from "vitest";
import {
  extractMentionTokens,
  matchMentionCandidate,
  resolveMentions,
  type MentionCandidate,
} from "./mentions";

const JANE: MentionCandidate = {
  user_id: "11111111-1111-1111-1111-111111111111",
  display_name: "Jane Doe",
};
const JANET: MentionCandidate = {
  user_id: "22222222-2222-2222-2222-222222222222",
  display_name: "Janet Roe",
};
const BOB: MentionCandidate = {
  user_id: "33333333-3333-3333-3333-333333333333",
  display_name: "Bob Stone",
};

describe("extractMentionTokens", () => {
  it("pulls each distinct token once, in order of first appearance", () => {
    expect(extractMentionTokens("@bob hi @jane and @bob again")).toEqual([
      "bob",
      "jane",
    ]);
  });

  it("does not treat an email address as a mention", () => {
    // Otherwise every address in a message would notify whoever matched the
    // domain's first label.
    expect(extractMentionTokens("mail me at bob@example.com")).toEqual([]);
  });

  it("stops at whitespace rather than swallowing the rest of the sentence", () => {
    // `@Jane Doe` yields `Jane`, which the first-word tier resolves when it is
    // unambiguous. Spanning spaces would try to resolve "Jane Doe and Bob".
    expect(extractMentionTokens("@Jane Doe and Bob")).toEqual(["Jane"]);
  });

  it("ignores a token longer than the bound", () => {
    expect(extractMentionTokens(`@${"a".repeat(120)}`)).toEqual([]);
  });

  it("does not swallow trailing punctuation into the token", () => {
    // `jane.` matches no resolution tier, so absorbing the period silently
    // dropped every mention that ended a sentence.
    expect(extractMentionTokens("hey @jane.")).toEqual(["jane"]);
    expect(extractMentionTokens("ping @bob...")).toEqual(["bob"]);
    expect(extractMentionTokens("@bob-")).toEqual(["bob"]);
    expect(extractMentionTokens("@jane, @bob!")).toEqual(["jane", "bob"]);
  });

  it("keeps punctuation that is inside a name", () => {
    expect(extractMentionTokens("@O'Brien and @Mary-Jane")).toEqual([
      "O'Brien",
      "Mary-Jane",
    ]);
  });

  it("tokenises a non-ASCII name", () => {
    // An ASCII-only pattern produced no token here at all.
    expect(extractMentionTokens("hola @Ángela")).toEqual(["Ángela"]);
  });

  it("still ignores an email whose local part is non-ASCII", () => {
    expect(extractMentionTokens("josé@example.com")).toEqual([]);
  });

  it("returns nothing for prose with no mention", () => {
    expect(extractMentionTokens("meet me @ noon")).toEqual([]);
  });
});

describe("matchMentionCandidate", () => {
  const all = [JANE, JANET, BOB];

  it("matches an exact user id", () => {
    expect(matchMentionCandidate(all, JANE.user_id)).toBe(JANE);
  });

  it("matches an exact display name, case-insensitively", () => {
    expect(matchMentionCandidate(all, "jane doe")).toBe(JANE);
  });

  it("matches a display name with the spaces removed", () => {
    expect(matchMentionCandidate(all, "janedoe")).toBe(JANE);
  });

  it("matches a unique prefix", () => {
    expect(matchMentionCandidate(all, "bo")).toBe(BOB);
  });

  it("returns null when a tier is ambiguous instead of falling through", () => {
    // "jan" prefixes both Jane and Janet. Falling through to a looser tier, or
    // picking the first hit, would notify the wrong person while looking right
    // to the sender — so ambiguity fails closed at the tier where it appears.
    expect(matchMentionCandidate(all, "jan")).toBeNull();
  });

  it("resolves an exact first name even when a longer name shares its prefix", () => {
    // "jane" is ambiguous as a *prefix* only if you ignore that it is an exact
    // display-name-first-word match for exactly one member. The earlier tier
    // must settle it before the prefix tier ever runs.
    expect(matchMentionCandidate(all, "jane")).toBe(JANE);
  });

  it("matches a name carrying an apostrophe or hyphen", () => {
    const list = [
      { user_id: "u-ob", display_name: "Sean O'Brien" },
      { user_id: "u-mj", display_name: "Mary-Jane Watson" },
    ];
    // Punctuation inside the name is no longer a barrier: these all fold to the
    // same comparable core. Before, only `@sean` reached Sean at all.
    expect(matchMentionCandidate(list, "sean")?.user_id).toBe("u-ob");
    expect(matchMentionCandidate(list, "seanobrien")?.user_id).toBe("u-ob");
    expect(matchMentionCandidate(list, "sean o'brien")?.user_id).toBe("u-ob");
    expect(matchMentionCandidate(list, "mary-jane")?.user_id).toBe("u-mj");
    expect(matchMentionCandidate(list, "maryjane")?.user_id).toBe("u-mj");
  });

  it("does not match on surname alone", () => {
    // Not a bug — the tiers are id, full name, first word, prefix. Surname
    // matching is a product decision (it would make `@smith` ambiguous across
    // a chapter), so it stays out until someone asks for it.
    const list = [{ user_id: "u-ob", display_name: "Sean O'Brien" }];
    expect(matchMentionCandidate(list, "obrien")).toBeNull();
  });

  it("returns null for an unknown token", () => {
    expect(matchMentionCandidate(all, "nobody")).toBeNull();
  });

  it("returns null for an empty token", () => {
    expect(matchMentionCandidate(all, "   ")).toBeNull();
  });
});

describe("resolveMentions", () => {
  const all = [JANE, JANET, BOB];

  it("returns the resolved user ids in order of first appearance", () => {
    expect(resolveMentions("@bob please see @janedoe", all)).toEqual([
      BOB.user_id,
      JANE.user_id,
    ]);
  });

  it("collapses a member mentioned twice under different spellings", () => {
    expect(resolveMentions("@janedoe @jane doe", all)).toEqual([JANE.user_id]);
  });

  it("drops unresolvable tokens silently rather than failing the send", () => {
    expect(resolveMentions("@nobody hello @bob", all)).toEqual([BOB.user_id]);
  });

  it("drops an ambiguous mention entirely", () => {
    expect(resolveMentions("@jan are you around?", all)).toEqual([]);
  });

  it("returns nothing when there are no candidates to resolve against", () => {
    // A member with an empty chapter roster must not resolve to anyone.
    expect(resolveMentions("@bob", [])).toEqual([]);
  });

  it("returns nothing for a message with no mentions", () => {
    expect(resolveMentions("no mentions here", all)).toEqual([]);
  });
});
