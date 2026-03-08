import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";
import { ScreenShell } from "@/components/screen-shell";

type MessageState = "sent" | "sending" | "retry";

const MESSAGE_STATE_STYLES = {
  sent: {
    label: "Sent",
    backgroundColor: "#DCFCE7",
    borderColor: "#86EFAC",
    textColor: "#166534",
  },
  sending: {
    label: "Sending",
    backgroundColor: frappTokens.color.feedback.warningBackground,
    borderColor: frappTokens.color.feedback.warningBorder,
    textColor: frappTokens.color.feedback.warningText,
  },
  retry: {
    label: "Retry needed",
    backgroundColor: frappTokens.color.feedback.errorBackground,
    borderColor: frappTokens.color.feedback.errorBorder,
    textColor: frappTokens.color.feedback.errorText,
  },
} as const;

function MessageBubble({
  author,
  body,
  timestamp,
  state,
  outgoing = false,
}: {
  author: string;
  body: string;
  timestamp: string;
  state: MessageState;
  outgoing?: boolean;
}) {
  const stateStyle = MESSAGE_STATE_STYLES[state];

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
  return (
    <ScreenShell
      title="#general"
      subtitle="Message-level reliability states for sent, sending, and retry-required events."
    >
      <View style={styles.threadSummaryCard}>
        <Text style={styles.threadSummaryLabel}>Thread health</Text>
        <Text style={styles.threadSummaryValue}>Delivery stabilized</Text>
        <Text style={styles.threadSummaryMeta}>
          2 pending actions • 1 retry-required attachment
        </Text>
      </View>

      <MessageBubble
        author="Jordan M."
        body="Reminder: submit service hours before Sunday so we can finalize attendance rollups."
        timestamp="6:11 PM"
        state="sent"
      />
      <MessageBubble
        author="You"
        body="Uploading meeting notes PDF now. Will pin it once this sends."
        timestamp="6:13 PM"
        state="sending"
        outgoing
      />
      <MessageBubble
        author="You"
        body="Attachment failed while reconnecting. Retrying with compressed file."
        timestamp="6:14 PM"
        state="retry"
        outgoing
      />

      <View style={styles.composerCard}>
        <Text style={styles.composerLabel}>Composer state</Text>
        <Text style={styles.composerText}>
          Draft preserved locally with retry metadata. Sending resumes automatically once connection improves.
        </Text>
        <View style={styles.composerActions}>
          <Pressable style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry failed upload</Text>
          </Pressable>
          <Pressable style={styles.sendButton}>
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

const styles = StyleSheet.create({
  threadSummaryCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  threadSummaryLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: "#1E3A8A",
  },
  threadSummaryValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1E40AF",
    letterSpacing: -0.3,
  },
  threadSummaryMeta: {
    fontSize: 13,
    color: "#1E3A8A",
  },
  messageBubble: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    padding: frappTokens.spacing.lg,
    gap: 8,
  },
  messageBubbleIncoming: {
    backgroundColor: frappTokens.color.surface.card,
  },
  messageBubbleOutgoing: {
    backgroundColor: "#F8FAFF",
    borderColor: "#BFDBFE",
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
    color: frappTokens.color.text.primary,
  },
  messageTime: {
    fontSize: 12,
    color: frappTokens.color.text.muted,
  },
  messageBody: {
    fontSize: 14,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
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
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 10,
  },
  composerLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: frappTokens.color.text.muted,
  },
  composerText: {
    fontSize: 14,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
  },
  composerActions: {
    flexDirection: "row",
    gap: 8,
  },
  retryButton: {
    flex: 1,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.errorBorder,
    backgroundColor: frappTokens.color.feedback.errorBackground,
    paddingVertical: 10,
    alignItems: "center",
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: frappTokens.color.feedback.errorText,
  },
  sendButton: {
    flex: 1,
    borderRadius: frappTokens.radius.md,
    backgroundColor: frappTokens.color.brand.royalBlue,
    paddingVertical: 10,
    alignItems: "center",
  },
  sendButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: frappTokens.color.text.inverse,
  },
  backButton: {
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    paddingVertical: 12,
    alignItems: "center",
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
});
