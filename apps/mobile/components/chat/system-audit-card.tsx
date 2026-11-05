import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  auditChangeSummary,
  type SystemAuditPayload,
} from "@repo/chat-core/cards";
import { actorLabel, type NameResolver } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";
import { AuditGlyph } from "./card-glyphs";
import {
  CardEyebrow,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";

/**
 * The `#chapter-audit` card on mobile (#3383), web's
 * `apps/web/components/chat/renderers/system-audit-card.tsx` on the phone:
 * the action, who took it, and which fields it changed.
 *
 * An accent-free card: it has no primary action, and its eyebrow is muted
 * like every card's. It is also the one card that draws mono: an audit row's action is a key, which `foundations.md` §7
 * reserves the mono role for. The actor is a member's name, so it is not.
 * `actorLabel` names them: the roster's name, "Frapp" for the system, or the
 * member fallback, never a bare id prefix.
 *
 * Only the audit mirror writes this payload. The server's own notices (a poll
 * closing, an invite accepted, the chapter welcome) are `system_audit` rows
 * without one, and `cardFor` draws those as the sentence their `content` is.
 */
export function SystemAuditCard({
  payload,
  nameFor,
  ...frame
}: ChatCardFrameProps & { payload: SystemAuditPayload; nameFor: NameResolver }) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const actor = actorLabel(payload.actor_user_id, nameFor);
  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow label="Audit" glyph={AuditGlyph} />
          {/*
            Siblings, not nested: a nested Text inherits the mono
            `fontWeight`, which on a Figtree face is the Android fallback
            `typeRole` exists to avoid.
          */}
          <View style={styles.actionRow}>
            <Text style={styles.action}>{payload.action}</Text>
            {actor ? <Text style={styles.actor}>{`by ${actor}`}</Text> : null}
          </View>
          <Text style={styles.diff}>{auditChangeSummary(payload)}</Text>
        </>
      }
    />
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // Mono is a system family, which resolves a weight itself, so `fontWeight`
    // is right here where `typeRole` keeps it off Figtree (theme.tsx).
    actionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "baseline",
      columnGap: tokens.spacing.sm,
      marginTop: tokens.spacing.sm,
    },
    action: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: MONO_FONT_FAMILY,
      fontWeight: "600",
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    actor: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
    },
    diff: {
      ...typeRole(tokens.typography.role.caption),
      fontFamily: MONO_FONT_FAMILY,
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm,
    },
  });
}
