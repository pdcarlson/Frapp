import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  cooldownCopy,
  describeEmailSendError,
  describeEmailCodeError,
  EMAIL_CODE_COPY,
  EMAIL_CODE_LENGTH,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  emailCooldownSeconds,
} from "@repo/hooks/auth-error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  OnboardingFieldLabel,
  OnboardingTextInput,
} from "@/components/onboarding/onboarding-field";
import { OnboardingPrimaryButton } from "@/components/onboarding/onboarding-primary-button";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { useAuthSession } from "@/lib/auth-session";
import {
  fieldTypeRole,
  MONO_FONT_FAMILY,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";

/**
 * Continue with email on the invite card (#5625), the phone's twin of web's
 * (`apps/web/components/join/email-code-sign-in.tsx`): one address, then the
 * six-digit code from the email typed right here, so nobody leaves the app
 * for Mail and back (Slack's and Notion's sign-in work the same way). The
 * same email still carries the sign-in link, which opens the app: the code
 * needs the Auth email template to print `{{ .Token }}`, and until it does,
 * the link is the way in. A new address works too: Auth makes the account on
 * the first code.
 *
 * `onSending` runs before the email goes, so the card can remember what the
 * member came to do should the link bring them back instead.
 */
export function EmailCodeSignIn({
  onSending,
  onBack,
  disabled = false,
}: {
  onSending: () => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { sendMagicLink, verifyEmailCode } = useAuthSession();
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<TextInput>(null);
  const lastTried = useRef<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function send() {
    if (sending) return;
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(EMAIL_CODE_COPY.invalidEmail);
      return;
    }
    setSending(true);
    setError(null);
    onSending();
    try {
      await sendMagicLink({ email: address });
      setStage("code");
      setCooldown(EMAIL_RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      const wait = emailCooldownSeconds(caught);
      if (wait !== undefined) {
        // One went out under a minute ago; its code still works.
        setStage("code");
        setCooldown(Math.max(1, wait));
        setError(cooldownCopy(wait));
        return;
      }
      setError(describeEmailSendError(caught));
    } finally {
      setSending(false);
    }
  }

  async function verify(value: string) {
    if (verifying || value.length < EMAIL_CODE_LENGTH) return;
    lastTried.current = value;
    setVerifying(true);
    setError(null);
    try {
      await verifyEmailCode({ email: email.trim().toLowerCase(), code: value });
      // Signed in: the session change carries the card on from here.
    } catch (caught) {
      const { message, wrongCode } = describeEmailCodeError(caught);
      setError(message);
      if (wrongCode) setCode("");
      // Not the code's fault: keep it, and let the same code go again.
      else lastTried.current = null;
      codeRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  }

  if (stage === "email") {
    return (
      <View style={styles.column}>
        <View style={styles.field}>
          <OnboardingFieldLabel>Email</OnboardingFieldLabel>
          <OnboardingTextInput
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setError(null);
            }}
            placeholder="you@university.edu"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            autoFocus
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => void send()}
            editable={!disabled && !sending}
            accessibilityLabel="Email"
          />
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <OnboardingPrimaryButton
          label={EMAIL_CODE_COPY.sendLabel}
          busy={sending}
          disabled={disabled || sending}
          onPress={() => void send()}
        />
        <OnboardingPressable
          accessibilityRole="button"
          disabled={sending}
          onPress={onBack}
          quiet
          style={styles.quietLine}
        >
          <Text style={styles.quietText}>Back</Text>
        </OnboardingPressable>
      </View>
    );
  }

  return (
    <View style={styles.column}>
      <View>
        <Text accessibilityRole="header" style={styles.sentTitle}>
          {EMAIL_CODE_COPY.sentTitle}
        </Text>
        <Text style={styles.sentBody}>
          {EMAIL_CODE_COPY.sent(email.trim().toLowerCase())}
        </Text>
      </View>
      <OnboardingTextInput
        ref={codeRef}
        value={code}
        onChangeText={(value) => {
          const digits = value.replace(/\D/g, "");
          setCode(digits);
          setError(null);
          // Six digits typed or pasted is the answer; send it at once, but
          // never the same wrong code twice.
          if (
            digits.length === EMAIL_CODE_LENGTH &&
            digits !== lastTried.current
          ) {
            void verify(digits);
          }
        }}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={10}
        editable={!disabled && !verifying}
        accessibilityLabel={`${EMAIL_CODE_LENGTH}-digit code`}
        // A machine value read character by character, in mono.
        style={styles.codeInput}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <OnboardingPrimaryButton
        label="Continue"
        busy={verifying}
        disabled={disabled || verifying || code.length < EMAIL_CODE_LENGTH}
        onPress={() => void verify(code)}
      />
      <View style={styles.codeActions}>
        <OnboardingPressable
          accessibilityRole="button"
          disabled={verifying}
          onPress={() => {
            setStage("email");
            setCode("");
            setError(null);
            lastTried.current = null;
          }}
          quiet
          style={styles.quietLine}
        >
          <Text style={styles.quietGold}>{EMAIL_CODE_COPY.differentEmail}</Text>
        </OnboardingPressable>
        <OnboardingPressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: verifying || sending || cooldown > 0,
          }}
          disabled={verifying || sending || cooldown > 0}
          onPress={() => void send()}
          quiet
          style={styles.quietLine}
        >
          <Text style={cooldown > 0 ? styles.quietText : styles.quietGold}>
            {cooldown > 0
              ? EMAIL_CODE_COPY.sendAgainIn(cooldown)
              : EMAIL_CODE_COPY.sendAgain}
          </Text>
        </OnboardingPressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    column: {
      gap: tokens.spacing.md,
    },
    field: {
      gap: tokens.spacing.sm,
    },
    sentTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    sentBody: {
      marginTop: tokens.spacing.xs,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    codeInput: {
      minHeight: 56,
      ...fieldTypeRole(tokens.typography.role.title),
      fontFamily: MONO_FONT_FAMILY,
      letterSpacing: 8,
      textAlign: "center",
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    codeActions: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
    },
    quietLine: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    quietText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    quietGold: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
    },
  });
}
