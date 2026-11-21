import { formatEndsLabel } from "@repo/formatting";
import {
  HEADCOUNT_GOING_SLOT_ID,
  HEADCOUNT_NOT_GOING_SLOT_ID,
  SIGNUP_ANSWER_NOTE_MAX_LENGTH,
  SIGNUP_HEADCOUNT_FORMAT,
  joinNames,
} from "@repo/validation";
import { isCardClosed, isCardOrganizer } from "./card-closing";
import { currentPollPicks, POLL_PICKS_PENDING_MS } from "./polls";
import type { PendingPollPicks } from "./polls";
import type { ChatMessage } from "./types";
import type { MemberLabel } from "./form-responses";

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
 *
 * A **headcount** (`format: "headcount"`, step 2) is the same card with two
 * fixed slots the server writes, Going and Can't make it, both with no limit.
 * A member holds at most one, and may add a short note to it
 * (`payload.note` on their claim). Either kind may carry an end time
 * (`closes_at`), and its creator or a `channels:manage` holder may close it
 * early (`closed_at`); the API then refuses every claim
 * (`signup-card-rules.ts`).
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
  /** `"headcount"`, or absent for a sheet of named slots. */
  format?: typeof SIGNUP_HEADCOUNT_FORMAT;
  slots: SignupSlot[];
  /** When sign-ups end on their own (ISO), or absent. */
  closes_at?: string;
  /** Set by the server when the card is closed early. */
  closed_at?: string;
  closed_by?: string | null;
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
  const format = (raw as { format?: unknown }).format;
  const closesAt = (raw as { closes_at?: unknown }).closes_at;
  const closedAt = (raw as { closed_at?: unknown }).closed_at;
  const closedBy = (raw as { closed_by?: unknown }).closed_by;
  return {
    title,
    ...(typeof note === "string" && note.trim() !== "" ? { note } : {}),
    ...(format === SIGNUP_HEADCOUNT_FORMAT
      ? { format: SIGNUP_HEADCOUNT_FORMAT }
      : {}),
    slots: parsed,
    ...(typeof closesAt === "string" && closesAt !== ""
      ? { closes_at: closesAt }
      : {}),
    ...(typeof closedAt === "string" && closedAt !== ""
      ? {
          closed_at: closedAt,
          closed_by: typeof closedBy === "string" ? closedBy : null,
        }
      : {}),
  };
}

/** Whether the card is a headcount: Going or Can't make it, one answer each. */
export function isHeadcountSignup(payload: SignupPayload): boolean {
  return payload.format === SIGNUP_HEADCOUNT_FORMAT;
}

/** Close sign-ups asks first, in the same words on web and the phone. */
export const CLOSE_SIGNUP_LABEL = "Close sign-ups";
export const CLOSE_SIGNUP_CONFIRM_TITLE = "Close sign-ups?";
export const CLOSE_SIGNUP_CONFIRM_BODY =
  "No one can sign up or change their answer after it closes, and it can't be reopened. The names stay on the card.";
export const CLOSE_SIGNUP_CONFIRM_LABEL = "Close sign-ups";

/**
 * The line that says when an open card ends: "Ends today at 6 PM", "Ends
 * Friday at 6 PM", "Ends Nov 14 at 9 AM". `null` for a card with no end time
 * or one already closed, whose eyebrow says so.
 */
export function signupDeadlineLine(
  payload: SignupPayload,
  now: number,
): string | null {
  if (isCardClosed(payload, now)) return null;
  return formatEndsLabel("Ends", payload.closes_at, new Date(now));
}

export interface SignupTally {
  /** Each slot's members, in the order they first signed up on the card. */
  bySlot: Record<string, string[]>;
  /** Members holding at least one slot. */
  people: number;
  /** The viewer's slots, in the card's order. */
  mine: string[];
  /** Each member's note on their answer (a headcount only), by member id. */
  notes: Record<string, string>;
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
  const notes: Record<string, string> = {};
  const headcount = isHeadcountSignup(payload);
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
    const note = (claim.payload as { note?: unknown } | null)?.note;
    if (headcount && typeof note === "string" && note.trim() !== "") {
      notes[claim.user_id] = note.trim();
    }
  }
  return {
    bySlot,
    people,
    mine: payload.slots.map((s) => s.id).filter((id) => mine.has(id)),
    notes,
  };
}

/**
 * Whether the viewer is offered Export on a sign-up card: its creator or a
 * `channels:manage` holder, the people Close sign-ups is for, open or closed,
 * on a card the server has. The names are on the card for every member
 * already; the export is the organizer's list to work from, as SignUpGenius
 * reports are.
 */
export function canExportSignup(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  viewerId: string | null,
  canManageChannels: boolean,
): boolean {
  return isCardOrganizer(message, viewerId, canManageChannels);
}

