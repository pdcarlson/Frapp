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
  mentionPicksIn,
  readMentionPicks,
  MAX_MENTION_PICKS,
  sendMentionReading,
  spacedMentionNames,
  mentionPickerEntries,
  mentionPickerRows,
  mentionSuggestions,
  resolveMentions,
  askMentionQuestion,
  ASK_MENTION_NAME,
  type MentionCandidate,
  type MentionPick,
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

  describe("@here", () => {
    const HERE: MentionRole = {
      role_id: "role-member",
      name: "here",
      member_ids: [BOB.user_id],
      mentionable: true,
    };
    const herbert = {
      user_id: "55555555-5555-5555-5555-555555555555",
      display_name: "Herebert",
    };

    it("reaches the online members its entry holds", () => {
      expect(
        resolveMentions("@here who's around", roster, [...roles, HERE]),
      ).toEqual([BOB.user_id]);
    });

    it("never falls through to a member's prefix, even with no entry or nobody online", () => {
      const withHerbert = [...roster, herbert];
      expect(resolveMentions("@here", withHerbert, roles)).toEqual([]);
      expect(resolveMentions("@here", withHerbert, [])).toEqual([]);
      expect(
        resolveMentions("@HERE", withHerbert, [
          ...roles,
          { ...HERE, member_ids: [] },
        ]),
      ).toEqual([]);
    });

    it("reaches nobody when the sender may not use it", () => {
      expect(
        resolveMentions("@here", roster, [
          ...roles,
          { ...HERE, mentionable: false },
        ]),
      ).toEqual([]);
    });
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

  it("reaches a tier and a role sharing a name together (#4076)", () => {
    const tier: MentionRole = {
      ...OFFICERS,
      role_id: "tier-officers",
      kind: "tier",
      member_ids: [JANE.user_id],
    };
    const role: MentionRole = {
      ...OFFICERS,
      kind: "role",
      member_ids: [BOB.user_id],
    };
    expect(resolveMentions("@Officers", roster, [role, tier]).sort()).toEqual(
      [BOB.user_id, JANE.user_id].sort(),
    );
  });

  it("reaches two groups sharing a name together, as a pledge class can take a group's name (#4076)", () => {
    const manual: MentionRole = {
      ...OFFICERS,
      role_id: "group-manual",
      kind: "group",
      member_ids: [JANE.user_id],
    };
    const pledgeClass: MentionRole = {
      ...OFFICERS,
      role_id: "group-class",
      kind: "group",
      member_ids: [BOB.user_id],
    };
    expect(
      resolveMentions("@Officers", roster, [manual, pledgeClass]).sort(),
    ).toEqual([BOB.user_id, JANE.user_id].sort());
  });

  it("still reaches nobody when two tiers fold to the same name", () => {
    const a: MentionRole = { ...OFFICERS, role_id: "tier-a", kind: "tier" };
    const b: MentionRole = { ...OFFICERS, role_id: "tier-b", kind: "tier" };
    const group: MentionRole = { ...OFFICERS, role_id: "g", kind: "group" };
    expect(resolveMentions("@Officers", roster, [a, b, group])).toEqual([]);
  });

  it("leaves out the shared-name sets this sender may not ping", () => {
    const tier: MentionRole = {
      ...OFFICERS,
      role_id: "tier-officers",
      kind: "tier",
      member_ids: [JANE.user_id],
      mentionable: false,
    };
    const group: MentionRole = {
      ...OFFICERS,
      role_id: "group-officers",
      kind: "group",
      member_ids: [BOB.user_id],
    };
    expect(resolveMentions("@Officers", roster, [tier, group])).toEqual([
      BOB.user_id,
    ]);
    // None allowed: the token is still consumed, so no member takes it.
    expect(
      resolveMentions("@Officers", roster, [
        tier,
        { ...group, mentionable: false },
      ]),
    ).toEqual([]);
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

  describe("@everyone and @here", () => {
    const withReserved = [
      { name: "everyone", mentionable: true },
      { name: "here", mentionable: true },
      { name: "Treasurer", mentionable: true },
      { name: "Officers", mentionable: true },
      { name: "Rush Chair", mentionable: true },
    ];

    it("waits for a letter, then matches only the start of the name", () => {
      const labels = (query: string) =>
        mentionPickerEntries([], withReserved, query).map((e) => e.label);
      expect(labels("")).toEqual(["Treasurer", "Officers", "Rush Chair"]);
      expect(labels("he")).toEqual(["here"]);
      expect(labels("e")).toEqual(["everyone", "Treasurer", "Officers"]);
      expect(labels("er")).toEqual(["Treasurer", "Officers"]);
    });

    it("takes none of the three role rows and sits before them", () => {
      expect(
        mentionPickerEntries(
          [],
          [...withReserved, { name: "Recruitment", mentionable: true }],
          "e",
        ).map((e) => e.label),
      ).toEqual(["everyone", "Treasurer", "Officers", "Recruitment"]);
      expect(
        mentionPickerEntries([], withReserved, "h").map((e) => e.label),
      ).toEqual(["here", "Rush Chair"]);
    });

    it("is not offered to a viewer who may not use it", () => {
      expect(
        mentionPickerEntries(
          [],
          [{ name: "here", mentionable: false }],
          "here",
        ),
      ).toEqual([]);
    });
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
    expect(findMentionSpans("hey @winston hewitt, you in?", { names })).toEqual(
      [{ start: 4, end: 19, token: "winston hewitt" }],
    );
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
    expect(
      resolveMentions("@Vice President", [...chapter, vice], roles),
    ).toEqual(["u-vice"]);
  });

  describe("a spaced name next to someone the first word names", () => {
    const JORDAN = { user_id: "u-jordan", display_name: "Jordan" };
    const JORDAN_WILL = {
      user_id: "u-jordan-will",
      display_name: "Jordan Will",
    };
    const both = [JORDAN, JORDAN_WILL, JANE];

    it("leaves prose after a one-word name alone", () => {
      expect(resolveMentions("@Jordan will you come", both)).toEqual([
        "u-jordan",
      ]);
    });

    it("reads the spaced name when it is written as the name is", () => {
      expect(resolveMentions("@Jordan Will, you in?", both)).toEqual([
        "u-jordan-will",
      ]);
    });

    it("does not let a renamed member take a role's mention", () => {
      const squatter = { user_id: "u-x", display_name: "Officers meeting" };
      const roles: MentionRole[] = [
        {
          role_id: "r-off",
          name: "Officers",
          member_ids: ["u-jordan"],
          mentionable: true,
        },
      ];
      expect(
        resolveMentions("@Officers Meeting at 7", [...both, squatter], roles),
      ).toEqual(["u-jordan"]);
    });

    it("ignores case where the first word names nobody exactly", () => {
      expect(resolveMentions("@winston hewitt", chapter)).toEqual([
        "u-winston",
      ]);
    });

    it("reads a send's tokens once, for the resolver and the permission pre-read", () => {
      // An empty "Vice President" role must not hide a held "Vice" role.
      const roles: MentionRole[] = [
        {
          role_id: "r-v",
          name: "Vice",
          member_ids: ["u-sam"],
          mentionable: false,
        },
        {
          role_id: "r-vp",
          name: "Vice President",
          member_ids: [],
          mentionable: true,
        },
      ];
      expect(
        extractMentionTokens(
          "@Vice President is out",
          sendMentionReading(chapter, roles),
        ),
      ).toEqual(["Vice"]);
    });
  });

  it("replaces a whole written name when the caret sits inside it", () => {
    expect(activeMentionQuery("@Jane Doe tomorrow", 3, ["Jane Doe"])).toEqual({
      start: 0,
      query: "Ja",
      end: 9,
    });
    // Without the names, or on other text, the handle ends at the space.
    expect(activeMentionQuery("@Jane Doe tomorrow", 3)?.end).toBe(5);
    expect(activeMentionQuery("@Jane Smith", 3, ["Jane Doe"])?.end).toBe(5);
  });

  it("keeps a bare chip the message is known to have sent over a role's name", () => {
    const vice = { user_id: "u-vice", display_name: "Vice" };
    const chips = mentionChipFilter(["u-vice"], {
      members: [...chapter, vice],
      roleNames: ["Vice President"],
    });
    expect(chips("Vice President")).toBe(false);
    expect(chips("Vice")).toBe(true);
    // A role whose first word names nobody reached still chips on trust.
    expect(
      mentionChipFilter(["u-sam"], {
        members: chapter,
        roleNames: ["Vice President"],
      })("Vice President"),
    ).toBe(true);
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

/**
 * A pick carries the member's id (#3835, Shawn 2026-11-13): the body stays
 * `@Jane Doe`, and the id beside it decides who that token reaches.
 */
describe("picked mentions (#3835)", () => {
  const JANE_DOE: MentionCandidate = {
    user_id: "u-jane-doe",
    display_name: "Jane Doe",
  };
  const JANE_SMITH: MentionCandidate = {
    user_id: "u-jane-smith",
    display_name: "Jane Smith",
  };
  const pickedJane: MentionPick[] = [
    { user_id: "u-jane-doe", label: "Jane Doe" },
  ];

  it("the stale-roster case: a picked member who left reaches nobody, not another Jane", () => {
    // Jane Doe left between the picker's roster load and the send, so the
    // server's roster has only Jane Smith.
    const now = [JANE_SMITH, BOB];
    // Without the pick, the name reads as `@Jane`, and the first-word tier
    // hands it to the only Jane left: the bug.
    expect(resolveMentions("@Jane Doe can you cover?", now)).toEqual([
      "u-jane-smith",
    ]);
    // With it, the token is hers, and she is gone.
    expect(
      resolveMentions("@Jane Doe can you cover?", now, [], pickedJane),
    ).toEqual([]);
  });

  it("a picked member who renamed reaches nobody under the old name", () => {
    const renamed = { ...JANE_DOE, display_name: "Janet Doe" };
    expect(
      resolveMentions("@Jane Doe hi", [renamed, JANE_SMITH], [], pickedJane),
    ).toEqual([]);
  });

  it("a picked member still here is reached through the pick", () => {
    expect(
      resolveMentions("@Jane Doe hi", [JANE_DOE, JANE_SMITH], [], pickedJane),
    ).toEqual(["u-jane-doe"]);
    // A one-word label and a reduced one too.
    const sam = { user_id: "u-sam", display_name: "Sam (VP)" };
    const jane = { user_id: "u-jane", display_name: "Jane" };
    expect(
      resolveMentions(
        "@SamVP and @Jane",
        [sam, jane, JANE_SMITH],
        [],
        [
          { user_id: "u-sam", label: "SamVP" },
          { user_id: "u-jane", label: "Jane" },
        ],
      ),
    ).toEqual(["u-sam", "u-jane"]);
  });

  it("one label reaches one member: the first pick for it, so a re-pick replaces", () => {
    const a = { user_id: "u-chris-a", display_name: "Chris Lee" };
    const b = { user_id: "u-chris-b", display_name: "Chris Lee" };
    // Picked A, deleted the chip, picked B: the newest comes first.
    const picks = [
      { user_id: "u-chris-b", label: "Chris Lee" },
      { user_id: "u-chris-a", label: "Chris Lee" },
    ];
    expect(resolveMentions("@Chris Lee", [a, b], [], picks)).toEqual([
      "u-chris-b",
    ]);
    expect(mentionPicksIn("@Chris Lee", picks)).toEqual([picks[0]]);
  });

  it("a longer roster name doesn't take a picked label", () => {
    const longer = { user_id: "u-jds", display_name: "Jane Doe Smith" };
    expect(
      resolveMentions(
        "@Jane Doe Smith was asking",
        [JANE_DOE, longer],
        [],
        pickedJane,
      ),
    ).toEqual(["u-jane-doe"]);
    // Nor a one-word pick followed by more words.
    const jane = { user_id: "u-jane", display_name: "Jane" };
    expect(
      resolveMentions(
        "@Jane Doe hi",
        [jane, JANE_DOE],
        [],
        [{ user_id: "u-jane", label: "Jane" }],
      ),
    ).toEqual(["u-jane"]);
  });

  it("a stale pick isn't read as the member named exactly its first word", () => {
    // Jane Doe left; a member named exactly "Jane" is still here. The exact
    // first word would make the reading fall back to `@Jane` without the
    // picked label being read as written.
    const jane = { user_id: "u-jane", display_name: "Jane" };
    expect(resolveMentions("@Jane Doe hi", [jane, BOB])).toEqual(["u-jane"]);
    expect(
      resolveMentions("@Jane Doe hi", [jane, BOB], [], pickedJane),
    ).toEqual([]);
  });

  it("two members sharing a name are told apart by the pick", () => {
    const twin = { user_id: "u-jane-doe-2", display_name: "Jane Doe" };
    const chapter = [JANE_DOE, twin, BOB];
    // By name the pair is ambiguous and reaches nobody.
    expect(resolveMentions("@Jane Doe", chapter)).toEqual([]);
    expect(
      resolveMentions(
        "@Jane Doe",
        chapter,
        [],
        [{ user_id: "u-jane-doe-2", label: "Jane Doe" }],
      ),
    ).toEqual(["u-jane-doe-2"]);
  });

  it("an id whose member's name the label doesn't spell reaches nobody", () => {
    // A forged pick can't ping someone under a word that isn't their name.
    expect(
      resolveMentions(
        "@pizza time",
        [JANE_DOE, BOB],
        [],
        [{ user_id: "u-jane-doe", label: "pizza" }],
      ),
    ).toEqual([]);
    // Nor an id outside the chapter.
    expect(
      resolveMentions(
        "@Jane Doe",
        [JANE_SMITH],
        [],
        [{ user_id: "u-elsewhere", label: "Jane Doe" }],
      ),
    ).toEqual([]);
  });

  it("only the token written as the label is the pick; the rest resolve by name", () => {
    expect(
      resolveMentions("@Jane Doe and @Bob", [JANE_SMITH, BOB], [], pickedJane),
    ).toEqual([BOB.user_id]);
    // A hand-typed case variant is not what the picker wrote.
    expect(
      resolveMentions("@jane doe", [JANE_DOE, JANE_SMITH], [], pickedJane),
    ).toEqual(["u-jane-doe"]);
  });

  it("a pick outranks a role of the same name", () => {
    const officers: MentionRole = {
      role_id: "r-1",
      name: "Jane Doe",
      member_ids: [BOB.user_id],
      mentionable: true,
    };
    expect(
      resolveMentions("@Jane Doe", [JANE_DOE, BOB], [officers], pickedJane),
    ).toEqual(["u-jane-doe"]);
  });

  it("reads a picked spaced label whole for the pre-read too", () => {
    const reading = sendMentionReading([JANE_SMITH], [], pickedJane);
    expect(extractMentionTokens("@Jane Doe hi", reading)).toEqual(["Jane Doe"]);
    expect(
      extractMentionTokens(
        "@Jane Doe hi",
        sendMentionReading([JANE_SMITH], []),
      ),
    ).toEqual(["Jane"]);
  });

  describe("mentionPicksIn", () => {
    it("keeps the picks the body still writes, once per label", () => {
      const picks: MentionPick[] = [
        { user_id: "u-jane-doe", label: "Jane Doe" },
        { user_id: "u-jane-doe", label: "Jane Doe" },
        { user_id: "u-bob", label: "Bob Stone" },
      ];
      expect(mentionPicksIn("hey @Jane Doe!", picks)).toEqual([
        { user_id: "u-jane-doe", label: "Jane Doe" },
      ]);
      expect(mentionPicksIn("no mentions", picks)).toEqual([]);
      // A label inside a longer word is not written.
      expect(mentionPicksIn("@Jane Doersmith", picks)).toEqual([]);
      // Nor a case variant of it.
      expect(mentionPicksIn("@jane doe", picks)).toEqual([]);
    });

    it("holds at most MAX_MENTION_PICKS", () => {
      const many = Array.from({ length: MAX_MENTION_PICKS + 5 }, (_, i) => ({
        user_id: `u-${i}`,
        label: `Jane${i}`,
      }));
      const body = many.map((pick) => `@${pick.label}`).join(" ");
      expect(mentionPicksIn(body, many)).toHaveLength(MAX_MENTION_PICKS);
    });

    it("drops strays, so a stored list never pins a token the body lost", () => {
      expect(
        mentionPicksIn("@Bob Stone", [
          { user_id: "u-jane-doe", label: "Jane Doe" },
          { user_id: "u-bob", label: "Bob Stone" },
        ]),
      ).toEqual([{ user_id: "u-bob", label: "Bob Stone" }]);
    });
  });

  it("reads a stored list defensively", () => {
    expect(readMentionPicks(undefined)).toEqual([]);
    expect(readMentionPicks("Jane")).toEqual([]);
    expect(
      readMentionPicks([
        { user_id: "u-1", label: "Jane Doe" },
        { user_id: 7, label: "Bob" },
        null,
        { user_id: "u-2" },
      ]),
    ).toEqual([{ user_id: "u-1", label: "Jane Doe" }]);
  });
});

describe("@Frapp, the assistant's handle (#4713)", () => {
  const FRAPP: MentionCandidate = {
    user_id: "f0000000-0000-4000-8000-000000000001",
    display_name: "Frapp",
  };
  const FRAPP_FAN: MentionCandidate = {
    user_id: "f0000000-0000-4000-8000-000000000002",
    display_name: "Frapp Fan",
  };
  const roster = [JANE, BOB];

  describe("reaches nobody", () => {
    it("never resolves to a member named Frapp, or one whose name starts with it", () => {
      expect(resolveMentions("@Frapp what's quorum", [JANE, FRAPP])).toEqual(
        [],
      );
      expect(resolveMentions("@frapp hi", [JANE, FRAPP_FAN])).toEqual([]);
    });

    it("never resolves to a role named Frapp", () => {
      const role: MentionRole = {
        role_id: "r-frapp",
        name: "Frapp",
        member_ids: [JANE.user_id],
        mentionable: true,
      };
      expect(resolveMentions("@Frapp", roster, [role])).toEqual([]);
    });

    it("leaves a member with a longer name reachable by that name", () => {
      expect(resolveMentions("@Frapp Fan hi", [JANE, FRAPP_FAN])).toEqual([
        FRAPP_FAN.user_id,
      ]);
    });

    it("does not offer a member or a role a pick could not reach", () => {
      expect(mentionSuggestions([FRAPP, JANE], "")).toEqual([
        { member: JANE, label: "Jane Doe" },
      ]);
      expect(
        mentionPickerEntries(
          roster,
          [{ name: "Frapp", mentionable: true }],
          "",
        ),
      ).toEqual([
        { kind: "member", member: JANE, label: "Jane Doe" },
        { kind: "member", member: BOB, label: "Bob Stone" },
      ]);
    });
  });

  describe("mentionPickerRows", () => {
    const ask = { kind: "ask", label: ASK_MENTION_NAME };

    it("is mentionPickerEntries for a member without Ask", () => {
      for (const query of ["", "f", "frapp", "jane"]) {
        expect(mentionPickerRows(roster, [], query, { ask: false })).toEqual(
          mentionPickerEntries(roster, [], query),
        );
      }
    });

    it("puts Frapp last on a bare @, so the first row is still a person", () => {
      expect(mentionPickerRows(roster, [], "", { ask: true })).toEqual([
        { kind: "member", member: JANE, label: "Jane Doe" },
        { kind: "member", member: BOB, label: "Bob Stone" },
        ask,
      ]);
    });

    it("puts Frapp first once its name is being typed, in any case", () => {
      for (const query of ["f", "Fr", "FRAPP", "frapp"]) {
        expect(
          mentionPickerRows(roster, [], query, { ask: true })[0],
          query,
        ).toEqual(ask);
      }
    });

    it("offers no Frapp for text that is not the start of its name", () => {
      for (const query of ["rapp", "frappe", "jane", "fx"]) {
        expect(
          mentionPickerRows(roster, [], query, { ask: true }).some(
            (row) => row.kind === "ask",
          ),
          query,
        ).toBe(false);
      }
    });

    it("takes one of the rows, never one more", () => {
      const many = Array.from({ length: 20 }, (_, index) => ({
        user_id: `m-${index}`,
        display_name: `Frank ${index}`,
      }));
      const bare = mentionPickerRows(many, [], "", { ask: true });
      expect(bare).toHaveLength(8);
      expect(bare.at(-1)).toEqual(ask);
      const typed = mentionPickerRows(many, [], "fr", { ask: true });
      expect(typed).toHaveLength(8);
      expect(typed[0]).toEqual(ask);
    });
  });

  describe("askMentionQuestion", () => {
    it("is null for a message that does not name Frapp", () => {
      expect(askMentionQuestion("what's quorum?")).toBeNull();
      expect(askMentionQuestion("@Jane what's quorum?")).toBeNull();
      expect(askMentionQuestion("mail frapp@example.com")).toBeNull();
      expect(askMentionQuestion("@Frappe is a drink")).toBeNull();
    });

    it("is the words without the handle, wherever the handle is", () => {
      expect(askMentionQuestion("@Frapp what's quorum?")).toBe(
        "what's quorum?",
      );
      expect(askMentionQuestion("@frapp, what's quorum?")).toBe(
        "what's quorum?",
      );
      expect(askMentionQuestion("what do I owe @Frapp")).toBe("what do I owe");
      expect(askMentionQuestion("hey @FRAPP: when is chapter")).toBe(
        "hey when is chapter",
      );
      expect(askMentionQuestion("@Frapp @Frapp twice")).toBe("twice");
    });

    it("keeps the lines of a longer question", () => {
      expect(askMentionQuestion("@Frapp two things\n1. dues\n2. quorum")).toBe(
        "two things\n1. dues\n2. quorum",
      );
    });

    it("is empty when the handle is all there is", () => {
      expect(askMentionQuestion("@Frapp")).toBe("");
      expect(askMentionQuestion("  @Frapp,  ")).toBe("");
    });

    it("reads a member's spaced name as that member, as a send does", () => {
      const names = spacedMentionNames([FRAPP_FAN]);
      expect(askMentionQuestion("@Frapp Fan are you in?", names)).toBeNull();
      expect(askMentionQuestion("@Frapp fans, are you in?", names)).toBe(
        "fans, are you in?",
      );
    });

    it("leaves other mentions in the question as written", () => {
      expect(askMentionQuestion("@Frapp what does @Jane owe")).toBe(
        "what does @Jane owe",
      );
    });
  });
});
