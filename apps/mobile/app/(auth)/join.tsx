import { useEffect, useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRedeemInvite } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useAuthSession } from "@/lib/auth-session";
import {
  consumeRememberedInviteToken,
  extractInviteToken,
  rememberInviteToken,
} from "@/lib/onboarding/invite-token";
import { joinErrorCopy, redeemChapterId } from "@/lib/onboarding/join-errors";
import { useSelectChapter } from "@/lib/select-chapter";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s02 — Join chapter (`spec/ui/mobile/screens.md`).
 *
 * Invite-token entry plus invite-link autofill. Visual language is the `(auth)`
 * card (s01 / chapter picker). Canvas draws six cells for a shared code; joining
 * is single-use invite tokens, so this is one field that also accepts a pasted
 * URL (`spec/behavior/onboarding.md` wins over the drawing for the data model).
 */
export default function JoinChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, signOut } = useAuthSession();
  const queryClient = useQueryClient();
  const redeemInvite = useRedeemInvite();
  const selectChapter = useSelectChapter();
  const params = useLocalSearchParams<{ token?: string; invite?: string }>();
  const deepLinkUrl = Linking.useURL();

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromParams = extractInviteToken(
      typeof params.token === "string"
        ? params.token
        : typeof params.invite === "string"
          ? params.invite
          : "",
    );
    const fromLink = extractInviteToken(deepLinkUrl);
    const next =
      fromParams ?? fromLink ?? consumeRememberedInviteToken();
    if (next) {
      rememberInviteToken(next);
      setToken((current) => (current.length > 0 ? current : next));
    }
  }, [deepLinkUrl, params.invite, params.token]);

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  async function handleSignOut() {
    await signOut();
    queryClient.clear();
    router.replace("/(auth)/sign-in");
  }

  async function handleJoin() {
    const extracted = extractInviteToken(token);
    if (!extracted) {
      setError("Paste the invite your officer sent, or open the invite link.");
      return;
    }

    setError(null);
    try {
      const result = await redeemInvite.mutateAsync({ token: extracted });
      consumeRememberedInviteToken();
      const chapterId = redeemChapterId(result);
      if (chapterId) {
        await selectChapter(chapterId);
      }
      router.replace("/welcome");
    } catch (caught) {
      setError(joinErrorCopy(caught));
    }
  }

  const submitting = redeemInvite.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
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
            {submitting ? (
              <ActivityIndicator color={tokens.color.gold.onHouse} />
            ) : (
              <Text style={styles.primaryButtonText}>Join chapter</Text>
            )}
          </Pressable>

          <View style={styles.linkHint}>
            <Text style={styles.helperText}>
              Got an invite link? It opens here and fills the invite for you.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void handleSignOut();
            }}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
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
  });
}
