import { useCallback, useRef, useState } from "react";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useListChapters } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useAuthSession } from "@/lib/auth-session";
import { ChoiceRow } from "@/components/auth/choice-row";
import { BackRow } from "@/components/back-row";
import { useSelectChapter } from "@/lib/select-chapter";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chapter picker — the supporting route with no drawn Canvas screen
 * (spec/ui/mobile/screens.md § Inventory), so it reuses s02's visual language:
 * one surface, no card, with each chapter as a row like s02's two answers
 * (#3349, #3350).
 *
 * Reached deliberately, from the More hub — **not** forced on members whose
 * token lacks an `active_chapter_id` claim. `lib/auth-gate.ts` explains why
 * that distinction is load-bearing rather than a preference: a missing claim
 * is still normal (no membership yet, or a playbook that disables the hook),
 * so a forced redirect would trap those users on a screen that cannot satisfy
 * its own exit condition.
 *
 * There is no local write on selection — see `lib/select-chapter.ts`. Because
 * the gate exempts this route, it will not push the member back out when a
 * switch lands, so every exit here is explicit: back to (or into) `(tabs)` on
 * success, and from the Current row whether or not its re-select succeeds; to
 * sign-in on sign-out. Nothing waits on a redirect that may never come.
 */
export default function ChapterPicker() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, signOut, chapterId: currentChapterId } = useAuthSession();
  const selectChapter = useSelectChapter();
  // More's Switch chapter row says it opened the picker (`from: "more"`), and
  // only then is the More tab underneath to go back to, so only then does the
  // picker draw `‹ More` and start its column at the top. A deep link keeps
  // the centred layout and no row. `router.canGoBack()` can't tell the two
  // apart: `(auth)/_layout.tsx` anchors sign-in under a linked screen, so it
  // is true there too, and a row that went back would land on sign-in under a
  // label that says More.
  const { from } = useLocalSearchParams<{ from?: string | string[] }>();
  const openedFromMore = from === "more";

  // Whether the picker is still the screen in front. A switch can settle
  // after the member has gone back (Android back, or the edge swipe, which
  // nothing here holds), and `leave()` then would move whatever screen is
  // showing by then: from More, a second `back()` would take the member off
  // the More tab they had just gone back to.
  const inFront = useRef(true);
  useFocusEffect(
    useCallback(() => {
      inFront.current = true;
      return () => {
        inFront.current = false;
      };
    }, []),
  );

  /** Back to the tabs this was opened over, or into them from a link. */
  function leave() {
    // Back, not a navigate: arriving from More means `(tabs)` is already on
    // the stack underneath, and opening it again would leave a second copy
    // on top of the first. A link opened at launch has sign-in under it (the
    // `(auth)` anchor), and going back there hands the member to the layout,
    // which sends them on to where the gate says: the tabs, once they have a
    // chapter. Replace is the fallback for a stack with nothing under the
    // picker at all.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }

  const { data, isPending, isError, refetch } = useListChapters();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);

  async function handleSignOut() {
    await signOut();
    // `signOut` drops the query cache itself (`lib/auth-session.tsx`), so every
    // sign-out path gets it without each screen remembering to.
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
    // The row marked Current: the chapter the token in hand is on already.
    const alreadyOn = nextChapterId === currentChapterId;
    setPendingId(nextChapterId);
    setSelectError(null);

    try {
      const ok = await selectChapter(nextChapterId);

      // A failed re-select of the chapter the member is already on leaves
      // anyway. Requests are checked against the token's claim, so the tabs
      // underneath work just as they did before the tap; the re-assert, which
      // keeps the next token on that chapter too, is best-effort. An error
      // here would strand a member who is offline on the one chapter they
      // are already in, and a picker a link opened has no row out but Sign
      // out. Any other row keeps the error: its switch hasn't happened.
      if (!ok && !alreadyOn) {
        // Nothing local was written, so retrying is safe and nothing needs
        // undoing.
        setSelectError(
          "Could not switch chapters. Check your connection and try again.",
        );
        return;
      }

      // Leave under our own steam rather than waiting to be redirected. The
      // gate exempts this route so a member can open it deliberately from More,
      // which also means it will not push them back out when the switch lands.
      // An earlier version waited for that redirect and spun forever.
      // Unless the picker has gone already, backed out of or covered: leaving
      // then would move whichever screen is in front instead.
      if (inFront.current) leave();
    } finally {
      // Always clear. The screen usually unmounts before this matters, but
      // "usually" is what stranded members on a dead list of disabled rows.
      setPendingId(null);
    }
  }

  return (
    // One scroll view for the whole column, not one for the list inside a
    // centred `View`. The inner list's height was never bounded, so it grew
    // to fit its rows and the column overflowed both ends of the screen
    // (`justifyContent: "center"` does not clamp): a member of enough
    // chapters lost "Sign out" off the bottom, and "Sign out" is this
    // screen's escape hatch. Same shape as sign-in and join.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.container,
          openedFromMore ? styles.containerTop : null,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/*
          `‹ More`, as every screen opened from a More row draws
          (navigation.md § Back rows), in house gold like the rest of this
          group. It goes back rather than navigating to More, for the reason
          `leave` gives, and holds while a switch is in flight, as the chapter
          rows do and the other `(auth)` back rows do while they wait.
        */}
        {openedFromMore ? (
          <BackRow
            house
            label="More"
            disabled={pendingId !== null}
            onPress={() => router.back()}
          />
        ) : null}
        {/* No line under the title: the list says the rest. */}
        <Text style={styles.title}>Choose your chapter</Text>

        <View style={styles.body}>
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
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.primaryButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : !data || data.length === 0 ? (
            // Not reachable through the normal hook path, but a member with no
            // membership at all would otherwise be stranded on a blank screen
            // with no way back to sign-in.
            // s02 asks invite-or-start itself (#3350), so one way there.
            <View style={styles.stateBlock}>
              <Text style={styles.helperText}>
                This account is not a member of any chapter yet. Join with an
                invite, or start your chapter if you&apos;re the first officer.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  router.push("/join");
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  Join or start a chapter
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.list}>
              {data.map((membership) => {
                const isPendingRow = pendingId === membership.chapter_id;
                // The chapter open now says so. A tap on it still selects it,
                // as on any row: `Current` reads the token's claim, which can
                // lag the active chapter the server holds (a switch on web, or
                // a switch here whose refresh failed), and selecting it again
                // is what puts the server back on the chapter shown. Unlike
                // the other rows, it leaves even when that fails (see
                // `handleSelect`).
                const isCurrent = membership.chapter_id === currentChapterId;
                return (
                  <ChoiceRow
                    key={membership.chapter_id}
                    title={membership.chapter.name}
                    body={membership.chapter.university}
                    accessibilityHint={`Open ${membership.chapter.name}.`}
                    disabled={pendingId !== null}
                    dimmed={pendingId !== null && !isPendingRow}
                    busy={isPendingRow}
                    trailing={
                      isPendingRow ? (
                        <ActivityIndicator color={tokens.color.gold.house} />
                      ) : isCurrent ? (
                        <Text style={styles.currentText}>Current</Text>
                      ) : undefined
                    }
                    onPress={() => {
                      void handleSelect(membership.chapter_id);
                    }}
                  />
                );
              })}
            </View>
          )}

          {selectError ? (
            <Text style={styles.errorText}>{selectError}</Text>
          ) : null}

          {/* Never disabled, and it navigates rather than trusting the gate to
            move us. Sign-out is the escape hatch — gating it on `pendingId`
            meant any stuck selection left the member with no way off this
            screen at all. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void handleSignOut();
            }}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed ? styles.textPressed : null,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    // The surface colour sits on the scroll view as well as its content: an
    // iOS overscroll bounce shows what is behind the content (join.tsx).
    scroll: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    container: {
      flexGrow: 1,
      justifyContent: "center",
      width: "100%",
      maxWidth: 448,
      alignSelf: "center",
      padding: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    // Under a back row the column starts at the top, where every screen
    // opened from More puts its row and title.
    containerTop: {
      justifyContent: "flex-start",
      paddingTop: tokens.spacing.sm,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    body: {
      marginTop: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    currentText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    stateBlock: {
      gap: tokens.spacing.md,
      alignItems: "center",
      paddingVertical: tokens.spacing.lg,
    },
    list: {
      gap: tokens.spacing.sm,
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
    // components.md § Buttons: Tinted presses one step up its own tint.
    primaryButtonPressed: {
      backgroundColor: tint(tokens.color.gold.house, 0.2),
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
    textPressed: {
      opacity: 0.6,
    },
    secondaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
