import { formatDueLabel, parseInstant } from "@repo/formatting";
import {
  HEADCOUNT_GOING_SLOT_ID,
  HEADCOUNT_NOT_GOING_SLOT_ID,
  HEADCOUNT_SLOTS,
  SIGNUP_ANSWER_NOTE_MAX_LENGTH,
  SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS,
  SIGNUP_HEADCOUNT_FORMAT,
  SIGNUP_NOTE_MAX_LENGTH,
  SIGNUP_SLOT_CAPACITY_MAX,
  SIGNUP_SLOT_LABEL_MAX_LENGTH,
  SIGNUP_SLOTS_MAX,
  SIGNUP_TITLE_MAX_LENGTH,
  joinNames,
} from "@repo/validation";
import { canActOnMessage, isOwnMessage } from "./message-actions";
import {
  currentPollPicks,
  makePollOptionId,
  POLL_PICKS_PENDING_MS,
} from "./polls";
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

export {
  HEADCOUNT_GOING_SLOT_ID,
  HEADCOUNT_NOT_GOING_SLOT_ID,
  SIGNUP_HEADCOUNT_FORMAT,
};

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

/** What a member typed into the New sign-up sheet form. */
export interface SignupMessageInput {
  title: string;
  note?: string;
  /** A headcount takes no slots: the server writes its two. */
  format?: typeof SIGNUP_HEADCOUNT_FORMAT;
  slots: readonly { label: string; capacity: number | null }[];
  /** When sign-ups end, or absent for a card that stays open. */
  closesAt?: Date | null;
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
  const closes = input.closesAt
    ? { closes_at: input.closesAt.toISOString() }
    : {};
  if (input.format === SIGNUP_HEADCOUNT_FORMAT) {
    return {
      content: input.title,
      payload: {
        title: input.title,
        ...(note ? { note } : {}),
        format: SIGNUP_HEADCOUNT_FORMAT,
        // The server replaces these with its own; sent so the optimistic row
        // draws the card it will become.
        slots: HEADCOUNT_SLOTS.map((slot) => ({ ...slot })),
        ...closes,
      },
    };
  }
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
      ...closes,
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

/**
 * Whether the card takes no more claims: closed early, or its end time has
 * come. The API's answer (`isCardClosed`), including `<=` at the end
 * time itself, so a card never offers a tap the server refuses.
 */
export function isSignupClosed(payload: SignupPayload, now: number): boolean {
  if (payload.closed_at) return true;
  const deadline = parseInstant(payload.closes_at);
  return deadline ? deadline.getTime() <= now : false;
}

/**
 * Whether the viewer is offered Close sign-ups on this card: it is on the
 * server and not deleted, still open, and the viewer posted it or holds
 * `channels:manage`. The same rule as Close poll (`canClosePoll`); the API
 * enforces it (`ChatService.closeCard`).
 */
export function canCloseSignup(
  message: Pick<ChatMessage, "sender_id" | "_status" | "is_deleted">,
  payload: SignupPayload,
  viewerId: string | null,
  now: number,
  canManageChannels: boolean,
): boolean {
  return (
    (isOwnMessage(message, viewerId) || (canManageChannels && !!viewerId)) &&
    canActOnMessage(message) &&
    !isSignupClosed(payload, now)
  );
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
  if (isSignupClosed(payload, now) || !parseInstant(payload.closes_at)) {
    return null;
  }
  // A task's countdown words, which name the day and time the same way.
  const due = formatDueLabel(payload.closes_at, new Date(now));
  return due ? due.replace(/^Due /, "Ends ") : null;
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
  if (isSignupClosed(payload, now)) return `${kind} · Closed`;
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
export function currentHeadcount(
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

/** What the form makes: a sheet of named slots, or a Going / Can't make it headcount. */
export type SignupDraftFormat = "sheet" | typeof SIGNUP_HEADCOUNT_FORMAT;

export interface SignupDraft {
  format: SignupDraftFormat;
  title: string;
  note: string;
  /** Kept while the member tries Headcount, so switching back loses nothing. */
  slots: SignupSlotRow[];
  /** When sign-ups end, or `null` for a card that stays open until closed. */
  closesAt: Date | null;
}

export const SIGNUP_FORMAT_CHOICES: readonly {
  id: SignupDraftFormat;
  label: string;
}[] = [
  { id: "sheet", label: "Sheet" },
  { id: SIGNUP_HEADCOUNT_FORMAT, label: "Headcount" },
];

let nextSlotKey = 0;
function newSlotRow(): SignupSlotRow {
  nextSlotKey += 1;
  return { key: `slot-${nextSlotKey}`, label: "", capacity: "" };
}

/** A new sheet starts with two slot rows, the usual "Friday, Saturday". */
export function emptySignupDraft(): SignupDraft {
  return {
    format: "sheet",
    title: "",
    note: "",
    slots: [newSlotRow(), newSlotRow()],
    closesAt: null,
  };
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
const DUPLICATE_SLOT_PROBLEM =
  "Two slots have the same name. Change one, or remove it.";
export const SIGNUP_END_PASSED_PROBLEM =
  "That end time has passed. Pick a later one, or none.";
export const SIGNUP_END_TOO_FAR_PROBLEM =
  "Sign-ups can end at most a year from now.";

/** The API's furthest end time (`signup-card-rules.ts`), less a day of slack. */
const SIGNUP_END_MAX_AHEAD_MS =
  (SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS - 1) * 24 * 60 * 60 * 1000;

/**
 * A default end time for a member who turns one on: tomorrow at 6 PM, the
 * usual "sign up by" for a chapter week.
 */
export function defaultSignupEnd(now: Date): Date {
  const at = new Date(now);
  at.setDate(at.getDate() + 1);
  at.setHours(18, 0, 0, 0);
  return at;
}

/**
 * Whether the draft can be posted, and what it posts. A row with no name is
 * skipped, as a blank poll option is, unless it has Spots typed, which reads
 * as a slot the member forgot to name. The limits are the API's.
 */
export function checkSignupDraft(
  draft: SignupDraft,
  now: number = Date.now(),
): SignupDraftCheck {
  const title = draft.title.trim();
  const note = draft.note.trim();
  const closesAt = draft.closesAt;
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
  if (closesAt) {
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= now) {
      return { ok: false, problem: SIGNUP_END_PASSED_PROBLEM };
    }
    if (closesAt.getTime() > now + SIGNUP_END_MAX_AHEAD_MS) {
      return { ok: false, problem: SIGNUP_END_TOO_FAR_PROBLEM };
    }
  }
  const ends = closesAt ? { closesAt } : {};
  if (draft.format === SIGNUP_HEADCOUNT_FORMAT) {
    if (!title) return { ok: false, problem: null };
    return {
      ok: true,
      input: {
        title,
        ...(note ? { note } : {}),
        format: SIGNUP_HEADCOUNT_FORMAT,
        slots: [],
        ...ends,
      },
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
    input: { title, ...(note ? { note } : {}), slots, ...ends },
  };
}
