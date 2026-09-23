import { describe, expect, it } from "vitest";
import {
  mergeServerRow,
  emptyCache,
  removeMessage,
  selectMessages,
} from "@repo/chat-core/cache";
import {
  reactionActionType,
  type ChatMessage,
  type RawChatMessage,
} from "@repo/chat-core/types";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  applyBlockList,
  blockListNotice,
  canOpenMessageActions,
  classifyMessage,
  contradictingRows,
  hasMaskedCopyFrom,
  isBlockableSender,
  messageActionsFor,
  replaceMaskedCopies,
  rosterMembership,
  rowsToRemember,
  tombstoneCanUnblock,
  visibleReactions,
  type BlockState,
  type MemberLookup,
} from "./blocks";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const BLOCKED = "22222222-2222-4222-8222-222222222222";
const FRIEND = "33333333-3333-4333-8333-333333333333";

/** What the API's masker writes today — used only to prove nothing reads it. */
const SERVER_SENTINEL = "[message from a blocked member]";

interface StateExtras {
  unblocked?: string[];
  cleared?: string[];
}

function state(
  status: BlockState["status"],
  ids: string[],
  { unblocked = [], cleared = [] }: StateExtras,
): BlockState {
  return {
    status,
    ids: new Set(ids),
    unblocked: new Set(unblocked),
    cleared: new Set(cleared),
  };
}

const ready = (ids: string[] = [], extras: StateExtras = {}) =>
  state("ready", ids, extras);
const loading = (ids: string[] = [], extras: StateExtras = {}) =>
  state("loading", ids, extras);
const unavailable = (ids: string[] = [], extras: StateExtras = {}) =>
  state("unavailable", ids, extras);

const everyoneIsAMember: MemberLookup = () => true;

/**
 * Rows go through the real `mergeServerRow`, so provenance is whatever
 * chat-core's normalizer derives from the wire shape — not a hand-set flag
 * that could drift from it.
 */
function restRow(
  id: string,
  senderId: string | null,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    id,
    channel_id: "chan-1",
    sender_id: senderId,
    author_name: senderId === null ? "Discord Dan" : null,
    content: `body ${id}`,
    kind: "text",
    // PostgREST's `timestamptz` shape.
    created_at: "2026-09-15T18:00:00.123456+00:00",
    sender_blocked: false,
    ...overrides,
  };
}

function echoRow(
  id: string,
  senderId: string | null,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  const row: RawChatMessage = {
    id,
    channel_id: "chan-1",
    sender_id: senderId,
    author_name: senderId === null ? "Discord Dan" : null,
    content: `body ${id}`,
    kind: "text",
    // Postgres's text `timestamptz` shape — space, `+00` — which realtime-js
    // would pass through untouched. (Local Realtime v2.113.4 actually sends the
    // REST shape; see the spec's 2026-09-23 correction.) It sorts *below*
    // every REST timestamp above as a string, so a watermark compare would
    // vouch for it. Nothing here may care.
    created_at: "2026-09-15 18:05:12.4+00",
    ...overrides,
  };
  return row;
}

function one(raw: RawChatMessage): ChatMessage {
  const [message] = selectMessages(mergeServerRow(emptyCache(), raw));
  return message!;
}

