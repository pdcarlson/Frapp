import { forwardRef, useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  DELETE_CHANNEL_CONFIRM_BODY,
  DELETE_CHANNEL_LABEL,
  deleteChannelConfirmTitle,
  deleteChannelNameMatches,
  deleteChannelTypeLabel,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Delete channel, on the phone (#3838): Paul asked that deleting a channel be
 * harder, so it asks for the channel's name, typed exactly, as web's dialog
 * does and as GitHub asks before deleting a repository. A system alert can't
 * hold a text field on Android, so this is a sheet. Delete stays disabled
 * until the name matches; a refusal shows under the field and keeps the
 * sheet up.
 */
export const DeleteChannelSheet = forwardRef<
  BottomSheetModal,
  {
    /** The channel asked about; null draws nothing until one is set. */
    channel: { id: string; name: string } | null;
    /** Deletes it. Rejects with the reason to show when the server refuses. */
    onDelete: (channelId: string) => Promise<void>;
  }
>(function DeleteChannelSheet({ channel, onDelete }, ref) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const matches = channel
    ? deleteChannelNameMatches(typed, channel.name)
    : false;

  const closed = useCallback(() => {
    markClosed();
    setTyped("");
    setFocused(false);
    setFailure(null);
  }, [markClosed]);

  const confirm = useCallback(() => {
    if (!channel || !matches || busy) return;
    setBusy(true);
    setFailure(null);
    const sentFrom = visit();
    void onDelete(channel.id)
      .then(() => {
        if (isSameVisit(sentFrom)) dismiss();
      })
      .catch(() => {
        if (isSameVisit(sentFrom)) {
          setFailure(
            "Couldn't delete the channel. Nothing changed. Check your connection and try again.",
          );
        }
      })
      .finally(() => setBusy(false));
  }, [channel, matches, busy, onDelete, visit, isSameVisit, dismiss]);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onAnimate={onAnimate}
      onDismiss={closed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView style={styles.body} onAccessibilityEscape={closeSheet}>
        {channel ? (
          <>
            <SheetHeader
              title={deleteChannelConfirmTitle(channel.name)}
              onCancel={closeSheet}
              cancelDisabled={busy}
            />
            <Text style={styles.copy}>{DELETE_CHANNEL_CONFIRM_BODY}</Text>
            <Text style={styles.label}>
              {deleteChannelTypeLabel(channel.name)}
            </Text>
            <View style={[styles.ring, focused ? styles.ringActive : null]}>
              <BottomSheetTextInput
                value={typed}
                onChangeText={(next) => {
                  setTyped(next);
                  setFailure(null);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                editable={!busy}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                accessibilityLabel={deleteChannelTypeLabel(channel.name)}
                returnKeyType="done"
                onSubmitEditing={confirm}
                style={[styles.field, focused ? styles.fieldFocused : null]}
              />
            </View>
            {failure ? (
              <Text style={styles.failure} accessibilityLiveRegion="polite">
                {failure}
              </Text>
            ) : null}
            <SheetPrimaryButton
              label={DELETE_CHANNEL_LABEL}
              onPress={confirm}
              disabled={!matches || busy}
              busy={busy}
              accent={tokens.color.semantic.destructive}
              onAccent={tokens.color.text.foreground}
              accessibilityHint={
                matches ? undefined : "Type the channel's name first."
              }
            />
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    copy: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    failure: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    ...sheetFieldStyles(tokens, tokens.color.semantic.destructive),
  });
}
