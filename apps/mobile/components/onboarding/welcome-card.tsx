import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  landingChannelId,
  useActiveChapterId,
  useChannels,
  useCurrentUser,
  useEvents,
} from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import {
  WELCOME_CARD_COPY,
  welcomeCardEventWhen,
  welcomeCardEvents,
  welcomeCardTitle,
} from "@repo/validation";
import { CloseGlyph, ForwardGlyph } from "@/components/control-glyphs";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectChannels } from "@/lib/chat/channel-list";
import { selectViewerProfile } from "@/lib/more/profile";
import { clearWelcomeDue, isWelcomeDue } from "@/lib/onboarding/welcome-due";
import { typeRole, useFrappTheme } from "@/lib/theme";

type EventRow = {
  id: string;
  name: string;
  start_time: string;
  end_time?: string | null;
};

/**
 * The welcome card (#5627; Paul's pick 2026-11-19, "welcome card, no tour"):
 * under the header of the chapter's default channel only, where chat home
 * lands a new member after s03 (`landingChannelId`), never every channel
 * they open. It replaced the first-run tour. Web draws the same
 * card (`apps/web/components/onboarding/welcome-card.tsx`).
 *
 * "Welcome to <chapter>, <first name>", the chapter's next two events with
 * their days written out (each opens the event), and **Finish your profile**,
 * a screen of its own (`app/(app)/finish-profile.tsx`) with the photo, the
 * roles they can join and the chat display: what s03 stopped asking up front. Closing it is for good, on this phone
 * (`lib/onboarding/welcome-due.ts`).
 */
export function WelcomeCard({ channelId }: { channelId: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const chapterId = useActiveChapterId();
  const { chapterName } = useChapterBranding();
  const userQuery = useCurrentUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const userId = (userQuery.data as { id?: string } | undefined)?.id ?? null;
  const [due, setDue] = useState(false);
  // The list is already cached for chat home; read only while due.
  const channels = useChannels({ enabled: due });
  const defaultChannelId = useMemo(
    () => landingChannelId(selectChannels(channels.data), null),
    [channels.data],
  );

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void isWelcomeDue(userId, chapterId).then((value) => {
      if (live) setDue(value);
    });
    return () => {
      live = false;
    };
  }, [userId, chapterId]);

  const events = useEvents({ enabled: due });
  const upcoming = useMemo(
    () =>
      welcomeCardEvents(
        (Array.isArray(events.data) ? events.data : []) as EventRow[],
        new Date(),
      ),
    [events.data],
  );

  // Drawn once the events have answered, so the rows never push it taller.
  if (!due || events.isPending || channelId !== defaultChannelId) return null;

  const close = () => {
    setDue(false);
    void clearWelcomeDue();
  };

  return (
    <View testID="welcome-card" style={styles.card}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>
          {welcomeCardTitle(chapterName, profile?.displayName)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={WELCOME_CARD_COPY.close}
          onPress={close}
          hitSlop={8}
          style={({ pressed }) => [
            styles.close,
            pressed ? styles.pressed : null,
          ]}
        >
          <CloseGlyph size={16} color={tokens.color.text.mutedForeground} />
        </Pressable>
      </View>
      {upcoming.map((event) => (
        <Pressable
          key={event.id}
          accessibilityRole="button"
          accessibilityLabel={`${event.name}, ${welcomeCardEventWhen(event.start_time, new Date())}`}
          onPress={() =>
            router.push({
              pathname: "/event-details",
              params: { id: event.id },
            })
          }
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
        >
          <Text numberOfLines={1} style={styles.rowName}>
            {event.name}
          </Text>
          <Text style={styles.rowWhen}>
            {welcomeCardEventWhen(event.start_time, new Date())}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={WELCOME_CARD_COPY.finishProfile}
        accessibilityHint={WELCOME_CARD_COPY.finishProfileHint}
        onPress={() => router.push("/finish-profile")}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <Text numberOfLines={1} style={[styles.rowName, styles.finish]}>
          {WELCOME_CARD_COPY.finishProfile}
        </Text>
        <Text style={styles.rowWhen}>
          {WELCOME_CARD_COPY.finishProfileHint}
        </Text>
        <ForwardGlyph color={tokens.color.text.mutedForeground} />
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      marginHorizontal: tokens.spacing.lg,
      marginTop: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
      borderRadius: tokens.radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
      marginBottom: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      fontSize: tokens.typography.role.body.size,
      color: tokens.color.text.foreground,
      flex: 1,
    },
    close: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -4,
      marginRight: -6,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    rowName: {
      ...typeRole(tokens.typography.role.body),
      fontSize: tokens.typography.role.label.size,
      color: tokens.color.text.foreground,
      flex: 1,
    },
    finish: {
      fontWeight: "600",
    },
    rowWhen: {
      ...typeRole(tokens.typography.role.body),
      fontSize: tokens.typography.role.label.size,
      color: tokens.color.text.mutedForeground,
    },
    pressed: { opacity: 0.6 },
  });
}
