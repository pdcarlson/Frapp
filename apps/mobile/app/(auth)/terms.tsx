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
import {
  termsPromptErrorCopy,
  useAcceptLegalTerms,
  useDeleteAccount,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { TERMS_PROMPT_COPY } from "@repo/validation";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { confirmDeleteAccount } from "@/lib/account/delete-account-prompt";
import { useAuthSession } from "@/lib/auth-session";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The Terms prompt (#2302): a member who hasn't accepted the Terms version the
 * server enforces lands here before anything else, first-run included.
 * `resolveAuthGate` returns `"terms"`, `useOnboardingRedirect` walks the member
 * out of the tabs, and this group's layout pins them here. Accepting updates
 * the cached status, so the gate moves on by itself: no navigation here.
 *
 * It offers Sign out and Delete account for the same reason the join screen
 * does (#2295, Apple 5.1.1(v)): while the gate pins a member here, Settings is
 * unreachable, and declining the Terms must not leave an account they can't
 * delete from the app.
 */
export default function TermsPrompt() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, signOut } = useAuthSession();
  const acceptTerms = useAcceptLegalTerms();
  const deleteAccount = useDeleteAccount();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/sign-in");
  }

  function handleDeleteAccount() {
    confirmDeleteAccount({
      deleteAccount,
      onDeleted: () => {
        void handleSignOut();
      },
    });
  }

  async function handleAccept() {
    if (!accepted) {
      setError(TERMS_PROMPT_COPY.unticked);
      return;
    }
    setError(null);
    try {
      await acceptTerms.mutateAsync();
    } catch (caught) {
      setError(termsPromptErrorCopy(caught));
    }
  }

  // Same locking as the join screen, for the same reasons: a deletion
  // navigates away when it finishes, and `isSuccess` covers the window
  // between the network call and that navigation.
  const deleting = deleteAccount.isPending || deleteAccount.isSuccess;
  // `isSuccess` on accept too: the gate moves the member on once the cache
  // updates, and the button must not re-enable in between.
  const submitting =
    acceptTerms.isPending || acceptTerms.isSuccess || deleting;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>{TERMS_PROMPT_COPY.title}</Text>
      <Text style={styles.subtitle}>{TERMS_PROMPT_COPY.body}</Text>

      <View style={styles.card}>
        <TermsAcceptance
          accepted={accepted}
          onAcceptedChange={(next) => {
            setAccepted(next);
            setError(null);
          }}
          disabled={submitting}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          onPress={() => {
            void handleAccept();
          }}
          style={[
            styles.primaryButton,
            submitting ? styles.primaryButtonDisabled : null,
          ]}
        >
          {acceptTerms.isPending ? (
            <ActivityIndicator color={tokens.color.gold.onHouse} />
          ) : (
            <Text style={styles.primaryButtonText}>
              {TERMS_PROMPT_COPY.cta}
            </Text>
          )}
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
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // On the scroll view as well as its content, as on the join screen: an
    // iOS overscroll bounce otherwise shows react-navigation's light default.
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
    secondaryButton: {
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    destructiveButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.destructive,
    },
    disabledButtonText: {
      opacity: 0.5,
    },
  });
}
