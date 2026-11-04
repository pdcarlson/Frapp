import {
  type ComponentRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import * as Linking from "expo-linking";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  joinErrorCopy,
  redeemChapterId,
  useDeleteAccount,
  useJoinTermsCheckbox,
  useRedeemInvite,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ChoiceRow } from "@/components/auth/choice-row";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { confirmDeleteAccount } from "@/lib/account/delete-account-prompt";
import { OAUTH_MEMBERSHIP_HINT } from "@/lib/auth-providers";
import { useAuthSession } from "@/lib/auth-session";
import {
  consumeRememberedInviteToken,
  extractInviteToken,
  extractInviteTokenFromQuery,
  rememberInviteToken,
  takeInviteTokenFromLink,
} from "@/lib/onboarding/invite-token";
import { useBackToClose, useFocusOnOpen } from "@/lib/overlay";
import { useSelectChapter } from "@/lib/select-chapter";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s02, "How are you getting in?" (`spec/ui/mobile/screens.md`, #3350).
 *
 * Where an account with no chapter lands. It asks one question with two large
 * answers: "I have an invite" opens the invite step here, and "I'm starting our
 * chapter" opens `/create-chapter`. An invite link that opened the app skips
 * the question and lands on the confirm step.
 *
 * One surface, no card, like s01 (#3349). Sign out and Delete account sit in
 * the Account menu in the top corner, on both views, because this is the only
 * screen a zero-membership account can reach (Apple 5.1.1(v), #2295).
 *
 * The invite step is one field that also accepts a pasted URL; the canvas draws
 * six cells for a shared code, but joining is single-use invite tokens
 * (`spec/behavior/onboarding.md` wins over the drawing for the data model).
 *
 * Nothing joins from the field itself. Continue opens a confirm step, and an
 * opened invite link lands there directly (#3352): one card for the invite,
 * the Terms checkbox when it's needed, and Join chapter pinned at the bottom.
 * The card can't name the chapter yet. An invite is a random token, and the
 * only route that reads its chapter is the redeem that uses it up, so the
 * chapter's name first shows on s03, "You're in.", right after.
 */

type JoinView = "choose" | "invite" | "confirm";

export const JOIN_CHOICE_TITLE = "How are you getting in?";
export const JOIN_INVITE_TITLE = "Join with an invite";
export const JOIN_CONFIRM_TITLE = "Join with this invite?";

/** How the confirm card names an invite: its last four characters. */
export function inviteTail(token: string): string {
  return token.slice(-4);
}

export default function JoinChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, email, signOut } = useAuthSession();
  const redeemInvite = useRedeemInvite();
  const deleteAccount = useDeleteAccount();
  // When to show the Terms checkbox, and what a refused join means for it,
  // is shared with web `/join` (#2302).
  const terms = useJoinTermsCheckbox({ enabled: status === "authenticated" });
  const selectChapter = useSelectChapter();
  const params = useLocalSearchParams<{
    token?: string | string[];
    invite?: string | string[];
    code?: string | string[];
  }>();
  const deepLinkUrl = Linking.useURL();

  const [view, setView] = useState<JoinView>("choose");
  const [accountOpen, setAccountOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const paramValue = (
      value: string | string[] | undefined,
    ): string | null => {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
      }
      return null;
    };
    const fromParams = extractInviteToken(
      extractInviteTokenFromQuery((key) => {
        switch (key) {
          case "token":
            return paramValue(params.token);
          case "invite":
            return paramValue(params.invite);
          case "code":
            return paramValue(params.code);
        }
      }),
    );
    // Once per link: `useURL` keeps returning the launch URL for the life of
    // the process, so an invite already redeemed would otherwise fill the
    // field, and skip the question, on every later visit.
    const fromLink = takeInviteTokenFromLink(deepLinkUrl);
    const fresh = fromParams ?? fromLink;
    // Only a fresh invite is remembered, for the signed-out bounce onto
    // sign-in. One taken back out of memory stays out, or it would fill the
    // field and skip the question on every later visit until a redeem.
    if (fresh) rememberInviteToken(fresh);
    const next = fresh ?? consumeRememberedInviteToken();
    if (next) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed an empty field from the invite URL; keep text the member already typed
      setToken((current) => (current.length > 0 ? current : next));
      // An opened invite link has already answered the question and filled
      // the field, so it goes straight to the confirm step.
      setView("confirm");
    }
  }, [deepLinkUrl, params.code, params.invite, params.token]);

  // `isSuccess`, not just `isPending`: TanStack clears `isPending` in the same
  // render that runs `onSuccess`, but `handleSignOut` then awaits a real
  // network sign-out before navigating. Without it the row re-enables
  // mid-teardown reading "Delete account" again, and a second tap sends a
  // DELETE with a bearer whose auth user is already gone — a 401 that renders
  // as "deletion didn't finish, running it again is safe" after it in fact
  // finished.
  const deleting = deleteAccount.isPending || deleteAccount.isSuccess;
  // Redemption and deletion each lock the whole screen. Deleting must lock it
  // because navigating away unmounts this screen, and a per-call `mutate`
  // callback does not fire after unmount — the account would be erased with
  // `handleSignOut` never running, leaving a live session on a deleted account.
  // Redeeming must lock it because burning a single-use invite and then
  // deleting the account strands the membership it just created.
  // `isSuccess` on the redeem side too: `handleJoin` awaits `selectChapter`
  // (a POST plus a session refresh) *after* `mutateAsync` resolves and before
  // it navigates. Without it every control re-enables for those round trips —
  // the exact window where a delete would strand the membership the redeem
  // just created.
  //
  // This cannot strand the screen, and the reason is worth keeping: a
  // successful redeem always reaches `router.replace`, because everything
  // between the two is total. `selectChapter` catches its own failures and
  // returns a boolean rather than throwing (`lib/select-chapter.ts`), and
  // `consumeRememberedInviteToken` / `redeemChapterId` are pure. If any of
  // those grows a throw path, the catch would leave `isSuccess` true on a
  // mounted screen and lock every control — including this one.
  const submitting =
    redeemInvite.isPending || redeemInvite.isSuccess || deleting;
  // The primary button's spinner stays tied to redemption alone. `submitting`
  // disables it during a deletion too, but showing its spinner then would tell
  // the user a join is running when what is running is the deletion of their
  // account.
  const redeeming = redeemInvite.isPending;
  // A deletion in flight keeps the menu open, so "Deleting account…" stays on
  // screen until sign-out takes the user away. The menu's own close controls
  // are locked for the same window.
  const menuVisible = accountOpen || deleting;

  // Only the focused screen answers Android's back button. `/join` stays
  // mounted under a pushed `/create-chapter`, and an invite link opened then
  // still moves it to the confirm step; holding back from there would swallow
  // presses meant for the screen on top.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const closeMenu = useCallback(() => {
    // A deletion in flight holds the menu, so its progress stays on screen.
    if (!submitting) setAccountOpen(false);
  }, [submitting]);

  /**
   * One step back: from the confirm step to the field, which keeps the
   * invite so it can be changed, and from the field to the question.
   */
  const stepBack = useCallback(() => {
    // Held while a join or deletion runs, so the result lands on the view
    // that started it.
    if (submitting) return;
    setError(null);
    if (view === "confirm") {
      setView("invite");
      return;
    }
    // Backing out declines an opened invite: the next visit asks again.
    consumeRememberedInviteToken();
    setView("choose");
  }, [submitting, view]);

  // Android's back button steps back inside this screen before leaving it:
  // it closes the Account menu, then steps back a view, as the chevron does.
  // On the question itself it is left alone.
  useBackToClose(focused && menuVisible, closeMenu);
  useBackToClose(focused && !menuVisible && view !== "choose", stepBack);

  // The menu's title takes a screen reader's focus when it opens
  // (`spec/ui/mobile/patterns.md` § Overlays). A `Text`, as in the worked
  // examples there: TalkBack may not land on a plain container `View`.
  const menuTitleRef = useRef<ComponentRef<typeof Text>>(null);
  useFocusOnOpen(menuTitleRef, menuVisible);

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleSignOut() {
    // An invite remembered for this account is not the next account's.
    consumeRememberedInviteToken();
    await signOut();
    // `signOut` drops the query cache itself (`lib/auth-session.tsx`), so every
    // sign-out path gets it without each screen remembering to.
    router.replace("/(auth)/sign-in");
  }

  /**
   * Apple 5.1.1(v): an account that can be created in-app must be deletable
   * in-app. Frapp creates the account implicitly on first sign-in, and a user
   * with zero memberships is pinned to this screen — `useOnboardingRedirect`
   * (mounted app-wide by `components/app-runtime.tsx`) replaces any other path
   * with `/join` while the gate reads `join`, and this group's own layout
   * re-asserts it. Settings, where the other copy of this control lives, is
   * unreachable from here, so without this row that account can never be
   * deleted from the app (#2295).
   *
   * The failure deliberately uses the shared native alert rather than this
   * screen's `error` slot. That slot belongs to invite redemption and is
   * cleared on every keystroke (`onChangeText`) and on every join attempt, so a
   * "deletion didn't finish, please retry" notice put there is erased by the
   * user's next tap — on the one flow whose entire contract is retry. The
   * alert also announces itself to VoiceOver and survives navigation, matching
   * Settings exactly.
   */
  function handleDeleteAccount() {
    confirmDeleteAccount({
      deleteAccount,
      onDeleted: () => {
        void handleSignOut();
      },
    });
  }

  /** The field's Continue, and its Go key: on to the confirm step. */
  function handleContinue() {
    // A field that already has focus can still send Go after `editable`
    // turns false.
    if (submitting) return;
    if (!extractInviteToken(token)) {
      setError("Paste the invite your officer sent, or open the invite link.");
      return;
    }
    setError(null);
    setView("confirm");
  }

  async function handleJoin() {
    // A second tap can land before the button disables.
    if (submitting) return;
    const extracted = extractInviteToken(token);
    if (!extracted) {
      // Only reachable if the field was cleared under a confirm step.
      setView("invite");
      setError("Paste the invite your officer sent, or open the invite link.");
      return;
    }

    if (terms.blocker) {
      setError(terms.blocker);
      return;
    }

    setError(null);
    try {
      const result = await redeemInvite.mutateAsync(
        terms.redeemBody(extracted),
      );
      consumeRememberedInviteToken();
      const chapterId = redeemChapterId(result);
      if (chapterId) {
        await selectChapter(chapterId);
      }
      router.replace("/welcome");
    } catch (caught) {
      terms.onJoinError(caught);
      setError(joinErrorCopy(caught));
    }
  }

  const invite = extractInviteToken(token);

  const header = (
    <View style={styles.header}>
      {view !== "choose" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            view === "confirm" ? "Back to the invite" : "Back to the choices"
          }
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          hitSlop={8}
          onPress={stepBack}
          style={styles.backButton}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
      ) : (
        <View />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account"
        accessibilityHint="Sign out or delete your account."
        accessibilityState={{ expanded: menuVisible, disabled: submitting }}
        disabled={submitting}
        hitSlop={8}
        onPress={() => {
          setAccountOpen((open) => !open);
        }}
        style={styles.accountButton}
      >
        <Text style={styles.accountButtonText}>Account</Text>
      </Pressable>
    </View>
  );

  return (
    // Safe area on every edge (#3345): `(auth)` renders with `headerShown:
    // false`, and Android draws the app edge to edge, so nothing else keeps
    // this screen off the status bar or its last control off the swipe bar.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      <KeyboardAvoidingArea style={styles.flex}>
        {/*
          The column scrolls: on a 375x667 phone with the keyboard up the
          invite step does not fit, and a non-scrolling column would clip its
          last control.
        */}
        {/*
          What the menu covers leaves the accessibility tree while it is up:
          `accessibilityViewIsModal` is iOS-only, so without this TalkBack
          would still reach the controls underneath (patterns.md § Overlays).
        */}
        <View
          style={styles.flex}
          collapsable={false}
          accessibilityElementsHidden={menuVisible}
          importantForAccessibility={
            menuVisible ? "no-hide-descendants" : "auto"
          }
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            {header}

            {view === "choose" ? (
              <View style={styles.body}>
                <Text style={styles.title}>{JOIN_CHOICE_TITLE}</Text>
                <Text style={styles.subtitle}>
                  Members join with an invite from an officer. The first officer
                  sets the chapter up.
                </Text>

                <View style={styles.choices}>
                  <ChoiceRow
                    title="I have an invite"
                    body="Use the link your officer sent."
                    disabled={submitting}
                    dimmed={submitting}
                    onPress={() => {
                      setAccountOpen(false);
                      setView("invite");
                    }}
                  />
                  <ChoiceRow
                    title="I'm starting our chapter"
                    body="Set it up, then invite everyone."
                    accessibilityHint="Opens chapter setup."
                    disabled={submitting}
                    dimmed={submitting}
                    onPress={() => {
                      setAccountOpen(false);
                      router.push("/create-chapter");
                    }}
                  />
                </View>
              </View>
            ) : view === "invite" ? (
              <View style={styles.stepBody}>
                <Text style={styles.title}>{JOIN_INVITE_TITLE}</Text>
                <Text style={styles.subtitle}>
                  Paste the invite link or code your officer sent. Invites work
                  once and expire after 24 hours.
                </Text>

                <Text style={styles.inputLabel}>Invite</Text>
                <TextInput
                  value={token}
                  onChangeText={(value) => {
                    setToken(value);
                    setError(null);
                  }}
                  placeholder="Paste invite or link"
                  placeholderTextColor={tokens.color.text.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  // A filled field came from a link, or back from the confirm
                  // step; the next step is Continue, not typing, so the
                  // keyboard stays down.
                  autoFocus={token.length === 0}
                  textContentType="none"
                  accessibilityLabel="Invite token"
                  editable={!submitting}
                  returnKeyType="next"
                  onSubmitEditing={handleContinue}
                  style={styles.input}
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <Text style={styles.hintText}>{OAUTH_MEMBERSHIP_HINT}</Text>
              </View>
            ) : (
              <View style={styles.stepBody}>
                <Text style={styles.title}>{JOIN_CONFIRM_TITLE}</Text>
                <Text style={styles.subtitle}>
                  You&apos;ll join the chapter that sent it, and see its name
                  and channels as soon as you&apos;re in.
                </Text>

                {/* One object, so one card: the invite this step joins with. */}
                <View style={styles.inviteCard}>
                  <Text style={styles.inviteCardTitle}>Chapter invite</Text>
                  <Text style={styles.inviteCardDetail}>
                    {invite ? (
                      <>
                        Ending in{" "}
                        <Text style={styles.inviteCardTail}>
                          {inviteTail(invite)}
                        </Text>
                        {" · "}
                      </>
                    ) : null}
                    Works once
                  </Text>
                </View>

                {terms.needed ? (
                  <TermsAcceptance
                    accepted={terms.accepted}
                    onAcceptedChange={(next) => {
                      terms.setAccepted(next);
                      setError(null);
                    }}
                    disabled={submitting}
                  />
                ) : null}

                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
            )}
          </ScrollView>

          {/*
            The step forward, pinned above the keyboard and the inset, on both
            invite views (#3348 screen rules). Inside the underlay so the
            Account menu hides it from a screen reader too.
          */}
          {view === "choose" ? null : (
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting, busy: redeeming }}
                disabled={submitting}
                onPress={() => {
                  if (view === "invite") handleContinue();
                  else void handleJoin();
                }}
                style={[
                  styles.primaryButton,
                  submitting ? styles.disabled : null,
                ]}
              >
                {redeeming ? (
                  <ActivityIndicator color={tokens.color.gold.onHouse} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {view === "invite" ? "Continue" : "Join chapter"}
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        {menuVisible ? (
          <>
            {/* Tapping anywhere outside the menu closes it. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close account menu"
              disabled={submitting}
              onPress={closeMenu}
              style={styles.backdrop}
            />
            <View style={styles.menu} accessibilityViewIsModal>
              {/* Always drawn: it is where a screen reader's focus lands. */}
              <Text
                ref={menuTitleRef}
                accessibilityRole="header"
                style={styles.menuCaption}
                numberOfLines={1}
              >
                {email ? `Signed in as ${email}` : "Your account"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting }}
                disabled={submitting}
                onPress={() => {
                  setAccountOpen(false);
                  void handleSignOut();
                }}
                style={styles.menuRow}
              >
                <Text
                  style={[
                    styles.menuRowText,
                    submitting ? styles.disabled : null,
                  ]}
                >
                  Sign out
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Permanently deletes your account. You'll be asked to confirm."
                accessibilityState={{ disabled: submitting, busy: deleting }}
                disabled={submitting}
                onPress={handleDeleteAccount}
                style={styles.menuRow}
              >
                <Text
                  style={[
                    styles.menuRowDestructive,
                    submitting ? styles.disabled : null,
                  ]}
                >
                  {deleting ? "Deleting account…" : "Delete account"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </KeyboardAvoidingArea>
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    // The surface colour has to sit on the scroll view as well as its content
    // container: an iOS overscroll bounce reveals what is behind the content,
    // and the root Stack ships no navigation theme, so that is react-navigation's
    // default light background under a dark-only Signet surface.
    scroll: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: tokens.spacing.xl,
      paddingBottom: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: tokens.touch.minimum,
      marginTop: tokens.spacing.sm,
    },
    backButton: {
      minWidth: tokens.touch.minimum,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    backGlyph: {
      fontSize: 30,
      lineHeight: 32,
      color: tokens.color.text.foreground,
    },
    accountButton: {
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.sm,
      justifyContent: "center",
    },
    accountButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    // Centred in the space under the header while it fits; the scroll view
    // takes over when it does not.
    body: {
      flexGrow: 1,
      justifyContent: "center",
      width: "100%",
      maxWidth: 400,
      alignSelf: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.xl,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    subtitle: {
      marginBottom: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    // The invite and confirm steps sit at the top, under the back chevron,
    // with their button pinned below (#3348 screen rules).
    stepBody: {
      width: "100%",
      maxWidth: 400,
      alignSelf: "center",
      gap: tokens.spacing.md,
      paddingTop: tokens.spacing.lg,
    },
    choices: {
      gap: tokens.spacing.md,
    },
    inviteCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    inviteCardTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    inviteCardDetail: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    inviteCardTail: {
      fontFamily: MONO_FONT_FAMILY,
      color: tokens.color.text.foreground,
    },
    footer: {
      paddingHorizontal: tokens.spacing.xl,
      paddingVertical: tokens.spacing.lg,
    },
    inputLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    input: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.button,
      ...typeRole(tokens.typography.role.body),
      fontFamily: MONO_FONT_FAMILY,
      color: tokens.color.text.foreground,
    },
    errorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    // As wide as the column above it.
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
    primaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    hintText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textAlign: "center",
    },
    // Mirrors `ListRow`'s disabled treatment: a control that cannot respond has
    // to look like it, or a user on a slow delete taps a dead full-strength
    // button and concludes the app has frozen.
    disabled: {
      opacity: 0.5,
    },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    // The one floating surface on the screen: a lighter card under the
    // Account button, no shadow (foundations.md §10).
    menu: {
      position: "absolute",
      top: tokens.spacing.sm + tokens.touch.minimum,
      // Lines up with the Account button's own box, inside the column's
      // side padding.
      right: tokens.spacing.xl,
      minWidth: 220,
      maxWidth: 300,
      paddingVertical: tokens.spacing.xs,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    menuCaption: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.xs,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    menuRow: {
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      justifyContent: "center",
    },
    menuRowText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    // Same hue `ListRow` gives a destructive row in Settings
    // (`components/list-section.tsx`), so the delete control reads the same
    // way on both screens that offer it.
    menuRowDestructive: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.destructive,
    },
  });
}
