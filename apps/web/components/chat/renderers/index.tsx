"use client";

import type { ChatMessage } from "@repo/chat-core/types";
import { AnnouncementCard } from "./announcement-card";
import { ComingSoonCard } from "./coming-soon-card";
import { EventCard } from "./event-card";
import { HoursCard } from "./hours-card";
import { RushCard } from "./rush-card";
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
  "rush",
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
  /**
   * The signed-in member's `users.id`, and it is **known** — never `null`.
   *
   * Non-nullable for the same reason `MessageItemProps.viewerId` is (#2255):
   * `MessageItem` is the only caller, it is rendered only from behind
   * `message-timeline.tsx`'s identity gate, and it already guarantees a resolved
   * id. The nullable type was the last place in this subtree where an
   * unresolved viewer could arrive and be read as a confident answer about one
   * — and the cards below do read it that way: `poll-card` would tell a member
   * who voted that they did not, and `task-card` would offer a `tasks:manage`
   * viewer the Confirm control on their own completed task, which the server
   * refuses (#1056).
   *
   * That is not reachable today, because nothing renders a card outside the
   * gate. It typechecked, though, and four sibling surfaces
   * (`pins-popover`, `bookmarks-popover`, `chat-search-popover`,
   * `chat-admin-page`) already pass a literal `null` viewer to message chrome
   * on purpose — so the next caller reaching for one of these cards from one of
   * those would have compiled clean. Now it does not.
   */
  viewerId: string;
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
    case "hours":
      return <HoursCard message={message} />;
    case "rush":
      return <RushCard message={message} isConfirmed={isConfirmed} />;
    case "dues":
      return <ComingSoonCard message={message} />;
    default:
      return <TextRenderer message={message} isSelf={isSelf} />;
  }
}
