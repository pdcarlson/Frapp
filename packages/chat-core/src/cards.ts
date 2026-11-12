import type {
  EventPayload,
  HoursPayload,
  PointsPayload,
  RushPayload,
  SystemAuditPayload,
  TaskPayload,
} from "./integrations/payloads";
import type { ChatMessage } from "./types";
import { checkInOpensMinutes } from "@repo/validation";

export type {
  EventPayload,
  HoursPayload,
  PointsPayload,
  RushPayload,
  SystemAuditPayload,
  TaskPayload,
};

/**
 * Readers for the chat card kinds, shared by web's renderers
 * (`apps/web/components/chat/renderers/`) and mobile's
 * (`apps/mobile/components/chat/`), so both surfaces decide "is this payload
 * drawable" the same way. `readPollPayload` in `./polls` is the same idea for
 * the poll.
 *
 * Each reader is defensive: a malformed row returns `null`, and the renderer
 * falls back to the message's `content` string rather than blanking the
 * timeline. Optional fields get the default the card draws, so a renderer
 * never re-checks a type.
 *
 * Imports the payload shapes from `./integrations/payloads` directly, not the
 * `./integrations` barrel, which also carries the slash parsers and catalog
 * that mobile has no use for.
 */

function recordOf(message: ChatMessage): Record<string, unknown> | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A `kind:"event"` payload, or `null` without the id, name and both times.
 * `point_value` defaults to 0 (the card draws no points chip) and `location` to
 * `null`.
 */
