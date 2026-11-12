import { describe, expect, it } from "vitest";
import {
  SIGNUP_END_PASSED_PROBLEM,
  SIGNUP_END_TOO_FAR_PROBLEM,
  SIGNUP_SPOTS_PROBLEM,
  addSignupSlot,
  canCloseSignup,
  headcountAnswerPayload,
  headcountNotePayload,
  isSignupClosed,
  signupDeadlineLine,
  buildSignupMessage,
  castSignupClaim,
  checkSignupDraft,
  emptySignupDraft,
  readSignupPayload,
  removeSignupSlot,
  setSignupSlot,
  signupCardEyebrow,
  signupCardFooter,
  signupClaimPayload,
  signupSlotAction,
  signupSlotCount,
  tallySignups,
  type SignupPayload,
} from "./signups";
import type { ChatMessage } from "./types";

const card: SignupPayload = {
  title: "Sober drivers",
  slots: [
    { id: "fri", label: "Friday", capacity: 2 },
    { id: "sat", label: "Saturday", capacity: 2 },
  ],
};

function message(
  payload: unknown,
  claims: {
    user: string;
    slots: unknown;
    at?: string;
    type?: string;
    note?: string;
  }[] = [],
): ChatMessage {
  return {
    id: "m1",
    kind: "signup",
    payload,
    actions: claims.map((claim, index) => ({
      id: `a${index}`,
      message_id: "m1",
      user_id: claim.user,
      action_type: claim.type ?? "signup",
      payload: {
        slot_ids: claim.slots,
        ...(claim.note !== undefined ? { note: claim.note } : {}),
      },
      created_at: claim.at ?? `2026-11-12T10:0${index}:00Z`,
    })),
  } as unknown as ChatMessage;
}

describe("buildSignupMessage (#3926)", () => {
  it("makes the title the message's text and gives each slot an id", () => {
    let n = 0;
    const built = buildSignupMessage(
      {
        title: "Sober drivers",
        note: "  ",
        slots: [
          { label: "Friday", capacity: 2 },
          { label: "Bring a bucket", capacity: null },
        ],
      },
      () => `s${++n}`,
    );
    expect(built).toEqual({
      content: "Sober drivers",
      payload: {
        title: "Sober drivers",
        slots: [
          { id: "s1", label: "Friday", capacity: 2 },
          { id: "s2", label: "Bring a bucket", capacity: null },
        ],
      },
    });
  });
});

describe("readSignupPayload", () => {
  it("reads a card, and a limit that isn't a positive whole number as none", () => {
    expect(
      readSignupPayload(
        message({
          title: "T",
          note: "Details",
          slots: [
            { id: "a", label: "A", capacity: 0 },
            { id: "b", label: "B", capacity: 3 },
            { id: 4, label: "dropped" },
          ],
        }),
      ),
    ).toEqual({
      title: "T",
      note: "Details",
      slots: [
        { id: "a", label: "A", capacity: null },
        { id: "b", label: "B", capacity: 3 },
      ],
    });
  });

  it("is null for a card with no slots or no title", () => {
    expect(readSignupPayload(message({ title: "T", slots: [] }))).toBeNull();
    expect(readSignupPayload(message({ slots: card.slots }))).toBeNull();
    expect(readSignupPayload(message(null))).toBeNull();
  });
});

