import {
  forwardRef,
  type Ref,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useQueryClient } from "@tanstack/react-query";
import type { TextInput as GestureTextInput } from "react-native-gesture-handler";
import { randomClientId } from "@repo/api-sdk";
import { mergeServerRow } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";
import {
  useChannels,
  useChapterRoster,
  useForwardMessage,
  useMemberDisplayNames,
  useMentionRoles,
} from "@repo/hooks";
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  MAX_MENTION_PICKS,
  mentionPicksIn,
  type MentionPick,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { CheckGlyph } from "@/components/control-glyphs";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectChannels } from "@/lib/chat/channel-list";
import {
  FORWARD_COMMENT_PLACEHOLDER,
  FORWARD_DONE_ANNOUNCEMENT,
  FORWARD_FAILED_TITLE,
  FORWARD_NO_DESTINATIONS,
  FORWARD_NO_MATCHES,
  FORWARD_SEARCH_PLACEHOLDER,
  FORWARD_SEND_LABEL,
  FORWARD_SHEET_TITLE,
  filterForwardDestinations,
  forwardDestinations,
  forwardFailureBody,
} from "@repo/hooks/forward-destinations";
import { type ForwardTarget } from "@repo/chat-core/forward";
import { useConnection } from "@/lib/connection/use-connection";
import { selectionHaptic } from "@/lib/haptics";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { ForwardedCard } from "./forwarded-card";
import {
  MentionPicker,
  mentionPickFor,
  useMentionPicker,
} from "./mention-picker";

/** As the report form: the sheet holds a list, so it takes a fixed detent. */
const FORWARD_SNAP_POINTS = ["85%"];

export interface ForwardSheetHandle {
  present: () => void;
  /** Closes the picker, only while it is up (`useSheetVisit`, #3795). */
  dismiss: () => void;
}

export interface ForwardSheetProps {
  target: ForwardTarget | null;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
}

/**
 * Forward to (#4864, `spec/behavior/chat/README.md` § Forward): pick one
 * channel or DM the viewer can post in, add a comment if they like, and Send.
 * Discord's long-press Forward, which the chapters moving off Discord know:
 * the message being forwarded on top, a search, the conversations, and a
 * message field over the button.
 *
 * **It replaces the actions menu** (`stackBehavior="replace"`), as the
 * report form and the emoji picker do, so closing it returns to the thread.
 * The menu presents it itself, never the thread after the menu closed: a
 * modal presented while another is still animating closed is the
 * gorhom 5.2 path #3795 wedged on, and `replace` lowers the menu as this one
 * mounts.
 *
 * **A scrollable sheet with a keyboard**: a fixed detent, the header and
 * search above the sheet-aware scroll view, the comment and Send pinned under
 * it (`ask-sheet.tsx`'s layout), so Send stays in reach however long the list
 * is (`spec/ui/mobile/patterns.md` § Bottom sheets).
 *
 * **@ in the comment** opens the composer's member list over the field
 * (#4907), and a member picked there is sent as a `mention_picks` entry, so
 * the comment reaches them as a post's mention does, by pick rather than by
 * the server matching the text. Frapp isn't offered: a forward can't ask.
 *
 * **No queue.** A forward is a plain request, not the composer's outbox, so
 * offline it is disabled and says why (`writeBlockedReason`), as every
 * queueless write on the phone does. One idempotency key is kept per draft
 * (the destination and comment), so a retry after a lost response answers the
 * forward already made rather than posting a second.
 *
 * **Outcomes.** Success closes the sheet with a tick of haptics and says
 * "Forwarded" to a screen reader; the row itself lands in the destination's
 * timeline (merged here into its cache when one is held, and over Realtime
 * anyway). A failure keeps the sheet and the draft up behind an alert that
 * says whether trying again can help (`forwardFailureBody`).
 */
