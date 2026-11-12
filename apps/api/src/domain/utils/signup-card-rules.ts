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
} from '@repo/validation';

/**
 * Rules for a sign-up sheet card in chat (`kind: 'signup'`, #3926).
 *
 * The card is a chat message a member composes, like a poll card, so its
 * payload arrives from a client. Unlike a poll's options, its slots carry a
 * limit the server enforces on every claim (`claim_signup_slots`), so the
 * card is checked and rebuilt on send rather than stored as sent: a slot
 * without a usable id, a limit outside 1 to {@link SIGNUP_SLOT_CAPACITY_MAX},
 * or a field nobody reads would otherwise be stored and trusted by the claim.
 *
 * A member's claim is their one `chat_message_actions` row with
 * `action_type = 'signup'` and `payload.slot_ids`, every slot they hold.
 *
 * A **headcount** (`format: 'headcount'`, #3926 step 2) is the same card with
 * two fixed slots, Going and Can't make it, both with no limit. A member
 * holds at most one of them and may add a short note to the answer
 * (`payload.note` on their claim).
 *
 * Either kind may carry an end time (`closes_at`), and its creator or a
 * `channels:manage` holder may close it early (`closed_at` / `closed_by`,
 * written only by `ChatService.closeSignup`). Once closed, the claim RPC
 * refuses every claim.
 */

/** The action type of a member's claim on a sign-up card. */
export const SIGNUP_ACTION_TYPE = 'signup';

/** The longest slot id a card may carry. Clients make 8-character ids. */
const SLOT_ID_MAX_LENGTH = 32;

/** A headcount's format and two slots, shared with the clients. */
export {
  HEADCOUNT_GOING_SLOT_ID,
  HEADCOUNT_NOT_GOING_SLOT_ID,
  SIGNUP_HEADCOUNT_FORMAT,
};

/** The furthest ahead an end time may be set. */
const CLOSES_AT_MAX_AHEAD_MS =
  SIGNUP_CLOSES_AT_MAX_AHEAD_DAYS * 24 * 60 * 60 * 1000;

export interface SignupSlot {
  id: string;
  label: string;
  /** How many members the slot holds, or `null` for no limit. */
  capacity: number | null;
}

export interface SignupCard {
  title: string;
  /** Details under the title, or absent. */
  note?: string;
  /** `'headcount'`, or absent for a sheet of named slots. */
  format?: typeof SIGNUP_HEADCOUNT_FORMAT;
  slots: SignupSlot[];
  /** When sign-ups end on their own (ISO), or absent. */
  closes_at?: string;
  /** Set only by `ChatService.closeSignup`; never taken from a client. */
  closed_at?: string;
  closed_by?: string;
}

/**
 * The card as it is stored, or the reason it can't be. Text is trimmed; a
 * blank note is dropped; any key the card doesn't define is left out, which
 * includes a client's attempt at server-written fields.
 */
