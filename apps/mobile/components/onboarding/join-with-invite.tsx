import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { codeOf, statusOf } from "@repo/api-sdk";
import {
  askForNewLinkCopy,
  deadInviteCopy,
  joinErrorCopy,
  joinRedeemBody,
  redeemChapterId,
  UNKNOWN_INVITE_COPY,
  useAskForNewLink,
  useInviteCardViewed,
  useInviteDetails,
  useInviteFunnel,
  useListChapters,
  useRedeemInvite,
  type InviteDetails,
} from "@repo/hooks";
import { inviteJoinFailureReason } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  DeadInviteHero,
  InviteHero,
  InviteHeroSkeleton,
} from "@/components/onboarding/invite-hero";
import {
  JoinSignIn,
  PasswordSignInLine,
} from "@/components/onboarding/join-sign-in";
import {
  InvitePasteButton,
  useInvitePaste,
} from "@/components/onboarding/invite-paste";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { TermsLine } from "@/components/onboarding/terms-line";
import { ErrorState } from "@/components/state-block";
import { useAuthSession } from "@/lib/auth-session";
import { useConnection } from "@/lib/connection/use-connection";
import { successHaptic } from "@/lib/haptics";
import {
  clearRememberedInviteThen,
  consumeRememberedInviteToken,
  peekRememberedInviteThen,
  peekRememberedInviteToken,
  rememberInviteToken,
  type JoinThen,
} from "@/lib/onboarding/invite-token";
import { inviteVisitId } from "@/lib/onboarding/invite-visit";
import { stepFadeIn } from "@/lib/onboarding/step-fade";
import { useSelectChapter } from "@/lib/select-chapter";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The phone's invite screen (#5625, epic #5624): the chapter card first,
 * before any account, and one tap that is sign-in and join together. Web
 * `/join` shows the same screen (`apps/web/components/join/join-with-invite.tsx`),
 * state for state and word for word, so the two never feel like two systems.
 *
 * - **Signed out, live link.** The card, Continue with Apple, Google or email,
 *   and the Terms line. Each way in remembers the invite marked `join`
 *   (`rememberInviteToken`), and that mark is what joins: only a sign-in
 *   started from this card joins on its own, and it survives the sign-in
 *   leaving the app.
 * - **Signed in.** The card and one Join, pinned in thumb reach. Someone
 *   already in the chapter is told so and offered it instead.
 * - **Dead link** (expired, used, turned off). The card still names the
 *   chapter and its sender, and "Ask Paul for a new link" notifies them by
 *   name. Asking needs an account, so the sender knows who; signed out, the
 *   button opens the ways in, marked `ask`.
 * - **Not an invite** (404). Says so, and Paste takes another link, as the
 *   join question's does (#5626). Signed out, "Have a password? Sign in", as
 *   on web, forgets this one and goes back to sign-in, which would otherwise
 *   send the remembered invite straight back here.
 *
 * Each step is recorded in the invite card funnel (#5663, `useInviteFunnel`),
 * the same steps web records: the card viewed, the way in tapped, the email
 * code sent and verified, the join or a failed one, and an ask for a new
 * link.
 *
 * `header` and `accountLine` are the join screen's own chrome (Back, the
 * Account menu, "Signed in as"), drawn above the card.
 */
