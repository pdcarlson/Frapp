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
 * s03, "You're in." (`spec/ui/mobile/screens.md`).
 *
 * The first screen after a member joins, and the first that can name the
 * chapter: the confirm step on `/join` can't, because an invite is a random
 * token (#3352). It shows the auto-joined public channels and, when this
 * build can push, the C7 push primer card inline (`shouldOfferPrimer`,
 * #2299). Go to chat PATCHes `has_completed_onboarding`, so the gate will not
 * send the member here again.
 *
 * It follows the #3348 screen rules: one surface, with a card only for the
 * channel list and the primer, and one button pinned above the inset. It used
 * to carry a Skip under Go to chat that did the same thing.
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
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.title}>
          You&apos;re in.
        </Text>
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
    flex: { flex: 1 },
    // One column, as wide as the join and setup screens' (400), centred on a
    // tablet.
    scroll: {
      width: "100%",
      maxWidth: 400 + tokens.spacing.xl * 2,
      alignSelf: "center",
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
      paddingVertical: tokens.spacing.lg,
    },
    primaryButton: {
      width: "100%",
      maxWidth: 400,
      alignSelf: "center",
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
  });
}