export function normalizeSignupCard(
  payload: unknown,
  now: number = Date.now(),
): { card: SignupCard } | { error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'A sign-up card needs a title and at least one slot' };
  }
  const raw = payload as Record<string, unknown>;

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return { error: 'A sign-up card needs a title' };
  if (title.length > SIGNUP_TITLE_MAX_LENGTH) {
    return {
      error: `A sign-up title can be at most ${SIGNUP_TITLE_MAX_LENGTH} characters`,
    };
  }

  let note: string | undefined;
  if (raw.note != null) {
    if (typeof raw.note !== 'string') {
      return { error: 'A sign-up card’s details must be text' };
    }
    const trimmed = raw.note.trim();
    if (trimmed.length > SIGNUP_NOTE_MAX_LENGTH) {
      return {
        error: `A sign-up card’s details can be at most ${SIGNUP_NOTE_MAX_LENGTH} characters`,
      };
    }
    if (trimmed) note = trimmed;
  }

  let closesAt: string | undefined;
  if (raw.closes_at != null && raw.closes_at !== '') {
    const at =
      typeof raw.closes_at === 'string' ? Date.parse(raw.closes_at) : NaN;
    if (Number.isNaN(at)) {
      return { error: 'A sign-up card’s end time must be a date and time' };
    }
    // A past end time is kept, not refused: a card queued offline can reach
    // the server after the time its creator picked, and it then posts closed.
    if (at > now + CLOSES_AT_MAX_AHEAD_MS) {
      return { error: 'A sign-up card can end at most a year from now' };
    }
    closesAt = new Date(at).toISOString();
  }

  const extras = closesAt ? { closes_at: closesAt } : {};

  if (raw.format === SIGNUP_HEADCOUNT_FORMAT) {
    return {
      card: {
        title,
        ...(note ? { note } : {}),
        format: SIGNUP_HEADCOUNT_FORMAT,
        slots: HEADCOUNT_SLOTS.map((slot) => ({ ...slot })),
        ...extras,
      },
    };
  }
  if (raw.format != null) {
    return { error: 'Unknown sign-up card format' };
  }

  if (!Array.isArray(raw.slots) || raw.slots.length === 0) {
    return { error: 'A sign-up card needs at least one slot' };
  }
  if (raw.slots.length > SIGNUP_SLOTS_MAX) {
    return {
      error: `A sign-up card can have at most ${SIGNUP_SLOTS_MAX} slots`,
    };
  }

  const seen = new Set<string>();
  const slots: SignupSlot[] = [];
  for (const entry of raw.slots as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: 'Each slot needs an id and a name' };
    }
    const slot = entry as Record<string, unknown>;
    const id = typeof slot.id === 'string' ? slot.id.trim() : '';
    const label = typeof slot.label === 'string' ? slot.label.trim() : '';
    if (!id || id.length > SLOT_ID_MAX_LENGTH || !label) {
      return { error: 'Each slot needs an id and a name' };
    }
    if (seen.has(id)) return { error: 'Each slot needs its own id' };
    seen.add(id);
    if (label.length > SIGNUP_SLOT_LABEL_MAX_LENGTH) {
      return {
        error: `A slot’s name can be at most ${SIGNUP_SLOT_LABEL_MAX_LENGTH} characters`,
      };
    }
    const capacity = slot.capacity ?? null;
    if (
      capacity !== null &&
      (typeof capacity !== 'number' ||
        !Number.isInteger(capacity) ||
        capacity < 1 ||
        capacity > SIGNUP_SLOT_CAPACITY_MAX)
    ) {
      return {
        error: `A slot holds 1 to ${SIGNUP_SLOT_CAPACITY_MAX} people, or has no limit`,
      };
    }
    slots.push({ id, label, capacity });
  }

  return { card: { title, ...(note ? { note } : {}), slots, ...extras } };
}

/**
 * The slot ids a claim names: `payload.slot_ids`, a list of strings, with
 * repeats dropped. An empty list gives up every slot. Anything else is
 * `null`, a malformed claim.
 */
export function signupClaimSlotIds(payload: unknown): string[] | null {
  const raw = (payload as { slot_ids?: unknown } | null)?.slot_ids;
  if (!Array.isArray(raw)) return null;
  const ids = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string') return null;
    ids.add(id);
  }
  // A card has at most SIGNUP_SLOTS_MAX slots; a longer list can't be real.
  if (ids.size > SIGNUP_SLOTS_MAX) return null;
  return [...ids];
}

/** Whether the card is a headcount (two fixed slots, one answer each). */
export function isHeadcountCard(payload: unknown): boolean {
  return (
    (payload as { format?: unknown } | null)?.format === SIGNUP_HEADCOUNT_FORMAT
  );
}

/**
 * Whether the card takes no more claims: closed early, or past its end time.
 * The claim RPC decides this again under its lock; this lets the API refuse
 * without a round trip and the close route refuse a second close.
 */
export function isSignupCardClosed(
  payload: unknown,
  now: number = Date.now(),
): boolean {
  const card = payload as { closed_at?: unknown; closes_at?: unknown } | null;
  if (typeof card?.closed_at === 'string' && card.closed_at !== '') return true;
  if (typeof card?.closes_at !== 'string') return false;
  const at = Date.parse(card.closes_at);
  return !Number.isNaN(at) && at <= now;
}

/**
 * The note on a member's answer, or the reason it can't be stored. Only a
 * headcount takes one; blank is none.
 */
export function signupClaimNote(
  payload: unknown,
  headcount: boolean,
): { note: string | null } | { error: string } {
  const raw = (payload as { note?: unknown } | null)?.note;
  if (raw == null) return { note: null };
  if (typeof raw !== 'string') return { error: 'A note must be text' };
  const note = raw.trim();
  if (!note) return { note: null };
  if (!headcount) {
    return { error: 'Only a headcount answer takes a note' };
  }
  if (note.length > SIGNUP_ANSWER_NOTE_MAX_LENGTH) {
    return {
      error: `A note can be at most ${SIGNUP_ANSWER_NOTE_MAX_LENGTH} characters`,
    };
  }
  return { note };
}
