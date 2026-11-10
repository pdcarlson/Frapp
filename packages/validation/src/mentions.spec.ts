import { describe, expect, it } from "vitest";
import {
  draftWithMention,
  activeMentionQuery,
  extractMentionTokens,
  findMentionSpans,
  matchMentionCandidate,
  mentionChipFilter,
  mentionLabelFor,
  mentionPickLabel,
  spacedMentionNames,
  mentionPickerEntries,
  mentionSuggestions,
  resolveMentions,
  type MentionCandidate,
  type MentionRole,
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
    expect(matchMentionCandidate(list, "\u0041\u0301ngela")?.user_id).toBe(
      "u-an",
    );
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

describe("resolveMentions with roles", () => {
  const OFFICERS: MentionRole = {
    role_id: "role-officers",
    name: "Officers",
    member_ids: [JANE.user_id, BOB.user_id],
    mentionable: true,
  };
  const VP: MentionRole = {
    role_id: "role-vp",
    name: "Vice President",
    member_ids: [JANET.user_id],
    mentionable: true,
  };
  const MEMBERS: MentionRole = {
    role_id: "role-member",
    name: "Member",
    member_ids: [JANE.user_id, JANET.user_id, BOB.user_id],
    mentionable: false,
  };
  const roster = [JANE, JANET, BOB];
  const roles = [OFFICERS, VP, MEMBERS];

  it("reaches every member holding a role", () => {
    expect(resolveMentions("ping @Officers", roster, roles)).toEqual([
      JANE.user_id,
      BOB.user_id,
    ]);
  });

  it("matches the role's whole name folded, as the picker inserts it", () => {
    expect(resolveMentions("@VicePresident", roster, roles)).toEqual([
      JANET.user_id,
    ]);
    expect(resolveMentions("@vice-president", roster, roles)).toEqual([
      JANET.user_id,
    ]);
  });

  it("never matches a role by prefix", () => {
    // Prefix is a member tier only, and nobody's name starts with "off".
    expect(resolveMentions("@Off", roster, roles)).toEqual([]);
  });

  it("consumes a role the sender may not ping, reaching nobody", () => {
    expect(resolveMentions("@Member hi", roster, roles)).toEqual([]);
  });

  it("collapses a member named twice, once by role", () => {
    expect(resolveMentions("@Jane and @Officers", roster, roles)).toEqual([
      JANE.user_id,
      BOB.user_id,
    ]);
  });

  it("outranks a member's shorthand", () => {
    // "Rush Week" would win `@Rush` on the first-word tier without roles.
    const rushee = {
      user_id: "44444444-4444-4444-4444-444444444444",
      display_name: "Rush Week",
    };
    const rush: MentionRole = {
      role_id: "role-rush",
      name: "Rush",
      member_ids: [BOB.user_id],
      mentionable: true,
    };
    expect(resolveMentions("@Rush", [...roster, rushee], [rush])).toEqual([
      BOB.user_id,
    ]);
  });

  it("reaches nobody when a member's exact name is also a role's", () => {
    const rushee = {
      user_id: "44444444-4444-4444-4444-444444444444",
      display_name: "Rush",
    };
    const rush: MentionRole = {
      role_id: "role-rush",
      name: "Rush",
      member_ids: [BOB.user_id],
      mentionable: true,
    };
    expect(resolveMentions("@Rush", [...roster, rushee], [rush])).toEqual([]);
  });

  it("reaches nobody when two members and a role share the name", () => {
    const one = {
      user_id: "44444444-4444-4444-4444-444444444444",
      display_name: "Rush",
    };
    const two = {
      user_id: "55555555-5555-5555-5555-555555555555",
      display_name: "Rush",
    };
    const rush: MentionRole = {
      role_id: "role-rush",
      name: "Rush",
      member_ids: [BOB.user_id],
      mentionable: true,
    };
    expect(resolveMentions("@Rush", [...roster, one, two], [rush])).toEqual([]);
  });

  it("leaves a member their name when the matching role has no holders", () => {
    const moose = {
      user_id: "44444444-4444-4444-4444-444444444444",
      display_name: "Moose",
    };
    const empty: MentionRole = {
      role_id: "role-moose",
      name: "Moose",
      member_ids: [],
      mentionable: true,
    };
    expect(resolveMentions("@Moose", [...roster, moose], [empty])).toEqual([
      moose.user_id,
    ]);
  });

  it("reaches nobody when two roles fold to the same name", () => {
    const twin = { ...VP, role_id: "role-vp-2", name: "Vice-President" };
    expect(resolveMentions("@VicePresident", roster, [VP, twin])).toEqual([]);
  });

  it("never reaches a role holder outside the roster it was given", () => {
    const stranger: MentionRole = {
      ...OFFICERS,
      member_ids: ["99999999-9999-9999-9999-999999999999"],
    };
    expect(resolveMentions("@Officers", roster, [stranger])).toEqual([]);
  });
});

describe("mentionPickerEntries", () => {
  it("never offers a role whose label the tokenizer would drop", () => {
    const long = { name: "A".repeat(65), mentionable: true };
    expect(mentionPickerEntries([], [long], "")).toEqual([]);
  });

  const roster = [JANE, JANET, BOB];
  const roles = [
    { name: "Officers", mentionable: true },
    { name: "Member", mentionable: false },
    { name: "123 Club", mentionable: true },
  ];

  it("offers members first, then the roles the viewer may ping", () => {
    expect(
      mentionPickerEntries(roster, roles, "").map((entry) => entry.label),
    ).toEqual(["Jane Doe", "Janet Roe", "Bob Stone", "Officers"]);
  });

  it("filters roles by the query as it does members", () => {
    const entries = mentionPickerEntries(roster, roles, "off");
    expect(entries).toEqual([
      { kind: "role", role: roles[0], label: "Officers" },
    ]);
  });

  it("keeps at most three role rows, and fills the rest with members", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      name: `Role${String.fromCharCode(65 + i)}`,
      mentionable: true,
    }));
    const lots = Array.from({ length: 10 }, (_, i) => ({
      user_id: `user-${i}`,
      display_name: `Member${String.fromCharCode(65 + i)}`,
    }));
    const entries = mentionPickerEntries(lots, many, "");
    expect(entries).toHaveLength(8);
    expect(entries.filter((entry) => entry.kind === "role")).toHaveLength(3);
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
    expect(mentionSuggestions(roster, "").map((s) => s.member.user_id)).toEqual(
      [JANE.user_id, JANET.user_id, BOB.user_id],
    );
  });

  it("matches anywhere in the display name, ignoring case", () => {
    expect(mentionSuggestions(roster, "STONE").map((s) => s.label)).toEqual([
      "Bob Stone",
    ]);
    expect(mentionSuggestions(roster, "jan").map((s) => s.label)).toEqual([
      "Jane Doe",
      "Janet Roe",
    ]);
  });

  it("leaves out a member with no name and one whose label opens on a digit", () => {
    const ids = mentionSuggestions(roster, "").map((s) => s.member.user_id);
    expect(ids).not.toContain("empty");
    expect(ids).not.toContain("digit");
  });

  it("caps the matches, not the rows it reads", () => {
    const roster = [
      ...Array.from({ length: 20 }, (_, i) => ({
        user_id: `u${i}`,
        display_name: `Member ${i}`,
      })),
      { user_id: "zoe", display_name: "Zoe Park" },
    ];
    expect(
      mentionSuggestions(roster, "zoe").map((s) => s.member.user_id),
    ).toEqual(["zoe"]);
  });

  it("reads iOS's curly apostrophe as the straight one, both ways", () => {
    const roster = [
      { user_id: "straight", display_name: "Sean O'Brien" },
      { user_id: "curly", display_name: "Pat O’Neil" },
    ];
    expect(
      mentionSuggestions(roster, "o’br").map((s) => s.member.user_id),
    ).toEqual(["straight"]);
    expect(
      mentionSuggestions(roster, "o'ne").map((s) => s.member.user_id),
    ).toEqual(["curly"]);
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
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "", end: 1 });
    expect(activeMentionQuery("hi @", 4)).toEqual({
      start: 3,
      query: "",
      end: 4,
    });
  });

  it("reads the text between the `@` and the caret", () => {
    expect(activeMentionQuery("hi @pa", 6)).toEqual({
      start: 3,
      query: "pa",
      end: 6,
    });
    // Caret mid-word: only what is before it is the query, but the handle
    // runs on to its end, so a pick replaces all of it.
    expect(activeMentionQuery("hi @paul now", 6)).toEqual({
      start: 3,
      query: "pa",
      end: 8,
    });
  });

  it("closes once a space follows the name", () => {
    expect(activeMentionQuery("hi @paul ", 9)).toBeNull();
  });

  it("does not open where the tokenizer would not read a mention", () => {
    expect(activeMentionQuery("mail paul@example", 17)).toBeNull();
    expect(activeMentionQuery("@jane@b", 7)).toBeNull();
    // A token opens on a letter, so `@1` and `@.` are never mentions.
    expect(activeMentionQuery("@1", 2)).toBeNull();
    expect(activeMentionQuery("@.", 2)).toBeNull();
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

describe("mentionChipFilter", () => {
  const members = [
    { user_id: "u-paul", display_name: "Paul Carlson" },
    { user_id: "u-shawn", display_name: "Shawn Klein" },
  ];
  const targets = { members, roleNames: ["President", "Vice President"] };

  it("chips nothing on a message that reached nobody", () => {
    const chips = mentionChipFilter([], targets);
    expect(chips("bigsigma")).toBe(false);
    expect(chips("President")).toBe(false);
  });

  it("chips a role token and leaves a name nobody holds plain", () => {
    const chips = mentionChipFilter(["u-paul"], targets);
    expect(chips("President")).toBe(true);
    expect(chips("vicepresident")).toBe(true);
    expect(chips("bigsigma")).toBe(false);
  });

  it("chips a member only when the send reached them", () => {
    const chips = mentionChipFilter(["u-paul"], targets);
    expect(chips("PaulCarlson")).toBe(true);
    expect(chips("Shawn")).toBe(false);
  });

  it("chips every token before the roster loads, if someone was reached", () => {
    expect(mentionChipFilter(["u-paul"], null)("anything")).toBe(true);
    expect(mentionChipFilter(["u-paul"], {})("anything")).toBe(true);
  });
});

describe("draftWithMention", () => {
  it("writes the picker's label with a trailing space into an empty draft", () => {
    expect(draftWithMention("", "Shawn Klein")).toBe("@Shawn Klein ");
  });

  it("separates it from text already typed", () => {
    expect(draftWithMention("hey", "Shawn Klein")).toBe("hey @Shawn Klein ");
    expect(draftWithMention("hey ", "Shawn Klein")).toBe("hey @Shawn Klein ");
  });

  it("reduces a name that can't be read back as written", () => {
    expect(draftWithMention("", "Sam (VP)")).toBe("@SamVP ");
  });

  it("writes nothing the picker wouldn't, since it would reach nobody", () => {
    expect(draftWithMention("hey", "!!")).toBeNull();
    expect(draftWithMention("hey", "2Fast")).toBeNull();
    expect(draftWithMention("hey", "a".repeat(65))).toBeNull();
  });
});

describe("names with spaces (#3825)", () => {
  const WINSTON: MentionCandidate = {
    user_id: "u-winston",
    display_name: "Winston Hewitt",
  };
  const WINSTON_JR: MentionCandidate = {
    user_id: "u-winston-jr",
    display_name: "Winston Hewitt Jr",
  };
  const WINNIE: MentionCandidate = {
    user_id: "u-winnie",
    display_name: "Winston Park",
  };
  const SAM: MentionCandidate = { user_id: "u-sam", display_name: "Sam" };
  const SAM_ABE: MentionCandidate = {
    user_id: "u-sam-abe",
    display_name: "Sam Abernathy",
  };
  const chapter = [WINSTON, WINSTON_JR, WINNIE, SAM, SAM_ABE, JANE];
  const names = spacedMentionNames(chapter, ["Vice President"]);

  it("lists the names that hold a space, longest first, one per spelling", () => {
    expect(
      spacedMentionNames(
        [
          WINSTON,
          { display_name: "  winston   hewitt " },
          SAM,
          { display_name: "Sam (VP)" },
          { display_name: "123 Squad" },
          { display_name: "Mary-Jane O'Brien" },
          { display_name: `${"a".repeat(40)} ${"b".repeat(40)}` },
        ],
        ["Vice President", "Officers"],
      ),
    ).toEqual(["Mary-Jane O'Brien", "Winston Hewitt", "Vice President"]);
  });

  it("reads a known name as one token, as written", () => {
    expect(
      findMentionSpans("hey @winston hewitt, you in?", { names }),
    ).toEqual([{ start: 4, end: 19, token: "winston hewitt" }]);
  });

  it("still stops at whitespace without the names, as every body did before", () => {
    expect(extractMentionTokens("hey @Winston Hewitt")).toEqual(["Winston"]);
  });

  it("takes the longest name that fits", () => {
    expect(
      extractMentionTokens("@Winston Hewitt Jr and @Winston Hewitt", { names }),
    ).toEqual(["Winston Hewitt Jr", "Winston Hewitt"]);
  });

  it("does not read a name out of a longer word", () => {
    // "Winston Hewitts" is not "Winston Hewitt"; the bare token stands.
    expect(extractMentionTokens("@Winston Hewitts", { names })).toEqual([
      "Winston",
    ]);
  });

  it.each([
    ["@Winston Hewitt.", "Winston Hewitt"],
    ["@Winston Hewitt, hi", "Winston Hewitt"],
    ["@Winston Hewitt's turn", "Winston Hewitt"],
    ["(@Winston Hewitt)", "Winston Hewitt"],
    ["@Winston Hewitt!", "Winston Hewitt"],
    ["@Winston Hewitt\nnext line", "Winston Hewitt"],
  ])("stops at punctuation after the name: %j", (body, token) => {
    expect(extractMentionTokens(body, { names })).toEqual([token]);
  });

  it("leaves other words alone: @jane and bob is still @jane", () => {
    expect(extractMentionTokens("@jane and bob", { names })).toEqual(["jane"]);
  });

  it("resolves a name typed in full to that member", () => {
    expect(resolveMentions("ask @Winston Hewitt", chapter)).toEqual([
      "u-winston",
    ]);
    expect(resolveMentions("ask @winston hewitt jr.", chapter)).toEqual([
      "u-winston-jr",
    ]);
  });

  it("resolves the full name where the first name alone is ambiguous", () => {
    // Three Winstons: `@Winston` reaches nobody, the full name reaches one.
    expect(resolveMentions("@Winston", chapter)).toEqual([]);
    expect(resolveMentions("@Winston Park", chapter)).toEqual(["u-winnie"]);
  });

  it("gives the full name to its holder, not to the member it starts with", () => {
    // Before, `@Sam Abernathy` read as `@Sam` and pinged the member "Sam".
    expect(resolveMentions("@Sam Abernathy", chapter)).toEqual(["u-sam-abe"]);
    expect(resolveMentions("@Sam and others", chapter)).toEqual(["u-sam"]);
  });

  it("reaches nobody when two members hold the same full name", () => {
    const twin = { user_id: "u-twin", display_name: "winston hewitt" };
    expect(resolveMentions("@Winston Hewitt", [...chapter, twin])).toEqual([]);
  });

  it("still resolves the old reduced label", () => {
    expect(resolveMentions("@WinstonHewitt", chapter)).toEqual(["u-winston"]);
  });

  it("resolves a role named with its space", () => {
    const roles: MentionRole[] = [
      {
        role_id: "r-vp",
        name: "Vice President",
        member_ids: ["u-sam", "u-sam-abe"],
        mentionable: true,
      },
    ];
    expect(resolveMentions("@Vice President please", chapter, roles)).toEqual([
      "u-sam",
      "u-sam-abe",
    ]);
  });

  it("does not let a role nobody holds claim the words", () => {
    const vice = { user_id: "u-vice", display_name: "Vice" };
    const roles: MentionRole[] = [
      {
        role_id: "r-vp",
        name: "Vice President",
        member_ids: [],
        mentionable: true,
      },
    ];
    expect(resolveMentions("@Vice President", [...chapter, vice], roles)).toEqual(
      ["u-vice"],
    );
  });

  it("offers the name as written, and the reduced label where it can't be read back", () => {
    expect(mentionPickLabel("Winston Hewitt")).toBe("Winston Hewitt");
    expect(mentionPickLabel("  Winston   Hewitt ")).toBe("Winston Hewitt");
    expect(mentionPickLabel("Sam (VP)")).toBe("SamVP");
    expect(mentionPickLabel("O'Brien")).toBe("OBrien");
  });

  it("a picked member is the member that resolves", () => {
    for (const member of chapter) {
      const label = mentionPickLabel(member.display_name);
      const resolved = resolveMentions(`hi @${label} there`, chapter);
      // `@Winston Hewitt` vs "Winston Hewitt Jr" is the one accepted overlap:
      // each resolves to itself.
      expect(resolved, member.display_name).toEqual([member.user_id]);
    }
  });

  it("lets a renderer keep the bare token an old body pinged", () => {
    // "@Sam Abernathy" sent before spaced names pinged the member "Sam".
    const pingedSam = (token: string) => token.toLowerCase() === "sam";
    expect(
      findMentionSpans("@Sam Abernathy", { names, accept: pingedSam }),
    ).toEqual([{ start: 0, end: 4, token: "Sam" }]);
    expect(
      findMentionSpans("@Sam Abernathy", { names, accept: () => false }),
    ).toEqual([]);
  });

  it("chips a spaced token by who it reached", () => {
    const chips = mentionChipFilter(["u-winston"], { members: chapter });
    expect(chips("Winston Hewitt")).toBe(true);
    expect(chips("Winston Park")).toBe(false);
  });
});
