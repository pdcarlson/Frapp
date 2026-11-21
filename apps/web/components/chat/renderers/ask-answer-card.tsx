"use client";

import type { ChatMessage } from "@repo/chat-core/types";
import { actorLabel, type NameResolver } from "@repo/hooks";
import { ASK_POST_COPY, readAskPostedAnswer } from "@repo/validation";
import { AskPostedBody } from "@/components/ask/ask-answer";

interface AskAnswerCardProps {
  message: ChatMessage;
  /** The row's roster lookup, for the member who asked. */
  nameFor: NameResolver;
}

/**
 * An Ask Frapp answer its asker posted to the channel (`kind: 'ask_answer'`,
 * #4713, `spec/behavior/ai.md` § Posting an answer to the channel). Mobile's twin is
 * `apps/mobile/components/chat/ask-answer-card.tsx`.
 *
 * The row is the Frapp sender's, so `MessageItem` draws the crest and
 * "Frapp" above it as for any message. This draws who asked and what, then
 * the answer as its asker saw it (`AskPostedBody`):
 *
 *   Frapp                                              2:32 PM
 *   Sam Abernathy asked Frapp
 *   | When is chapter meeting?
 *   Chapter meeting is Sunday, November 15 at 7:00 PM. [1]
 *   (1 Events)
 *
 * No frame: an answer is text to read, as it is in Ask, and Slack and
 * Discord both show an app's reply to a command as an ordinary message
 * under a line naming who ran it. The question is the asker's words, drawn
 * as plain text behind a rule and never as markdown, so it cannot pose as
 * part of the answer.
 *
 * A payload this build can't read falls back to the row's `content`, which
 * is the whole answer.
 */
export function AskAnswerCard({ message, nameFor }: AskAnswerCardProps) {
  const posted = readAskPostedAnswer(message.payload);
  if (!posted) {
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {message.content}
      </p>
    );
  }
  const asker = actorLabel(posted.asked_by, nameFor);
  return (
    <div className="max-w-2xl space-y-2">
      <p className="text-caption text-muted-foreground">
        {ASK_POST_COPY.asked(asker)}
      </p>
      <p className="whitespace-pre-wrap break-words border-l-2 border-border pl-2.5 text-sm text-muted-foreground">
        {posted.question}
      </p>
      <AskPostedBody text={message.content} posted={posted} askerName={asker} />
    </div>
  );
}
