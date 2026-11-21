import { forwardRef, useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import {
  useChapterChatBackground,
  useRequestChatBackgroundPhotoUrl,
  useSetChapterChatBackground,
} from "@repo/hooks";
import type { ChatBackgroundKey } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ChatBackgroundSwatches } from "@/components/chat/chat-background-picker";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { saveChatBackgroundPick } from "@/lib/chat/chat-background-photo";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Settings → Chat background, on the phone (#4031): the chapter default every
 * channel without its own background shows. Web's twin is Chat settings →
 * Default chat background. The row opens this only for a member who holds
 * `CHAPTER_PROFILE_PERMISSIONS`, the route's own guard.
 *
 * A tap saves and, once saved, closes. Photo opens the library first; the
 * sheet stays up meanwhile, so a refusal is read here. A save can land after
 * the officer swiped the sheet away (a photo upload is slow), so it closes
 * only the visit it was sent from (`useSheetVisit`, #3405).
 */
export const ChatBackgroundSheet = forwardRef<BottomSheetModal>(
  function ChatBackgroundSheet(_props, ref) {
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);
    const backgroundStyle = useSheetBackgroundStyle();
    const { tokens } = useFrappTheme();
    const styles = createStyles(tokens);
    const closeAfterSave = useCallback(
      (sentFrom: number) => {
        if (isSameVisit(sentFrom)) dismiss();
      },
      [dismiss, isSameVisit],
    );

    return (
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        enableDynamicSizing
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={markClosed}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetView style={styles.body} onAccessibilityEscape={closeSheet}>
          <SheetHeader title="Chat background" />
          <ChatBackgroundDefaultPicker visit={visit} onSaved={closeAfterSave} />
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

/** The sheet's body: the default's swatches, their save, and its words. */
export function ChatBackgroundDefaultPicker({
  visit,
  onSaved,
}: {
  /** Names the sheet visit a save is sent from (`useSheetVisit`). */
  visit: () => number;
  /** Saved: close the visit it was sent from, if that is still the one up. */
  onSaved: (sentFrom: number) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const current = useChapterChatBackground();
  const setDefault = useSetChapterChatBackground();
  const requestPhotoUrl = useRequestChatBackgroundPhotoUrl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = current.data?.background ?? null;

  async function pick(next: ChatBackgroundKey | null) {
    // The default has no "follow" choice; the picker offers none.
    if (next === null || busy) return;
    const sentFrom = visit();
    if (next !== "photo" && next === value) {
      onSaved(sentFrom);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await saveChatBackgroundPick(next, {
      requestPhotoUrl: ({ filename, contentType }) =>
        requestPhotoUrl.mutateAsync({
          scope: "default",
          filename,
          contentType,
        }),
      save: ({ background, storagePath }) =>
        setDefault.mutateAsync({
          background: background ?? "plain",
          storagePath,
        }),
    });
    setBusy(false);
    if (result.status === "saved") onSaved(sentFrom);
    else if (result.status === "refused") setError(result.reason);
  }

  return (
    <>
      <Text style={styles.helper}>
        Every channel without its own background shows this.
      </Text>
      <ChatBackgroundSwatches
        value={value}
        allowInherit={false}
        disabled={busy || (current.data === undefined && !current.isError)}
        onPick={(next) => void pick(next)}
      />
      {busy ? (
        <Text accessibilityRole="text" style={styles.helper}>
          Saving…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </>
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