export const ForwardSheet = forwardRef<ForwardSheetHandle, ForwardSheetProps>(
  function ForwardSheet({ target, nameFor, viewerId }, ref) {
    const backgroundStyle = useSheetBackgroundStyle();
    const modalRef = useRef<BottomSheetModal>(null);
    const close = useSheetClose(modalRef);
    const visit = useSheetVisit(modalRef);
    const { dismiss, willPresent } = visit;

    useImperativeHandle(
      ref,
      () => ({
        present: () => {
          willPresent();
          modalRef.current?.present();
        },
        dismiss,
      }),
      [dismiss, willPresent],
    );

    return (
      <BottomSheetModal
        ref={modalRef}
        stackBehavior="replace"
        enableDynamicSizing={false}
        snapPoints={FORWARD_SNAP_POINTS}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={visit.onAnimate}
        onDismiss={visit.markClosed}
      >
        <SheetBackToClose onClose={close} />
        {/* Its hooks read the API, so the body mounts only with a message
            to forward; keyed by it, so another message opens a fresh form. */}
        {target ? (
          <ForwardSheetBody
            key={target.messageId}
            target={target}
            nameFor={nameFor}
            viewerId={viewerId}
            close={close}
            visitNow={visit.visit}
            isSameVisit={visit.isSameVisit}
          />
        ) : null}
      </BottomSheetModal>
    );
  },
);

