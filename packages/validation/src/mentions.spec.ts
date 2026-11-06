import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  extractMentionTokens,
  findMentionSpans,
  matchMentionCandidate,
  mentionLabelFor,
  mentionSuggestions,
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

/**
 * The positional half, added for the in-body mention chip
 * (`packages/chat-core/src/markdown-mentions.ts`). A highlight
 * has to wrap exactly the characters the resolver read, so these pin the offsets
 * as well as the tokens — the whole point of putting this here rather than
 * letting a renderer keep its own regex.
 */
describe("findMentionSpans", () => {
  it("returns the offsets of the `@` and of the token's end", () => {
    const text = "hi @jane";
    const [span] = findMentionSpans(text);

    expect(span).toEqual({ start: 3, end: 8, token: "jane" });
    expect(text.slice(span!.start, span!.end)).toBe("@jane");
  });

  it("keeps every occurrence, unlike the deduplicating token list", () => {
    const text = "@bob hi @jane and @bob again";

    expect(findMentionSpans(text).map((s) => s.token)).toEqual([
      "bob",
      "jane",
      "bob",
    ]);
    expect(extractMentionTokens(text)).toEqual(["bob", "jane"]);
  });

  it("stops the span short of trailing punctuation the token drops", () => {
    // `@jane.` tokenises as `jane`, so a highlight that spanned the stop would
    // paint a character the resolver never looked at.
    const text = "over to @jane.";
    const [span] = findMentionSpans(text);

    expect(text.slice(span!.start, span!.end)).toBe("@jane");
    expect(span!.end).toBe(text.length - 1);
  });

  it("spans a name with an apostrophe whole", () => {
    const text = "ask @O'Brien";
    const [span] = findMentionSpans(text);

    expect(text.slice(span!.start, span!.end)).toBe("@O'Brien");
  });

  it("finds nothing in an email address", () => {
    expect(findMentionSpans("mail jane@example.com")).toEqual([]);
  });

  it("rejects an over-long run rather than spanning a truncation of it", () => {
    // Same rule as `extractMentionTokens`: a truncated token is a valid prefix,
    // and the prefix tier would resolve it to someone nobody named. Nothing to
    // highlight either, then.
    expect(findMentionSpans(`@${"a".repeat(65)}`)).toEqual([]);
    expect(findMentionSpans(`@${"a".repeat(64)}`)).toHaveLength(1);
  });

  it("agrees with the tokens the resolver acts on", () => {
    // The contract the chip depends on, asserted directly: same walk, same
    // rejections, so a painted run is always a run resolution considered.
    const text = "@bob, @jane. and jane@example.com plus `@nobody`";

    expect([...new Set(findMentionSpans(text).map((s) => s.token))]).toEqual(
      extractMentionTokens(text),
    );
  });
});

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

  it("keeps combining marks in the token", () => {
    // Decomposed (NFD) input: "A" + U+0301, which is what a paste from many
    // sources actually carries. Excluding \p{M} truncated the token to "A",
    // which the prefix tier then resolved to an unrelated member whose name
    // merely started with A -- a fail-open into the *wrong* person, and a
    // mention overrides an explicit mute.
    const NFD_ANGELA = "\u0041\u0301ngela"; // A + combining acute
    expect(NFD_ANGELA).not.toBe("\u00C1ngela"); // really decomposed
    expect(NFD_ANGELA.normalize("NFC")).toBe("\u00C1ngela");
    expect(extractMentionTokens(`hola @${NFD_ANGELA}`)).toEqual([NFD_ANGELA]);

    // Arabic with harakat truncated to its first letter the same way.
    const HARAKAT = "\u0645\u064F\u062D\u064E\u0645"; // Arabic + harakat
    expect(extractMentionTokens(`@${HARAKAT}`)).toEqual([HARAKAT]);
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

  it("resolves the same name whether it arrives as NFC or NFD", () => {
    // Before the fold normalised, a decomposed token could not match a
    // precomposed display name even when the two render identically -- and it
    // did not merely miss, it fell through to the prefix tier and hit Aaron.
    const list = [
      { user_id: "u-an", display_name: "\u00C1ngela Ruiz" },
      { user_id: "u-aa", display_name: "Aaron Webb" },
    ];
    expect(matchMentionCandidate(list, "\u00C1ngela")?.user_id).toBe("u-an");
    expect(
      matchMentionCandidate(list, "\u0041\u0301ngela")?.user_id,
    ).toBe("u-an");
  });

  it("refuses to guess from a single-character prefix", () => {
    // This is the shape a truncated token takes. Resolving it would notify
    // whoever happens to sort first, which is worse than not resolving.
    const list = [{ user_id: "u-aa", display_name: "Aaron Webb" }];
    expect(matchMentionCandidate(list, "A")).toBeNull();
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

// Moved from `apps/web/components/chat/mention-suggestion.spec.ts` when the
// label became shared with mobile's composer.
describe("mentionLabelFor", () => {
  it("strips internal whitespace so the label matches the mention resolver's no-space tier", () => {
    expect(mentionLabelFor("Jane Doe")).toBe("JaneDoe");
  });

  it("leaves a single-word name untouched", () => {
    expect(mentionLabelFor("Cher")).toBe("Cher");
  });

  it("collapses multiple internal spaces, not just single ones", () => {
    expect(mentionLabelFor("Mary  Jane   Watson")).toBe("MaryJaneWatson");
  });

  // Regression: the mention tokenizer (packages/validation/src/mentions.ts)
  // truncates — does not reject — a token at the first character outside
  // its allowed set. A label that kept "(", ")" or other punctuation would
  // silently shorten to something that could resolve to a *different*
  // member than the one actually picked. Stripping to alphanumerics-and-marks
  // only means every kept character is one the tokenizer always carries
  // through to the end.
  it("strips punctuation the mention tokenizer would otherwise truncate on", () => {
    expect(mentionLabelFor("Sam (VP)")).toBe("SamVP");
  });

  it("strips commas, slashes, and ampersands", () => {
    expect(mentionLabelFor("Smith, John")).toBe("SmithJohn");
    expect(mentionLabelFor("A/B Test")).toBe("ABTest");
    expect(mentionLabelFor("Rock & Roll")).toBe("RockRoll");
  });

  it("keeps digits and Unicode letters, which the tokenizer does accept mid-token", () => {
    expect(mentionLabelFor("Ángela 2nd")).toBe("Ángela2nd");
  });

  // Proves the fix against the real server-side resolver, not just the
  // label-computation logic in isolation: a label built for a member whose
  // name contains punctuation the tokenizer would otherwise truncate on
  // must still resolve back to that exact member — not a same-named
  // lookalike whose name the truncated token happens to match exactly.
  it("resolves to the exact member picked, not a same-named lookalike, when the display name has punctuation", () => {
    const candidates = [
      { user_id: "vp-id", display_name: "Sam (VP)" },
      { user_id: "other-sam-id", display_name: "Sam" },
    ];
    const label = mentionLabelFor("Sam (VP)");
    const resolved = resolveMentions(`Hey @${label}`, candidates);
    expect(resolved).toEqual(["vp-id"]);
  });
});

describe("mentionSuggestions", () => {
  const roster: MentionCandidate[] = [
    JANE,
    { user_id: "empty", display_name: "" },
    JANET,
    { user_id: "digit", display_name: "123 Squad" },
    BOB,
  ];

  it("offers every reachable member in roster order for an empty query", () => {
    expect(mentionSuggestions(roster, "").map((s) => s.member.user_id)).toEqual([
      JANE.user_id,
      JANET.user_id,
      BOB.user_id,
    ]);
  });

  it("matches anywhere in the display name, ignoring case", () => {
    expect(mentionSuggestions(roster, "STONE").map((s) => s.label)).toEqual([
      "BobStone",
    ]);
    expect(mentionSuggestions(roster, "jan").map((s) => s.label)).toEqual([
      "JaneDoe",
      "JanetRoe",
    ]);
  });

  it("leaves out a member with no name and one whose label opens on a digit", () => {
    const ids = mentionSuggestions(roster, "").map((s) => s.member.user_id);
    expect(ids).not.toContain("empty");
    expect(ids).not.toContain("digit");
  });

  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      user_id: `u${i}`,
      display_name: `Member ${i}`,
    }));
    expect(mentionSuggestions(many, "")).toHaveLength(8);
    expect(mentionSuggestions(many, "", 3)).toHaveLength(3);
  });

  it("inserts a label that resolves back to the member picked", () => {
    for (const { member, label } of mentionSuggestions(roster, "")) {
      expect(resolveMentions(`hi @${label}`, roster)).toEqual([member.user_id]);
    }
  });
});

describe("activeMentionQuery", () => {
  it("opens on a bare `@` at the caret", () => {
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("hi @", 4)).toEqual({ start: 3, query: "" });
  });

  it("reads the text between the `@` and the caret", () => {
    expect(activeMentionQuery("hi @pa", 6)).toEqual({ start: 3, query: "pa" });
    // Caret mid-word: only what is before it counts.
    expect(activeMentionQuery("hi @paul", 6)).toEqual({ start: 3, query: "pa" });
  });

  it("closes once a space follows the name", () => {
    expect(activeMentionQuery("hi @paul ", 9)).toBeNull();
  });

  it("does not open where the tokenizer would not read a mention", () => {
    expect(activeMentionQuery("mail paul@example", 17)).toBeNull();
    expect(activeMentionQuery("@jane@b", 7)).toBeNull();
  });

  it("is null for a caret outside the text", () => {
    expect(activeMentionQuery("@pa", 0)).toBeNull();
    expect(activeMentionQuery("@pa", 9)).toBeNull();
  });

  it("closes on a query longer than any token the resolver reads", () => {
    const long = "a".repeat(65);
    expect(activeMentionQuery(`@${long}`, long.length + 1)).toBeNull();
  });
});
