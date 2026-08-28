"use client";

import type { ChatMessage } from "@repo/chat-core/types";
import { AnnouncementCard } from "./announcement-card";
import { ComingSoonCard } from "./coming-soon-card";
import { EventCard } from "./event-card";
import { LoadingCard } from "./loading-card";
import { PointsCard } from "./points-card";
import { PollCard } from "./poll-card";
import { SystemAuditCard } from "./system-audit-card";
import { TaskCard } from "./task-card";
import { TextRenderer } from "./text-renderer";

/** Kinds whose renderer is a card in the flow rather than a message bubble. */
const CARD_KINDS = new Set([
  "poll",
  "announcement",
  "system_audit",
  "loading",
  "points",
  "task",
  "event",
  "dues",
  "hours",
]);

/**
 * Does this message render as a bubble (§11) rather than as a card?
 *
 * The row layout needs the answer before it renders the body: a bubble is
 * sided — self right, incoming left with an avatar — and a card is not. This
 * mirrors the switch below rather than being a second, independent list, so a
 * kind cannot be a bubble in one place and a card in the other.
 *
 * **Deletion does not enter into it**, which is the point. `MessageRenderer`
 * routes every deleted row to `TextRenderer` whatever its kind, but the *layout*
 * keys off the kind alone, so a row keeps the side and the chrome it already
 * had. An earlier cut returned `true` for anything deleted, which moved a
 * deleted poll of your own from the left column to the right the instant it was
 * deleted — reflowing the thread around the one row nobody should still be
 * looking at.
 */
export function rendersAsBubble(message: { kind?: string | null }): boolean {
  return !CARD_KINDS.has(message.kind ?? "text");
}

export interface MessageRendererProps {
  message: ChatMessage;
  viewerId: string | null;
  isSelf: boolean;
  isConfirmed: boolean;
  onAct: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
}

/**
 * Dispatches a chat message to its kind-specific renderer. Unknown kinds
 * fall back to the text renderer (master-plan guard-on-missing-key rule):
 * a future kind that ships server-first never blanks the timeline.
 *
 * Renderer registry intentionally lives in `apps/web` (not the
 * `@repo/chat-integrations` package) — the package is framework-free.
 * The wire contract (kind enum + payload shapes) is shared via the
 * package; the React rendering is per-app.
 */
export function MessageRenderer({
  message,
  viewerId,
  isSelf,
  isConfirmed,
  onAct,
}: MessageRendererProps) {
  if (message.is_deleted) {
    return <TextRenderer message={message} isSelf={isSelf} />;
  }
  switch (message.kind) {
    case "text":
      return <TextRenderer message={message} isSelf={isSelf} />;
    case "poll":
      return (
        <PollCard
          message={message}
          viewerId={viewerId}
          isConfirmed={isConfirmed}
          onVote={onAct}
        />
      );
    case "announcement":
      return <AnnouncementCard message={message} />;
    case "system_audit":
      return <SystemAuditCard message={message} />;
    case "loading":
      return <LoadingCard message={message} />;
    case "points":
      return <PointsCard message={message} />;
    case "task":
      return (
        <TaskCard
          message={message}
          viewerId={viewerId}
          isConfirmed={isConfirmed}
        />
      );
    case "event":
      return <EventCard message={message} isConfirmed={isConfirmed} />;
    case "dues":
    case "hours":
      return <ComingSoonCard message={message} />;
    default:
      return <TextRenderer message={message} isSelf={isSelf} />;
  }
}
