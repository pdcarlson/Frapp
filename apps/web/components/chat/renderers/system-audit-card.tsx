"use client";

import { AuditGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import type { SystemAuditPayload } from "@repo/chat-integrations";

interface SystemAuditCardProps {
  message: ChatMessage;
}

function readPayload(message: ChatMessage): SystemAuditPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const action = (raw as { action?: unknown }).action;
  const diff = (raw as { diff?: unknown }).diff;
  const actor = (raw as { actor_user_id?: unknown }).actor_user_id;
  return {
    action: typeof action === "string" ? action : "",
    actor_user_id: typeof actor === "string" ? actor : null,
    diff: diff && typeof diff === "object" ? (diff as Record<string, unknown>) : {},
  };
}

function summarizeDiff(diff: Record<string, unknown>): string {
  const keys = Object.keys(diff);
  if (keys.length === 0) return "no field changes recorded";
  return keys.join(", ");
}

/**
 * `#chapter-audit` system message. Deliberately the one accent-free card, and
 * the one that keeps `font-mono`: an audit row is a permission key and an action
 * name, which is exactly what foundations.md §7 reserves the mono role for. No
 * avatar, no actions, just actor + action + diff summary. Falls back to the hot-path `content` field if the payload is
 * missing or malformed (an old row from before the bridge worker landed).
 */
export function SystemAuditCard({ message }: SystemAuditCardProps) {
  const payload = readPayload(message);
  if (!payload || !payload.action) {
    return (
      <div className="mt-1 rounded-lg border border-border bg-card p-4 font-mono text-[12.5px] text-muted-foreground">
        {message.content || "audit event"}
      </div>
    );
  }
  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className={cn(EYEBROW, "flex items-center gap-1.5 text-muted-foreground")}>
        <AuditGlyph className="h-4 w-4" /> Audit
      </div>
      <div className="mt-2 font-mono text-[12.5px] text-foreground">
        <span className="font-semibold">{payload.action}</span>
        {payload.actor_user_id ? (
          <span className="ml-2 text-muted-foreground">
            by {payload.actor_user_id.slice(0, 6)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 font-mono text-[12.5px] text-muted-foreground">
        Changed: {summarizeDiff(payload.diff)}
      </div>
    </Card>
  );
}
