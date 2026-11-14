import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import { actorLabel, type NameResolver } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { ASK_POST_COPY, readAskPostedAnswer } from "@repo/validation";
import { AskPostedBody } from "@/components/ask/ask-turn";
import {
  canOpenAskSource,
  SOURCE_OPEN_FAILED,
  useAskSourceOpener,
} from "@/components/ask/use-ask-turns";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * An Ask Frapp answer its asker posted to the channel (`kind: 'ask_answer'`,
 * #4713, `spec/behavior/ai.md` § Posting an answer to the channel). Web's twin is
 * `apps/web/components/chat/renderers/ask-answer-card.tsx`, which says what
 * it is modelled on.
 *
 * The row is the Frapp sender's, so the row frame draws the crest and
 * "Frapp" above it as for any message. This draws who asked and what, then
 * the answer as its asker saw it (`AskPostedBody`):
 *
 *   Frapp                                              2:32 PM
 *   Sam Abernathy asked Frapp
 *   | When is chapter meeting?
 *   Chapter meeting is Sunday, November 15 at 7:00 PM. [1]
 *   (1 Events)
 *
 * No frame: an answer is text to read, as it is in Ask. The question is the
 * asker's words, drawn as plain text behind a rule and never as markdown, so
 * it cannot pose as part of the answer.
 *
 * A payload this build can't read falls back to the row's `content`, which
 * is the whole answer.
 */
export function AskAnswerCard({
  message,
  nameFor,
}: {
  message: ChatMessage;
  /** The row's roster lookup, for the member who asked. */
  nameFor: NameResolver;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const sources = useAskSourceOpener();
  const posted = readAskPostedAnswer(message.payload);
  if (!posted) {
    return <Text style={styles.fallback}>{message.content}</Text>;
  }
  const asker = actorLabel(posted.asked_by, nameFor);
  const opening = sources.openingKey?.startsWith(`${message.id}:`)
    ? sources.openingKey.slice(message.id.length + 1)
    : null;
  return (
    <View style={styles.card} testID="ask-answer-card">
      <Text style={styles.caption}>{ASK_POST_COPY.asked(asker)}</Text>
      <View style={styles.quote}>
        <Text style={styles.question}>{posted.question}</Text>
      </View>
      <AskPostedBody
        text={message.content}
        posted={posted}
        askerName={asker}
        canOpen={canOpenAskSource}
        openingSourceId={opening}
        onOpenSource={(source) => void sources.open(message.id, source)}
      />
      {sources.failedOwner === message.id ? (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          {SOURCE_OPEN_FAILED}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      gap: tokens.spacing.sm,
    },
    fallback: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: tokens.color.border.hairline,
      paddingLeft: 10,
    },
    question: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
