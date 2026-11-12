import {
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
 */

/** The action type of a member's claim on a sign-up card. */
export const SIGNUP_ACTION_TYPE = 'signup';

/** The longest slot id a card may carry. Clients make 8-character ids. */
const SLOT_ID_MAX_LENGTH = 32;

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
  slots: SignupSlot[];
}

/**
 * The card as it is stored, or the reason it can't be. Text is trimmed; a
 * blank note is dropped; any key the card doesn't define is left out, which
 * includes a client's attempt at server-written fields.
 */
export function normalizeSignupCard(
  payload: unknown,
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

  return { card: { title, ...(note ? { note } : {}), slots } };
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
