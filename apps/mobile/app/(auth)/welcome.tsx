import { useMemo, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useListChapters, useUpdateOnboarding } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { PushPrimerCard } from "@/components/notifications/push-primer-card";
import { JoinedChannelsCard } from "@/components/onboarding/joined-channels-card";
import { useAuthSession } from "@/lib/auth-session";
import { selectOnboardingMembership } from "@/lib/onboarding/membership";
import { usePushPrimer } from "@/lib/notifications/use-push-primer";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s03 — First-run + notification primer (`spec/ui/mobile/screens.md`).
 *
 * Hosts the auto-joined public channels and, when this build can push, the C7
 * push primer card (`shouldOfferPrimer`, #2299). Completing
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
  const updateOnboarding = useUpdateOnboarding();
  const primer = usePushPrimer();
  const [leaving, setLeaving] = useState(false);

  const membership = useMemo(() => {
    const rows = Array.isArray(chapters.data) ? chapters.data : [];
    return selectOnboardingMembership(rows, chapterId) ?? rows[0] ?? null;
  }, [chapterId, chapters.data]);

  const chapterName = membership?.chapter.name ?? "your chapter";
  const university = membership?.chapter.university ?? null;

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
    // Safe area on every edge (#3345): `(auth)` renders with `headerShown:
    // false`, and Android draws the app edge to edge, so nothing else keeps
    // this screen off the status bar or its last control off the swipe bar.
    <SafeAreaView
      style={styles.container}
      edges={["top", "right", "bottom", "left"]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>You&apos;re in.</Text>
        <Text style={styles.subtitle}>
          {university ? `${chapterName} · ${university}` : chapterName}
        </Text>

        <View style={styles.channels}>
          <JoinedChannelsCard />
        </View>

        {primer.showPrimer ? (
          <View style={styles.primerWrap}>
            <PushPrimerCard
              isRequesting={primer.isRequesting}
              onTurnOn={() => {
                void primer.turnOn();
              }}
              onNotNow={() => {
                void primer.notNow();
              }}
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
    </SafeAreaView>
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
    channels: {
      marginTop: tokens.spacing.lg,
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