export function JoinWithInvite({
  token,
  then: initialThen,
  header,
  accountLine,
  onBusyChange,
  onOtherInvite,
  onLeave,
}: {
  token: string;
  /** What a sign-in from the card came back to do, read when it mounted. */
  then: JoinThen | null;
  header?: ReactNode;
  accountLine?: ReactNode;
  onBusyChange?: (busy: boolean) => void;
  /** Another link pasted on the not-an-invite screen. */
  onOtherInvite: (token: string) => void;
  /** Off the not-an-invite screen while signed out, back to sign-in. */
  onLeave: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status } = useAuthSession();
  const selectChapter = useSelectChapter();
  const redeem = useRedeemInvite();
  const ask = useAskForNewLink();
  const details = useInviteDetails(token);
  const paste = useInvitePaste(onOtherInvite);
  const { isOffline } = useConnection();
  const [visitId] = useState(() => inviteVisitId(token));
  const record = useInviteFunnel(token, visitId);

  const signedIn = status === "authenticated";
  const chapters = useListChapters({ enabled: signedIn });
  const memberships = Array.isArray(chapters.data) ? chapters.data : [];
  const invite = details.data;
  const alreadyIn =
    signedIn &&
    !!invite &&
    memberships.some((m) => m.chapter_id === invite.chapter_id);

  useInviteCardViewed(
    record,
    invite && status !== "hydrating"
      ? { state: invite.state, signed_in: signedIn }
      : null,
  );

  // A sign-in started here, whose session hasn't reached this screen yet.
  const [localThen, setLocalThen] = useState<JoinThen | null>(null);
  const then = localThen ?? initialThen;
  // Held for the whole join, through `selectChapter` and the navigation, so a
  // second tap can't redeem twice. Starts held when the sign-in came back to
  // join, so Join never shows before it presses itself.
  const [busy, setBusy] = useState(() => initialThen === "join");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const acted = useRef(false);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const openChapter = useCallback(
    async (chapterId: string) => {
      setBusy(true);
      consumeRememberedInviteToken();
      await selectChapter(chapterId);
      router.replace("/");
    },
    [router, selectChapter],
  );

  // A second tap can land before the button disables.
  const joining = useRef(false);
  const join = useCallback(
    async (card: InviteDetails) => {
      if (joining.current) return;
      joining.current = true;
      setBusy(true);
      setJoinError(null);
      try {
        const result = await redeem.mutateAsync(joinRedeemBody(token));
        record({ step: "joined" });
        consumeRememberedInviteToken();
        // The member is in: the one tap a chapter going live gives, so joining
        // one feels like it landed (`lib/haptics.ts`, best effort).
        successHaptic();
        await selectChapter(redeemChapterId(result) ?? card.chapter_id);
        router.replace("/welcome");
      } catch (error) {
        // Already in, from an earlier visit or the web: open it.
        if (statusOf(error) === 409) {
          await openChapter(card.chapter_id);
          return;
        }
        joining.current = false;
        record({
          step: "join-failed",
          reason: inviteJoinFailureReason(statusOf(error), isOffline),
        });
        setJoinError(joinErrorCopy(error));
        setBusy(false);
        // A link that died since the card was read gets the dead card.
        if (statusOf(error) === 410) void details.refetch();
      }
    },
    [
      details,
      isOffline,
      openChapter,
      record,
      redeem,
      router,
      selectChapter,
      token,
    ],
  );

  const askForLink = useCallback(async () => {
    setAskError(null);
    try {
      await ask.mutateAsync(token);
      record({ step: "new-link-asked" });
      setAsked(true);
    } catch (error) {
      const code = codeOf(error);
      if (code === "invite.still_live") return; // the card refetches as live
      if (code === "invite.already_member") {
        void chapters.refetch();
        return;
      }
      setAskError("Couldn't send that. Try again in a moment.");
    }
  }, [ask, chapters, record, token]);

  // What a sign-in from the card came back to do, done once. The mark comes
  // off the remembered invite first, so a relaunch never repeats it.
  useEffect(() => {
    if (acted.current || then === null) return;
    // A link that can't be read has nothing to carry on with: let go of the
    // hold, so the screen's account line stays usable.
    if (details.isError) {
      acted.current = true;
      clearRememberedInviteThen();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect acts once on what a sign-in came back to do; each branch starts or releases the screen's hold
      setBusy(false);
      return;
    }
    if (!signedIn || !invite || chapters.isLoading) return;
    acted.current = true;
    // The mark is taken, not just read: if this card was left mounted under
    // another one after the sign-in, only the first to act joins, and the
    // other stands down instead of redeeming the same invite twice.
    // A card for another invite, left mounted under this one, neither acts
    // nor takes this invite's mark.
    const stillMarked =
      peekRememberedInviteToken() === token &&
      peekRememberedInviteThen() === then;
    if (stillMarked) clearRememberedInviteThen();
    if (!stillMarked) {
      setBusy(false);
    } else if (alreadyIn) {
      void openChapter(invite.chapter_id);
    } else if (then === "join" && invite.state === "live") {
      void join(invite);
    } else {
      setBusy(false);
      if (then === "ask" && invite.state !== "live") void askForLink();
    }
  }, [
    alreadyIn,
    askForLink,
    chapters.isLoading,
    details.isError,
    invite,
    join,
    openChapter,
    signedIn,
    then,
    token,
  ]);

  // A sign-in from here that the member abandoned leaves them signed out;
  // nothing is held for it.
  const startSignIn = useCallback(
    (next: JoinThen) => {
      rememberInviteToken(token, next);
      setLocalThen(next);
    },
    [token],
  );

  const passwordSignIn = () => {
    startSignIn("join");
    record({ step: "sign-in-started", method: "password" });
    // Marked, so sign-in doesn't send a remembered invite back to this card.
    router.push({ pathname: "/sign-in", params: { password: "1" } });
  };

  const entering = stepFadeIn(tokens);
  let body: ReactNode;
  let footer: ReactNode = null;

  if (details.isLoading || status === "hydrating") {
    body = <InviteHeroSkeleton />;
  } else if (details.isError) {
    body =
      statusOf(details.error) === 404 ? (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            {UNKNOWN_INVITE_COPY.title}
          </Text>
          <Text
            style={paste.message ? styles.bodyError : styles.body}
            accessibilityLiveRegion="polite"
          >
            {paste.message ?? UNKNOWN_INVITE_COPY.body}
          </Text>
        </>
      ) : (
        <ErrorState
          title="Couldn't open your invite"
          body="Frapp couldn't be reached. Try again in a moment."
          onRetry={() => void details.refetch()}
          isRetrying={details.isFetching}
        />
      );
    if (statusOf(details.error) === 404) {
      footer = (
        <>
          <InvitePasteButton onText={paste.onText} size="large" />
          {signedIn ? null : <PasswordSignInLine onPress={onLeave} />}
        </>
      );
    }
  } else if (!invite) {
    body = <InviteHeroSkeleton />;
  } else if (alreadyIn && !busy) {
    // ── Already in this chapter ─────────────────────────────────────────────
    body = <InviteHero details={invite} eyebrow="You're already in" />;
    footer = (
      <OnboardingPrimaryButton
        label="Open chat"
        onPress={() => void openChapter(invite.chapter_id)}
      />
    );
  } else if (invite.state !== "live") {
    // ── A dead link ─────────────────────────────────────────────────────────
    const copy = deadInviteCopy(invite);
    const askCopy = askForNewLinkCopy(invite);
    body = (
      <>
        <DeadInviteHero details={invite} title={copy.title} sent={copy.sent} />
        <Text style={styles.body}>{copy.body}</Text>
        {asked ? (
          <View accessibilityRole="alert" style={styles.askedNote}>
            <Text style={styles.askedText}>{askCopy.sent}</Text>
          </View>
        ) : !signedIn && askOpen ? (
          <View style={styles.signInBlock}>
            <Text style={styles.askPrompt}>{askCopy.signedOutHint}</Text>
            <JoinSignIn onStart={() => startSignIn("ask")} record={record} />
            <TermsLine action="continuing" />
          </View>
        ) : null}
      </>
    );
    if (!asked && (signedIn || !askOpen)) {
      footer = (
        <>
          {askError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {askError}
            </Text>
          ) : null}
          <OnboardingPrimaryButton
            label={copy.ask}
            busy={ask.isPending}
            disabled={ask.isPending}
            onPress={() => {
              if (signedIn) void askForLink();
              else setAskOpen(true);
            }}
          />
          <Text style={styles.hint}>{askCopy.hint}</Text>
        </>
      );
    }
  } else if (!signedIn) {
    // ── A live link, signed out: one tap signs in and joins ─────────────────
    body = (
      <>
        <InviteHero details={invite} />
        <View style={styles.signInBlock}>
          <JoinSignIn onStart={() => startSignIn("join")} record={record} />
          <TermsLine action="continuing" />
          <PasswordSignInLine onPress={passwordSignIn} />
        </View>
      </>
    );
  } else {
    // ── A live link, signed in: one Join ───────────────────────────────────
    body = <InviteHero details={invite} />;
    footer = (
      <>
        {joinError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {joinError}
          </Text>
        ) : null}
        <OnboardingPrimaryButton
          label={busy ? `Joining ${invite.chapter_name}…` : "Join chapter"}
          busy={busy}
          disabled={busy}
          onPress={() => void join(invite)}
        />
        <TermsLine action="joining" />
      </>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {header}
        {accountLine ? <View style={styles.column}>{accountLine}</View> : null}
        <Animated.View entering={entering} style={styles.stepBody}>
          {body}
        </Animated.View>
      </ScrollView>
      {/*
        The step forward, pinned above the inset in thumb reach (#3348 screen
        rules), with the Terms line under the button it covers.
      */}
      {footer ? (
        <View style={styles.footer}>
          <View style={styles.footerColumn}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
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
    column: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH,
      alignSelf: "center",
    },
    stepBody: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH,
      alignSelf: "center",
      gap: tokens.spacing.lg,
      paddingTop: tokens.spacing.lg,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    // What a paste found, in the body's slot and size, so nothing moves.
    bodyError: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.semantic.destructive,
    },
    signInBlock: {
      marginTop: tokens.spacing.md,
      gap: tokens.spacing.md,
    },
    askPrompt: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    askedNote: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.success, 0.3),
      backgroundColor: tint(tokens.color.semantic.success, 0.13),
      padding: tokens.spacing.lg,
    },
    askedText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    footer: {
      paddingHorizontal: tokens.spacing.xl,
      paddingVertical: tokens.spacing.lg,
    },
    footerColumn: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH,
      alignSelf: "center",
      gap: tokens.spacing.md,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
  });
}