describe("tallySignups", () => {
  it("lists who holds each slot in the order they took it, and the viewer's slots", () => {
    const tally = tallySignups(
      message(card, [
        { user: "u2", slots: ["fri"], at: "2026-11-12T10:05:00Z" },
        {
          user: "me",
          slots: ["sat", "fri", "zzz"],
          at: "2026-11-12T10:01:00Z",
        },
        { user: "u3", slots: [] },
        { user: "u4", slots: ["fri"], type: "vote" },
      ]),
      card,
      "me",
    );
    expect(tally).toEqual({
      bySlot: { fri: ["me", "u2"], sat: ["me"] },
      people: 2,
      mine: ["fri", "sat"],
      notes: {},
    });
  });

  it("draws counts, full slots and the eyebrow from it", () => {
    const tally = tallySignups(
      message(card, [
        { user: "u1", slots: ["fri", "sat"] },
        { user: "u2", slots: ["fri"] },
      ]),
      card,
      "me",
    );
    expect(signupSlotCount(card.slots[0]!, tally)).toBe("2/2");
    expect(signupSlotAction(card.slots[0]!, tally)).toEqual({
      label: "Full",
      held: false,
      full: true,
    });
    expect(signupSlotAction(card.slots[1]!, tally).label).toBe("Sign up");
    expect(signupCardEyebrow(card, tally, 0)).toBe(
      "Sign-up · 3 of 4 spots taken",
    );
    expect(signupCardFooter(card, tally)).toBe("2 people signed up");
  });

  it("is Full only when every slot is, and plain when a slot has no limit", () => {
    const full = tallySignups(
      message(card, [
        { user: "u1", slots: ["fri", "sat"] },
        { user: "u2", slots: ["fri", "sat"] },
      ]),
      card,
      "u1",
    );
    expect(signupCardEyebrow(card, full, 0)).toBe("Sign-up · Full");
    // A slot you hold reads as yours, never as full.
    expect(signupSlotAction(card.slots[0]!, full).label).toBe("Signed up");
    expect(signupCardFooter(card, full)).toBe(
      "You're signed up for Friday and Saturday",
    );

    const open = {
      ...card,
      slots: [...card.slots, { id: "x", label: "X", capacity: null }],
    };
    const none = tallySignups(message(open), open, "me");
    expect(signupCardEyebrow(open, none, 0)).toBe("Sign-up");
    expect(signupSlotCount(open.slots[2]!, none)).toBe("0");
    expect(signupCardFooter(open, none)).toBe("No one has signed up yet.");
  });
});

describe("claims", () => {
  it("adds or drops one slot, sending the whole list in the card's order", () => {
    expect(signupClaimPayload(card, ["sat"], "fri")).toEqual({
      slot_ids: ["fri", "sat"],
    });
    expect(signupClaimPayload(card, ["fri"], "fri")).toEqual({ slot_ids: [] });
  });

  it("builds a second quick tap on the first, before the card has redrawn", () => {
    const pending = { current: null };
    const none = tallySignups(message(card), card, "me");
    expect(castSignupClaim(card, none, pending, "fri", 1_000)).toEqual({
      slot_ids: ["fri"],
    });
    expect(castSignupClaim(card, none, pending, "sat", 2_000)).toEqual({
      slot_ids: ["fri", "sat"],
    });
  });

  it("drops a slot the last tap lost to someone else, so the next tap isn't refused too", () => {
    const pending = { current: null };
    const held = tallySignups(
      message(card, [{ user: "me", slots: ["sat"] }]),
      card,
      "me",
    );
    // The member asks for Friday too; the 409 never reaches the card.
    expect(castSignupClaim(card, held, pending, "fri", 1_000)).toEqual({
      slot_ids: ["fri", "sat"],
    });
    // Friday filled first, and the card has drawn it full.
    const lost = tallySignups(
      message(card, [
        { user: "me", slots: ["sat"] },
        { user: "u1", slots: ["fri"] },
        { user: "u2", slots: ["fri"] },
      ]),
      card,
      "me",
    );
    // Giving up Saturday sends no Friday along with it.
    expect(castSignupClaim(card, lost, pending, "sat", 2_000)).toEqual({
      slot_ids: [],
    });
  });
});

