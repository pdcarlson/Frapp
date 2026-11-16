import { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SignetTokens } from "@repo/theme/signet";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { useAuthSession } from "@/lib/auth-session";
import { consumeRememberedInviteToken } from "@/lib/onboarding/invite-token";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The one way an account with no chapter signs out of onboarding: forget any
 * remembered invite (it was this account's, not the next one's), sign out, and
 * land on sign-in. s02 (its Sign out line and the sign-out after Delete
 * account), chapter setup and the chapter picker all run it, so they can't
 * drift.
 *
 * `signingOut` is true for the whole round trip. The screen folds it into
 * whatever locks its controls, so a Join, a Create or a Delete can't start
 * under a session that is going away. A second call while one runs does
 * nothing.
 */
export function useOnboardingSignOut(): {
  signOut: () => Promise<void>;
  signingOut: boolean;
} {
  const router = useRouter();
  const { signOut: endSession } = useAuthSession();
  const [signingOut, setSigningOut] = useState(false);
  // A ref as well as the state: two taps in one frame both read the state
  // before it re-renders.
  const running = useRef(false);
  const signOut = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSigningOut(true);
    try {
      consumeRememberedInviteToken();
      await endSession();
      // `signOut` drops the query cache itself (`lib/auth-session.tsx`), so
      // every sign-out path gets it without each screen remembering to.
      router.replace("/(auth)/sign-in");
    } finally {
      running.current = false;
      setSigningOut(false);
    }
  }, [endSession, router]);
  return { signOut, signingOut };
}

/**
 * "Signed in as <email> · Sign out", on the face of every view of s02 and
 * every step of chapter setup (#3782), as web's `/join` and setup wizard show
 * it (#3776). Without it, someone signed in with the wrong account (a fresh
 * Apple account, say) had to find Sign out inside s02's Account menu, and
 * setup had none at all.
 *
 * The line says only `Signed in` when the session has no email. The screen
 * owns the sign-out (`useOnboardingSignOut`) and passes it in, so the rest of
 * the screen can lock while it runs. `disabled` holds Sign out while the
 * screen has a join, a deletion or a chapter create in flight.
 */
export function SignedInAs({
  signOut,
  signingOut,
  disabled = false,
}: {
  signOut: () => Promise<void>;
  signingOut: boolean;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { email } = useAuthSession();
  const blocked = disabled || signingOut;

  return (
    <View style={styles.row}>
      {/*
        One element for a screen reader ("Signed in as …"), drawn as two
        texts so a long address truncates on its own and the label stays.
      */}
      <View
        accessible
        accessibilityLabel={email ? `Signed in as ${email}` : "Signed in"}
        style={styles.account}
      >
        <Text style={styles.accountText}>
          {email ? "Signed in as" : "Signed in"}
        </Text>
        {email ? (
          <Text style={styles.email} numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
      <Text
        style={styles.separator}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        ·
      </Text>
      <OnboardingPressable
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked, busy: signingOut }}
        disabled={blocked}
        hitSlop={8}
        onPress={() => {
          if (!blocked) void signOut();
        }}
        quiet
        style={[styles.signOut, blocked ? styles.disabled : null]}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </OnboardingPressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
    },
    // Takes what the row has left, and the address truncates inside it, so
    // Sign out never wraps off the line.
    account: {
      flexShrink: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    accountText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    email: {
      flexShrink: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    separator: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    signOut: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    signOutText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
    },
    // A quiet line takes no dim of its own (`OnboardingPressable`), and this
    // one sits beside nothing that shows the wait, so it greys itself.
    disabled: {
      opacity: 0.5,
    },
  });
}
