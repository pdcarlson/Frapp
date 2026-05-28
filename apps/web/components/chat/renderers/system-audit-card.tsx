"use client";

import { ShieldAlert } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
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
 * `#chapter-audit` system message. Mono-style card per the master plan
 * theming notes — no avatar, no actions, just actor + action + diff
 * summary. Falls back to the hot-path `content` field if the payload is
 * missing or malformed (an old row from before the bridge worker landed).
 */
export function SystemAuditCard({ message }: SystemAuditCardProps) {
  const payload = readPayload(message);
  if (!payload || !payload.action) {
    return (
      <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {message.content || "audit event"}
      </div>
    );
  }
  return (
    <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Audit
      </div>
      <div className="mt-1 font-mono text-[11px] text-foreground">
        <span className="font-semibold">{payload.action}</span>
        {payload.actor_user_id ? (
          <span className="ml-2 text-muted-foreground">
            by {payload.actor_user_id.slice(0, 6)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
        Changed: {summarizeDiff(payload.diff)}
      </div>
    </div>
  );
}
