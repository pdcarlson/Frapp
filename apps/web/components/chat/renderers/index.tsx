"use client";

import type { ReactNode } from "react";
import type { ChatMessage } from "@repo/chat-core/types";
import type { NameResolver } from "@repo/hooks";
import { AnnouncementCard } from "./announcement-card";
import { ComingSoonCard } from "./coming-soon-card";
import { EventCard } from "./event-card";
import { HoursCard } from "./hours-card";
import { RushCard } from "./rush-card";
import { LoadingCard } from "./loading-card";
import { PointsCard } from "./points-card";
import { PollCard } from "./poll-card";
import { SignupCard } from "./signup-card";
import { SystemAuditCard } from "./system-audit-card";
import { TaskCard } from "./task-card";
import { TextRenderer } from "./text-renderer";

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
  /**
   * The row's roster lookup (`MessageItemProps.nameFor`), for a card that
   * names a member by id: the audit card's actor. Required for the reason the
   * row's is, so a caller cannot regress that name to a bare id.
   */
  nameFor: NameResolver;
  isConfirmed: boolean;
  /**
   * The row's trailing markers, drawn after a plain message's last line. A card
   * ignores it; `MessageItem` draws a card's markers under the card instead.
   */
  trailing?: ReactNode;
  /** A plain message still sending, or failed: its text reads muted. */
  muted?: boolean;
  onAct: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => void;
  /** A poll card's Close poll: the creator's, or a `channels:manage` holder's (#3794, #4046). */
  onClosePoll?: (messageId: string) => void;
  /** A sign-up card's Close sign-ups: the creator's, or a `channels:manage` holder's (#3926). */
  onCloseSignup?: (messageId: string) => void;
}

/**
 * Dispatches a chat message to its kind-specific renderer. Unknown kinds
 * fall back to the text renderer (master-plan guard-on-missing-key rule):
 * a future kind that ships server-first never blanks the timeline.
 *
 * Renderer registry intentionally lives in `apps/web` (not
 * `@repo/chat-core/integrations`) — that module is framework-free.
 * The wire contract (kind enum + payload shapes) is shared via it; the
 * React rendering is per-app.
 */
export function MessageRenderer({
  message,
  viewerId,
  nameFor,
  isConfirmed,
  onAct,
  onClosePoll,
  onCloseSignup,
  trailing,
  muted,
}: MessageRendererProps) {
  if (message.is_deleted) {
    return <TextRenderer message={message} trailing={trailing} muted={muted} />;
  }
  switch (message.kind) {
    case "text":
      return (
        <TextRenderer message={message} trailing={trailing} muted={muted} />
      );
    case "poll":
      return (
        <PollCard
          message={message}
          viewerId={viewerId}
          isConfirmed={isConfirmed}
          onVote={onAct}
          onClosePoll={onClosePoll}
        />
      );
    case "signup":
      return (
        <SignupCard
          message={message}
          viewerId={viewerId}
          nameFor={nameFor}
          isConfirmed={isConfirmed}
          onClaim={onAct}
          onCloseSignup={onCloseSignup}
        />
      );
    case "announcement":
      return <AnnouncementCard message={message} />;
    case "system_audit":
      return <SystemAuditCard message={message} nameFor={nameFor} />;
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
      return <HoursCard message={message} viewerId={viewerId} />;
    case "rush":
      return <RushCard message={message} isConfirmed={isConfirmed} />;
    case "dues":
      return <ComingSoonCard message={message} />;
    default:
      return (
        <TextRenderer message={message} trailing={trailing} muted={muted} />
      );
  }
}
