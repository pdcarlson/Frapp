import {
  SIGNUP_NOTE_MAX_LENGTH,
  SIGNUP_SLOT_CAPACITY_MAX,
  SIGNUP_SLOT_LABEL_MAX_LENGTH,
  SIGNUP_SLOTS_MAX,
  SIGNUP_TITLE_MAX_LENGTH,
} from "@repo/validation";
import { currentPollPicks, makePollOptionId } from "./polls";
import type { PendingPollPicks } from "./polls";
import type { ChatMessage } from "./types";

/**
 * Sign-up sheet cards in chat (`kind: "signup"`, #3926), shared by web's
 * `apps/web/components/chat/renderers/signup-card.tsx` and form, and mobile's
 * `apps/mobile/components/chat/signup-card.tsx` and sheet, so the two
 * surfaces read, count and post a card the same way.
 *
 * A card lists slots, each with a name and a limit (or none). A member's
 * claim is their one `chat_message_actions` row with `action_type: "signup"`
 * and `payload.slot_ids`, every slot they hold, changed in place as a poll
 * vote is (ADR-07). The API checks each slot's limit against everyone else's
 * claims under a lock on the card (`claim_signup_slots`), so a slot can't be
 * over-filled by two taps at once; this module only draws the result.
 */

export const SIGNUP_CLAIM_ACTION_TYPE = "signup";

export interface SignupSlot {
  id: string;
  label: string;
  /** How many members the slot holds, or `null` for no limit. */
  capacity: number | null;
}

export interface SignupPayload {
  title: string;
  /** Details under the title, if the creator wrote any. */
  note?: string;
  slots: SignupSlot[];
}

/** What a member typed into the New sign-up sheet form. */
export interface SignupMessageInput {
  title: string;
  note?: string;
  slots: readonly { label: string; capacity: number | null }[];
}

/**
 * The `kind: "signup"` message a client posts: `content` is the title, which
 * is what a notification, the channel preview and search read, and `payload`
 * is the card. Both forms build it here. The API checks and rebuilds the card
 * on send (`normalizeSignupCard`), so this only shapes it.
 */
export function buildSignupMessage(
  input: SignupMessageInput,
  makeSlotId: () => string = makePollOptionId,
): { content: string; payload: SignupPayload } {
  const note = input.note?.trim();
  return {
    content: input.title,
    payload: {
      title: input.title,
      ...(note ? { note } : {}),
      slots: input.slots.map((slot) => ({
        id: makeSlotId(),
        label: slot.label,
        capacity: slot.capacity,
      })),
    },
  };
}

/** The card in a message, or `null` when it can't be drawn. */
export function readSignupPayload(message: ChatMessage): SignupPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const title = (raw as { title?: unknown }).title;
  const slots = (raw as { slots?: unknown }).slots;
  if (typeof title !== "string" || !Array.isArray(slots)) return null;
  const parsed: SignupSlot[] = [];
  for (const slot of slots) {
    if (!slot || typeof slot !== "object") continue;
    const { id, label, capacity } = slot as Record<string, unknown>;
    if (typeof id !== "string" || typeof label !== "string") continue;
    parsed.push({
      id,
      label,
      // Read as the API's claim reads it: anything but a positive whole
      // number is no limit.
      capacity:
        typeof capacity === "number" &&
        Number.isInteger(capacity) &&
        capacity > 0
          ? capacity
          : null,
    });
  }
  if (parsed.length === 0) return null;
  const note = (raw as { note?: unknown }).note;
  return {
    title,
    ...(typeof note === "string" && note.trim() !== "" ? { note } : {}),
    slots: parsed,
  };
}

export interface SignupTally {
  /** Each slot's members, in the order they first signed up on the card. */
  bySlot: Record<string, string[]>;
  /** Members holding at least one slot. */
  people: number;
  /** The viewer's slots, in the card's order. */
  mine: string[];
}

/**
 * Who holds which slot, from the raw `chat_message_actions` rows on the
 * message (one `signup` row per member). Ids the card doesn't list are
 * dropped. A member's row keeps the time of their first claim on the card
 * (`claim_signup_slots` doesn't move it), so holders are listed in the order
 * they first signed up. A blocked member's claim is shown like anyone's: the
 * SELECT policy hides only a blocked member's reactions (#2494), and a
 * sign-up's point is who holds which slot.
 */
export function tallySignups(
  message: ChatMessage,
  payload: SignupPayload,
  viewerId: string | null,
): SignupTally {
  const bySlot: Record<string, string[]> = {};
  for (const slot of payload.slots) bySlot[slot.id] = [];
  const claims = message.actions
    .filter((action) => action.action_type === SIGNUP_CLAIM_ACTION_TYPE)
    .slice()
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  let people = 0;
  let mine = new Set<string>();
  for (const claim of claims) {
    const raw = (claim.payload as { slot_ids?: unknown } | null)?.slot_ids;
    if (!Array.isArray(raw)) continue;
    const held = new Set(
      raw.filter((id): id is string => typeof id === "string" && id in bySlot),
    );
    if (held.size === 0) continue;
    people += 1;
    for (const id of held) bySlot[id]!.push(claim.user_id);
    if (viewerId && claim.user_id === viewerId) mine = held;
  }
  return {
    bySlot,
    people,
    mine: payload.slots.map((s) => s.id).filter((id) => mine.has(id)),
  };
}