export function ForwardSheetBody({
  target,
  nameFor,
  viewerId,
  close,
  visitNow,
  isSameVisit,
}: {
  target: ForwardTarget;
  nameFor: (userId: string) => string | null;
  viewerId: string | null;
  close: () => void;
  visitNow: () => number;
  isSameVisit: (visit: number) => boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens, accent), [tokens, accent]);
  const queryClient = useQueryClient();
  const forward = useForwardMessage();
  const { writeBlockedReason } = useConnection();
  const channelsQuery = useChannels();
  const { byId: names, avatarFor, avatarTintFor } = useMemberDisplayNames();
  // Who the comment's `@` offers: the roster read the names above come from
  // (one query key) and the roles this member may ping, as the composer's.
  const mentionRoster = useChapterRoster().data;
  const mentionRoles = useMentionRoles().data;

  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  /** The draft's idempotency key; a new destination or comment is a new draft. */
  const draftKey = useRef<string | null>(null);
  const commentRef = useRef<TextInput>(null);
  /** Members picked from the comment's `@` list, as the composer keeps them. */
  const picksRef = useRef<MentionPick[]>([]);

  const destinations = useMemo(
    () =>
      forwardDestinations(selectChannels(channelsQuery.data), viewerId, names),
    [channelsQuery.data, viewerId, names],
  );
  const shown = useMemo(
    () => filterForwardDestinations(destinations, query),
    [destinations, query],
  );

  const pick = useCallback((channelId: string) => {
    draftKey.current = null;
    setDestination(channelId);
  }, []);
  const editComment = useCallback((text: string) => {
    draftKey.current = null;
    setComment(text);
  }, []);
  const mention = useMentionPicker(
    commentRef,
    comment,
    editComment,
    mentionRoster,
    mentionRoles,
    false,
  );
  const addMentionPick = useCallback((pick: MentionPick) => {
    // The newest pick of a label wins, as the composer's
    // (`use-composer-staging.ts`).
    picksRef.current = [
      pick,
      ...picksRef.current.filter((held) => held.label !== pick.label),
    ].slice(0, MAX_MENTION_PICKS);
  }, []);

  const reset = useCallback(() => {
    draftKey.current = null;
    setQuery("");
    setDestination(null);
    setComment("");
    picksRef.current = [];
  }, []);

  const sending = forward.isPending;
  const canSend =
    destination !== null && !sending && writeBlockedReason === null;

  const send = useCallback(() => {
    if (!destination || sending || writeBlockedReason !== null) return;
    draftKey.current ??= randomClientId();
    const clientMessageId = draftKey.current;
    const sentFrom = visitNow();
    void forward
      .mutateAsync({
        messageId: target.messageId,
        channelId: destination,
        content: comment,
        clientMessageId,
        // Only the picks the comment still writes, as a post sends them.
        mentionPicks: mentionPicksIn(comment, picksRef.current),
      })
      .then((row) => {
        // The row in the destination's timeline at once where a cache holds
        // it; the Realtime echo merges by id, so this never doubles it.
        queryClient.setQueryData<ChannelCache>(
          chatMessagesKey(destination),
          (cache) =>
            cache
              ? mergeServerRow(cache, row as unknown as RawChatMessage)
              : cache,
        );
        selectionHaptic();
        AccessibilityInfo.announceForAccessibility(FORWARD_DONE_ANNOUNCEMENT);
        reset();
        if (isSameVisit(sentFrom)) close();
      })
      .catch((error: unknown) => {
        Alert.alert(FORWARD_FAILED_TITLE, forwardFailureBody(error));
      });
  }, [
    close,
    comment,
    destination,
    forward,
    isSameVisit,
    queryClient,
    reset,
    sending,
    target.messageId,
    visitNow,
    writeBlockedReason,
  ]);

  const cancel = useCallback(() => {
    if (sending) return;
    reset();
    close();
  }, [close, reset, sending]);

  const empty = channelsQuery.isPending
    ? null
    : destinations.length === 0
      ? FORWARD_NO_DESTINATIONS
      : shown.length === 0
        ? FORWARD_NO_MATCHES
        : null;

  return (
    <>
      <View style={styles.top}>
        <SheetHeader
          title={FORWARD_SHEET_TITLE}
          onCancel={cancel}
          cancelDisabled={sending}
        />
        <ForwardedCard
          forwarded={target.preview}
          hidden={target.hidden}
          nameFor={nameFor}
          viewerId={viewerId}
        />
        {/* `BottomSheetTextInput`, never a plain `TextInput` (`patterns.md`
            § Bottom sheets). */}
        <BottomSheetTextInput
          value={query}
          onChangeText={setQuery}
          placeholder={FORWARD_SEARCH_PLACEHOLDER}
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel={FORWARD_SEARCH_PLACEHOLDER}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.field}
        />
      </View>
      <BottomSheetScrollView
        onAccessibilityEscape={close}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {empty ? <Text style={styles.caption}>{empty}</Text> : null}
        {shown.length > 0 ? (
          <View accessibilityRole="radiogroup" style={styles.list}>
            {shown.map((row, index) => {
              const selected = row.id === destination;
              return (
                <Pressable
                  key={row.id}
                  testID={`forward-destination-${row.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={row.label}
                  onPress={() => pick(row.id)}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 ? styles.rowDivider : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {row.label}
                  </Text>
                  {selected ? <CheckGlyph color={accent} size={20} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </BottomSheetScrollView>
      <View style={styles.bottom}>
        {mention.open ? (
          <MentionPicker
            suggestions={mention.suggestions}
            avatarFor={avatarFor}
            avatarTintFor={avatarTintFor}
            onPick={(entry) => {
              mention.pick(entry.label);
              const pick = mentionPickFor(entry);
              if (pick) addMentionPick(pick);
            }}
          />
        ) : null}
        <BottomSheetTextInput
          // gorhom types this ref as gesture-handler's TextInput component,
          // not the instance it hands over, which is React Native's
          // TextInput (what the `@` list moves the caret through).
          ref={commentRef as unknown as Ref<GestureTextInput | undefined>}
          value={comment}
          onChangeText={mention.onChangeText}
          onSelectionChange={mention.onSelectionChange}
          onFocus={mention.onFocus}
          onBlur={mention.onBlur}
          placeholder={FORWARD_COMMENT_PLACEHOLDER}
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel={FORWARD_COMMENT_PLACEHOLDER}
          maxLength={CHAT_MESSAGE_CONTENT_MAX_LENGTH}
          multiline
          style={[styles.field, styles.comment]}
        />
        {writeBlockedReason ? (
          <Text style={styles.caption}>{writeBlockedReason}</Text>
        ) : null}
        <SheetPrimaryButton
          label={FORWARD_SEND_LABEL}
          onPress={send}
          disabled={!canSend}
          busy={sending}
          accessibilityHint={writeBlockedReason ?? undefined}
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </View>
    </>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fields = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    top: {
      paddingHorizontal: tokens.spacing.lg,
      gap: tokens.spacing.md,
      paddingBottom: tokens.spacing.md,
    },
    field: fields.field,
    comment: {
      ...fields.fieldMultilineText,
      maxHeight: 120,
    },
    // Takes the space the header and the comment do not, so Send stays
    // pinned to the sheet's bottom edge however long the list is.
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.md,
      gap: tokens.spacing.md,
    },
    // The ListSection recipe, so the conversations read as one grouped list.
    list: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      minHeight: tokens.touch.minimum,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    bottom: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
