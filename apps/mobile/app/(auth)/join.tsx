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
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  isDeadInviteError,
  joinErrorCopy,
  pendingInviteDetail,
  pendingInviteTitle,
  redeemChapterId,
  useDeleteAccount,
  useInvitePreview,
  useJoinTermsCheckbox,
  usePendingInvites,
  useRedeemInvite,
} from "@repo/hooks";
import { normalizeAccentInput } from "@repo/hooks/chapter-identity";
import { chapterInitials } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ChoiceRow } from "@/components/auth/choice-row";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { BackRow } from "@/components/back-row";
import { ChapterMarkTile } from "@/components/onboarding/chapter-mark-tile";
import {
  OnboardingFieldLabel,
  OnboardingTextInput,
} from "@/components/onboarding/onboarding-field";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import {
  SignedInAs,
  useOnboardingSignOut,
} from "@/components/onboarding/signed-in-as";
import { confirmDeleteAccount } from "@/lib/account/delete-account-prompt";
import { OAUTH_MEMBERSHIP_HINT } from "@/lib/auth-providers";
import { useAuthSession } from "@/lib/auth-session";
import {
  consumeRememberedInviteToken,
  extractInviteToken,
  extractInviteTokenFromQuery,
  peekInviteTokenFromLink,
  peekRememberedInviteToken,
  rememberInviteToken,
  takeInviteTokenFromLink,
} from "@/lib/onboarding/invite-token";
import { useBackToClose, useFocusOnOpen } from "@/lib/overlay";
import { useSelectChapter } from "@/lib/select-chapter";
import { successHaptic } from "@/lib/haptics";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { stepFadeIn } from "@/lib/onboarding/step-fade";
import { MONO_FONT_FAMILY, tint, typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * s02, "How are you getting in?" (`spec/ui/mobile/screens.md`, #3350).
 *
 * Where an account with no chapter lands. It asks one question with two large
 * answers: "I have an invite" opens the invite step here, and "I'm starting our
 * chapter" opens `/create-chapter`. An invite link that opened the app skips
 * the question and lands on the confirm step.
 *
 * One surface, like s01 (#3349), with a card only for the one object on the
 * confirm step. Every view shows the account it is signed in as, with Sign
 * out beside it (#3782), and Delete account sits in the Account menu in the
 * top corner, because this is the only screen a zero-membership account can
 * reach (Apple 5.1.1(v), #2295).
 *
 * Signed in and not opened by an invite link, the question also offers each
 * pending invite emailed to the account's verified address (`GET
 * /v1/invites/mine`, #3782), as web `/join` does (#3776). Tapping one opens
 * the confirm step on that invite, so Terms and Join run as for any other.
 *
 * The invite step is one field that also accepts a pasted URL; the canvas draws
 * six cells for a shared code, but joining is single-use invite tokens
 * (`spec/behavior/onboarding.md` wins over the drawing for the data model).
 *
 * Nothing joins from the field itself. Continue opens a confirm step, and an
 * opened invite link lands there directly (#3352): "Join FIJI Tau Nu?" over
 * one card for the chapter (its mark, name and school, who sent the invite and
 * the role it grants, read by `POST /v1/invites/preview` without using the
 * invite up), the Terms checkbox when it's needed, and Join chapter pinned at
 * the bottom. A preview that fails leaves a card for the bare invite, which
 * can still be joined; a dead invite (410), found by the preview or by the redeem, says so and disables Join.
 */

type JoinView = "choose" | "invite" | "confirm";

export const JOIN_CHOICE_TITLE = "How are you getting in?";
export const JOIN_INVITE_TITLE = "Join with an invite";
export const JOIN_CONFIRM_TITLE = "Join with this invite?";

/** The confirm step's title once the invite's chapter is known. */
export function confirmTitle(chapterName: string): string {
  return `Join ${chapterName}?`;
}

/** How the confirm card names an invite it can't read: its last four characters. */
export function inviteTail(token: string): string {
  return token.slice(-4);
}

type InviteParams = {
  token?: string | string[];
  invite?: string | string[];
  code?: string | string[];
};

/** The invite a route param carries (`?token=`, `?invite=`, `?code=`), or null. */
function inviteFromParams(params: InviteParams): string | null {
  const paramValue = (value: string | string[] | undefined): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0];
    }
    return null;
  };
  return extractInviteToken(
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
}

export default function JoinChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, email, userId } = useAuthSession();
  const { signOut: signOutToSignIn, signingOut } = useOnboardingSignOut();
  const redeemInvite = useRedeemInvite();
  const deleteAccount = useDeleteAccount();
  // When to show the Terms checkbox, and what a refused join means for it,
  // is shared with web `/join` (#2302).
  const terms = useJoinTermsCheckbox({ enabled: status === "authenticated" });
  const selectChapter = useSelectChapter();
  const params = useLocalSearchParams<InviteParams>();
  const deepLinkUrl = Linking.useURL();

  const [view, setView] = useState<JoinView>("choose");
  const [accountOpen, setAccountOpen] = useState(false);
  const [token, setToken] = useState("");
  // Whether an invite link (or one remembered across the sign-in bounce)
  // brought the member here. A link carries one invite, and that is the one
  // the member came for, so the question offers no others, as web `/join`
  // offers none when opened with a token.
  // Set once the effect below applies one; until then `inviteIncoming`
  // (below) reads the same answer at render, so the first render already
  // knows and the offers are never fetched for a link-opened visit.
  const [appliedLinkInvite, setAppliedLinkInvite] = useState(false);
  // Whether the confirm step was opened from a pending-invite offer: its back
  // goes to the question, since the field never held that invite.
  const [fromOffer, setFromOffer] = useState(false);
  // What the field held when an offer was picked, put back on Back from the
  // offer's confirm step, so a pasted invite isn't lost to a look at an offer.
  const [tokenBeforeOffer, setTokenBeforeOffer] = useState("");
  const [error, setError] = useState<string | null>(null);
  /**
   * An invite the redeem itself found dead (410), with the sentence to show:
   * a preview read a minute earlier can still say it was live.
   */
  const [deadRedeem, setDeadRedeem] = useState<{
    token: string;
    copy: string;
  } | null>(null);

  // Every invite the effect below has applied. A route param stays set for
  // the life of the screen, so every re-run sees it again; only one never
  // applied is new. A set, not the last one: a param a link replaced must not
  // come back as new on a later re-run.
  const appliedInvites = useRef(new Set<string>());
  // The link and params the effect last acted on. A re-run where they are
  // unchanged (a join or deletion that held links just ended) has nothing to
  // apply, so it leaves the field, the step and any error alone.
  const handledInputs = useRef<string | null>(null);
  // A join or deletion in flight holds the screen on the invite that started
  // it, so a link opened meanwhile waits for it to end (`stepBack` holds the
  // same way).
  const holdLinks =
    redeemInvite.isPending ||
    redeemInvite.isSuccess ||
    deleteAccount.isPending ||
    deleteAccount.isSuccess;

  useEffect(() => {
    if (holdLinks) return;
    const inputs = JSON.stringify([
      deepLinkUrl,
      params.token,
      params.invite,
      params.code,
    ]);
    if (inputs === handledInputs.current) return;
    handledInputs.current = inputs;
    const fromParams = inviteFromParams({
      token: params.token,
      invite: params.invite,
      code: params.code,
    });
    // Once per link: `useURL` keeps returning the launch URL for the life of
    // the process, so an invite already redeemed would otherwise fill the
    // field, and skip the question, on every later visit.
    const fromLink = takeInviteTokenFromLink(deepLinkUrl);
    const isNew = (value: string | null): value is string =>
      value !== null && !appliedInvites.current.has(value);
    // A link is only ever returned once, so it leads; a param applied before
    // is not new.
    const fresh = isNew(fromLink)
      ? fromLink
      : isNew(fromParams)
        ? fromParams
        : null;
    if (!fresh && (fromLink ?? fromParams)) return;
    if (fresh) appliedInvites.current.add(fresh);
    // Only a fresh invite is remembered, for the signed-out bounce onto
    // sign-in. One taken back out of memory stays out, or it would fill the
    // field and skip the question on every later visit until a redeem.
    if (fresh) rememberInviteToken(fresh);
    const next = fresh ?? consumeRememberedInviteToken();
    if (next) {
      // A link just opened wins over whatever the field holds: the confirm
      // step hides the field, so a kept value would be joined unseen. A
      // remembered invite only fills an empty field.
      setToken((current) => (fresh || current.length === 0 ? next : current));
      setError(null);
      setAppliedLinkInvite(true);
      setFromOffer(false);
      // An opened invite link has already answered the question and filled
      // the field, so it goes straight to the confirm step.
      setView("confirm");
    }
  }, [deepLinkUrl, holdLinks, params.code, params.invite, params.token]);

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
  // returns a boolean rather than throwing (`lib/select-chapter.ts`),
  // `successHaptic` swallows its own failures (`lib/haptics.ts`), and
  // `consumeRememberedInviteToken` / `redeemChapterId` are pure. If any of
  // those grows a throw path, the catch would leave `isSuccess` true on a
  // mounted screen and lock every control — including this one.
  // A sign-out in flight locks it too: nothing should start under a session
  // that is going away.
  const submitting =
    redeemInvite.isPending || redeemInvite.isSuccess || deleting || signingOut;
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
    if (view === "confirm" && fromOffer) {
      // The offer's invite never went through the field, so backing out
      // returns to the question with the field empty.
      setFromOffer(false);
      setToken(tokenBeforeOffer);
      setView("choose");
      return;
    }
    if (view === "confirm") {
      setView("invite");
      return;
    }
    // Backing out declines an opened invite: the next visit asks again.
    consumeRememberedInviteToken();
    setView("choose");
  }, [fromOffer, submitting, tokenBeforeOffer, view]);

  // Android's back button steps back inside this screen before leaving it:
  // it closes the Account menu, then steps back a view, as `‹ Back` does.
  // On the question itself it is left alone.
  useBackToClose(focused && menuVisible, closeMenu);
  useBackToClose(focused && !menuVisible && view !== "choose", stepBack);

  // The menu's title takes a screen reader's focus when it opens
  // (`spec/ui/mobile/patterns.md` § Overlays). A `Text`, as in the worked
  // examples there: TalkBack may not land on a plain container `View`.
  const menuTitleRef = useRef<ComponentRef<typeof Text>>(null);
  useFocusOnOpen(menuTitleRef, menuVisible);

  // Read before the redirect below: hooks run on every render.
  const invite = extractInviteToken(token);
  // Signed-in only: a signed-out render is about to redirect, and the token
  // would go out with no session.
  const preview = useInvitePreview(
    status === "authenticated" && view === "confirm" ? invite : null,
  );
  const chapter = preview.data ?? null;
  // A dead link can't be joined, so the step says so and disables Join,
  // whether the preview or the redeem found it dead.
  const deadCopy =
    preview.isError && isDeadInviteError(preview.error)
      ? joinErrorCopy(preview.error)
      : deadRedeem && deadRedeem.token === invite
        ? deadRedeem.copy
        : null;
  const deadInvite = deadCopy !== null;
  const stepBlocked = submitting || (view === "confirm" && deadInvite);
  // Whether an invite link (or a param, or one remembered across the sign-in
  // bounce) is about to be applied by the effect above, read at render
  // without taking it, so the very first render of a link-opened visit
  // already knows. Once applied, `appliedLinkInvite` keeps the answer.
  const fromParamsNow = inviteFromParams(params);
  // A route param stays set for the life of the screen, like web's
  // `initialToken`, so any param counts.
  //
  // `Linking.useURL()` is null on its first render (it reads the launch URL
  // in an effect), so the link is also peeked from `getLinkingURL()`, which
  // answers the launch URL synchronously. A link that arrives later, while
  // the app is open, is seen only once `useURL` reports it; an offers read
  // already in flight then stops being shown when the effect applies it.
  const inviteIncoming =
    fromParamsNow !== null ||
    peekInviteTokenFromLink(deepLinkUrl ?? Linking.getLinkingURL()) !== null ||
    peekRememberedInviteToken() !== null;
  const arrivedWithInvite = appliedLinkInvite || inviteIncoming;
  // Invites emailed to this account, offered on the question (#3782). Not
  // read while signed out, nor when a link brought one.
  const pendingInvites = usePendingInvites(
    status === "authenticated" && !arrivedWithInvite ? userId : null,
  );
  const offers = Array.isArray(pendingInvites.data) ? pendingInvites.data : [];

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleSignOut() {
    // The same path the Sign out line runs (`useOnboardingSignOut`): forget a
    // remembered invite, sign out, land on sign-in.
    await signOutToSignIn();
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
    setFromOffer(false);
    setView("confirm");
  }

  /** A pending-invite offer: on to the confirm step with its invite. */
  function handlePickOffer(offerToken: string) {
    if (submitting) return;
    setAccountOpen(false);
    setTokenBeforeOffer(token);
    setToken(offerToken);
    setError(null);
    setFromOffer(true);
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
      // The member is in: the one tap setup gives a chapter going live, so
      // joining one feels like it landed. Best effort, and silent where the
      // device can't (`lib/haptics.ts`).
      successHaptic();
      const chapterId = redeemChapterId(result);
      if (chapterId) {
        await selectChapter(chapterId);
      }
      router.replace("/welcome");
    } catch (caught) {
      terms.onJoinError(caught);
      if (isDeadInviteError(caught)) {
        setDeadRedeem({ token: extracted, copy: joinErrorCopy(caught) });
        return;
      }
      setError(joinErrorCopy(caught));
    }
  }

  const accountButton = (
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityLabel="Account"
      accessibilityHint="Delete your account."
      accessibilityState={{ expanded: menuVisible, disabled: submitting }}
      disabled={submitting}
      hitSlop={8}
      onPress={() => {
        setAccountOpen((open) => !open);
      }}
      quiet
      style={styles.accountButton}
    >
      <Text style={styles.accountButtonText}>Account</Text>
    </OnboardingPressable>
  );

  // The board's s02 `‹ Back` row, in house gold (`BackRow`), with the
  // Account menu at its far end. The question has nothing to step back to,
  // so it draws Account alone, in the same place.
  const header = (
    <View style={styles.header}>
      {view !== "choose" ? (
        <BackRow
          house
          label="Back"
          accessibilityLabel={
            view === "confirm" && !fromOffer
              ? "Back to the invite"
              : "Back to the choices"
          }
          disabled={submitting}
          onPress={stepBack}
          trailing={accountButton}
        />
      ) : (
        <View style={styles.headerRow}>{accountButton}</View>
      )}
    </View>
  );

  // Each view fades in (`stepFadeIn`, as setup's steps do).
  const entering = stepFadeIn(tokens);

  return (
    // Safe area on every edge (#3345): `(auth)` renders with `headerShown:
    // false`, and Android draws the app edge to edge, so nothing else keeps
    // this screen off the status bar or its last control off the swipe bar.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      <KeyboardAvoidingArea style={styles.flex} atScreenBottom>
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

            {/*
              The account this screen is signed in as, with Sign out, on
              every view (#3782). In the column, under the header, so the
              pinned button never covers it.
            */}
            <View style={styles.accountLine}>
              <SignedInAs
                signOut={signOutToSignIn}
                signingOut={signingOut}
                disabled={submitting}
              />
            </View>

            {view === "choose" ? (
              // At the top, like the other two views, so the title doesn't
              // jump from mid-screen to the top on the first tap. No line
              // under it: the two answers already say how a member gets in.
              <Animated.View
                key="choose"
                entering={entering}
                style={styles.stepBody}
              >
                <Text style={styles.title}>{JOIN_CHOICE_TITLE}</Text>

                {offers.length > 0 ? (
                  // Invites emailed to this account, above the two answers
                  // (#3782). Each opens the confirm step on its invite.
                  <View style={styles.choices}>
                    {offers.map((offer) => (
                      <ChoiceRow
                        key={offer.token}
                        title={pendingInviteTitle(offer.chapter_name)}
                        body={pendingInviteDetail(offer)}
                        accessibilityHint="Opens the invite to join."
                        disabled={submitting}
                        dimmed={submitting}
                        leading={
                          // The title names the chapter, so a screen reader
                          // skips the mark.
                          <View
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                          >
                            <ChapterMarkTile
                              text={
                                offer.mark_text ??
                                chapterInitials(offer.chapter_name)
                              }
                              accent={normalizeAccentInput(offer.accent_color)}
                              size={44}
                            />
                          </View>
                        }
                        onPress={() => {
                          handlePickOffer(offer.token);
                        }}
                      />
                    ))}
                  </View>
                ) : null}

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
              </Animated.View>
            ) : view === "invite" ? (
              <Animated.View
                key="invite"
                entering={entering}
                style={styles.stepBody}
              >
                <Text style={styles.title}>{JOIN_INVITE_TITLE}</Text>
                <Text style={styles.subtitle}>
                  Paste the invite link or code your officer sent. Invites work
                  once and expire after 24 hours.
                </Text>

                <OnboardingFieldLabel>Invite</OnboardingFieldLabel>
                <OnboardingTextInput
                  value={token}
                  onChangeText={(value) => {
                    setToken(value);
                    setError(null);
                  }}
                  placeholder="Paste invite or link"
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
                  style={styles.inviteInput}
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <Text style={styles.hintText}>{OAUTH_MEMBERSHIP_HINT}</Text>
              </Animated.View>
            ) : (
              <Animated.View
                key="confirm"
                entering={entering}
                style={styles.stepBody}
              >
                <Text style={styles.title}>
                  {chapter
                    ? confirmTitle(chapter.chapter_name)
                    : JOIN_CONFIRM_TITLE}
                </Text>

                {chapter ? (
                  // One object, so one card: the chapter this invite joins.
                  <View style={styles.inviteCard}>
                    <View style={styles.chapterRow}>
                      {/* The name beside it says who this is, so a screen
                          reader skips the mark. */}
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        <ChapterMarkTile
                          text={
                            chapter.mark_text ??
                            chapterInitials(chapter.chapter_name)
                          }
                          accent={normalizeAccentInput(chapter.accent_color)}
                          size={44}
                        />
                      </View>
                      <View style={styles.chapterText}>
                        <Text style={styles.inviteCardTitle}>
                          {chapter.chapter_name}
                        </Text>
                        <Text style={styles.inviteCardDetail}>
                          {chapter.university}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.cardRule} />
                    {chapter.invited_by ? (
                      <Text style={styles.inviteCardDetail}>
                        Invited by {chapter.invited_by}
                      </Text>
                    ) : null}
                    {chapter.role ? (
                      <Text style={styles.inviteCardDetail}>
                        Joining as {chapter.role}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  // The invite itself, while the preview loads or when it
                  // can't be read.
                  <View style={styles.inviteCard}>
                    <View style={styles.chapterRow}>
                      <View style={styles.chapterText}>
                        <Text style={styles.inviteCardTitle}>
                          Chapter invite
                        </Text>
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
                      {preview.isPending && preview.fetchStatus !== "idle" ? (
                        <ActivityIndicator
                          color={tokens.color.gold.house}
                          accessibilityLabel="Reading the invite"
                        />
                      ) : null}
                    </View>
                  </View>
                )}

                {deadCopy ? (
                  <Text style={styles.errorText}>{deadCopy}</Text>
                ) : null}

                {terms.needed && !deadInvite ? (
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
              </Animated.View>
            )}
          </ScrollView>

          {/*
            The step forward, pinned above the keyboard and the inset, on both
            invite views (#3348 screen rules). Inside the underlay so the
            Account menu hides it from a screen reader too.
          */}
          {view === "choose" ? null : (
            <View style={styles.footer}>
              <OnboardingPrimaryButton
                label={view === "invite" ? "Continue" : "Join chapter"}
                disabled={stepBlocked}
                busy={redeeming}
                onPress={() => {
                  if (view === "invite") handleContinue();
                  else void handleJoin();
                }}
              />
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
              {/*
                The onboarding press (`OnboardingPressable`), lifting a rung
                while held as `ListRow` does. A disabled row dims as a whole;
                it has no fill of its own, so that dims just its label. Sign
                out is on the face of the screen (`SignedInAs`), so the menu
                holds only what is rare and destructive.
              */}
              <OnboardingPressable
                accessibilityRole="button"
                accessibilityHint="Permanently deletes your account. You'll be asked to confirm."
                accessibilityState={{ disabled: submitting, busy: deleting }}
                disabled={submitting}
                onPress={handleDeleteAccount}
                rippleColor={styles.menuRipple.color}
                heldStyle={styles.menuRowPressed}
                disabledStyle={styles.disabled}
                style={styles.menuRow}
              >
                <Text style={styles.menuRowDestructive}>
                  {deleting ? "Deleting account…" : "Delete account"}
                </Text>
              </OnboardingPressable>
            </View>
          </>
        ) : null}
      </KeyboardAvoidingArea>
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
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
      minHeight: tokens.touch.minimum,
      marginTop: tokens.spacing.sm,
    },
    // The question's header: Account alone, where `BackRow` puts it on the
    // other two views, with the row's own bottom margin so nothing under it
    // moves between views.
    headerRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginBottom: tokens.spacing.sm,
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
    // Every view sits at the top, under the header, with the invite and
    // confirm steps' button pinned below (#3348 screen rules).
    stepBody: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH,
      alignSelf: "center",
      gap: tokens.spacing.md,
      paddingTop: tokens.spacing.lg,
    },
    choices: {
      gap: tokens.spacing.md,
    },
    // The Sign out line, in the step column's width under the header.
    accountLine: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH,
      alignSelf: "center",
    },
    inviteCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    chapterRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    chapterText: {
      flex: 1,
      gap: 2,
    },
    cardRule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tint(tokens.color.text.foreground, 0.08),
      marginVertical: tokens.spacing.xs,
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
    // An invite is a token, so it reads in mono, on the shared field.
    inviteInput: {
      fontFamily: MONO_FONT_FAMILY,
    },
    errorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    hintText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textAlign: "center",
    },
    // The Account menu's rows, while a join or a deletion is in flight
    // (`submitting`): each row dims as a whole, to 0.5. A control that cannot
    // respond has to look like it, or a user on a slow delete taps a dead
    // full-strength button and concludes the app has frozen.
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
      // Keeps a row's Android ripple inside the rounded corners.
      overflow: "hidden",
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
    // `ListRow`'s press feedback: the ripple on Android, one rung up the
    // surface ladder on iOS.
    menuRowPressed: {
      backgroundColor: tokens.color.surface.card,
    },
    menuRipple: {
      color: tint(tokens.color.text.foreground, 0.12),
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
