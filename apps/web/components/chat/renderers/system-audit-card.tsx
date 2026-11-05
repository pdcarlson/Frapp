"use client";

import { AuditGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  auditChangeSummary,
  readSystemAuditPayload,
} from "@repo/chat-core/cards";
import { actorLabel, type NameResolver } from "@repo/hooks";

interface SystemAuditCardProps {
  message: ChatMessage;
  /** The row's roster lookup, for the actor's name. */
  nameFor: NameResolver;
}

/**
 * `#chapter-audit` system message. The one card
 * that keeps `font-mono` for its action: an audit row's action is a
 * key, which is exactly what foundations.md §7 reserves the mono role for. The
 * actor is a member's name, so it is not mono: `actorLabel` gives the
 * roster's name, "Frapp" for the system, or the member fallback, never the
 * bare id prefix this card used to draw.
 *
 * The payload reader is `@repo/chat-core/cards`, which mobile's card reads
 * too. Only the audit mirror writes the payload; the server's own notices (a
 * poll closing, an invite accepted, the chapter welcome) are `system_audit`
 * rows without one, whose `content` is the whole sentence, so the fallback
 * draws that sentence in the card frame in the body face.
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
  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div
        className={cn(
          EYEBROW,
          "flex items-center gap-1.5 text-muted-foreground",
        )}
      >
        <AuditGlyph className="h-4 w-4" /> Audit
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-caption">
        <span className="font-mono font-semibold text-foreground">
          {payload.action}
        </span>
        {actor ? (
          <span className="text-muted-foreground">by {actor}</span>
        ) : null}
      </div>
      <div className="mt-2 font-mono text-caption text-muted-foreground">
        {auditChangeSummary(payload)}
      </div>
    </Card>
  );
}
