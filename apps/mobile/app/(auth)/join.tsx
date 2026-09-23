import { useEffect, useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useDeleteAccount,
  useLegalAcceptance,
  useRedeemInvite,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { confirmDeleteAccount } from "@/lib/account/delete-account-prompt";
import { useAuthSession } from "@/lib/auth-session";
import {
  consumeRememberedInviteToken,
  extractInviteToken,
  extractInviteTokenFromQuery,
  rememberInviteToken,
} from "@/lib/onboarding/invite-token";
import {
  isTermsRequiredError,
  JOIN_TERMS_REQUIRED_COPY,
  joinErrorCopy,
  redeemChapterId,
} from "@/lib/onboarding/join-errors";
import { useSelectChapter } from "@/lib/select-chapter";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s02 — Join chapter (`spec/ui/mobile/screens.md`).
 *
 * Invite-token entry plus invite-link autofill. Visual language is the `(auth)`
 * card (s01 / chapter picker). Canvas draws six cells for a shared code; joining
 * is single-use invite tokens, so this is one field that also accepts a pasted
 * URL (`spec/behavior/onboarding.md` wins over the drawing for the data model).
 *
 * First-officer creation is a secondary control here (`/create-chapter`) so an
 * account with zero memberships can still start a chapter without leaving s02.
 */
export default function JoinChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, signOut } = useAuthSession();
  const redeemInvite = useRedeemInvite();
  const deleteAccount = useDeleteAccount();
  const legalAcceptance = useLegalAcceptance({
    enabled: status === "authenticated",
  });
  const selectChapter = useSelectChapter();
  const params = useLocalSearchParams<{
    token?: string | string[];
    invite?: string | string[];
    code?: string | string[];
  }>();
  const deepLinkUrl = Linking.useURL();

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // Set when the server refuses the join for want of the checkbox, which can
  // happen if its answer changed after this screen read the status.
  const [termsDemanded, setTermsDemanded] = useState(false);
  // Ask unless the server has said this user already accepted the current
  // Terms (#2302). A status still loading, or one that failed, shows the
  // checkbox: ticking it is harmless for someone who had accepted, and
  // leaving it off would only earn a refusal.
  const termsNeeded =
    termsDemanded || legalAcceptance.data?.required !== false;

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
    const fromLink = extractInviteToken(deepLinkUrl);
    const next = fromParams ?? fromLink ?? consumeRememberedInviteToken();
    if (next) {
      rememberInviteToken(next);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed an empty field from the invite URL; keep text the member already typed
      setToken((current) => (current.length > 0 ? current : next));
    }
  }, [deepLinkUrl, params.code, params.invite, params.token]);

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleSignOut() {
    await signOut();
    // `signOut` drops the query cache itself (`lib/auth-session.tsx`), so every
    // sign-out path gets it without each screen remembering to.
    router.replace("/(auth)/sign-in");
  }

  /**
   * Apple 5.1.1(v): an account that can be created in-app must be deletable
   * in-app. Signet creates the account implicitly on first sign-in, and a user
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

  async function handleJoin() {
    const extracted = extractInviteToken(token);
    if (!extracted) {
      setError("Paste the invite your officer sent, or open the invite link.");
      return;
    }

    if (termsNeeded && !acceptedTerms) {
      setError(JOIN_TERMS_REQUIRED_COPY);
      return;
    }

    setError(null);
    try {
      const result = await redeemInvite.mutateAsync(
        termsNeeded
          ? { token: extracted, accept_terms_privacy: true }
          : { token: extracted },
      );
      consumeRememberedInviteToken();
      const chapterId = redeemChapterId(result);
      if (chapterId) {
        await selectChapter(chapterId);
      }
      router.replace("/welcome");
    } catch (caught) {
      if (isTermsRequiredError(caught)) {
        setTermsDemanded(true);
        setAcceptedTerms(false);
      }
      setError(joinErrorCopy(caught));
    }
  }

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

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/*
        The card scrolls. It stays centred while it fits and scrolls when it
        does not — which it does not on a 375x667 device once the keyboard is
        up: `justifyContent: "center"` lets Yoga overflow *both* ends rather
        than clamping, so the last child is lost first, and that child is the
        delete control this screen exists to guarantee (#2295).
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Join your chapter</Text>
        <Text style={styles.subtitle}>
          Enter the invite your officer sent. Invites expire after 24 hours and
          work once.
        </Text>

        <View style={styles.card}>
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
            textContentType="none"
            accessibilityLabel="Invite token"
            style={styles.input}
          />

          {termsNeeded ? (
            <TermsAcceptance
              accepted={acceptedTerms}
              onAcceptedChange={(next) => {
                setAcceptedTerms(next);
                setError(null);
              }}
              disabled={submitting}
            />
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={() => {
              void handleJoin();
            }}
            style={[
              styles.primaryButton,
              submitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            {redeeming ? (
              <ActivityIndicator color={tokens.color.gold.onHouse} />
            ) : (
              <Text style={styles.primaryButtonText}>Join chapter</Text>
            )}
          </Pressable>

          <View style={styles.linkHint}>
            <Text style={styles.helperText}>
              Got an invite link? Paste it here, or open it and this page fills itself in.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityHint="Open the first-officer chapter creation wizard."
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={() => {
              router.push("/create-chapter");
            }}
            style={styles.secondaryButton}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                submitting ? styles.disabledButtonText : null,
              ]}
            >
              Create a chapter
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={() => {
              void handleSignOut();
            }}
            style={styles.secondaryButton}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                submitting ? styles.disabledButtonText : null,
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
            style={styles.secondaryButton}
          >
            <Text
              style={[
                styles.destructiveButtonText,
                submitting ? styles.disabledButtonText : null,
              ]}
            >
              {deleting ? "Deleting account…" : "Delete account"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
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
    linkHint: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    },
    helperText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
    // Same hue `ListRow` gives a destructive row in Settings
    // (`components/list-section.tsx`), so the delete control reads the same
    // way on both screens that offer it.
    destructiveButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.destructive,
    },
    // Mirrors `ListRow`'s disabled treatment: a control that cannot respond has
    // to look like it, or a user on a slow delete taps a dead full-strength
    // button and concludes the app has frozen.
    disabledButtonText: {
      opacity: 0.5,
    },
  });
}
