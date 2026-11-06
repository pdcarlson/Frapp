"use client";

import type { ChatMessage } from "@repo/chat-core/types";
import {
  auditLineText,
  readSystemAuditPayload,
} from "@repo/chat-core/cards";
import { formatTimeOfDay } from "@repo/formatting";
import { actorLabel, type NameResolver } from "@repo/hooks";

interface SystemAuditCardProps {
  message: ChatMessage;
  /** The row's roster lookup, for the actor's name. */
  nameFor: NameResolver;
}

/**
 * A `#chapter-audit` entry: one quiet line, not a card (`components.md` §11
 * § Audit lines, owner decision 2026-11-06). Mobile's twin is
 * `apps/mobile/components/chat/system-audit-card.tsx`.
 *
 *   [shield]  Paul updated the chapter profile · accent color   2:32 PM
 *
 * `MessageItem` draws the shield in the gutter and no author line
 * (`isAuditLine`); this draws the words. The actor is the one word in the
 * foreground; the rest is caption in the muted foreground, so entries read as
 * a log under the conversation. `actorLabel` gives the roster's name,
 * "Frapp" for the system, or the member fallback, never a bare id prefix,
 * and the action reads as words (`auditLineText`), never as its key.
 *
 * Only the audit mirror writes the payload; the server's own notices (a poll
 * closing, an invite accepted, the chapter welcome) are `system_audit` rows
 * without one, whose `content` is the whole sentence, so the fallback draws
 * that sentence in the card frame in the body face.
 */
export function SystemAuditCard({ message, nameFor }: SystemAuditCardProps) {
  const payload = readSystemAuditPayload(message);
  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
        {message.content || "audit event"}
      </div>
    );
  }
  const actor = actorLabel(payload.actor_user_id, nameFor);
  const { phrase, detail } = auditLineText(payload);
  return (
    <p className="text-caption leading-5 text-muted-foreground">
      {actor ? (
        <span className="font-semibold text-foreground">{actor} </span>
      ) : null}
      {phrase}
      {detail ? ` · ${detail}` : null}
      <time dateTime={message.created_at} className="ml-2 text-muted">
        {formatTimeOfDay(message.created_at)}
      </time>
    </p>
  );
}