/** Whether nobody else can take this slot: it has a limit and is at it. */
export function isSignupSlotFull(
  slot: SignupSlot,
  tally: SignupTally,
): boolean {
  return (
    slot.capacity !== null &&
    (tally.bySlot[slot.id]?.length ?? 0) >= slot.capacity
  );
}

/** "1/2" for a slot with a limit, "3" for one without. */
export function signupSlotCount(slot: SignupSlot, tally: SignupTally): string {
  const taken = tally.bySlot[slot.id]?.length ?? 0;
  return slot.capacity === null ? `${taken}` : `${taken}/${slot.capacity}`;
}

/**
 * The card's eyebrow on both clients. "Sign-up · Full" once every slot has a
 * limit and is at it; "Sign-up · 3 of 4 spots taken" while every slot has a
 * limit; plain "Sign-up" when any slot has none, since there's no total.
 */
export function signupCardEyebrow(
  payload: SignupPayload,
  tally: SignupTally,
): string {
  if (payload.slots.some((slot) => slot.capacity === null)) return "Sign-up";
  if (payload.slots.every((slot) => isSignupSlotFull(slot, tally))) {
    return "Sign-up · Full";
  }
  const total = payload.slots.reduce((sum, s) => sum + (s.capacity ?? 0), 0);
  const taken = payload.slots.reduce(
    (sum, s) =>
      sum + Math.min(tally.bySlot[s.id]?.length ?? 0, s.capacity ?? 0),
    0,
  );
  return `Sign-up · ${taken} of ${total} spot${total === 1 ? "" : "s"} taken`;
}

/**
 * The line under the slots: what the viewer holds, or how many people have
 * signed up. "You're signed up for Friday", "…for Friday and Saturday",
 * "…for 3 slots".
 */
export function signupCardFooter(
  payload: SignupPayload,
  tally: SignupTally,
): string {
  if (tally.mine.length > 0) {
    const labels = payload.slots
      .filter((slot) => tally.mine.includes(slot.id))
      .map((slot) => slot.label);
    const which =
      labels.length === 1
        ? labels[0]
        : labels.length === 2
          ? `${labels[0]} and ${labels[1]}`
          : `${labels.length} slots`;
    return `You're signed up for ${which}`;
  }
  if (tally.people === 0) return "No one has signed up yet.";
  return `${tally.people === 1 ? "1 person" : `${tally.people} people`} signed up`;
}

/** The slot button's words: what a tap does, or why it can't. */
export function signupSlotAction(
  slot: SignupSlot,
  tally: SignupTally,
): { label: string; held: boolean; full: boolean } {
  const held = tally.mine.includes(slot.id);
  if (held) return { label: "Signed up", held, full: false };
  const full = isSignupSlotFull(slot, tally);
  return { label: full ? "Full" : "Sign up", held, full };
}

/**
 * The claim a tap on `slotId` sends: the viewer's slots with that one taken or
 * given up, the whole list in the card's order. An empty list drops out of
 * every slot, and the API keeps the row, as an emptied vote does.
 */
export function signupClaimPayload(
  payload: SignupPayload,
  mine: readonly string[],
  slotId: string,
): { slot_ids: string[] } {
  const held = new Set(mine);
  if (held.has(slotId)) held.delete(slotId);
  else held.add(slotId);
  return {
    slot_ids: payload.slots.map((s) => s.id).filter((id) => held.has(id)),
  };
}

/**
 * The claim a tap sends from a card, built on the member's last tap while it
 * is fresh, as a multi-choice vote is (`castPollVote`): a claim isn't
 * optimistic, so a second tap before the first answer would otherwise drop
 * the first slot.
 *
 * Unlike a vote, a claim is expected to be refused: two members race for the
 * last spot, and the loser's tap gets a 409 the card never hears about. So a
 * slot the last tap asked for that the card now shows full of other members
 * is left out of the next one, or the refused slot would ride along on every
 * tap for the next ten seconds and have each refused in turn. The winner's
 * claim reaches the card through Realtime, usually before the member taps
 * again.
 */
