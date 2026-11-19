import { useCallback, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { INVITE_PASTE_COPY, pastedInviteToken } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { PasteGlyph } from "@/components/control-glyphs";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Paste, the phone's half of the install hand-off (#5626, epic #5624).
 *
 * Web `/join` on a phone copies the invite link as the member taps Get Frapp
 * (`apps/web/components/auth/app-handoff.tsx`), because iOS can't hand a link
 * to an app that wasn't installed when it was tapped. The app's first screens
 * then offer Paste: sign-in's "Joining a chapter?" strip, and the join
 * question for an account with no chapter yet. One tap opens the invite card.
 *
 * On iOS 16 and later it is the system Paste button (`UIPasteControl` through
 * `expo-clipboard`), which reads the clipboard with no "Allow Paste" prompt and
 * no "pasted from Safari" banner. Elsewhere (Android, older iOS, the web build)
 * it is Frapp's own gold button, which reads the clipboard on the tap; Android
 * 13 shows its own small "pasted" note then, which is the member's own doing.
 * Nothing here reads the clipboard without a tap.
 */

/** iOS 16 and later: the system button, where it exists in this build. */
const SYSTEM_PASTE = Platform.OS === "ios" && Clipboard.isPasteButtonAvailable;

/**
 * What a paste says back, and what it opens. `message` is null until a paste
 * finds no invite; the screen shows it in place of its lede, so nothing moves.
 */
export function useInvitePaste(onInvite: (token: string) => void): {
  message: string | null;
  onText: (text: string | null) => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const onText = useCallback(
    (text: string | null) => {
      const token = pastedInviteToken(text);
      if (token) {
        setMessage(null);
        onInvite(token);
        return;
      }
      setMessage(
        text === null || text.trim().length === 0
          ? INVITE_PASTE_COPY.empty
          : INVITE_PASTE_COPY.notInvite,
      );
    },
    [onInvite],
  );
  return { message, onText };
}

/**
 * The Paste button. `large` is a screen's one step forward, full width and
 * pinned (the #3348 screen rules); `compact` sits at the end of a row, as on
 * sign-in's strip. House gold either way: nothing before a chapter takes a
 * chapter's color.
 */
export function InvitePasteButton({
  onText,
  size,
  disabled = false,
}: {
  onText: (text: string | null) => void;
  size: "large" | "compact";
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  if (SYSTEM_PASTE) {
    // Apple fixes the word and the mark; Frapp picks the fill, ink and
    // corner. It can't be disabled itself, so a wait holds it from outside.
    return (
      <View
        pointerEvents={disabled ? "none" : "auto"}
        style={[
          size === "large" ? styles.systemLarge : styles.systemCompact,
          disabled ? styles.disabled : null,
        ]}
        testID="invite-paste-system"
      >
        <Clipboard.ClipboardPasteButton
          acceptedContentTypes={["plain-text", "url"]}
          backgroundColor={tokens.color.gold.house}
          foregroundColor={tokens.color.gold.onHouse}
          cornerStyle="large"
          displayMode="iconAndLabel"
          style={styles.fill}
          onPress={(data) => {
            onText(data.type === "text" ? data.text : null);
          }}
        />
      </View>
    );
  }

  async function readAndPaste() {
    let text: string | null = null;
    try {
      text = await Clipboard.getStringAsync();
    } catch {
      text = null;
    }
    onText(text);
  }

  if (size === "large") {
    return (
      <OnboardingPrimaryButton
        label="Paste"
        icon={(color) => <PasteGlyph color={color} />}
        disabled={disabled}
        onPress={() => void readAndPaste()}
      />
    );
  }
  return (
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityLabel="Paste"
      accessibilityHint="Opens the invite link you copied."
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => void readAndPaste()}
      rippleColor={tint(tokens.color.gold.onHouse, 0.16)}
      style={styles.compact}
    >
      <PasteGlyph color={tokens.color.gold.onHouse} size={16} />
      <Text style={styles.compactLabel}>Paste</Text>
    </OnboardingPressable>
  );
}

/**
 * Sign-in's "Joining a chapter?" strip (#5626): the first screen a freshly
 * installed app opens to, so the invite Get Frapp copied is one tap away
 * before any account. A paste remembers the invite (`onInvite`), and sign-in
 * then opens its card, which signs in and joins in one tap (#5625). A member
 * signing back in passes over it to the buttons below.
 *
 * One quiet row on the page's own surface, a step down like the cards above
 * it: the line under the title turns into what a paste found, in the same
 * slot, so nothing under it moves.
 */
export function InvitePasteStrip({
  onInvite,
  disabled = false,
}: {
  onInvite: (token: string) => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { message, onText } = useInvitePaste(onInvite);
  return (
    <View style={styles.strip} testID="invite-paste-strip">
      <View style={styles.stripText}>
        <Text style={styles.stripTitle}>{INVITE_PASTE_COPY.title}</Text>
        <Text
          style={message ? styles.stripError : styles.stripLede}
          accessibilityLiveRegion="polite"
        >
          {message ?? INVITE_PASTE_COPY.lede}
        </Text>
      </View>
      <InvitePasteButton onText={onText} size="compact" disabled={disabled} />
    </View>
  );
}

/** The width sign-in's strip keeps for the compact button. */
const COMPACT_PASTE_WIDTH = 96;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    systemLarge: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH,
      alignSelf: "center",
      height: tokens.touch.buttonLarge,
    },
    systemCompact: {
      width: COMPACT_PASTE_WIDTH,
      height: tokens.touch.button,
    },
    fill: {
      width: "100%",
      height: "100%",
    },
    compact: {
      width: COMPACT_PASTE_WIDTH,
      minHeight: tokens.touch.button,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
    },
    compactLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    disabled: {
      opacity: 0.55,
    },
    strip: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
    },
    stripText: {
      flex: 1,
      gap: 2,
    },
    stripTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    stripLede: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    stripError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
