import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useListChapters } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useAuthSession } from "@/lib/auth-session";
import { useSelectChapter } from "@/lib/select-chapter";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chapter picker — the supporting route with no drawn Canvas screen
 * (spec/ui/mobile/screens.md:46), so it reuses s02's visual language, which in
 * turn is the existing `(auth)` card language from s01.
 *
 * Only a multi-chapter member with no persisted selection ever reaches this:
 * `custom_access_token_hook` resolves a sole membership server-side, so a
 * single-chapter member always has a claim and the routing gate never sends
 * them here (spec/behavior/multi-tenancy.md).
 *
 * There is no local write on selection — see `lib/select-chapter.ts`. Once the
 * refreshed token carries the claim, `(auth)/_layout` redirects into `(tabs)`
 * on its own, which is why this screen never navigates.
 */
export default function ChapterPicker() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { signOut } = useAuthSession();
  const selectChapter = useSelectChapter();

  const { data, isPending, isError, refetch } = useListChapters();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);

  async function handleSelect(chapterId: string) {
    setPendingId(chapterId);
    setSelectError(null);

    const ok = await selectChapter(chapterId);

    if (!ok) {
      // Deliberately stay put. The selection is best-effort and writes nothing
      // locally on failure, so retrying is safe and nothing needs undoing.
      setSelectError("Could not switch chapters. Check your connection and try again.");
      setPendingId(null);
    }
    // On success the refreshed claim moves the routing gate, so this screen
    // unmounts underneath us — clearing `pendingId` here would be a state
    // update on an unmounted component.
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Choose your chapter</Text>
      <Text style={styles.subtitle}>
        Your account belongs to more than one chapter. Pick the one you want to
        open.
      </Text>

      <View style={styles.card}>
        {isPending ? (
          <View style={styles.stateBlock}>
            <ActivityIndicator color={tokens.color.gold.house} />
            <Text style={styles.helperText}>Loading your chapters…</Text>
          </View>
        ) : isError ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>
              We could not load your chapters.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void refetch();
              }}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : !data || data.length === 0 ? (
          // Not reachable through the normal hook path, but a member with no
          // membership at all would otherwise be stranded on a blank screen
          // with no way back to sign-in.
          <View style={styles.stateBlock}>
            <Text style={styles.helperText}>
              This account is not a member of any chapter yet. Ask an officer for
              an invite, then sign in again.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {data.map((membership) => {
              const isPendingRow = pendingId === membership.chapter_id;
              return (
                <Pressable
                  key={membership.chapter_id}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: pendingId !== null,
                    busy: isPendingRow,
                  }}
                  accessibilityHint={`Open ${membership.chapter.name}.`}
                  disabled={pendingId !== null}
                  onPress={() => {
                    void handleSelect(membership.chapter_id);
                  }}
                  style={[
                    styles.chapterRow,
                    pendingId !== null && !isPendingRow
                      ? styles.chapterRowDimmed
                      : null,
                  ]}
                >
                  <View style={styles.chapterRowText}>
                    <Text style={styles.chapterName}>
                      {membership.chapter.name}
                    </Text>
                    <Text style={styles.chapterMeta}>
                      {membership.chapter.university}
                    </Text>
                  </View>
                  {isPendingRow ? (
                    <ActivityIndicator color={tokens.color.gold.house} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {selectError ? <Text style={styles.errorText}>{selectError}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={pendingId !== null}
          onPress={() => {
            void signOut();
          }}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
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
    stateBlock: {
      gap: tokens.spacing.md,
      alignItems: "center",
      paddingVertical: tokens.spacing.lg,
    },
    list: {
      gap: tokens.spacing.sm,
    },
    chapterRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    chapterRowDimmed: {
      opacity: 0.5,
    },
    chapterRowText: {
      flex: 1,
      gap: 2,
    },
    chapterName: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    chapterMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    helperText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    errorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    primaryButton: {
      borderRadius: tokens.radius.control,
      backgroundColor: tint(tokens.color.gold.house),
      borderWidth: 1,
      borderColor: tint(tokens.color.gold.house, 0.3),
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
    },
    secondaryButton: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