/** A sign-up's export columns. */
const SIGNUP_EXPORT_SLOT_COLUMN = "Slot";
const SIGNUP_EXPORT_ANSWER_COLUMN = "Answer";
const SIGNUP_EXPORT_NAME_COLUMN = "Name";
const SIGNUP_EXPORT_NOTE_COLUMN = "Note";
const SIGNUP_EXPORT_SIGNED_UP_COLUMN = "Signed up at";

/**
 * A sign-up card's claims as spreadsheet rows: one per member per slot, in
 * the card's slot order and then the order members first signed up. A sheet
 * names the Slot; a headcount names the Answer and adds each member's Note.
 * `Signed up at` is when the member first claimed on the card (ISO; their
 * row keeps it, so a later change doesn't move it). `labelOf` is the label
 * the card shows for each member, so a row matches the name under its slot.
 */
export function signupExportRows(
  message: ChatMessage,
  payload: SignupPayload,
  labelOf: MemberLabel,
): Record<string, string>[] {
  const tally = tallySignups(message, payload, null);
  const headcount = isHeadcountSignup(payload);
  const firstClaimed = new Map<string, string>();
  for (const action of message.actions) {
    if (action.action_type === SIGNUP_CLAIM_ACTION_TYPE) {
      firstClaimed.set(action.user_id, action.created_at ?? "");
    }
  }
  const rows: Record<string, string>[] = [];
  for (const slot of payload.slots) {
    for (const userId of tally.bySlot[slot.id] ?? []) {
      const row: Record<string, string> = {
        [headcount ? SIGNUP_EXPORT_ANSWER_COLUMN : SIGNUP_EXPORT_SLOT_COLUMN]:
          slot.label,
        [SIGNUP_EXPORT_NAME_COLUMN]: labelOf(userId),
      };
      if (headcount) row[SIGNUP_EXPORT_NOTE_COLUMN] = tally.notes[userId] ?? "";
      row[SIGNUP_EXPORT_SIGNED_UP_COLUMN] = firstClaimed.get(userId) ?? "";
      rows.push(row);
    }
  }
  return rows;
}

/** Whether nobody else can take this slot: it has a limit and is at it. */
function isSignupSlotFull(slot: SignupSlot, tally: SignupTally): boolean {
  return (
    slot.capacity !== null &&
    (tally.bySlot[slot.id]?.length ?? 0) >= slot.capacity
  );
}

/**
 * What a slot row shows at its end: "Full" once nobody else can take it and
 * the viewer doesn't hold it (the row can't be tapped then, and this says
 * why), otherwise its count (`signupSlotCount`).
 */
export function signupSlotStatus(slot: SignupSlot, tally: SignupTally): string {
  const action = signupSlotAction(slot, tally);
  return action.full ? "Full" : signupSlotCount(slot, tally);
}

/**
 * A slot's count as a screen reader says it: "2 of 4 spots taken", or
 * "3 signed up" for a slot with no limit.
 */
export function signupSlotSpoken(slot: SignupSlot, tally: SignupTally): string {
  const taken = tally.bySlot[slot.id]?.length ?? 0;
  return slot.capacity === null
    ? `${taken} signed up`
    : `${taken} of ${slot.capacity} spot${slot.capacity === 1 ? "" : "s"} taken`;
}

/**
 * How full a limited slot is, 0 to 100, for the meter under its row; `null`
 * for a slot with no limit, which has nothing to fill.
 */
export function signupSlotPercent(
  slot: SignupSlot,
  tally: SignupTally,
): number | null {
  if (slot.capacity === null) return null;
  const taken = tally.bySlot[slot.id]?.length ?? 0;
  return Math.min(100, Math.round((taken / slot.capacity) * 100));
}

/**
 * Who holds a slot, as one line under its row: "You" first, then the rest in
 * the order they signed up, the first few by name and the others counted,
 * "You, Ryan Castellano, Aaron Whitfield and 3 more". Names, not chips, as iMessage and
 * Discord name voters: a slot of twenty would otherwise wrap into a wall.
 * `nameOf` turns a user id into a display name; the viewer is never passed
 * to it. Empty when nobody holds the slot: the count already says so.
 * `notes` (a headcount's, `tally.notes`) puts each member's note after
 * their name.
 */
export function signupHoldersLine(
  holders: readonly string[],
  viewerId: string | null,
  nameOf: (userId: string) => string,
  shown = 3,
  notes: Readonly<Record<string, string>> = {},
): string {
  // A headcount answer's note follows its member's name (step 2):
  // "You (running late), Ryan Castellano".
  const withNote = (userId: string, name: string) =>
    notes[userId] ? `${name} (${notes[userId]})` : name;
  const mine = viewerId !== null && holders.includes(viewerId);
  const names = [
    ...(mine ? [withNote(viewerId, "You")] : []),
    ...holders
      .filter((id) => id !== viewerId)
      .map((id) => withNote(id, nameOf(id))),
  ];
  if (names.length <= shown) return joinNames(names);
  const rest = names.length - shown;
  return `${names.slice(0, shown).join(", ")} and ${rest} more`;
}

