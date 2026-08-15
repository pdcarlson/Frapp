import { useEffect, useRef, useState } from "react";
import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

type MessageState = "sent" | "sending" | "retry";

function MessageBubble({
  author,
  body,
  timestamp,
  state,
  outgoing = false,
  styles,
  messageStateStyles,
}: {
  author: string;
  body: string;
  timestamp: string;
  state: MessageState;
  outgoing?: boolean;
  styles: ReturnType<typeof createStyles>;
  messageStateStyles: ReturnType<typeof createMessageStateStyles>;
}) {
  const stateStyle = messageStateStyles[state];

  return (
    <View
      style={[
        styles.messageBubble,
        outgoing ? styles.messageBubbleOutgoing : styles.messageBubbleIncoming,
      ]}
    >
      <View style={styles.messageHeader}>
        <Text style={styles.messageAuthor}>{author}</Text>
        <Text style={styles.messageTime}>{timestamp}</Text>
      </View>
      <Text style={styles.messageBody}>{body}</Text>
      <View
        style={[
          styles.statePill,
          {
            backgroundColor: stateStyle.backgroundColor,
            borderColor: stateStyle.borderColor,
          },
        ]}
      >
        <Text style={[styles.statePillText, { color: stateStyle.textColor }]}>
          {stateStyle.label}
        </Text>
      </View>
    </View>
  );
}

export default function ChatThreadScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const messageStateStyles = createMessageStateStyles(tokens);
  const [pendingActions, setPendingActions] = useState(2);
  const [retryCount, setRetryCount] = useState(2);
  const [composerFeedback, setComposerFeedback] = useState(
    "Draft preserved locally with retry metadata. Sending resumes automatically once connection improves.",
  );
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  function handleRetryUpload() {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);
    setRetryCount((current) => current + 1);
    setComposerFeedback(
      "Retry requested. Upload requeued and compression fallback is running.",
    );

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    retryTimeoutRef.current = setTimeout(() => {
      setPendingActions((current) => Math.max(current - 1, 0));
      setIsRetrying(false);
      retryTimeoutRef.current = null;
    }, 800);
  }

  function handleQueueMessage() {
    setPendingActions((current) => current + 1);
    setComposerFeedback(
      "Message queued successfully. It will send automatically when connection stabilizes.",
    );
  }

  return (
    <ScreenShell
      title="#general"
      subtitle="Message-level reliability states for sent, sending, and retry-required events."
    >
      <View style={styles.threadSummaryCard}>
        <Text style={styles.threadSummaryLabel}>Thread health</Text>
        <Text style={styles.threadSummaryValue}>Delivery stabilized</Text>
        <Text style={styles.threadSummaryMeta}>
          {pendingActions} pending actions • {retryCount} retry attempts
        </Text>
      </View>

      <MessageBubble
        author="Jordan M."
        body="Reminder: submit service hours before Sunday so we can finalize attendance rollups."
        timestamp="6:11 PM"
        state="sent"
        styles={styles}
        messageStateStyles={messageStateStyles}
      />
      <MessageBubble
        author="You"
        body="Uploading meeting notes PDF now. Will pin it once this sends."
        timestamp="6:13 PM"
        state="sending"
        outgoing
        styles={styles}
        messageStateStyles={messageStateStyles}
      />
      <MessageBubble
        author="You"
        body="Attachment failed while reconnecting. Retrying with compressed file."
        timestamp="6:14 PM"
        state="retry"
        outgoing
        styles={styles}
        messageStateStyles={messageStateStyles}
      />

      <View style={styles.composerCard}>
        <Text style={styles.composerLabel}>Composer state</Text>
        <Text style={styles.composerText}>{composerFeedback}</Text>
        <View style={styles.composerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isRetrying }}
            disabled={isRetrying}
            onPress={handleRetryUpload}
            style={[
              styles.retryButton,
              isRetrying ? styles.retryButtonDisabled : null,
            ]}
          >
            <Text style={styles.retryButtonText}>
              {isRetrying ? "Retrying upload..." : "Retry failed upload"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleQueueMessage}
            style={styles.sendButton}
          >
            <Text style={styles.sendButtonText}>Queue message</Text>
          </Pressable>
        </View>
      </View>

      <Link href={asRoute("/")} asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to chat overview</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function createMessageStateStyles(tokens: SignetTokens) {
  return {
    sent: {
      label: "Sent",
      backgroundColor: tint(tokens.color.semantic.success),
      borderColor: tint(tokens.color.semantic.success, 0.3),
      textColor: tokens.color.semantic.success,
    },
    sending: {
      label: "Sending",
      backgroundColor: tint(tokens.color.semantic.warning),
      borderColor: tint(tokens.color.semantic.warning, 0.3),
      textColor: tokens.color.semantic.warning,
    },
    retry: {
      label: "Retry needed",
      backgroundColor: tint(tokens.color.semantic.destructive),
      borderColor: tint(tokens.color.semantic.destructive, 0.3),
      textColor: tokens.color.semantic.destructive,
    },
  } as const;
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    threadSummaryCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.info, 0.3),
      backgroundColor: tint(tokens.color.semantic.info),
      padding: tokens.spacing.lg,
      gap: tokens.spacing.xs,
    },
    threadSummaryLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.semantic.info,
    },
    threadSummaryValue: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
      letterSpacing: -0.3,
    },
    threadSummaryMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.info,
    },
    messageBubble: {
      borderRadius: tokens.radius.bubble,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    messageBubbleIncoming: {
      backgroundColor: tokens.color.surface.card,
    },
    messageBubbleOutgoing: {
      backgroundColor: tint(tokens.color.semantic.info),
      borderColor: tint(tokens.color.semantic.info, 0.3),
    },
    messageHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    messageAuthor: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    messageTime: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    messageBody: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    statePill: {
      alignSelf: "flex-start",
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 3,
    },
    statePillText: {
      ...typeRole(tokens.typography.role.caption),
    },
    composerCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    composerLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    composerText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    composerActions: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    retryButton: {
      flex: 1,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.destructive, 0.3),
      backgroundColor: tint(tokens.color.semantic.destructive),
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    retryButtonDisabled: {
      opacity: 0.65,
    },
    retryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.destructive,
    },
    sendButton: {
      flex: 1,
      borderRadius: tokens.radius.control,
      backgroundColor: accent,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButtonText: {
      ...typeRole(tokens.typography.role.label),
      // Chapter accents clear AA against the dark card, so the darkest surface
      // step is the legible on-accent text until the engine's on-primary lands.
      color: tokens.color.surface.background,
    },
    backButton: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    backButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
