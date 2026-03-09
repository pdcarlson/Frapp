import { useState } from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FrappTokens } from "@repo/theme/tokens";
import { ScreenShell } from "@/components/screen-shell";
import { useFrappTheme } from "@/lib/theme";

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
  const styles = createStyles(tokens);
  const messageStateStyles = createMessageStateStyles(tokens);
  const [pendingActions, setPendingActions] = useState(2);
  const [retryCount, setRetryCount] = useState(2);
  const [composerFeedback, setComposerFeedback] = useState(
    "Draft preserved locally with retry metadata. Sending resumes automatically once connection improves.",
  );
  const [isRetrying, setIsRetrying] = useState(false);

  function handleRetryUpload() {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);
    setRetryCount((current) => current + 1);
    setComposerFeedback(
      "Retry requested. Upload requeued and compression fallback is running.",
    );

    setTimeout(() => {
      setPendingActions((current) => Math.max(current - 1, 0));
      setIsRetrying(false);
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

      <Link href="/chat" asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to chat overview</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function createMessageStateStyles(tokens: FrappTokens) {
  return {
    sent: {
      label: "Sent",
      backgroundColor: tokens.color.feedback.successBackground,
      borderColor: tokens.color.feedback.successBorder,
      textColor: tokens.color.feedback.successText,
    },
    sending: {
      label: "Sending",
      backgroundColor: tokens.color.feedback.warningBackground,
      borderColor: tokens.color.feedback.warningBorder,
      textColor: tokens.color.feedback.warningText,
    },
    retry: {
      label: "Retry needed",
      backgroundColor: tokens.color.feedback.errorBackground,
      borderColor: tokens.color.feedback.errorBorder,
      textColor: tokens.color.feedback.errorText,
    },
  } as const;
}

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    threadSummaryCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.feedback.infoBorder,
      backgroundColor: tokens.color.feedback.infoBackground,
      padding: tokens.spacing.lg,
      gap: 6,
    },
    threadSummaryLabel: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.feedback.infoText,
    },
    threadSummaryValue: {
      fontSize: 22,
      fontWeight: "800",
      color: tokens.color.feedback.infoTextStrong,
      letterSpacing: -0.3,
    },
    threadSummaryMeta: {
      fontSize: 13,
      color: tokens.color.feedback.infoText,
    },
    messageBubble: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      padding: tokens.spacing.lg,
      gap: 8,
    },
    messageBubbleIncoming: {
      backgroundColor: tokens.color.surface.card,
    },
    messageBubbleOutgoing: {
      backgroundColor: tokens.color.feedback.infoBackground,
      borderColor: tokens.color.feedback.infoBorder,
    },
    messageHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    messageAuthor: {
      fontSize: 13,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    messageTime: {
      fontSize: 12,
      color: tokens.color.text.muted,
    },
    messageBody: {
      fontSize: 14,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
    statePill: {
      alignSelf: "flex-start",
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    statePillText: {
      fontSize: 11,
      fontWeight: "700",
    },
    composerCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 10,
    },
    composerLabel: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    composerText: {
      fontSize: 14,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
    composerActions: {
      flexDirection: "row",
      gap: 8,
    },
    retryButton: {
      flex: 1,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.feedback.errorBorder,
      backgroundColor: tokens.color.feedback.errorBackground,
      paddingVertical: 10,
      alignItems: "center",
    },
    retryButtonDisabled: {
      opacity: 0.65,
    },
    retryButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: tokens.color.feedback.errorText,
    },
    sendButton: {
      flex: 1,
      borderRadius: tokens.radius.md,
      backgroundColor: tokens.color.brand.royalBlue,
      paddingVertical: 10,
      alignItems: "center",
    },
    sendButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: tokens.color.text.inverse,
    },
    backButton: {
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: 12,
      alignItems: "center",
    },
    backButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
  });
}
