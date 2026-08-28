import { useCallback, useEffect, useMemo, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChannels,
  useListChapters,
  useUpdateOnboarding,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { PushPrimerCard } from "@/components/notifications/push-primer-card";
import { useAuthSession } from "@/lib/auth-session";
import { selectOnboardingMembership } from "@/lib/onboarding/membership";
import {
  displayChannelLabel,
  selectJoinedPublicChannels,
} from "@/lib/onboarding/welcome-channels";
import {
  getPushPermission,
  isPushAvailable,
  pushUnavailableReason,
  requestPushPermission,
} from "@/lib/notifications/push";
import {
  readPrimerDecision,
  recordPrimerDecision,
  shouldOfferPrimer,
  type PrimerDecision,
} from "@/lib/notifications/primer";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s03 — First-run + notification primer (`spec/ui/mobile/screens.md`).
 *
 * Hosts the auto-joined public channels and the C7 push primer card. Completing
 * or skipping PATCHes `has_completed_onboarding` so the gate will not send the
 * member here again.
 */
export default function Welcome() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, chapterId } = useAuthSession();
  const queryClient = useQueryClient();
  const chapters = useListChapters({ enabled: status === "authenticated" });
  const channels = useChannels();
  const updateOnboarding = useUpdateOnboarding();

  const [decision, setDecision] = useState<PrimerDecision>("unasked");
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );
  const [isRequesting, setIsRequesting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void readPrimerDecision().then(setDecision);
  }, []);

  useEffect(() => {
    void getPushPermission().then((result) => {
      setPermissionGranted(result ? result.granted : null);
    });
  }, []);

  const membership = useMemo(() => {
    const rows = Array.isArray(chapters.data) ? chapters.data : [];
    return selectOnboardingMembership(rows, chapterId) ?? rows[0] ?? null;
  }, [chapterId, chapters.data]);

  const chapterName = membership?.chapter.name ?? "your chapter";
  const university = membership?.chapter.university ?? null;

  const joinedChannels = useMemo(
    () => selectJoinedPublicChannels(channels.data),
    [channels.data],
  );

  const showPrimer = shouldOfferPrimer({
    isAvailable: isPushAvailable(),
    permissionGranted,
    decision,
  });

  const handleTurnOn = useCallback(() => {
    setIsRequesting(true);
    void (async () => {
      await recordPrimerDecision("accepted");
      setDecision("accepted");
      const granted = await requestPushPermission();
      setPermissionGranted(granted);
      setIsRequesting(false);
    })();
  }, []);

  const handleNotNow = useCallback(() => {
    void recordPrimerDecision("declined").then(() => {
      setDecision("declined");
    });
  }, []);

  async function finish() {
    if (leaving) return;
    setLeaving(true);
    try {
      await updateOnboarding.mutateAsync({ has_completed_onboarding: true });
    } catch {
      // Non-fatal — the next session re-offers s03 if the write never landed.
    }
    await queryClient.invalidateQueries({ queryKey: ["chapters"] });
    router.replace("/(tabs)");
  }

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>You&apos;re in.</Text>
        <Text style={styles.subtitle}>
          {university ? `${chapterName} · ${university}` : chapterName}
        </Text>

        <View style={styles.channelCard}>
          {channels.isPending ? (
            <View style={styles.channelRow}>
              <ActivityIndicator color={tokens.color.gold.house} />
              <Text style={styles.channelHint}>Loading your channels…</Text>
            </View>
          ) : channels.isError ? (
            <Text style={styles.channelHint}>
              We couldn&apos;t load your channels. They&apos;ll be waiting in
              chat.
            </Text>
          ) : joinedChannels.length === 0 ? (
            <Text style={styles.channelHint}>
              You&apos;re in the chapter. Open chat to see your channels.
            </Text>
          ) : (
            joinedChannels.map((channel, index) => (
              <View key={channel.id}>
                {index > 0 ? <View style={styles.channelRule} /> : null}
                <View style={styles.channelRow}>
                  <Text style={styles.channelHash}>#</Text>
                  <Text style={styles.channelName}>
                    {displayChannelLabel(channel.name).replace(/^#/, "")}
                  </Text>
                  <Text style={styles.channelJoined}>joined</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {showPrimer ? (
          <View style={styles.primerWrap}>
            <PushPrimerCard
              unavailableReason={pushUnavailableReason()}
              isRequesting={isRequesting}
              onTurnOn={handleTurnOn}
              onNotNow={handleNotNow}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: leaving }}
          disabled={leaving}
          onPress={() => {
            void finish();
          }}
          style={[
            styles.primaryButton,
            leaving ? styles.primaryButtonDisabled : null,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {leaving ? "Opening chat…" : "Go to chat"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip first-run"
          disabled={leaving}
          onPress={() => {
            void finish();
          }}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    scroll: {
      paddingHorizontal: tokens.spacing.xl,
      paddingTop: tokens.spacing["3xl"],
      paddingBottom: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    channelCard: {
      marginTop: tokens.spacing.lg,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.xs,
    },
    channelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    channelRule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tint(tokens.color.text.foreground, 0.08),
      marginHorizontal: tokens.spacing.md,
    },
    channelHash: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.gold.house,
    },
    channelName: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    channelJoined: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    channelHint: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    },
    primerWrap: {
      marginTop: tokens.spacing.md,
    },
    footer: {
      paddingHorizontal: tokens.spacing.xl,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    primaryButton: {
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.55,
    },
    primaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    secondaryButton: {
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
