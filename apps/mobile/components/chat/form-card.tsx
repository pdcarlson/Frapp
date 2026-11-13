import { useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import {
  CLOSE_FORM_LABEL,
  canCloseForm,
  formAnsweredState,
  formCardAction,
  formDeadlineLine,
  formQuestionCountLine,
  isFormClosed,
  readFormPayload,
} from "@repo/chat-core/forms";
import { useMyPermissions, useNow } from "@repo/hooks";
import { can } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useOwnFormResponse } from "@/lib/chat/use-own-form-response";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import {
  CardActions,
  CardButton,
  CardEyebrow,
  CardTitle,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";
import { useOpenForm } from "./form-fill-page";

/**
 * A form card (`kind: "form"`, #3926 step 3), the phone's twin of web's
 * `apps/web/components/chat/renderers/form-card.tsx`: the form's title, its
 * details, how many questions it asks and when it closes, and one button
 * that opens the full-page form (`FormFillPage`): Fill out, or Edit your
 * answers once the viewer has sent theirs, marked done. Answers are never on
 * the card; whether the viewer has answered is their own read of the
 * form-response route. Reading and the words are `@repo/chat-core/forms`, so
 * the two cards can't disagree. Close form is its creator's or a
 * `channels:manage` holder's, as Close sign-ups is.
 */
export interface FormCardProps extends ChatCardFrameProps {
  /** Close form; the caller confirms first (`confirmCloseCard`). */
  onCloseForm?: (messageId: string) => void;
}

export function FormCard(props: FormCardProps) {
  const { message, viewerId, isConfirmed, onCloseForm } = props;
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const payload = useMemo(() => readFormPayload(message), [message]);
  const now = useNow();
  const canManageChannels = can(
    "channels:manage",
    useMyPermissions().data?.permissions,
  );
  const openForm = useOpenForm();
  const own = useOwnFormResponse(message.id, isConfirmed && !!payload);

  if (!payload) {
    return (
      <ChatCardShell
        {...props}
        header={
          <Text style={styles.muted}>Malformed form · {message.content}</Text>
        }
      />
    );
  }

  const closed = isFormClosed(payload, now);
  const action = formCardAction(formAnsweredState(own.data), closed);
  const deadline = formDeadlineLine(payload, now);
  const showClose =
    !!onCloseForm &&
    canCloseForm(message, payload, viewerId, now, canManageChannels);
  const canOpen = isConfirmed && !!openForm;

  return (
    <ChatCardShell
      {...props}
      header={
        <>
          <CardEyebrow label="Form" />
          <CardTitle>{payload.title}</CardTitle>
          {payload.description ? (
            <Text style={styles.note} numberOfLines={3}>
              {payload.description}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {formQuestionCountLine(payload)}
            {deadline ? ` · ${deadline}` : ""}
          </Text>
        </>
      }
    >
      <CardActions>
        <CardButton
          label={action.label}
          variant={action.done ? "secondary" : "primary"}
          disabled={!canOpen}
          accessibilityHint={
            isConfirmed ? undefined : "Opens once the form has posted."
          }
          icon={
            action.done ? (color) => <CheckGlyph color={color} /> : undefined
          }
          onPress={() => openForm?.(message.id)}
        />
      </CardActions>
      {showClose ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          accessibilityLabel={CLOSE_FORM_LABEL}
          onPress={() => onCloseForm?.(message.id)}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>{CLOSE_FORM_LABEL}</Text>
        </Pressable>
      ) : null}
    </ChatCardShell>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    muted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm,
    },
    linkButton: {
      alignSelf: "flex-start",
      marginTop: tokens.spacing.xs,
      paddingVertical: tokens.spacing.xs,
    },
    linkText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
  });
}
