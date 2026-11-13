import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

export const NEW_ACCOUNT_TITLE = "New account created";
export const NEW_ACCOUNT_CONTINUE = "Continue with the new account";

/** Web `/new-account`'s line (`spec/ui/design-system/writing.md` § New account). */
export function newAccountDescription(email: string | null): string {
  const lead = email
    ? `This is a new Frapp account for ${email}.`
    : "This is a new Frapp account.";
  return `${lead} Already a member? Sign out and use the method you joined with.`;
}

/**
 * The phone's "New account created" (#4769), web `/new-account`'s card at the
 * top of s02. A sign-in that just made a new, chapterless account (a first
 * Google or Apple sign-in, or the magic link to an address that had no
 * account) lands on s02 like anyone with no chapter, so this says so before
 * the screen asks how they're getting in. Someone who meant their existing
 * account is one tap from signing out; someone who is new carries on.
 *
 * `inviteFirst` leads with Continue when an invite link opened s02, as web
 * does when `next` is an invite: someone opening an invite on a new account is
 * most likely new. Otherwise Sign out leads.
 */
export function NewAccountNotice({
  email,
  inviteFirst,
  signOut,
  signingOut,
  disabled = false,
  onContinue,
}: {
  email: string | null;
  inviteFirst: boolean;
  signOut: () => Promise<void>;
  signingOut: boolean;
  disabled?: boolean;
  onContinue: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const blocked = disabled || signingOut;

  const signOutButton = inviteFirst ? (
    <QuietAction
      key="sign-out"
      label="Sign out"
      disabled={blocked}
      busy={signingOut}
      onPress={() => void signOut()}
      styles={styles}
    />
  ) : (
    <OnboardingSecondaryButton
      key="sign-out"
      label="Sign out"
      fill
      busy={signingOut}
      disabled={blocked}
      onPress={() => void signOut()}
    />
  );
  const continueButton = inviteFirst ? (
    <OnboardingSecondaryButton
      key="continue"
      label={NEW_ACCOUNT_CONTINUE}
      fill
      disabled={blocked}
      onPress={onContinue}
    />
  ) : (
    <QuietAction
      key="continue"
      label={NEW_ACCOUNT_CONTINUE}
      disabled={blocked}
      onPress={onContinue}
      styles={styles}
    />
  );

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {NEW_ACCOUNT_TITLE}
      </Text>
      <Text style={styles.body}>{newAccountDescription(email)}</Text>
      <View style={styles.actions}>
        {inviteFirst
          ? [continueButton, signOutButton]
          : [signOutButton, continueButton]}
      </View>
    </View>
  );
}

function QuietAction({
  label,
  onPress,
  disabled,
  busy = false,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  busy?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        if (!disabled) onPress();
      }}
      quiet
      style={[styles.quiet, disabled ? styles.disabled : null]}
    >
      <Text style={styles.quietText}>{label}</Text>
    </OnboardingPressable>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    // The same card s02's confirm step draws its invite on.
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    actions: {
      marginTop: tokens.spacing.sm,
      gap: tokens.spacing.xs,
      alignItems: "stretch",
    },
    quiet: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    quietText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