describe("the New sign-up sheet draft", () => {
  function filled() {
    let draft = emptySignupDraft();
    draft = { ...draft, title: " Sober drivers ", note: " 10pm " };
    const [a, b] = draft.slots;
    draft = setSignupSlot(draft, a!.key, { label: "Friday", capacity: "2" });
    draft = setSignupSlot(draft, b!.key, { label: "Saturday", capacity: "" });
    return draft;
  }

  it("posts the named slots, blank Spots as no limit", () => {
    expect(checkSignupDraft(filled())).toEqual({
      ok: true,
      input: {
        title: "Sober drivers",
        note: "10pm",
        slots: [
          { label: "Friday", capacity: 2 },
          { label: "Saturday", capacity: null },
        ],
      },
    });
  });

  it("skips an empty row, and holds Post quietly while unfinished", () => {
    const draft = addSignupSlot(filled());
    expect(checkSignupDraft(draft).ok).toBe(true);
    expect(checkSignupDraft(emptySignupDraft())).toEqual({
      ok: false,
      problem: null,
    });
  });

  it("names a bad Spots value, a nameless slot and a repeated name on their row", () => {
    const draft = filled();
    const key = draft.slots[0]!.key;
    for (const capacity of ["0", "1.5", "two", "101"]) {
      expect(checkSignupDraft(setSignupSlot(draft, key, { capacity }))).toEqual(
        {
          ok: false,
          problem: SIGNUP_SPOTS_PROBLEM,
          slotKey: key,
        },
      );
    }
    expect(
      checkSignupDraft(setSignupSlot(draft, key, { label: " " })),
    ).toMatchObject({
      ok: false,
      problem: "Give this slot a name.",
      slotKey: key,
    });
    expect(
      checkSignupDraft(setSignupSlot(draft, key, { label: "saturday" })),
    ).toMatchObject({ ok: false, slotKey: draft.slots[1]!.key });
  });

  it("keeps at least one row", () => {
    let draft = emptySignupDraft();
    draft = removeSignupSlot(draft, draft.slots[0]!.key);
    draft = removeSignupSlot(draft, draft.slots[0]!.key);
    expect(draft.slots).toHaveLength(1);
  });
});