describe("classifyMessage", () => {
  describe("the viewer's own message", () => {
    it("is visible on every path and in every list state", () => {
      for (const state of [ready(), loading(), unavailable()]) {
        expect(classifyMessage(one(echoRow("m1", VIEWER)), state, VIEWER)).toBe(
          "visible",
        );
        expect(classifyMessage(one(restRow("m1", VIEWER)), state, VIEWER)).toBe(
          "visible",
        );
      }
    });
  });

  describe("a row the server evaluated", () => {
    it("is a tombstone when the server masked it, whatever the list says", () => {
      const masked = one(restRow("m1", BLOCKED, { sender_blocked: true }));
      expect(classifyMessage(masked, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
      // Unblocked since, but this copy's content was withheld: nothing to draw.
      expect(classifyMessage(masked, ready([]), VIEWER)).toBe("tombstone");
      expect(classifyMessage(masked, unavailable(), VIEWER)).toBe("tombstone");
    });

    it("is visible when cleared, even while the list is unavailable (no wholesale tombstoning)", () => {
      const cleared = one(restRow("m1", FRIEND));
      expect(classifyMessage(cleared, ready(), VIEWER)).toBe("visible");
      expect(classifyMessage(cleared, loading(), VIEWER)).toBe("visible");
      expect(classifyMessage(cleared, unavailable(), VIEWER)).toBe("visible");
    });

    it("is a tombstone when cleared before a block the list now records", () => {
      const cleared = one(restRow("m1", BLOCKED));
      expect(classifyMessage(cleared, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
      // The floor applies while the list is unreadable too.
      expect(classifyMessage(cleared, unavailable([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
    });
  });

  describe("a row that arrived over the Realtime echo", () => {
    it("is visible only against a ready list that does not name its sender", () => {
      expect(classifyMessage(one(echoRow("m1", FRIEND)), ready(), VIEWER)).toBe(
        "visible",
      );
    });

    it("is a tombstone when its sender is on the list", () => {
      const echoed = one(echoRow("m1", BLOCKED));
      expect(classifyMessage(echoed, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
      expect(classifyMessage(echoed, unavailable([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
    });

    it("is held while the list is loading or unavailable — fail closed", () => {
      const echoed = one(echoRow("m1", FRIEND));
      expect(classifyMessage(echoed, loading(), VIEWER)).toBe("held");
      expect(classifyMessage(echoed, unavailable(), VIEWER)).toBe("held");
    });

    it("stays visible through an outage once a ready list cleared it this session (finding 4)", () => {
      // Never re-read over REST: the backfill reads only after the last-seen
      // cursor, which this echo advanced. Without the clearance a later outage
      // would take back a message the viewer already read.
      const echoed = one(echoRow("m1", FRIEND));
      const cleared = { cleared: ["m1"] };
      expect(classifyMessage(echoed, unavailable([], cleared), VIEWER)).toBe(
        "visible",
      );
      expect(classifyMessage(echoed, loading([], cleared), VIEWER)).toBe(
        "visible",
      );
      // A row that first arrives during the outage has no clearance: held.
      const late = one(echoRow("m2", FRIEND));
      expect(classifyMessage(late, unavailable([], cleared), VIEWER)).toBe(
        "held",
      );
    });

    it("is visible in every list state once this client confirmed unblocking its sender", () => {
      // A confirmed unblock applies at once, whatever the list's status — the
      // same rule that makes a confirmed block tombstone at once.
      const echoed = one(echoRow("m1", BLOCKED));
      const unblocked = { unblocked: [BLOCKED] };
      for (const state of [
        ready([], unblocked),
        loading([], unblocked),
        unavailable([], unblocked),
      ]) {
        expect(classifyMessage(echoed, state, VIEWER)).toBe("visible");
      }
      // Nobody else's rows are released by it.
      expect(
        classifyMessage(
          one(echoRow("m2", FRIEND)),
          unavailable([], unblocked),
          VIEWER,
        ),
      ).toBe("held");
    });

    it("a clearance never outranks a block made since", () => {
      const echoed = one(echoRow("m1", BLOCKED));
      expect(
        classifyMessage(
          echoed,
          unavailable([BLOCKED], { cleared: ["m1"] }),
          VIEWER,
        ),
      ).toBe("tombstone");
    });

    it("an UPDATE echo over a masked row never shows the words the mask withheld", () => {
      // A pin by any `channels:manage` holder writes the raw row back over the
      // server-masked one (#2315 defect 5). `mergeServerRow` carries the
      // server's verdict onto it, so it stays a tombstone in every list state —
      // including a ready list that predates a block made on another device,
      // which showed it in full before the carry.
      let cache = mergeServerRow(
        emptyCache(),
        restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
      );
      cache = mergeServerRow(
        cache,
        echoRow("m1", BLOCKED, { is_pinned: true, content: "the real words" }),
      );
      const [pinned] = selectMessages(cache);
      for (const blockState of [
        ready([BLOCKED]),
        ready(),
        loading(),
        unavailable(),
        unavailable([], { cleared: ["m1"] }),
      ]) {
        expect(classifyMessage(pinned!, blockState, VIEWER)).toBe("tombstone");
      }
    });

    it("an echo that carried a mask shows once this client confirmed the unblock, in every list state", () => {
      // A confirmed unblock applies whatever the list is doing, like any
      // confirmed change — and a pinned or edited message from a member the
      // viewer unblocked must not stay hidden. (It cannot tell a mask that
      // postdates the unblock, from a re-block elsewhere: #2499.)
      let cache = mergeServerRow(
        emptyCache(),
        restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
      );
      cache = mergeServerRow(
        cache,
        echoRow("m1", BLOCKED, { content: "edited after the unblock" }),
      );
      const [edited] = selectMessages(cache);
      for (const blockState of [
        ready([], { unblocked: [BLOCKED] }),
        loading([], { unblocked: [BLOCKED] }),
        unavailable([], { unblocked: [BLOCKED] }),
      ]) {
        expect(classifyMessage(edited!, blockState, VIEWER)).toBe("visible");
      }
      // …unless a block read since outranks it.
      expect(classifyMessage(edited!, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
    });

    it("a carried mask is never remembered as seen, so a later outage cannot surface it", () => {
      let cache = mergeServerRow(
        emptyCache(),
        restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
      );
      cache = mergeServerRow(
        cache,
        echoRow("m1", BLOCKED, { is_pinned: true, content: "the real words" }),
      );
      const { rows } = applyBlockList(selectMessages(cache), ready(), VIEWER);
      expect(rowsToRemember(rows, VIEWER, true)).toEqual([]);
    });
  });

  describe("senders nobody can block", () => {
    it("never hides the system actor or an imported row", () => {
      const system = one(echoRow("m1", SYSTEM_SENDER_ID));
      const imported = one(echoRow("m2", null, { kind: "imported" }));
      for (const state of [
        loading(),
        unavailable(),
        ready([SYSTEM_SENDER_ID]),
      ]) {
        expect(classifyMessage(system, state, VIEWER)).toBe("visible");
        expect(classifyMessage(imported, state, VIEWER)).toBe("visible");
      }
    });
  });

  describe("the server's sentinel string", () => {
    it("is never what decides", () => {
      // Sentinel content on a row the server says is clear stays visible…
      const lookalike = one(
        restRow("m1", FRIEND, { content: SERVER_SENTINEL }),
      );
      expect(classifyMessage(lookalike, ready(), VIEWER)).toBe("visible");
      // …and a masked row is a tombstone whatever its content says.
      const reworded = one(
        restRow("m2", BLOCKED, { sender_blocked: true, content: "anything" }),
      );
      expect(classifyMessage(reworded, ready([BLOCKED]), VIEWER)).toBe(
        "tombstone",
      );
    });
  });
});

describe("applyBlockList", () => {
  const rows = [
    restRow("a", FRIEND),
    restRow("b", BLOCKED, { sender_blocked: true }),
    echoRow("c", FRIEND),
    echoRow("d", VIEWER),
    echoRow("e", BLOCKED),
  ];
  const messages = selectMessages(
    rows.reduce((cache, row) => mergeServerRow(cache, row), emptyCache()),
  );

  it("holds unevaluated rows off screen when the list is unavailable", () => {
    const thread = applyBlockList(messages, unavailable(), VIEWER);
    expect(thread.heldCount).toBe(2); // c and e — the echoes from others
    expect(thread.rows.map((row) => [row.message.id, row.visibility])).toEqual(
      expect.arrayContaining([
        ["a", "visible"],
        ["b", "tombstone"],
        ["d", "visible"],
      ]),
    );
    expect(thread.rows.map((row) => row.message.id)).not.toContain("c");
    expect(thread.rows.map((row) => row.message.id)).not.toContain("e");
  });

  it("releases them once the list is ready, tombstoning the blocked sender", () => {
    const thread = applyBlockList(messages, ready([BLOCKED]), VIEWER);
    expect(thread.heldCount).toBe(0);
    expect(
      Object.fromEntries(
        thread.rows.map((row) => [row.message.id, row.visibility]),
      ),
    ).toEqual({
      a: "visible",
      b: "tombstone",
      c: "visible",
      d: "visible",
      e: "tombstone",
    });
  });

  it("keeps the input order", () => {
    const thread = applyBlockList(messages, ready(), VIEWER);
    expect(thread.rows.map((row) => row.message.id)).toEqual(
      messages
        .map((message) => message.id)
        .filter((id) => thread.rows.some((row) => row.message.id === id)),
    );
  });
});

describe("rowsToRemember", () => {
  it("names every row a ready list shows from someone the viewer could block", () => {
    const messages = selectMessages(
      [
        restRow("a", FRIEND),
        echoRow("b", FRIEND),
        echoRow("c", VIEWER),
        echoRow("d", SYSTEM_SENDER_ID),
        echoRow("e", BLOCKED),
      ].reduce((cache, row) => mergeServerRow(cache, row), emptyCache()),
    );
    const thread = applyBlockList(messages, ready([BLOCKED]), VIEWER);
    // c is the viewer's, d is unblockable and e is a tombstone: none of them
    // needs remembering. a does, although the server evaluated it — see below.
    expect(rowsToRemember(thread.rows, VIEWER, true).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps a REST row readable through an outage after an UPDATE echo strips its evaluation", () => {
    // Read over REST and shown against a ready list…
    let cache = mergeServerRow(emptyCache(), restRow("m1", FRIEND));
    const shown = applyBlockList(selectMessages(cache), ready(), VIEWER);
    const cleared = rowsToRemember(shown.rows, VIEWER, true);
    expect(cleared).toEqual(["m1"]);

    // …then pinned by an officer while the list is down. The echo replaces the
    // row as unevaluated, so only the clearance still vouches for it.
    cache = mergeServerRow(cache, echoRow("m1", FRIEND, { is_pinned: true }));
    const [pinned] = selectMessages(cache);
    expect(pinned!._blockEvaluated).toBe(false);
    expect(classifyMessage(pinned!, unavailable([], { cleared }), VIEWER)).toBe(
      "visible",
    );
    expect(classifyMessage(pinned!, unavailable(), VIEWER)).toBe("held");
  });

  it("names only server-cleared rows when the list is not ready", () => {
    const UNBLOCKED = "55555555-5555-4555-8555-555555555555";
    const messages = selectMessages(
      [
        restRow("a", FRIEND),
        restRow("b", FRIEND, { sender_blocked: true }),
        echoRow("c", UNBLOCKED),
        echoRow("d", FRIEND),
        echoRow("e", FRIEND),
      ].reduce((cache, row) => mergeServerRow(cache, row), emptyCache()),
    );
    const thread = applyBlockList(
      messages,
      unavailable([], { unblocked: [UNBLOCKED], cleared: ["e"] }),
      VIEWER,
    );
    // b is a tombstone and d is held. c is shown on a confirmed unblock, which
    // applies in every list state, and e on a clearance already recorded:
    // neither needs remembering. a is new, and only the server vouched for it.
    expect(thread.rows.map((row) => row.message.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "e",
    ]);
    expect(rowsToRemember(thread.rows, VIEWER, false)).toEqual(["a"]);
  });
});

describe("contradictingRows (finding 6)", () => {
  const maskedFromBlocked = one(
    restRow("m1", BLOCKED, { sender_blocked: true }),
  );

  it("names a masked row whose sender a ready list clears", () => {
    // What a block made on another device looks like before the list re-reads.
    expect(contradictingRows([maskedFromBlocked], ready())).toEqual(["m1"]);
  });

  it("is quiet when the list agrees", () => {
    expect(contradictingRows([maskedFromBlocked], ready([BLOCKED]))).toEqual(
      [],
    );
  });

  it("still counts a sender this client unblocked — a later block elsewhere looks the same", () => {
    const later = one(restRow("m2", BLOCKED, { sender_blocked: true }));
    expect(
      contradictingRows(
        [later, maskedFromBlocked],
        ready([], { unblocked: [BLOCKED] }),
      ),
    ).toEqual(["m1", "m2"]);
  });

  it("claims nothing against a list that is not ready", () => {
    expect(contradictingRows([maskedFromBlocked], unavailable())).toEqual([]);
    expect(contradictingRows([maskedFromBlocked], loading())).toEqual([]);
  });

  it("ignores unmasked and unevaluated rows", () => {
    expect(
      contradictingRows(
        [one(restRow("m1", FRIEND)), one(echoRow("m2", BLOCKED))],
        ready(),
      ),
    ).toEqual([]);
  });
});

describe("visibleReactions (finding 2)", () => {
  // `reaction:` plus up to 41 characters of the reactor's own text.
  const insult = reactionActionType("you're pathetic");
  const thumbs = reactionActionType("👍");
  const reactions = {
    [insult]: [BLOCKED],
    [thumbs]: [FRIEND, BLOCKED, VIEWER],
    "vote:o1": [BLOCKED],
  };

  it("drops a blocked reactor from every group on a ready list", () => {
    expect(visibleReactions(reactions, ready([BLOCKED]), VIEWER)).toEqual({
      [thumbs]: [FRIEND, VIEWER],
    });
  });

  it("keeps everyone a ready list does not name, and the object itself", () => {
    expect(visibleReactions(reactions, ready(), VIEWER)).toBe(reactions);
  });

  it("keeps only the viewer's own reactions while the list is not ready", () => {
    for (const state of [loading(), unavailable(), unavailable([BLOCKED])]) {
      expect(visibleReactions(reactions, state, VIEWER)).toEqual({
        [thumbs]: [VIEWER],
      });
    }
  });

  it("also keeps a reactor this client confirmed unblocking, in every list state", () => {
    for (const state of [
      loading([], { unblocked: [BLOCKED] }),
      unavailable([], { unblocked: [BLOCKED] }),
    ]) {
      expect(visibleReactions(reactions, state, VIEWER)).toEqual({
        [insult]: [BLOCKED],
        [thumbs]: [BLOCKED, VIEWER],
        "vote:o1": [BLOCKED],
      });
    }
  });

  it("shows nothing but the viewer's while the viewer is unknown", () => {
    expect(visibleReactions(reactions, unavailable(), null)).toEqual({});
  });
});

describe("replaceMaskedCopies (finding 3)", () => {
  function cacheOf(rows: RawChatMessage[]) {
    return rows.reduce(
      (cache, row) => mergeServerRow(cache, row),
      emptyCache(),
    );
  }

  it("swaps the unblocked member's masked copies for their clear twins", () => {
    const cache = cacheOf([
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
      restRow("m2", FRIEND),
    ]);
    const next = replaceMaskedCopies(
      cache,
      [
        restRow("m1", BLOCKED, { content: "the real words" }),
        restRow("m2", FRIEND, { content: "rewritten by a stale read" }),
      ],
      BLOCKED,
    );
    expect(next.byId["m1"]).toMatchObject({
      content: "the real words",
      sender_blocked: false,
      _blockEvaluated: true,
    });
    // Not the unblocked member's row, so the re-read never touches it.
    expect(next.byId["m2"]!.content).toBe("body m2");
  });

  it("keeps what Realtime wrote while the re-read was in flight", () => {
    const before = cacheOf([
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
      restRow("m3", BLOCKED, { sender_blocked: true, content: "hidden" }),
    ]);
    // Landing mid-request: a new message, a delete of m3 (its row is gone),
    // and an edit echo over m1 — which is no longer a masked copy.
    let during = removeMessage(
      mergeServerRow(before, echoRow("m4", FRIEND)),
      "m3",
    );
    during = mergeServerRow(
      during,
      echoRow("m1", BLOCKED, { content: "edited live", edited_at: "x" }),
    );

    const after = replaceMaskedCopies(
      during,
      [
        restRow("m1", BLOCKED, { content: "older words" }),
        restRow("m3", BLOCKED, { content: "deleted words" }),
      ],
      BLOCKED,
    );

    expect(after.byId["m4"]).toBeDefined();
    expect(after.byId["m3"]).toBeUndefined();
    expect(after.byId["m1"]!.content).toBe("edited live");
  });

  it("leaves a copy the server still masks as it is", () => {
    const cache = cacheOf([
      restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" }),
    ]);
    expect(
      replaceMaskedCopies(
        cache,
        [restRow("m1", BLOCKED, { sender_blocked: true, content: "hidden" })],
        BLOCKED,
      ),
    ).toBe(cache);
  });

  it("hasMaskedCopyFrom finds only that sender's masked rows", () => {
    const cache = cacheOf([
      restRow("m1", BLOCKED, { sender_blocked: true }),
      restRow("m2", FRIEND),
    ]);
    expect(hasMaskedCopyFrom(cache, BLOCKED)).toBe(true);
    expect(hasMaskedCopyFrom(cache, FRIEND)).toBe(false);
    expect(hasMaskedCopyFrom(undefined, BLOCKED)).toBe(false);
  });
});

describe("blockListNotice", () => {
  it("always speaks up when the list is unavailable, with a retry", () => {
    expect(blockListNotice("unavailable", 0)).toMatchObject({
      title: "Couldn't load your block list",
      canRetry: true,
    });
    expect(blockListNotice("unavailable", 3)?.body).toMatch(
      /^3 new messages are held/,
    );
    expect(blockListNotice("unavailable", 1)?.body).toMatch(
      /^1 new message is held/,
    );
  });

  it("stays quiet while loading unless something is actually held", () => {
    expect(blockListNotice("loading", 0)).toBeNull();
    expect(blockListNotice("loading", 2)).toMatchObject({ canRetry: false });
    expect(blockListNotice("ready", 0)).toBeNull();
  });
});

describe("messageActionsFor", () => {
  const base = one(restRow("m1", FRIEND));

  it("offers report and block on someone else's confirmed message", () => {
    expect(messageActionsFor(base, VIEWER, everyoneIsAMember)).toEqual({
      canOpen: true,
      canReport: true,
      canBlock: true,
    });
  });

  it("offers nothing on the viewer's own message", () => {
    expect(
      messageActionsFor(
        { ...base, sender_id: VIEWER },
        VIEWER,
        everyoneIsAMember,
      ).canOpen,
    ).toBe(false);
  });

  it("offers nothing before the viewer is known", () => {
    expect(messageActionsFor(base, null, everyoneIsAMember).canOpen).toBe(
      false,
    );
    expect(canOpenMessageActions(base, null)).toBe(false);
  });

  it("offers nothing on a row the server has not confirmed, or a deleted one", () => {
    for (const row of [
      { ...base, _status: "pending" as const },
      { ...base, _status: "failed" as const },
      { ...base, is_deleted: true },
    ]) {
      expect(messageActionsFor(row, VIEWER, everyoneIsAMember).canOpen).toBe(
        false,
      );
      expect(canOpenMessageActions(row, VIEWER)).toBe(false);
    }
  });

  it("reports but never blocks the system actor", () => {
    expect(
      messageActionsFor(
        { ...base, sender_id: SYSTEM_SENDER_ID },
        VIEWER,
        everyoneIsAMember,
      ),
    ).toEqual({ canOpen: true, canReport: true, canBlock: false });
  });

  it("reports but never blocks an imported row", () => {
    expect(
      messageActionsFor(
        { ...base, sender_id: null },
        VIEWER,
        everyoneIsAMember,
      ),
    ).toEqual({
      canOpen: true,
      canReport: true,
      canBlock: false,
    });
  });

  it("offers Block to a sender the cached roster does not list — a brand-new member looks exactly like that", () => {
    // Loaded before FRIEND joined. Hiding Block here would hide Guideline
    // 1.2's control from the member who just arrived.
    const staleRoster = rosterMembership({
      byId: { [VIEWER]: "Vic" },
      isPending: false,
      isError: false,
    });
    expect(messageActionsFor(base, VIEWER, staleRoster)).toEqual({
      canOpen: true,
      canReport: true,
      canBlock: true,
    });
  });

  it("still offers Block while the roster cannot say, leaving the 404 to the confirmation", () => {
    for (const roster of [
      { byId: {}, isPending: true, isError: false },
      { byId: {}, isPending: false, isError: true },
    ]) {
      expect(
        messageActionsFor(base, VIEWER, rosterMembership(roster)).canBlock,
      ).toBe(true);
    }
  });

  it("reports but does not offer Block once a block attempt proved they left (finding 11)", () => {
    const afterA404 = rosterMembership(
      { byId: { [VIEWER]: "Vic" }, isPending: false, isError: false },
      new Set([FRIEND]),
    );
    expect(messageActionsFor(base, VIEWER, afterA404)).toEqual({
      canOpen: true,
      canReport: true,
      canBlock: false,
    });
  });
});

describe("rosterMembership", () => {
  it("says yes for a listed member and nothing either way for anyone else", () => {
    const loaded = rosterMembership({
      byId: { [FRIEND]: "Casey" },
      isPending: false,
      isError: false,
    });
    expect(loaded(FRIEND)).toBe(true);
    // Not listed is not departed: the roster is cached.
    expect(loaded(BLOCKED)).toBeNull();
    // Not fooled by the object prototype.
    expect(loaded("toString")).toBeNull();
    expect(
      rosterMembership({ byId: {}, isPending: true, isError: false })(FRIEND),
    ).toBeNull();
  });

  it("says no only for a member a block attempt proved departed, until a roster lists them again", () => {
    const departed = new Set([BLOCKED]);
    expect(
      rosterMembership(
        { byId: {}, isPending: false, isError: false },
        departed,
      )(BLOCKED),
    ).toBe(false);
    expect(
      rosterMembership(
        { byId: {}, isPending: true, isError: false },
        departed,
      )(BLOCKED),
    ).toBe(false);
    // Rejoined: the roster's word wins.
    expect(
      rosterMembership(
        { byId: { [BLOCKED]: "Blake" }, isPending: false, isError: false },
        departed,
      )(BLOCKED),
    ).toBe(true);
  });
});

describe("isBlockableSender / tombstoneCanUnblock", () => {
  it("rejects the system actor and imported rows", () => {
    expect(isBlockableSender(SYSTEM_SENDER_ID)).toBe(false);
    expect(isBlockableSender(null)).toBe(false);
    expect(isBlockableSender(BLOCKED)).toBe(true);
  });

  it("withholds Unblock only after an unblock this client confirmed", () => {
    const row = { sender_id: BLOCKED };
    expect(tombstoneCanUnblock(row, ready([BLOCKED]))).toBe(true);
    expect(tombstoneCanUnblock(row, unavailable())).toBe(true);
    expect(tombstoneCanUnblock(row, loading())).toBe(true);
    expect(tombstoneCanUnblock(row, ready([], { unblocked: [BLOCKED] }))).toBe(
      false,
    );
    expect(
      tombstoneCanUnblock(row, unavailable([], { unblocked: [BLOCKED] })),
    ).toBe(false);
  });

  it("does not claim a block ended just because a ready list lacks them (finding 6)", () => {
    // A masked row for someone off a ready list is what a block made on
    // another device looks like until the list is re-read.
    expect(tombstoneCanUnblock({ sender_id: BLOCKED }, ready([]))).toBe(true);
  });

  it("never offers Unblock for a sender nobody can block", () => {
    expect(tombstoneCanUnblock({ sender_id: null }, ready())).toBe(false);
    expect(
      tombstoneCanUnblock({ sender_id: SYSTEM_SENDER_ID }, unavailable()),
    ).toBe(false);
  });
});
