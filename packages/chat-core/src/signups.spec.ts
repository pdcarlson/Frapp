import { describe, expect, it } from "vitest";
import {
  SIGNUP_SPOTS_PROBLEM,
  addSignupSlot,
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
  claims: { user: string; slots: unknown; at?: string; type?: string }[] = [],
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
      payload: { slot_ids: claim.slots },
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
        { user: "me", slots: ["sat", "fri", "zzz"], at: "2026-11-12T10:01:00Z" },
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
    expect(signupCardEyebrow(card, tally)).toBe(
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
    expect(signupCardEyebrow(card, full)).toBe("Sign-up · Full");
    // A slot you hold reads as yours, never as full.
    expect(signupSlotAction(card.slots[0]!, full).label).toBe("Signed up");
    expect(signupCardFooter(card, full)).toBe(
      "You're signed up for Friday and Saturday",
    );

    const open = { ...card, slots: [...card.slots, { id: "x", label: "X", capacity: null }] };
    const none = tallySignups(message(open), open, "me");
    expect(signupCardEyebrow(open, none)).toBe("Sign-up");
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
    expect(castSignupClaim(card, [], pending, "fri", 1_000)).toEqual({
      slot_ids: ["fri"],
    });
    expect(castSignupClaim(card, [], pending, "sat", 2_000)).toEqual({
      slot_ids: ["fri", "sat"],
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
      expect(checkSignupDraft(setSignupSlot(draft, key, { capacity }))).toEqual({
        ok: false,
        problem: SIGNUP_SPOTS_PROBLEM,
        slotKey: key,
      });
    }
    expect(
      checkSignupDraft(setSignupSlot(draft, key, { label: " " })),
    ).toMatchObject({ ok: false, problem: "Give this slot a name.", slotKey: key });
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