export function castSignupClaim(
  payload: SignupPayload,
  tally: SignupTally,
  pending: { current: PendingPollPicks | null },
  slotId: string,
  now: number = Date.now(),
): { slot_ids: string[] } {
  const base = currentPollPicks(tally.mine, pending.current, now).filter(
    (id) => {
      if (tally.mine.includes(id)) return true;
      const slot = payload.slots.find((s) => s.id === id);
      return !!slot && !isSignupSlotFull(slot, tally);
    },
  );
  const claim = signupClaimPayload(payload, base, slotId);
  pending.current = { picks: claim.slot_ids, at: now };
  return claim;
}

// ── The New sign-up sheet form ──────────────────────────────────────────────

/**
 * One slot row as typed. `capacity` is the Spots field's text: blank is no
 * limit. `key` is the row's own and moves with it (see `PollOptionRow`).
 */
export interface SignupSlotRow {
  key: string;
  label: string;
  capacity: string;
}

export interface SignupDraft {
  title: string;
  note: string;
  slots: SignupSlotRow[];
}

let nextSlotKey = 0;
function newSlotRow(): SignupSlotRow {
  nextSlotKey += 1;
  return { key: `slot-${nextSlotKey}`, label: "", capacity: "" };
}

/** A new sheet starts with two slot rows, the usual "Friday, Saturday". */
export function emptySignupDraft(): SignupDraft {
  return { title: "", note: "", slots: [newSlotRow(), newSlotRow()] };
}

export function canAddSignupSlot(draft: SignupDraft): boolean {
  return draft.slots.length < SIGNUP_SLOTS_MAX;
}

export function canRemoveSignupSlot(draft: SignupDraft): boolean {
  return draft.slots.length > 1;
}

export function addSignupSlot(draft: SignupDraft): SignupDraft {
  if (!canAddSignupSlot(draft)) return draft;
  return { ...draft, slots: [...draft.slots, newSlotRow()] };
}

export function removeSignupSlot(draft: SignupDraft, key: string): SignupDraft {
  if (!canRemoveSignupSlot(draft)) return draft;
  return { ...draft, slots: draft.slots.filter((row) => row.key !== key) };
}

export function setSignupSlot(
  draft: SignupDraft,
  key: string,
  patch: Partial<Pick<SignupSlotRow, "label" | "capacity">>,
): SignupDraft {
  return {
    ...draft,
    slots: draft.slots.map((row) =>
      row.key === key ? { ...row, ...patch } : row,
    ),
  };
}

export type SignupDraftCheck =
  | { ok: true; input: SignupMessageInput }
  /**
   * `problem` is what to tell the member, or `null` when the draft is only
   * unfinished (no title, no slot named yet), which the held Post button says
   * well enough. `slotKey` points at the row the problem is about.
   */
  | { ok: false; problem: string | null; slotKey?: string };

export const SIGNUP_SPOTS_PROBLEM = `Spots is a whole number from 1 to ${SIGNUP_SLOT_CAPACITY_MAX}, or blank for no limit.`;
export const DUPLICATE_SLOT_PROBLEM =
  "Two slots have the same name. Change one, or remove it.";

/**
 * Whether the draft can be posted, and what it posts. A row with no name is
 * skipped, as a blank poll option is, unless it has Spots typed, which reads
 * as a slot the member forgot to name. The limits are the API's.
 */
export function checkSignupDraft(draft: SignupDraft): SignupDraftCheck {
  const title = draft.title.trim();
  const note = draft.note.trim();
  if (title.length > SIGNUP_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      problem: `A title can be at most ${SIGNUP_TITLE_MAX_LENGTH} characters.`,
    };
  }
  if (note.length > SIGNUP_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      problem: `Details can be at most ${SIGNUP_NOTE_MAX_LENGTH} characters.`,
    };
  }
  const slots: { label: string; capacity: number | null }[] = [];
  const seen = new Set<string>();
  for (const row of draft.slots) {
    const label = row.label.trim();
    const spots = row.capacity.trim();
    if (!label) {
      if (spots) {
        return {
          ok: false,
          problem: "Give this slot a name.",
          slotKey: row.key,
        };
      }
      continue;
    }
    if (label.length > SIGNUP_SLOT_LABEL_MAX_LENGTH) {
      return {
        ok: false,
        problem: `A slot's name can be at most ${SIGNUP_SLOT_LABEL_MAX_LENGTH} characters.`,
        slotKey: row.key,
      };
    }
    const key = label.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      return { ok: false, problem: DUPLICATE_SLOT_PROBLEM, slotKey: row.key };
    }
    seen.add(key);
    let capacity: number | null = null;
    if (spots) {
      const n = Number(spots);
      if (
        !/^\d+$/.test(spots) ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > SIGNUP_SLOT_CAPACITY_MAX
      ) {
        return { ok: false, problem: SIGNUP_SPOTS_PROBLEM, slotKey: row.key };
      }
      capacity = n;
    }
    slots.push({ label, capacity });
  }
  if (!title || slots.length === 0) return { ok: false, problem: null };
  return {
    ok: true,
    input: { title, ...(note ? { note } : {}), slots },
  };
}
