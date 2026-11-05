import type { EventPayload, TaskPayload } from "./integrations/payloads";
import type { ChatMessage } from "./types";

export type { EventPayload, TaskPayload };

/**
 * Readers for the server-originated card kinds, shared by web's renderers
 * (`apps/web/components/chat/renderers/`) and mobile's
 * (`apps/mobile/components/chat/`), so both surfaces decide "is this payload
 * drawable" the same way. `readPollPayload` in `./polls` is the same idea for
 * the one member-authored card.
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
    status: "TODO",
    point_reward: finiteNumber(r.point_reward),
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}
