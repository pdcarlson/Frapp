import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RecordInviteStep } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { EmailCodeSignIn } from "@/components/onboarding/email-code-sign-in";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import {
  describeOAuthKickoffError,
  signInProviderLayout,
  type OAuthProvider,
} from "@/lib/auth-providers";
import { useAuthSession } from "@/lib/auth-session";
import { typeRole, useFrappTheme } from "@/lib/theme";

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  apple: "Continue with Apple",
  google: "Continue with Google",
};

/**
 * The invite card's way in on the phone (#5625), the same three as web's
 * (`apps/web/components/join/join-sign-in.tsx`): Continue with Apple, Google
 * or email, and that one tap is both the sign-in and the join. `onStart`
 * remembers what the member came to do before the sign-in leaves the screen,
 * so the card carries on with it when they come back signed in.
 *
 * Apple first on iOS, as sign-in has it (Guideline 4.8). Off iOS Apple is
 * only a browser page, so it stays on sign-in (`PasswordSignInLine`), as
 * sign-in tucks it there (`signInProviderLayout`).
 */
export function JoinSignIn({
  onStart,
  record,
  disabled = false,
}: {
  onStart: () => void;
  /** The card's funnel (#5663): which way in, the code sent and verified. */
  record?: RecordInviteStep;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { signInWithOAuthProvider } = useAuthSession();
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const layout = signInProviderLayout(Platform.OS);
  const providers = [layout.primary, layout.secondary].filter(
    (provider): provider is OAuthProvider => provider !== null,
  );

  async function start(provider: OAuthProvider) {
    if (pending) return;
    setPending(provider);
    setError(null);
    onStart();
    record?.({ step: "sign-in-started", method: provider });
    try {
      await signInWithOAuthProvider(provider);
      // Signed in, or the member closed the provider's page: either way the
      // session decides what the card shows next.
    } catch (caught) {
      // Already reported by `signInWithOAuthProvider` (#3832).
      setError(describeOAuthKickoffError(caught));
    } finally {
      setPending(null);
    }
  }

  if (emailOpen) {
    return (
      <EmailCodeSignIn
        onSending={onStart}
        onCodeSent={() => record?.({ step: "email-code-sent" })}
        onCodeVerified={() => record?.({ step: "email-code-verified" })}
        onBack={() => setEmailOpen(false)}
        disabled={disabled}
      />
    );
  }

  return (
    <View style={styles.column}>
      {providers.map((provider) => (
        <OnboardingSecondaryButton
          key={provider}
          label={
            pending === provider ? "Signing in…" : PROVIDER_LABEL[provider]
          }
          leading={
            pending === provider ? (
              <ActivityIndicator
                color={tokens.color.text.foreground}
                size="small"
              />
            ) : provider === "apple" ? (
              <AppleMark color={tokens.color.text.foreground} />
            ) : (
              <GoogleMark />
            )
          }
          disabled={disabled || pending !== null}
          onPress={() => void start(provider)}
        />
      ))}
      <OnboardingPressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || pending !== null }}
        disabled={disabled || pending !== null}
        onPress={() => {
          setError(null);
          record?.({ step: "sign-in-started", method: "email" });
          setEmailOpen(true);
        }}
        quiet
        style={styles.emailLine}
      >
        <Text style={styles.emailText}>Continue with email</Text>
      </OnboardingPressable>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** The card's footer for an account that signs in with a password, as web's. */
export function PasswordSignInLine({
  onPress,
  disabled = false,
}: {
  onPress: () => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityLabel="Have a password? Sign in"
      accessibilityHint="Opens sign-in."
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      quiet
      style={styles.passwordLine}
    >
      <Text style={styles.passwordPrompt}>
        Have a password? <Text style={styles.passwordAction}>Sign in</Text>
      </Text>
    </OnboardingPressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    column: {
      gap: tokens.spacing.md,
    },
    emailLine: {
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    emailText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    passwordLine: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    passwordPrompt: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    passwordAction: {
      color: tokens.color.gold.house,
    },
  });
}
