import { useState } from "react";
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
import { useListChapters } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useAuthSession } from "@/lib/auth-session";
import { useSelectChapter } from "@/lib/select-chapter";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chapter picker — the supporting route with no drawn Canvas screen
 * (spec/ui/mobile/screens.md:46), so it reuses s02's visual language, which in
 * turn is the existing `(auth)` card language from s01.
 *
 * Reached deliberately, from the More hub — **not** forced on members whose
 * token lacks an `active_chapter_id` claim. `lib/auth-gate.ts` explains why
 * that distinction is load-bearing rather than a preference: no token carries
 * the claim while `custom_access_token_hook` is disabled (#805), so a forced
 * redirect would trap every member on a screen that cannot satisfy its own
 * exit condition.
 *
 * There is no local write on selection — see `lib/select-chapter.ts`. Because
 * the gate exempts this route, it will not push the member back out when a
 * switch lands, so every exit here is an explicit `router.replace`: to `(tabs)`
 * on success, to sign-in on sign-out. Nothing waits on a redirect that may
 * never come.
 */
export default function ChapterPicker() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, signOut } = useAuthSession();
  const queryClient = useQueryClient();
  const selectChapter = useSelectChapter();

  const { data, isPending, isError, refetch } = useListChapters();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);

  async function handleSignOut() {
    await signOut();
    // The same cache drop `preferences.tsx` does on its sign-out, for the same
    // reason: mobile's `QueryClient` is a module singleton and `signOut` clears
    // only SecureStore and React state, so the next member to sign in on this
    // device is served the previous one's rows until each entry goes stale.
    // This is the *second* sign-out path in the app and it was missing the
    // clear — which stopped being theoretical when s11 started caching invoice
    // rows and a Pay affordance keyed off `/v1/users/me`.
    queryClient.clear();
    // Navigate explicitly rather than waiting for the gate: the gate only ever
    // redirects *out* of this group, so signing out here would otherwise leave
    // the member staring at a chapter list whose every action now 401s.
    router.replace("/(auth)/sign-in");
  }

  // A stale `frapp://chapter-picker` opened while signed out would otherwise
  // render a list query that 401s, behind a "Try again" that can never succeed.
  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleSelect(nextChapterId: string) {
    setPendingId(nextChapterId);
    setSelectError(null);

    try {
      const ok = await selectChapter(nextChapterId);

      if (!ok) {
        // Nothing local was written, so retrying is safe and nothing needs
        // undoing.
        setSelectError(
          "Could not switch chapters. Check your connection and try again.",
        );
        return;
      }

      // Leave under our own steam rather than waiting to be redirected. The
      // gate exempts this route so a member can open it deliberately from More,
      // which also means it will not push them back out when the switch lands —
      // and it could not be relied on anyway, since no token carries the new
      // claim while `custom_access_token_hook` is disabled (#805). An earlier
      // version waited for that redirect and spun forever.
      //
      // Prefer going back over replacing: arriving from More means `(tabs)` is
      // already on the stack underneath, and replacing would leave a second
      // copy on top of the first. Replace is the fallback for arriving by deep
      // link, where there is nothing to go back to.
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)");
      }
    } finally {
      // Always clear. The screen usually unmounts before this matters, but
      // "usually" is what stranded members on a dead list of disabled rows.
      setPendingId(null);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose your chapter</Text>
      {/* Reachable from More by any member, so the copy cannot assert that
          they belong to more than one chapter. */}
      <Text style={styles.subtitle}>
        Pick the chapter you want to open.
      </Text>

      <View style={styles.card}>
        {isPending ? (
          <View style={styles.stateBlock}>
            <ActivityIndicator color={tokens.color.gold.house} />
            <Text style={styles.helperText}>Loading your chapters…</Text>
          </View>
        ) : isError ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>
              We could not load your chapters.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void refetch();
              }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : !data || data.length === 0 ? (
          // Not reachable through the normal hook path, but a member with no
          // membership at all would otherwise be stranded on a blank screen
          // with no way back to sign-in.
          <View style={styles.stateBlock}>
            <Text style={styles.helperText}>
              This account is not a member of any chapter yet. Join with an
              invite, or create a chapter if you&apos;re the first officer.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push("/join");
              }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Join a chapter</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push("/create-chapter");
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Create a chapter</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {data.map((membership) => {
              const isPendingRow = pendingId === membership.chapter_id;
              return (
                <Pressable
                  key={membership.chapter_id}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: pendingId !== null,
                    busy: isPendingRow,
                  }}
                  accessibilityHint={`Open ${membership.chapter.name}.`}
                  disabled={pendingId !== null}
                  onPress={() => {
                    void handleSelect(membership.chapter_id);
                  }}
                  style={[
                    styles.chapterRow,
                    pendingId !== null && !isPendingRow
                      ? styles.chapterRowDimmed
                      : null,
                  ]}
                >
                  <View style={styles.chapterRowText}>
                    <Text style={styles.chapterName}>
                      {membership.chapter.name}
                    </Text>
                    <Text style={styles.chapterMeta}>
                      {membership.chapter.university}
                    </Text>
                  </View>
                  {isPendingRow ? (
                    <ActivityIndicator color={tokens.color.gold.house} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {selectError ? <Text style={styles.errorText}>{selectError}</Text> : null}

        {/* Never disabled, and it navigates rather than trusting the gate to
            move us. Sign-out is the escape hatch — gating it on `pendingId`
            meant any stuck selection left the member with no way off this
            screen at all. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void handleSignOut();
          }}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    subtitle: {
      marginTop: tokens.spacing.xs,
      marginBottom: tokens.spacing.lg,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    stateBlock: {
      gap: tokens.spacing.md,
      alignItems: "center",
      paddingVertical: tokens.spacing.lg,
    },
    list: {
      gap: tokens.spacing.sm,
    },
    chapterRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    chapterRowDimmed: {
      opacity: 0.5,
    },
    chapterRowText: {
      flex: 1,
      gap: 2,
    },
    chapterName: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    chapterMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    helperText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    errorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    primaryButton: {
      borderRadius: tokens.radius.control,
      backgroundColor: tint(tokens.color.gold.house),
      borderWidth: 1,
      borderColor: tint(tokens.color.gold.house, 0.3),
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
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
