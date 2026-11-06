import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  auditLineText,
  type SystemAuditPayload,
} from "@repo/chat-core/cards";
import type { ChatMessage } from "@repo/chat-core/types";
import { formatTimeOfDay } from "@repo/formatting";
import { actorLabel, type NameResolver } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";
import { AuditGlyph } from "./card-glyphs";
import { useCardStyles } from "./chat-card";
import {
  groupReactions,
  MESSAGE_AVATAR_SIZE,
  messageActionsA11yProps,
  ReactionRow,
} from "./message-item";

/**
 * A `#chapter-audit` entry on mobile: one quiet line, not a card
 * (`components.md` §11 § Audit lines, owner decision 2026-11-06). Web's twin
 * is `apps/web/components/chat/renderers/system-audit-card.tsx`.
 *
 *   [shield]  Paul updated the chapter profile · accent color   2:32 PM
 *
 * The shield sits in the avatar gutter so the words line up with message
 * text. The actor is the one word in the foreground; the rest is caption in
 * the muted foreground, so a run of entries reads as a log under the
 * conversation rather than as posts competing with it. No author line: the
 * entry names who acted, and "Frapp" posting it is noise. `actorLabel` names
 * them: the roster's name, "Frapp" for the system, or the member fallback,
 * never a bare id prefix. The action reads as words (`auditLineText`), never
 * as its key.
 *
 * Only the audit mirror writes this payload (`isAuditLine`). The server's own
 * notices (a poll closing, an invite accepted, the chapter welcome) are
 * `system_audit` rows without one and stay sentences from Frapp.
 */
export function SystemAuditLine({
  message,
  payload,
  viewerId,
  nameFor,
  startsRun,
  onReact,
  onUnreact,
  onOpenActions,
}: {
  message: ChatMessage;
  payload: SystemAuditPayload;
  viewerId: string;
  nameFor: NameResolver;
  /** The first of a stack of entries sits apart from the row above it. */
  startsRun: boolean;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  onOpenActions?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const reactionStyles = useCardStyles();
  const actor = actorLabel(payload.actor_user_id, nameFor);
  const { phrase, detail } = auditLineText(payload);
  const time = formatTimeOfDay(message.created_at);
  const a11y = messageActionsA11yProps(onOpenActions, {});

  return (
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      disabled={!onOpenActions}
      style={[styles.row, startsRun ? styles.rowFirst : null]}
      testID="audit-line"
    >
      <View style={styles.gutter}>
        <AuditGlyph
          focused={false}
          accent={tokens.color.text.muted}
          muted={tokens.color.text.muted}
          size={GLYPH_SIZE}
        />
      </View>
      <View style={styles.column}>
        <Text
          style={styles.line}
          accessible
          accessibilityLabel={`${actor ? `${actor} ` : ""}${phrase}${
            detail ? `: ${detail}` : ""
          }, ${time}`}
          {...a11y}
        >
          {actor ? <Text style={styles.actor}>{actor} </Text> : null}
          {phrase}
          {detail ? ` · ${detail}` : null}
          <Text style={styles.time}>{`  ${time}`}</Text>
        </Text>
        <ReactionRow
          reactions={groupReactions(message, viewerId)}
          messageId={message.id}
          disabled={message._status !== "confirmed"}
          onReact={onReact}
          onUnreact={onUnreact}
          onLongPress={onOpenActions}
          styles={reactionStyles}
        />
      </View>
    </Pressable>
  );
}

/** Small enough to sit inside a caption's line box beside the words. */
const GLYPH_SIZE = 14;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The message row's inset, and a 2pt step between stacked entries.
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: 2,
    },
    // The first of a stack sits 8 below the row above: closer than a run's 16,
    // because a log line is not a new speaker.
    rowFirst: { paddingTop: tokens.spacing.sm },
    // The avatar's gutter, the glyph centred in it and on the text's first line.
    gutter: {
      width: MESSAGE_AVATAR_SIZE,
      alignItems: "center",
      paddingTop: 2,
    },
    column: { flex: 1, minWidth: 0 },
    line: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // Nested Text sets its own family rather than inheriting a weight, which
    // on a Figtree face is the Android fallback `typeRole` exists to avoid.
    actor: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    time: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
  });
}
