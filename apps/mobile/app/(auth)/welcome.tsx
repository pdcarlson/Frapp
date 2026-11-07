import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useListChapters, useUpdateOnboarding } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  PUSH_ASK_TITLE,
  PushAskActions,
  PushAskBody,
} from "@/components/notifications/push-ask";
import { JoinedChannelsCard } from "@/components/onboarding/joined-channels-card";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { useAuthSession } from "@/lib/auth-session";
import { selectOnboardingMembership } from "@/lib/onboarding/membership";
import { usePushPrimer } from "@/lib/notifications/use-push-primer";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s03, "You're in." (`spec/ui/mobile/screens.md`).
 *
 * The first screen after a member joins, in two beats on one route:
 *
 * 1. **You're in.** The chapter and its school under the title, read from the
 *    membership this time, not from the invite preview the confirm step on
 *    `/join` showed (#3352), and the auto-joined public channels.
 * 2. **Turn on notifications**, when this build can push and push isn't on
 *    yet (`shouldOfferPrimer`, #2299). Its own step, not a card under the
 *    channels: the card was easy to scroll past on the way to Go to chat, and
 *    a member who joins and never turns push on misses the very pings the
 *    chapter invited them for. Either answer goes to chat; a "Not now" comes
 *    back once, days later, on the chat home (`usePushReminder`).
 *
 * Leaving PATCHes `has_completed_onboarding`, so the gate will not send the
 * member here again. One surface and one gold button pinned above the inset
 * on each beat (the #3348 screen rules).
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
  // The guard itself, since two taps in one frame both read `leaving` false.
  const leavingRef = useRef(false);
  const [step, setStep] = useState<"welcome" | "notifications">("welcome");

  const membership = useMemo(() => {
    const rows = Array.isArray(chapters.data) ? chapters.data : [];
    return selectOnboardingMembership(rows, chapterId) ?? rows[0] ?? null;
  }, [chapterId, chapters.data]);

  const chapterName = membership?.chapter.name ?? "your chapter";
  const university = membership?.chapter.university ?? null;

  async function finish() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      await updateOnboarding.mutateAsync({ has_completed_onboarding: true });
    } catch {
      // Non-fatal — the next session re-offers s03 if the write never landed.
    }
    await queryClient.invalidateQueries({ queryKey: ["chapters"] });
    router.replace("/(tabs)");
  }

  // Latched when Continue opens it, not re-derived from `showPrimer`: an
  // answer is stored before the OS dialog opens and before the PATCH, and
  // the step must stay on screen (busy) until the member has left for chat.
  const asking = step === "notifications";
  const answering = primer.isRequesting || leaving;

  // Android's back on the second beat returns to the first, as a back gesture
  // between two screens would; it never leaves onboarding half done. Held
  // while an answer is on its way out.
  useEffect(() => {
    if (!asking) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!answering) setStep("welcome");
      return true;
    });
    return () => sub.remove();
  }, [asking, answering]);

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
        {asking ? (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              {PUSH_ASK_TITLE}
            </Text>
            <View style={styles.channels}>
              <PushAskBody />
            </View>
          </>
        ) : (
          <>
            <Text accessibilityRole="header" style={styles.title}>
              You&apos;re in.
            </Text>
            <Text style={styles.subtitle}>
              {university ? `${chapterName} · ${university}` : chapterName}
            </Text>

            <View style={styles.channels}>
              <JoinedChannelsCard />
            </View>
          </>
        )}
      </ScrollView>

      {/*
        One gold button per beat. On the first it moves on: to the
        notifications step when there is one to show, else to chat. On the
        second it asks, and Not now is the quiet line under it; either answer
        leaves for chat, after the OS dialog closes.
      */}
      <View style={styles.footer}>
        {asking ? (
          <PushAskActions
            action={primer.action}
            busy={answering}
            onTurnOn={() => {
              void primer.turnOn().then((outcome) => {
                if (outcome !== null) void finish();
              });
            }}
            onNotNow={() => {
              void primer.notNow().then((answered) => {
                if (answered) void finish();
              });
            }}
          />
        ) : (
          <OnboardingPrimaryButton
            label={primer.showPrimer ? "Continue" : "Go to chat"}
            disabled={leaving}
            busy={leaving}
            onPress={() => {
              if (primer.showPrimer) {
                setStep("notifications");
              } else {
                void finish();
              }
            }}
          />
        )}
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
    // One column, as wide as the join and setup screens', centred on a
    // tablet.
    scroll: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH + tokens.spacing.xl * 2,
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
    footer: {
      paddingHorizontal: tokens.spacing.xl,
      paddingVertical: tokens.spacing.lg,
    },
  });
}