/** "1/2" for a slot with a limit, "3" for one without. */
export function signupSlotCount(slot: SignupSlot, tally: SignupTally): string {
  const taken = tally.bySlot[slot.id]?.length ?? 0;
  return slot.capacity === null ? `${taken}` : `${taken}/${slot.capacity}`;
}

/**
 * The card's eyebrow on both clients. "Sign-up · Closed" or "Headcount ·
 * Closed" once it takes no more claims; a headcount's "Headcount · 4 going".
 * Otherwise "Sign-up · Full" once every slot has a
 * limit and is at it; "Sign-up · 3 of 4 spots taken" while every slot has a
 * limit; plain "Sign-up" when any slot has none, since there's no total.
 */
export function signupCardEyebrow(
  payload: SignupPayload,
  tally: SignupTally,
  now: number,
): string {
  const kind = isHeadcountSignup(payload) ? "Headcount" : "Sign-up";
  if (isCardClosed(payload, now)) return `${kind} · Closed`;
  if (isHeadcountSignup(payload)) {
    const going = tally.bySlot[HEADCOUNT_GOING_SLOT_ID]?.length ?? 0;
    return going === 0 ? kind : `${kind} · ${going} going`;
  }
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
 * "…for 3 slots". A headcount says the viewer's answer, or how many have
 * answered.
 */
export function signupCardFooter(
  payload: SignupPayload,
  tally: SignupTally,
): string {
  if (isHeadcountSignup(payload)) {
    const answer = tally.mine[0];
    if (answer === HEADCOUNT_GOING_SLOT_ID) return "You're going";
    if (answer === HEADCOUNT_NOT_GOING_SLOT_ID) return "You can't make it";
    if (tally.people === 0) return "No one has answered yet.";
    return `${tally.people === 1 ? "1 person" : `${tally.people} people`} answered`;
  }
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
  // A headcount's row already names the answer; its button says whether it
  // is the viewer's.
  if (
    slot.id === HEADCOUNT_GOING_SLOT_ID ||
    slot.id === HEADCOUNT_NOT_GOING_SLOT_ID
  ) {
    return { label: held ? "Your answer" : "Answer", held, full: false };
  }
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

/**
 * The viewer's last headcount tap, while the card hasn't caught up with it.
 * A claim isn't optimistic, so the card's tally shows the old answer and note
 * until the server answers; a second tap or a note saved in that window builds
 * on this instead, as a quick second vote does (`castPollVote`). The server
 * stores a claim's payload whole, so a claim built on the stale tally would
 * undo the first: put the member back on their old answer, or erase the note
 * they just saved.
 */
export interface PendingHeadcount {
  answer: string | null;
  note: string;
  at: number;
}

/**
 * The viewer's answer and note as the card should build on them: their last
 * tap while it is fresh (`POLL_PICKS_PENDING_MS`), else the tally.
 */
function currentHeadcount(
  tally: SignupTally,
  viewerId: string | null,
  pending: PendingHeadcount | null,
  now: number,
): { answer: string | null; note: string } {
  if (pending && now - pending.at < POLL_PICKS_PENDING_MS) {
    return { answer: pending.answer, note: pending.note };
  }
  return {
    answer: tally.mine[0] ?? null,
    note: viewerId ? (tally.notes[viewerId] ?? "") : "",
  };
}

/**
 * The claim a headcount answer sends: the one slot tapped, or none when the
 * member taps the answer they already gave. The note rides along on every
 * claim, because the server stores the claim's payload whole and a claim
 * without one clears it; giving up the answer drops it.
 */
export function headcountAnswerPayload(
  tally: SignupTally,
  viewerId: string | null,
  pending: { current: PendingHeadcount | null },
  slotId: string,
  now: number = Date.now(),
): { slot_ids: string[]; note?: string } {
  const base = currentHeadcount(tally, viewerId, pending.current, now);
  if (base.answer === slotId) {
    pending.current = { answer: null, note: "", at: now };
    return { slot_ids: [] };
  }
  pending.current = { answer: slotId, note: base.note, at: now };
  return { slot_ids: [slotId], ...(base.note ? { note: base.note } : {}) };
}

/**
 * The claim that saves a note on the viewer's answer, or `null` when there is
 * nothing to send: no answer to attach it to, or the same note already. Blank
 * clears the note. The server trims it and holds it to
 * {@link SIGNUP_ANSWER_NOTE_MAX_LENGTH}.
 */
export function headcountNotePayload(
  tally: SignupTally,
  viewerId: string | null,
  pending: { current: PendingHeadcount | null },
  note: string,
  now: number = Date.now(),
): { slot_ids: string[]; note?: string } | null {
  const base = currentHeadcount(tally, viewerId, pending.current, now);
  if (!base.answer) return null;
  const trimmed = note.trim().slice(0, SIGNUP_ANSWER_NOTE_MAX_LENGTH);
  if (trimmed === base.note) return null;
  pending.current = { answer: base.answer, note: trimmed, at: now };
  return { slot_ids: [base.answer], ...(trimmed ? { note: trimmed } : {}) };
}