describe("headcount, end time and closing (#3926 step 2)", () => {
  const headcount = readSignupPayload(
    message(
      buildSignupMessage({ title: "Formal", slots: [], format: "headcount" })
        .payload,
    ),
  )!;

  it("builds a headcount with the server's two slots and an end time", () => {
    const at = new Date("2026-11-14T23:00:00Z");
    const built = buildSignupMessage({
      title: "Formal",
      slots: [{ label: "ignored", capacity: 1 }],
      format: "headcount",
      closesAt: at,
    });
    expect(built.payload.format).toBe("headcount");
    expect(built.payload.slots.map((s) => s.id)).toEqual([
      "going",
      "not_going",
    ]);
    expect(built.payload.closes_at).toBe(at.toISOString());
    expect(headcount.format).toBe("headcount");
  });

  it("counts going, names notes, and words the eyebrow and footer", () => {
    const m = message(headcount, [
      { user: "u1", slots: ["going"], note: " late " },
      { user: "u2", slots: ["not_going"] },
      { user: "me", slots: ["going"] },
    ]);
    const tally = tallySignups(m, headcount, "me");
    expect(tally.bySlot.going).toEqual(["u1", "me"]);
    expect(tally.notes).toEqual({ u1: "late" });
    expect(signupCardEyebrow(headcount, tally, 0)).toBe("Headcount · 2 going");
    expect(signupCardFooter(headcount, tally)).toBe("You're going");
    expect(signupSlotAction(headcount.slots[1]!, tally).label).toBe("Answer");
    expect(signupSlotAction(headcount.slots[0]!, tally).label).toBe(
      "Your answer",
    );
  });

  it("switches an answer keeping the note, and gives it up on a second tap", () => {
    const m = message(headcount, [
      { user: "me", slots: ["going"], note: "late" },
    ]);
    const tally = tallySignups(m, headcount, "me");
    // Each call starts from the tally (no recent tap) unless it shares `p`.
    const fresh = () => ({ current: null });
    expect(headcountAnswerPayload(tally, "me", fresh(), "not_going")).toEqual({
      slot_ids: ["not_going"],
      note: "late",
    });
    expect(headcountAnswerPayload(tally, "me", fresh(), "going")).toEqual({
      slot_ids: [],
    });
    expect(
      headcountNotePayload(tally, "me", fresh(), "  bringing a date "),
    ).toEqual({ slot_ids: ["going"], note: "bringing a date" });
    expect(headcountNotePayload(tally, "me", fresh(), "")).toEqual({
      slot_ids: ["going"],
    });
    // The same note again sends nothing.
    expect(headcountNotePayload(tally, "me", fresh(), " late ")).toBeNull();
    const none = tallySignups(message(headcount), headcount, "me");
    expect(headcountNotePayload(none, "me", fresh(), "x")).toBeNull();
  });

  it("builds a quick second tap or a note on the last tap, not the stale tally", () => {
    // The card still shows Going with "late": the server hasn't answered yet.
    const tally = tallySignups(
      message(headcount, [{ user: "me", slots: ["going"], note: "late" }]),
      headcount,
      "me",
    );
    const at = 1_000_000;

    // Switch to Can't make it, then save a note before the switch lands: the
    // note keeps the new answer rather than putting the member back on Going.
    const p = { current: null };
    expect(headcountAnswerPayload(tally, "me", p, "not_going", at)).toEqual({
      slot_ids: ["not_going"],
      note: "late",
    });
    expect(headcountNotePayload(tally, "me", p, "work shift", at + 1)).toEqual({
      slot_ids: ["not_going"],
      note: "work shift",
    });
    // Then switch back: the note just saved rides along, not the old one.
    expect(headcountAnswerPayload(tally, "me", p, "going", at + 2)).toEqual({
      slot_ids: ["going"],
      note: "work shift",
    });
    // A second tap on the answer just given takes it back.
    expect(headcountAnswerPayload(tally, "me", p, "going", at + 3)).toEqual({
      slot_ids: [],
    });
    // Once the last tap is old, the tally leads again.
    expect(
      headcountAnswerPayload(tally, "me", p, "going", at + 3 + 60_000),
    ).toEqual({ slot_ids: [] });
  });

  it("closes at its end time or when closed early, and says when it ends", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    const ends = { ...card, closes_at: "2026-11-12T12:00:00Z" };
    expect(isSignupClosed(ends, now)).toBe(true);
    expect(isSignupClosed(ends, now - 1)).toBe(false);
    expect(signupDeadlineLine(ends, now - 1)).toMatch(/^Ends today at /);
    expect(signupDeadlineLine(ends, now)).toBeNull();
    const early = readSignupPayload(
      message({ ...card, closed_at: "2026-11-12T11:00:00Z", closed_by: "u1" }),
    )!;
    expect(isSignupClosed(early, now)).toBe(true);
    const tally = tallySignups(message(early), early, "me");
    expect(signupCardEyebrow(early, tally, now)).toBe("Sign-up · Closed");
  });

  it("offers Close to the creator or a moderator on an open, confirmed card", () => {
    const row = {
      sender_id: "u1",
      _status: "confirmed",
      is_deleted: false,
    } as const;
    expect(canCloseSignup(row, card, "u1", 0, false)).toBe(true);
    expect(canCloseSignup(row, card, "u2", 0, false)).toBe(false);
    expect(canCloseSignup(row, card, "u2", 0, true)).toBe(true);
    expect(
      canCloseSignup(row, { ...card, closed_at: "x" }, "u1", 0, false),
    ).toBe(false);
    expect(
      canCloseSignup({ ...row, _status: "pending" }, card, "u1", 0, false),
    ).toBe(false);
  });

  it("checks a headcount draft by its title, and refuses a past or far end time", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    const draft = { ...emptySignupDraft(), format: "headcount" as const };
    expect(checkSignupDraft(draft, now)).toEqual({ ok: false, problem: null });
    const titled = { ...draft, title: "Formal" };
    expect(checkSignupDraft(titled, now)).toMatchObject({
      ok: true,
      input: { title: "Formal", format: "headcount" },
    });
    expect(
      checkSignupDraft({ ...titled, closesAt: new Date(now - 60_000) }, now),
    ).toEqual({ ok: false, problem: SIGNUP_END_PASSED_PROBLEM });
    expect(
      checkSignupDraft(
        { ...titled, closesAt: new Date(now + 400 * 86_400_000) },
        now,
      ),
    ).toEqual({ ok: false, problem: SIGNUP_END_TOO_FAR_PROBLEM });
  });
});
