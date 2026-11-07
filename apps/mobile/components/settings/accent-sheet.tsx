import { errorCopy } from "@repo/hooks/error-copy";
import { forwardRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useCurrentChapter, useUpdateChapter } from "@repo/hooks";
import { normalizeAccentInput } from "@repo/hooks/chapter-identity";
import { orgColorsFor } from "@repo/org-archetypes";
import { SignetTokens } from "@repo/theme/signet";
import { AccentPicker } from "@/components/chapter/accent-picker";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The stored accent seed, read the way `spec/behavior/branding.md` § Accent
 * Color orders it: `branding.colors.accent` is authoritative and
 * `accent_color` its mirror.
 */
export function storedAccentOf(
  chapter:
    | { accent_color?: string | null; branding?: Record<string, unknown> }
    | undefined,
): string {
  const colors = chapter?.branding?.colors;
  const fromBranding =
    colors && typeof colors === "object"
      ? (colors as Record<string, unknown>).accent
      : undefined;
  return normalizeAccentInput(
    typeof fromBranding === "string" ? fromBranding : chapter?.accent_color,
  );
}

/**
 * Settings → Chapter accent, on the phone. Before this sheet the row was a
 * swatch over "edited on the web dashboard", so an officer who set the wrong
 * color during onboarding could not fix it from the app.
 *
 * Saves through `PATCH /v1/chapters/current`, the call web's Accent tab makes,
 * which recomputes the chapter's palette server-side; the current-chapter
 * refetch then repaints the whole app in the new accent. The row opens this
 * sheet only for a member who holds `CHAPTER_PROFILE_PERMISSIONS`, the route's
 * own guard.
 */
export const AccentSheet = forwardRef<BottomSheetModal>(function AccentSheet(
  _props,
  ref,
) {
  const closeSheet = useSheetClose(ref);
  const backgroundStyle = useSheetBackgroundStyle();

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <AccentSheetBody
        onDone={closeSheet}
      />
    </BottomSheetModal>
  );
});

function AccentSheetBody({ onDone }: { onDone: () => void }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const chapter = useCurrentChapter();

  // The draft starts from the stored accent, so the picker waits for it:
  // starting from the house default while the read is in flight would
  // enable Save on a color nobody picked, and saving it would overwrite the
  // chapter's real accent.
  if (!chapter.data) {
    return (
      <BottomSheetView
        style={styles.body}
        onAccessibilityEscape={onDone}
      >
        <SheetHeader title="Chapter accent" onCancel={onDone} />
        {chapter.isError ? (
          <Text style={styles.error}>
            Couldn&apos;t load the chapter. Check your connection and try again.
          </Text>
        ) : (
          <ActivityIndicator color={tokens.color.text.muted} />
        )}
      </BottomSheetView>
    );
  }
  return <AccentSheetForm chapter={chapter.data} onDone={onDone} />;
}

function AccentSheetForm({
  chapter,
  onDone,
}: {
  chapter: NonNullable<ReturnType<typeof useCurrentChapter>["data"]>;
  onDone: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const updateChapter = useUpdateChapter();
  const { accent } = useChapterBranding();

  const stored = storedAccentOf(chapter);
  // The modal mounts this form on every present, so the draft starts from
  // whatever is stored at that moment.
  const [draft, setDraft] = useState(stored);
  const [draftValid, setDraftValid] = useState(true);
  // Save pressed over a half-typed hex: the picker's hint shows at once.
  const [saveTried, setSaveTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = draft === stored;

  async function save() {
    if (!draftValid) {
      setSaveTried(true);
      return;
    }
    setError(null);
    try {
      await updateChapter.mutateAsync({ accent_color: draft });
      onDone();
    } catch (caught) {
      setError(
        errorCopy(caught, "Couldn't save the accent. Try again in a moment."),
      );
    }
  }

  return (
    <BottomSheetView
      style={styles.body}
      onAccessibilityEscape={onDone}
    >
      <SheetHeader title="Chapter accent" onCancel={onDone} />
      {/* The one line the picker can't show: Settings is otherwise a screen
          of personal preferences, and this save repaints every member's app. */}
      <Text style={styles.helper}>
        Changes the color for everyone in the chapter.
      </Text>
      <AccentPicker
        label="Chapter accent"
        value={draft}
        onChange={setDraft}
        onValidityChange={setDraftValid}
        showError={saveTried}
        // Keyed by the chapter's name, which is its organization's name when
        // it was created from the directory. A chapter renamed since gets the
        // presets only (#3372).
        orgColors={orgColorsFor(chapter.name)}
        disabled={updateChapter.isPending}
        inputComponent={BottomSheetTextInput}
        focusColor={accent}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SheetPrimaryButton
        label={updateChapter.isPending ? "Saving…" : "Save"}
        onPress={() => void save()}
        // Pressable over a half-typed hex, so the press can say why
        // (`showError`); a swatch the chapter already has is no change.
        disabled={(unchanged && draftValid) || updateChapter.isPending}
        accent={accent}
        // `accent` is step 11 of the scale, and every mobile fill painted with
        // it labels in the fixed `gold.onHouse` ink (chapter-branding.ts
        // measures 7.2:1 or better), as the Start session and Pay buttons do.
        onAccent={tokens.color.gold.onHouse}
      />
    </BottomSheetView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    helper: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