export function readEventPayload(message: ChatMessage): EventPayload | null {
  const r = recordOf(message);
  if (
    !r ||
    typeof r.event_id !== "string" ||
    typeof r.name !== "string" ||
    typeof r.start_time !== "string" ||
    typeof r.end_time !== "string"
  ) {
    return null;
  }
  return {
    event_id: r.event_id,
    name: r.name,
    start_time: r.start_time,
    end_time: r.end_time,
    location: typeof r.location === "string" ? r.location : null,
    point_value: finiteNumber(r.point_value) ?? 0,
    is_mandatory: r.is_mandatory === true,
    check_in_opens_minutes: checkInOpensMinutes(r.check_in_opens_minutes),
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * A `kind:"task"` payload, or `null` without the id, title, both names and the
 * due date. `status` is always the creation-time `"TODO"` (`TaskPayload`): a
 * card must take the live status from the task query, never from this.
 */
export function readTaskPayload(message: ChatMessage): TaskPayload | null {
  const r = recordOf(message);
  if (
    !r ||
    typeof r.task_id !== "string" ||
    typeof r.title !== "string" ||
    typeof r.assignee_name !== "string" ||
    typeof r.assigner_name !== "string" ||
    typeof r.due_date !== "string"
  ) {
    return null;
  }
  return {
    task_id: r.task_id,
    title: r.title,
    assigner_user_id:
      typeof r.assigner_user_id === "string" ? r.assigner_user_id : "",
    assigner_name: r.assigner_name,
    assignee_user_id:
      typeof r.assignee_user_id === "string" ? r.assignee_user_id : "",
    assignee_name: r.assignee_name,
    due_date: r.due_date,
    due_at: typeof r.due_at === "string" ? r.due_at : null,
    status: "TODO",
    point_reward: finiteNumber(r.point_reward),
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * A `kind:"points"` payload, or `null` without both names, the reason and a
 * finite amount. `category` is `"FINE"` only when the row says so; the ids
 * default to empty.
 */
export function readPointsPayload(message: ChatMessage): PointsPayload | null {
  const r = recordOf(message);
  const amount = r ? finiteNumber(r.amount) : null;
  if (
    !r ||
    amount === null ||
    typeof r.actor_name !== "string" ||
    typeof r.recipient_name !== "string" ||
    typeof r.reason !== "string"
  ) {
    return null;
  }
  return {
    actor_user_id: typeof r.actor_user_id === "string" ? r.actor_user_id : "",
    actor_name: r.actor_name,
    recipient_user_id:
      typeof r.recipient_user_id === "string" ? r.recipient_user_id : "",
    recipient_name: r.recipient_name,
    amount,
    category: r.category === "FINE" ? "FINE" : "MANUAL",
    reason: r.reason,
    transaction_id:
      typeof r.transaction_id === "string" ? r.transaction_id : "",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/** How a points card states its change, the same words on every surface. */
export interface PointsChange {
  /** A deduction: a negative amount, or a `FINE` row. */
  fine: boolean;
  verb: "granted" | "deducted";
  /** "to" the recipient of a grant, "from" the one fined. */
  preposition: "to" | "from";
  /**
   * "+5 points", "−1 point". The minus is U+2212, the typographic sign, not
   * the hyphen the ledger stores.
   */
  amount: string;
}

export function pointsChange(payload: PointsPayload): PointsChange {
  const fine = payload.amount < 0 || payload.category === "FINE";
  const magnitude = Math.abs(payload.amount);
  return {
    fine,
    verb: fine ? "deducted" : "granted",
    preposition: fine ? "from" : "to",
    amount: `${fine ? "−" : "+"}${magnitude} ${
      magnitude === 1 ? "point" : "points"
    }`,
  };
}

/**
 * A `kind:"hours"` payload, or `null` without the entry and member ids, the
 * member's name, the description, the date and a finite duration. `status` is
 * always the creation-time `"PENDING"` (`HoursPayload`): a card takes the
 * review status from the entry itself, never from this.
 */
export function readHoursPayload(message: ChatMessage): HoursPayload | null {
  const r = recordOf(message);
  const duration = r ? finiteNumber(r.duration_minutes) : null;
  if (
    !r ||
    duration === null ||
    typeof r.entry_id !== "string" ||
    typeof r.user_id !== "string" ||
    typeof r.user_name !== "string" ||
    typeof r.description !== "string" ||
    typeof r.date !== "string"
  ) {
    return null;
  }
  return {
    entry_id: r.entry_id,
    user_id: r.user_id,
    user_name: r.user_name,
    duration_minutes: duration,
    description: r.description,
    date: r.date,
    status: "PENDING",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * A `kind:"system_audit"` payload, or `null` without a non-empty `action`.
 *
 * `null` is the common case, not only a malformed one: the server's own
 * notices ("This poll has closed.", an invite accepted, the chapter welcome)
 * are `system_audit` rows with no payload at all, and their `content` is the
 * sentence to show. Only the `#chapter-audit` mirror
 * (`ChatBridgeWorkerService`) writes the payload. `diff` is a plain object or
 * `{}`, and an actor that isn't a string is `null` (a system-originated row).
 */
export function readSystemAuditPayload(
  message: ChatMessage,
): SystemAuditPayload | null {
  const r = recordOf(message);
  if (!r || typeof r.action !== "string" || r.action.trim() === "") {
    return null;
  }
  const diff = r.diff;
  return {
    action: r.action,
    actor_user_id: typeof r.actor_user_id === "string" ? r.actor_user_id : null,
    diff:
      diff && typeof diff === "object" && !Array.isArray(diff)
        ? (diff as Record<string, unknown>)
        : {},
  };
}

/**
 * What each audited action did, as the words after the actor's name in an
 * audit line ("Paul **updated the chapter profile**"). One copy so web's and
 * mobile's lines say the same. An action not listed here reads as its key
 * with the underscores taken out, so a new writer never draws a raw key.
 */
const AUDIT_ACTION_PHRASES: Record<string, string> = {
  chapter_config_updated: "updated chapter settings",
  chapter_profile_updated: "updated the chapter profile",
  chapter_logo_updated: "updated the chapter logo",
  chapter_logo_removed: "removed the chapter logo",
  chapter_custom_field_created: "added a profile field",
  chapter_custom_field_updated: "edited a profile field",
  chapter_custom_field_deleted: "removed a profile field",
  chapter_custom_role_created: "added a role",
  chapter_custom_role_updated: "edited a role",
  chapter_custom_role_deleted: "removed a role",
  role_created: "added a role",
  role_updated: "edited a role",
  role_deleted: "removed a role",
  role_tier_created: "added a tier",
  role_tier_updated: "edited a tier",
  role_tier_deleted: "removed a tier",
  role_tiers_reordered: "reordered the tiers",
  member_removed: "removed a member",
  presidency_transferred: "handed over the presidency",
  presidency_claimed: "claimed the presidency",
  president_orphaned: "left the chapter without a president",
  ai_settings_updated: "changed the AI settings",
};

/** `accent_color` → `accent color`: a key as words, never as a key. */
function keyAsWords(key: string): string {
  return key.replace(/[_-]+/g, " ").trim();
}

/**
 * An audit line's words: what the actor did, and which fields it touched
 * (`null` when the row recorded none). The line draws them after the actor's
 * name, the detail muted: "Paul updated the chapter profile · accent color"
 * (`spec/ui/design-system/components.md` §11 § Audit lines).
 */
export function auditLineText(payload: SystemAuditPayload): {
  phrase: string;
  detail: string | null;
} {
  const phrase =
    AUDIT_ACTION_PHRASES[payload.action] ?? keyAsWords(payload.action);
  const fields = Object.keys(payload.diff).map(keyAsWords).filter(Boolean);
  return { phrase, detail: fields.length > 0 ? fields.join(", ") : null };
}

/**
 * Whether a message draws as an audit line rather than a message: a
 * `system_audit` row the `#chapter-audit` mirror wrote, so it carries a
 * readable payload. The server's other notices (a poll closing, the chapter
 * welcome) are `system_audit` rows without one and stay sentences in the
 * thread, from Frapp.
 */
export function isAuditLine(message: {
  kind?: string | null;
  payload?: unknown;
}): boolean {
  return (
    message.kind === "system_audit" &&
    readSystemAuditPayload(message as ChatMessage) !== null
  );
}

/**
 * The text of a `kind:"announcement"` card, or `null` when there is none.
 *
 * `content` first, not `payload.body`. `/announce` writes the same words to
 * both, but `content` is what a push, a search hit and the channel preview
 * show, and `kind:"announcement"` is not server-only: a client could send a
 * `payload.body` that differs from it, and the card would then say something
 * the notification didn't. The body is the fallback for a row whose `content`
 * is empty.
 */
export function readAnnouncementBody(message: ChatMessage): string | null {
  if (typeof message.content === "string" && message.content.trim() !== "") {
    return message.content;
  }
  const body = recordOf(message)?.body;
  return typeof body === "string" && body.trim() !== "" ? body : null;
}

/**
 * A `kind:"rush"` payload, or `null` without the candidate id, the candidate's
 * name and the adder's name. `bid_status` is always the creation-time
 * `"none"` (`RushService.create` makes every candidate with no bid): a card
 * takes the bid, the vote count and the viewer's vote from the candidate
 * itself, never from this. `stage` defaults to `"new"`.
 */
export function readRushPayload(message: ChatMessage): RushPayload | null {
  const r = recordOf(message);
  if (
    !r ||
    typeof r.candidate_id !== "string" ||
    r.candidate_id === "" ||
    typeof r.display_name !== "string" ||
    typeof r.added_by_name !== "string"
  ) {
    return null;
  }
  return {
    candidate_id: r.candidate_id,
    display_name: r.display_name,
    added_by_user_id:
      typeof r.added_by_user_id === "string" ? r.added_by_user_id : "",
    added_by_name: r.added_by_name,
    stage: typeof r.stage === "string" && r.stage !== "" ? r.stage : "new",
    bid_status: "none",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}
