"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHANNELS_ROLE_REFUSAL_TITLE,
  channelsRoleRefusalBody,
  isRoleRefusal,
} from "@repo/chat-core/channels-refused-copy";
import { createPortal } from "react-dom";
import { MembersGlyph } from "./chat-glyphs";
import { ChannelMemberList } from "./channel-member-list";
import { channelDescription } from "@repo/hooks/channel-start";
import { useReportOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { ChannelHeaderTitle } from "./channel-header-title";
import { ChannelStart } from "./channel-start";
import { ErrorState } from "@/components/shared/async-states";
import {
  canHideConversation,
  directChannelDisplayName,
  HIDE_CONVERSATION_CONFIRM_ACTION,
  HIDE_CONVERSATION_CONFIRM_BODY,
  HIDE_CONVERSATION_FAILED_BODY,
  HIDE_CONVERSATION_FAILED_TITLE,
  hideConversationConfirmTitle,
  otherMemberId,
  useGetOrCreateDm,
  useLeaveChannel,
  useChannelNotificationPreferences,
  claimViewedChannel,
  useChannelUnreadCounts,
  useChannels,
  useSetChannelNotificationLevel,
  useMarkChannelRead,
  useCategories,
  useChapterRoster,
  useMemberDisplayNames,
  useMentionRoles,
  useMyPermissions,
  useBookmarks,
  useBookmarkedMessageIds,
  useBookmarkMessage,
  useUnbookmarkMessage,
  resolveAuthorLabel,
  resolveAuthorName,
  SIDEBAR_SAVE_FAILED_BODY,
  SIDEBAR_SAVE_FAILED_TITLE,
  sidebarMutedChannelIds,
  sidebarUnreadCounts,
  useSetChannelPinned,
  useSetSidebarFilter,
  useSetSidebarSectionCollapsed,
  useSidebarPreferences,
  landingChannelId,
} from "@repo/hooks";
import {
  can,
  canAll,
  EVENT_CREATE_PERMISSIONS,
  isAnnouncementChannel,
  type MentionCandidate,
  type MentionChipTargets,
} from "@repo/validation";
import { MentionChipTargetsContext } from "@repo/hooks/mention-chips";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PanelContent, PanelHeader } from "@/components/shared/panel";
import { MemberDetailSheet } from "@/components/members/member-detail-sheet";
import {
  persistMembersHidden,
  WIDE_CHAT_QUERY,
} from "@/lib/chat/members-panel";
import { useMediaQuery } from "@/lib/use-media-query";
import { IconButton } from "@/components/ui/icon-button";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useChatViewerId } from "@/lib/chat/viewer-id";
import { asArray, cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { useChatChannel } from "@/lib/chat/use-chat-channel";
import {
  useMaskedRefresh,
  useThreadBlockList,
} from "@/lib/chat/use-thread-block-list";
import { readLastChannel, writeLastChannel } from "@/lib/chat/last-channel";
import { useToast } from "@/lib/hooks/use-toast";
import { useChapterModuleGateState } from "@/lib/hooks/use-chapter-module-gate";
import { useChapterVocabulary } from "@/lib/hooks/use-chapter-vocabulary";
import { vocab } from "@repo/org-archetypes";
import * as Sentry from "@sentry/nextjs";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useDeleteChannelFlow } from "./use-delete-channel-flow";
import {
  classifyMessage,
  hiddenQuoteText,
  visibleTypingUsers,
} from "@repo/chat-core/blocks";
import type { ResolveMember } from "@repo/chat-core/dispatch";
import type { ChatMessage } from "@repo/chat-core/types";
import { FOCUS_RING, SKIP_LINK_CLASSES } from "@/components/ui/focus";
import {
  ChannelFilters,
  ChannelList,
  type ChannelSidebarControls,
  type ChannelCategory,
  type ChatChannel,
} from "./channel-list";
import { ChannelListSkeleton } from "./channel-list-skeleton";
import {
  MessageTimeline,
  MessageTimelineSkeleton,
  type MessageTimelineHandle,
} from "./message-timeline";
import {
  Composer,
  ComposerShell,
  notifyDispatchOutcome,
  type CommandFormOutcome,
} from "./composer";
import {
  canBlockSender,
  channelAllowsReplies,
  DELETE_MESSAGE_CONFIRM_BODY,
  DELETE_MESSAGE_CONFIRM_LABEL,
  DELETE_MESSAGE_CONFIRM_TITLE,
  replyTargetId,
  departedIn,
  noDepartedMembers,
  rosterMembership,
  withDeparted,
  type DepartedMembers,
} from "@repo/chat-core/message-actions";
import { blockActionLabel } from "@repo/chat-core/block-copy";
import {
  CLOSE_POLL_CONFIRM_BODY,
  CLOSE_POLL_CONFIRM_LABEL,
  CLOSE_POLL_CONFIRM_TITLE,
} from "@repo/chat-core/polls";
import { replyPreviewText } from "./reply-quote";
import { OpsSetupNudge } from "./ops-setup-nudge";
import { SetupChecklistSection } from "./setup-checklist";
import { ChannelMenu } from "./channel-menu";
import type { ChannelRowActions } from "./channel-row-menu";
import type { ChatSearchHit } from "./chat-search-popover";
import type { BookmarkEntry } from "./bookmarks-popover";
import { BlockListNotice } from "./block-list-notice";
import { useUnblockFlow } from "./use-unblock-flow";
import { useBlockFlow } from "./use-block-flow";
import {
  ReportMessageDialog,
  type ReportTarget,
} from "./report-message-dialog";
import { compactControlClassName } from "@/components/shared/table-controls";
import {
  NavChannelsTitle,
  useIsDesktopShell,
  useNavFace,
} from "@/components/layout/nav-face";
import {
  eventFormPrefill,
  parseEventArgs,
  parsePollArgs,
  type EventFormPrefill,
  type SlashCommand,
} from "@repo/chat-core/integrations";
import { EventEditorDialog } from "@/components/events/event-editor-dialog";
import { pollDraftFromArgs, type PollDraft } from "@repo/chat-core/poll-draft";
import { NewPollDialog } from "./new-poll-dialog";
import type { PlusMenuForm } from "./composer-plus-menu";
import type { ChatNotificationLevel } from "@repo/hooks";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";

interface DirectoryMember {
  user_id: string;
  display_name: string;
}

/**
 * Resolve a `/points @member` token to a single chapter member. Tiered and
 * fail-closed: exact user id → exact display name → name without spaces →
 * first name → unique prefix. Ambiguity at any tier (or no match) returns
 * `null` so the dispatcher never adjusts the wrong person.
 */
function matchMember(
  list: DirectoryMember[],
  token: string,
): DirectoryMember | null {
  const needle = token.trim().toLowerCase();
  if (needle.length === 0) return null;
  const lower = (s: string) => s.toLowerCase();
  const noSpace = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

  const tiers: Array<(m: DirectoryMember) => boolean> = [
    (m) => m.user_id.toLowerCase() === needle,
    (m) => lower(m.display_name) === needle,
    (m) => noSpace(m.display_name) === needle,
    (m) => firstWord(m.display_name) === needle,
    (m) => lower(m.display_name).startsWith(needle),
  ];
  for (const pred of tiers) {
    const hits = list.filter(pred);
    if (hits.length === 1) {
      return { user_id: hits[0]!.user_id, display_name: hits[0]!.display_name };
    }
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * Older pages a jump loads while looking for its target before it says the
 * message is further back (#1571). Paging is contiguous, so reaching a message
 * costs every page between it and the newest one: at `OLDER_PAGE_LIMIT` rows
 * a page this is two thousand messages, a few seconds of reads, which covers
 * any search hit or bookmark from ordinary use. Past it the target stays
 * pending, so scrolling up still opens it once it loads.
 */
const JUMP_MAX_OLDER_PAGES = 20;

type UnreachableReason = "far" | "missing" | "error" | "unloaded";

/** `spec/ui/design-system/writing.md` § Chat (dashboard). */
const UNREACHABLE_COPY: Record<UnreachableReason, string> = {
  far: "That message is further back than the history loaded here. Scrolling up loads more, and it opens once it loads.",
  missing: "That message isn't in this channel anymore.",
  error: "Couldn't load the messages needed to reach that message.",
  unloaded: "Couldn't load this channel's messages to reach that message.",
};

/**
 * Marks the history entry a channel pick pushes below `lg`, so Back returns
 * from the thread to the channel list (#3824).
 *
 * The value is this document's own token, not `true`. History state outlives
 * a reload, but the entry under a marked one then belongs to the document the
 * reload discarded, and going back to it is a full page load, not a
 * `popstate`. A marker from another document is not ours to go back through.
 */
const THREAD_PANE_HISTORY_KEY = "frappChatThreadPane";
const THREAD_PANE_DOCUMENT_TOKEN = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2)}`;

function isThreadPaneEntry(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[THREAD_PANE_HISTORY_KEY] ===
      THREAD_PANE_DOCUMENT_TOKEN
  );
}

/** Pushes this document's marked, same-URL entry for an opened thread. */
function pushThreadPaneEntry(): void {
  // The spread keeps Next's own `__NA` state, so its patched `pushState`
  // passes the entry straight through.
  window.history.pushState(
    {
      ...(window.history.state as object | null),
      [THREAD_PANE_HISTORY_KEY]: THREAD_PANE_DOCUMENT_TOKEN,
    },
    "",
  );
}

/**
 * Overlays that own `Esc` while open. Radix closes them on the same keydown,
 * before this listener runs but while they are still in the DOM.
 */
const ESCAPE_OWNERS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

/**
 * Whether an `Esc` is someone else's: typed in a field or the composer (which
 * cancel a reply or an edit with it), or closing an open overlay. Chat only
 * takes the key when nothing else would have (#3824).
 */
function escapeBelongsElsewhere(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return true;
    if (target.closest("input, textarea, select")) return true;
  }
  return document.querySelector(ESCAPE_OWNERS) !== null;
}

/**
 * A typed `/event` date and clock time as a `datetime-local` value, or
 * `undefined` unless both are there (the form's field takes neither alone).
 */
export function prefillLocalInput(
  date: string | undefined,
  time: string | undefined,
): string | undefined {
  if (!date || !time) return undefined;
  const [hours = "", minutes = ""] = time.split(":");
  return `${date}T${hours.padStart(2, "0")}:${minutes}`;
}

/**
 * The chat surface: channels column, then thread and composer.
 *
 * **Two columns, flush, full height** (`1b`). It was three, the third being a
 * Details rail that hosted `ThreadPanel` over a static placeholder. Both are
 * deleted. Where threads went: the quote above a reply, which was the panel's
 * only remaining entry point, now scrolls this timeline to the message it
 * quotes (`MessageItem`'s `onJumpToParent`). The decision is recorded in
 * `spec/ui/web-dashboard/README.md` § Chat.
 *
 * **The panes are not cards, and that is load-bearing.** They used to be
 * `<Card>`s, so the whole surface painted `--card` — and `components.md` §11
 * then specced the incoming bubble as `--card` with a hairline, so a card on a
 * card was `#1E1B17` on `#1E1B17` and the bubble simply did not exist. The
 * reference resolves it the other way round (`canvas-screens.dc.html` s05):
 * the thread sits on `--background`, the app floor. The bubble is gone since
 * #2873, but the cards posted into the thread are still the step above it, and
 * a hovered row lifts to `--surface-1`. The channels column is `--surface-1`, the ladder step foundations
 * §2 assigns to nav chrome, which is what the sidebar already uses.
 *
 * Every async branch renders an explicit state, and none of them replaces the
 * route: they render inside the thread column with the frame already up, which
 * is what the board's first-paint contract asks for. The no-chapter branch was
 * the last exception and is one too, as of #2145.
 */

export function ChatShell({
  initialChannelId = null,
  initialMessageId = null,
  defaultMembersHidden = false,
}: {
  initialChannelId?: string | null;
  initialMessageId?: string | null;
  /**
   * The member list column's remembered state, read from its cookie on the
   * server (`lib/chat/members-panel.ts`) so the column paints right first time.
   */
  defaultMembersHidden?: boolean;
} = {}) {
  const activeChapterId = useChapterStore((state) => state.activeChapterId);
  /*
    The viewer's `users.id` for painting — live once `GET /v1/users/me` answers,
    and the one cached beside the first chunk until then (#2249).

    Every use of it on this surface is a paint: whose a row is (`viewerId`
    into the timeline, which says "You" in the accent), what a DM is called
    (`directChannelDisplayName`), whether the reply quote says "You", whether the
    live region says "You", and whether the `?message=` jump may run yet. None of
    them is a write, which is why the cached value is allowed to serve them —
    `viewer-id.tsx` and `use-first-chunk-cache.ts` hold that line and the reason
    for it.

    Still `null` when identity is genuinely unknown, and `null` still means
    withhold: the gate #2255 put in `message-timeline.tsx` is untouched, and
    every guard below reads the same way it did.
  */
  const userId = useChatViewerId();
  /*
    The *live* id, kept separately for two guards below that are not asking who
    the viewer is.

    Both are spelled `if (!liveUserId) return` and both were written when the
    two questions had the same answer. They are really asking **"has the
    authoritative window loaded yet?"**, and `GET /v1/users/me` having answered
    was the proxy they had for it. #2249 breaks that proxy on purpose: identity
    can now resolve from disk while the network has returned nothing, which is
    the whole point for painting and exactly wrong for these two.

    So they keep the proxy they have always used rather than being quietly
    re-timed by a change about something else. It is still a proxy — the
    identity query and the messages query are independent, so it was never
    airtight — and #2269 tracks replacing it with a signal that actually says
    whether the live window has landed.
  */
  const { userId: liveUserId } = useFrappUser();
  // From the member view, like the slash gate below: `useOrgConfig()` needs
  // `chapter-config:view`, which no seeded role below President holds (#2957),
  // so members got `/rush` in place of their chapter's recruitment word.
  // `undefined` until the read answers, which the palette shows as `/rush`.
  const chapterVocabulary = useChapterVocabulary();
  const recruitmentVocab = chapterVocabulary
    ? vocab("recruitment", chapterVocabulary)
    : undefined;

  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();
  // Names for message authors and DM titles. Shares its query key with the
  // roster read below, so react-query serves both from one fetch.
  const {
    byId: memberNames,
    nameFor,
    avatarFor,
    roleColorFor,
    isPending: rosterPending,
    isError: rosterError,
  } = useMemberDisplayNames();
  // Per-channel notification levels, from their own endpoint rather than the
  // channel payload — the same split unread counts use, and for the same
  // recorded reason (see `channel-list.tsx`, which explains how a `muted` field
  // nothing populated stayed permanently falsy).
  const notificationPrefsQuery = useChannelNotificationPreferences();
  const levelByChannelId = useMemo(() => {
    const map = new Map<string, ChatNotificationLevel>();
    // Keyed off `data`, NOT `isError`. TanStack Query keeps the last good
    // `data` when a *background refetch* fails, so bailing on `isError` threw
    // away still-valid levels the user had already seen: one 502 during an API
    // restart and every muted channel silently rendered as unmuted, which is
    // precisely the "claims a channel is not muted when it is" failure this
    // guard was meant to avoid. With no data at all the map stays empty and
    // callers fall back, which is the honest un-configured state.
    if (!notificationPrefsQuery.data) {
      return map;
    }
    for (const row of notificationPrefsQuery.data) {
      map.set(row.channel_id, row.level);
    }
    return map;
  }, [notificationPrefsQuery.data]);
  // The rail's Hide muted filter reads this: `undefined` while the levels are
  // unknown, so the filter hides nothing on missing data (#2877). The rule is
  // shared with mobile's s04.
  const mutedChannelIds = useMemo(
    () =>
      sidebarMutedChannelIds({
        data: notificationPrefsQuery.data,
        isError: notificationPrefsQuery.isError,
      }),
    [notificationPrefsQuery.data, notificationPrefsQuery.isError],
  );

  const channels = useMemo(
    () =>
      asArray<ChatChannel>(channelsQuery.data).map((ch) => ({
        ...ch,
        // `muted` finally has a writer. It has been on this type since the
        // channel list was built and was populated nowhere until now, so the
        // "muted" indicator it gates could never render.
        muted: levelByChannelId.get(ch.id) === "off",
      })),
    [channelsQuery.data, levelByChannelId],
  );

  // The rail groups plain channels under these. Passed through in the order the
  // API returned them — `SupabaseChatCategoryRepository.findByChapter` orders by
  // `display_order` and then `created_at` server-side, so there is nothing to
  // re-sort here.
  //
  // **A failed categories fetch degrades to the flat list rather than an error
  // state.** Unlike `channelsQuery` below, there is no `isError` branch:
  // `asArray` turns the absent payload into `[]` and every channel falls into
  // the default "Channels" group, which is exactly the pre-category rail.
  //
  // **Nothing waits for it either.** Chat used to gate the whole shell on
  // `categoriesQuery.isPending`, which bought a rail that painted grouped on
  // first render rather than flat-then-reflowed, and made every cold load wait
  // out the fetch, a failing one through the query provider's retry backoff
  // (`spec/ui/resilience/api-retry.md` § Reads). The framework board's
  // first-paint contract (`1s`) prices that the other way round: it lists the
  // gate under "delete" and accepts the reflow in as many words, "Categories
  // regroup only below the fold or on next visit". So a pending fetch renders
  // `[]`, which is the same flat rail the failed fetch degrades to.
  const categories = useMemo(
    () => asArray<ChannelCategory>(categoriesQuery.data),
    [categoriesQuery.data],
  );

  // The pane-history refs (#3824), described with `openThreadPane` below.
  // Declared here because the URL-target effect clears `onThreadEntry`.
  const onThreadEntry = useRef(false);
  const backPending = useRef(false);
  const openAfterBack = useRef(false);

  // Seeded from the `?channel=` query param a caller (e.g. the member
  // directory's Message action, a chat notification, a command-palette
  // search hit) may navigate here with — see `activeChannelId` below for what
  // happens before that channel has loaded into `channels`.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    initialChannelId,
  );
  // A caller-supplied channel id can be stale (deleted channel) or
  // inaccessible (membership changed since the link was made). Falling back
  // to #general for either case *silently* would make a broken deep link
  // indistinguishable from an intentional one — so this is tracked
  // separately from "no target was requested at all", and surfaces its own
  // empty state below rather than folding into the general fallback.
  const [channelTargetDismissed, setChannelTargetDismissed] = useState(false);
  // State, not a ref: the jump effect below needs to re-run when *only* this
  // changes (a second message-only link into an already-active, already-
  // loaded channel touches nothing else the effect depends on).
  const [pendingMessageId, setPendingMessageId] = useState(initialMessageId);
  // Which channel the pending jump's message actually lives in.
  //
  // Was read straight off `initialChannelId` (the URL param), which conflated
  // "the channel this deep link named" with "the channel this jump targets".
  // Those were the same thing only while deep links and the in-channel pins
  // panel were the only jumps. Both the chapter-wide Bookmarks panel (#462) and
  // chat search (#469) routinely target a *different* channel than the URL
  // named, and against the old guard such a jump was silently dropped, because
  // `activeChannelId` never equals a stale `initialChannelId` again. `null`
  // means "no channel was named; jump in whatever channel ends up active",
  // which is the message-only link case.
  const [pendingJumpChannelId, setPendingJumpChannelId] = useState<
    string | null
  >(initialChannelId);
  // Set when a jump target resolved to a channel but was not in its loaded
  // window. This is the difference between a control that quietly does nothing
  // and one that says why it could not — the whole reason `scrollToMessage`
  // now reports reachability.
  //
  // Scoped to the channel it was raised in, not a bare message id. An
  // unscoped notice followed the member around: switching channels from the
  // rail left it standing in a channel the message was never in, and a
  // `?message=` link with no channel (so no `pendingJumpChannelId` to gate on)
  // re-raised it in every channel visited until it was dismissed.
  //
  // `reason` is why, since older history can now be loaded (#1571): the
  // target is past what a jump pages back (`far`), the channel's history ran
  // out without it (`missing`), a read it needed failed (`error`), or the
  // channel's messages failed to load and the timeline shows that (`unloaded`).
  const [unreachableTarget, setUnreachableTarget] = useState<{
    messageId: string;
    channelId: string | null;
    reason: UnreachableReason;
  } | null>(null);
  // The jump currently paging older history to reach its target, for the
  // "Finding that message..." line. Keyed like the notice, by message.
  const [seekingMessageId, setSeekingMessageId] = useState<string | null>(null);
  // Older pages this jump has asked for, bounded by `JUMP_MAX_OLDER_PAGES`.
  // Keyed on the attempt and the message, so a new request starts from zero.
  // `caughtUp` records the one forward read (`loadNewer`) each request makes
  // before paging back; `seekTick` re-runs the jump when that read lands.
  const jumpSeek = useRef<{
    attempt: number;
    messageId: string;
    channelId: string | null;
    pages: number;
    caughtUp: boolean;
    forwardFailed: boolean;
  }>({
    attempt: -1,
    messageId: "",
    channelId: null,
    pages: 0,
    caughtUp: false,
    forwardFailed: false,
  });
  const [seekTick, setSeekTick] = useState(0);
  // Bumped on every jump request so re-picking the SAME target re-runs the
  // effect. Without it, asking again for something already resolved as
  // unreachable changed no dependency, so the effect never re-ran: the notice
  // cleared and nothing else happened — an inert row again, on the natural
  // "did that work?" second click.
  const [jumpAttempt, setJumpAttempt] = useState(0);
  // `initialChannelId`/`initialMessageId` are only read by `useState`'s
  // initializer on first mount. A second deep link (another notification, a
  // second command-palette hit) navigated to while `/chat` is already
  // mounted only changes these *props* — Next's App Router updates search
  // params without remounting the page — so without this, the new target is
  // silently dropped. Re-applying it here whenever it's genuinely new (not
  // on every render) is what makes each deep link a fresh navigation intent.
  const appliedTargetRef = useRef({
    channelId: initialChannelId,
    messageId: initialMessageId,
  });
  /**
   * Which of the two columns is on screen below `lg`.
   *
   * The shell's responsive contract is two states switching once at `lg`
   * (`spec/ui/web-dashboard/README.md` § Responsive contract), and chat has to
   * hold it: below `lg` the app
   * nav is a drawer and `<main>` is the whole viewport, so a 240px channels
   * column beside the thread leaves the thread about 135px wide at the
   * documented 375px floor. That is not a narrow layout, it is an unusable one,
   * and it clears the floor's horizontal-scroll check while failing what the
   * check is for.
   *
   * So below `lg` exactly one column renders, the way every chat client on a
   * phone does it. At `lg` and up both are always visible and this is inert.
   *
   * Defaults to the thread rather than the list: a channel is always resolved
   * (the rail falls back to #general), and a `?message=` deep link must land on
   * the message rather than on a list the member then has to navigate out of.
   */
  const [narrowPane, setNarrowPane] = useState<"channels" | "thread">("thread");
  /*
    The member list (#3536). From 1280px it is a column beside the timeline,
    shown unless the member hid it, which a cookie remembers. Below that there
    is no room for a third column, so the same toggle opens it as a sheet.
  */
  const [membersHidden, setMembersHidden] = useState(defaultMembersHidden);
  const [membersSheetOpen, setMembersSheetOpen] = useState(false);
  const isWideChat = useMediaQuery(WIDE_CHAT_QUERY);
  const toggleMembers = () => {
    if (!isWideChat) {
      setMembersSheetOpen(true);
      return;
    }
    const next = !membersHidden;
    setMembersHidden(next);
    persistMembersHidden(next);
  };
  // Inside the dashboard shell, from `lg` up, the channels pane is the shell's
  // left column (`components/layout/nav-face.tsx`); everywhere else it is
  // inline beside the thread.
  const navFace = useNavFace();
  const isDesktopShell = useIsDesktopShell();
  const channelsInNav = Boolean(navFace?.channelsSlot && isDesktopShell);
  const showChannelsInNav = navFace?.showChannels;

  useEffect(() => {
    if (
      appliedTargetRef.current.channelId === initialChannelId &&
      appliedTargetRef.current.messageId === initialMessageId
    ) {
      return;
    }
    appliedTargetRef.current = {
      channelId: initialChannelId,
      messageId: initialMessageId,
    };
    // A new URL target (a Find result, a notification) is a new history entry
    // Next pushed, not the one this mount marked (#3824), so the arrow must
    // not go back through it and the next pick pushes its own.
    onThreadEntry.current = false;
    setSelectedChannelId(initialChannelId);
    setChannelTargetDismissed(false);
    setPendingMessageId(initialMessageId);
    setPendingJumpChannelId(initialChannelId);
    setUnreachableTarget(null);
    setJumpAttempt((n) => n + 1);
    // The route does not remount on a search-param change, so below `lg` the
    // member can be looking at the channels column when a link lands. Showing
    // the thread is the whole point of following one.
    //
    // Conditional, unlike the six above: a URL that clears back to `/chat`
    // names no target, and yanking someone off the channel list they are
    // reading is not what "no target" should mean.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing to the URL, the external system this whole effect exists to follow; the six setState calls above it are the same act
    if (initialChannelId) setNarrowPane("thread");
    // The same from `lg` up: a link that lands while the left column shows
    // the module nav brings the channel list back, so the channel it opened
    // is on screen in the list too.
    if (initialChannelId) showChannelsInNav?.();
  }, [initialChannelId, initialMessageId, showChannelsInNav]);

  /*
    Getting back from a channel without hunting for the arrow (#3824): the
    browser's Back and `Esc` return to the channel list.

    Below `lg` the thread and the list are one screen each, so opening a
    channel from the list is a step the member expects Back to undo. Picking a
    row pushes a same-URL history entry marked `THREAD_PANE_HISTORY_KEY`, and a
    `popstate` that lands off a marked entry shows the list. The arrow and
    `Esc` show the list at once and go back through that entry when we are on
    it, so the list is never one Back press away while also being on screen. A
    thread that opened without a pick (the landing channel, a deep link) has
    no entry of its own, and going back from it just shows the list, as the
    arrow always did.

    "On it" is the marker or `onThreadEntry`. The ref covers a later soft
    navigation to the same URL (the nav's Chat link, a notification for
    `/chat`): Next then rewrites the entry's state without our marker
    (`preserveCustomHistoryState: false`), and only this mount still knows the
    entry is the one it pushed. A new URL target (a Find result, a
    notification) is an entry Next pushed, so it clears the ref.
    `backPending` keeps a quick second press from going back a second entry,
    out of `/chat`, before the first `popstate` lands, and a pick made in that
    window pushes its entry once the `popstate` has.

    The spread keeps Next's own `__NA` state on the entry, which its patched
    `pushState` then passes straight through, and its `popstate` handler
    restores the same route for the same URL.

    From `lg` up the list is on screen beside the thread, so a pick pushes
    nothing; `Esc` there brings the channels back when the column shows the
    module nav. An entry pushed below `lg` that outlives a widening past it
    costs one Back press that changes nothing on screen.
  */
  const openThreadPane = useCallback(() => {
    setNarrowPane("thread");
    if (isDesktopShell) return;
    // A pick while our own Back is still traversing: `history.state` is the
    // entry being left, so push only once the `popstate` lands.
    if (backPending.current) {
      openAfterBack.current = true;
      return;
    }
    if (onThreadEntry.current) return;
    if (isThreadPaneEntry(window.history.state)) {
      onThreadEntry.current = true;
      return;
    }
    pushThreadPaneEntry();
    onThreadEntry.current = true;
  }, [isDesktopShell]);
  const backToChannels = useCallback(() => {
    setNarrowPane("channels");
    if (backPending.current) return;
    if (onThreadEntry.current || isThreadPaneEntry(window.history.state)) {
      backPending.current = true;
      onThreadEntry.current = false;
      window.history.back();
    }
  }, []);
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      backPending.current = false;
      if (openAfterBack.current) {
        openAfterBack.current = false;
        pushThreadPaneEntry();
        onThreadEntry.current = true;
        setNarrowPane("thread");
        return;
      }
      const thread = isThreadPaneEntry(event.state);
      onThreadEntry.current = thread;
      setNarrowPane(thread ? "thread" : "channels");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // `useChannels()` can serve a read up to its `staleTime` old. A channel
  // created moments ago (a fresh DM, a newly shared private channel) can
  // legitimately be absent from that cached read — declaring it "not found"
  // on a stale list would be a false alarm, not an honest one. A forced
  // refetch per target keeps the "missing" verdict below trustworthy.
  const refetchChannels = channelsQuery.refetch;
  useEffect(() => {
    if (initialChannelId === null) return;
    void refetchChannels();
  }, [initialChannelId, refetchChannels]);

  // A caller can pass a channel *name* (onboarding's completion redirect
  // uses the literal `general`) as well as an id, and `activeChannelId`
  // resolves either, so "missing" means neither matches.
  const requestedChannelMissing =
    !channelTargetDismissed &&
    initialChannelId !== null &&
    selectedChannelId === initialChannelId &&
    channels.length > 0 &&
    !channelsQuery.isFetching &&
    !channels.some(
      (ch) => ch.id === initialChannelId || ch.name === initialChannelId,
    );
  /*
    The member's last channel is remembered per browser, member and chapter.
    A member whose token carries no chapter claim still has a working channel
    list (sole membership resolves server-side), so they are keyed "sole",
    as on mobile, rather than never being remembered.
  */
  const lastChannelChapter = activeChapterId ?? "sole";
  const activeChannelId = useMemo(() => {
    if (requestedChannelMissing) return null;
    if (selectedChannelId) {
      const selected =
        channels.find((ch) => ch.id === selectedChannelId) ??
        channels.find((ch) => ch.name === selectedChannelId);
      if (selected) return selected.id;
    }
    if (channels.length === 0) return null;
    /*
      Landing waits for identity: the stored channel is keyed by member, and
      landing on `#general` first would stamp its read cursor (the mark-read
      effect below) over messages the member never saw, then jump a render
      later. A selection or a link above never waits.

      Read fresh, not once at mount: a fallback later in the visit (hiding
      the open DM, the open channel deleted) reads the channel that was just
      open, which `landingChannelId` skips as hidden or missing, so it lands
      on `#general` rather than on a channel from page load.

      Shared with the first-chunk cache, which pins this channel's tail
      against eviction: the two rules have to be one rule or the cache
      misses here.
    */
    if (!userId) return null;
    return landingChannelId(
      channels,
      readLastChannel(userId, lastChannelChapter),
    );
  }, [
    selectedChannelId,
    channels,
    requestedChannelMissing,
    userId,
    lastChannelChapter,
  ]);
  /*
    On a chapter switch the new chapter id lands one commit before the old
    chapter's channel list is cleared (`FrappProvider` drops the query cache
    in an effect that runs after this one), so the open channel would be
    written under the new chapter's key. Writes wait until the list changes.
  */
  const lastChannelWrite = useRef({
    chapterId: lastChannelChapter,
    list: channels,
    staleList: null as typeof channels | null,
  });
  useEffect(() => {
    const guard = lastChannelWrite.current;
    if (guard.chapterId !== lastChannelChapter) {
      // A claim arriving (null to an id) is not a switch: the list is the
      // same chapter's.
      if (activeChapterId !== null && guard.chapterId !== "sole") {
        guard.staleList = guard.list;
      }
      guard.chapterId = lastChannelChapter;
    }
    guard.list = channels;
    if (!activeChannelId || channels === guard.staleList) return;
    guard.staleList = null;
    writeLastChannel(userId, lastChannelChapter, activeChannelId);
  }, [activeChannelId, userId, activeChapterId, lastChannelChapter, channels]);

  const activeChannel = useMemo(
    () => channels.find((ch) => ch.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  // A 1:1 DM has no list worth showing: its two members are the header's own
  // title and the viewer.
  const showMemberList = !!activeChannel && activeChannel.type !== "DM";
  // Radix never reports a close it did not cause, so a sheet the window
  // outgrew, or whose channel became a 1:1 DM, is closed here, during render
  // (React's pattern for state derived from a change). Left open in state, it
  // would pop back up by itself on the next narrowing.
  if (membersSheetOpen && (isWideChat || !showMemberList)) {
    setMembersSheetOpen(false);
  }

  // DM channels are stored as `dm-<uuidA>-<uuidB>`; the header, the composer
  // placeholder and the sidebar must all show the resolved title instead.
  const activeChannelDescription = channelDescription(
    activeChannel?.description,
  );
  const activeChannelName = useMemo(() => {
    if (!activeChannel) return "";
    return directChannelDisplayName(
      {
        name: activeChannel.name,
        type: activeChannel.type,
        member_ids: activeChannel.member_ids ?? [],
      },
      userId,
      memberNames,
    );
  }, [activeChannel, userId, memberNames]);

  // Same resolution as `activeChannelName`, for any channel — a search hit in
  // another channel has to be labelled with the name a member would recognise,
  // and a DM's stored `dm-<uuidA>-<uuidB>` is not it.
  //
  // Built once as a Map rather than a `channels.find` per lookup: this is called
  // per rendered search hit per render, and the shell already keeps
  // `levelByChannelId` in exactly this shape a few lines up.
  const channelTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) {
      map.set(
        ch.id,
        directChannelDisplayName(
          { name: ch.name, type: ch.type, member_ids: ch.member_ids ?? [] },
          userId,
          memberNames,
        ),
      );
    }
    return map;
  }, [channels, userId, memberNames]);
  const channelNameFor = useCallback(
    (channelId: string) => channelTitles.get(channelId) ?? null,
    [channelTitles],
  );

  // The same predicate the push worker uses (#2771). An exact-name match could
  // pick a group DM a member named "announcements" once the real channel is
  // renamed, and send the officer's /announce there.
  const announcementsChannelId = useMemo(
    () =>
      channels.find((ch) =>
        isAnnouncementChannel({
          name: ch.name,
          type: ch.type,
          is_read_only: ch.is_read_only ?? null,
        }),
      )?.id ?? null,
    [channels],
  );

  // Backs `@member` resolution for member-targeted slash commands (/points).
  // Reads the roster projection rather than the full member list: `matchMember`
  // only ever touches `user_id` and `display_name`, so the fat profile put every
  // member's email, bio and city on the chat page to match a name (#986).
  const membersQuery = useChapterRoster();
  // Which `@`-tokens in the timeline really pinged someone (`useMentionChips`):
  // the roster above and the chapter's role names.
  const mentionRoles = useMentionRoles();
  const mentionChipTargets = useMemo<MentionChipTargets>(
    () => ({
      members: membersQuery.data
        ? asArray<MentionCandidate>(membersQuery.data)
        : undefined,
      roleNames: mentionRoles.data?.map((role) => role.name),
    }),
    [membersQuery.data, mentionRoles.data],
  );
  const resolveMember = useMemo<ResolveMember>(() => {
    const list = asArray<DirectoryMember>(membersQuery.data);
    return (token: string) => matchMember(list, token);
  }, [membersQuery.data]);

  const channel = useChatChannel(activeChannelId);
  // The top bar's connection pill says what this channel's realtime transport
  // is doing, folded with the app's own connection state, so the header no
  // longer draws a pill of its own (`spec/ui/resilience/connection-state.md`
  // § One indicator).
  useReportOpenChatTransport(activeChannelId ? channel.connection : null);
  const { toast } = useToast();

  // The member's own arrangement of the rail (#2877): pins, folds, filters.
  // A failed read leaves the default arrangement, which hides nothing.
  const sidebarPreferences = useSidebarPreferences();
  // A hook option, not `mutate`'s per-call `onError`, which fires only for the
  // latest write on the hook. The write has already put the list back on the
  // server's state; this says so.
  const sidebarWriteOptions = useMemo(
    () => ({
      onError: () =>
        toast({
          title: SIDEBAR_SAVE_FAILED_TITLE,
          description: SIDEBAR_SAVE_FAILED_BODY,
        }),
    }),
    [toast],
  );
  const { mutate: setChannelPinned } = useSetChannelPinned(sidebarWriteOptions);
  const { mutate: setSectionCollapsed } =
    useSetSidebarSectionCollapsed(sidebarWriteOptions);
  const { mutate: setSidebarFilter } = useSetSidebarFilter(sidebarWriteOptions);
  const sidebarControls = useMemo<ChannelSidebarControls>(() => {
    return {
      preferences: sidebarPreferences,
      mutedChannelIds,
      onSetPinned: (channel, pinned) =>
        setChannelPinned({ channelId: channel.id, pinned }),
      onSetCollapsed: (sectionKey, collapsed) =>
        setSectionCollapsed({ sectionKey, collapsed }),
      onSetFilters: (change) => setSidebarFilter(change),
      onClearFilters: () =>
        setSidebarFilter({ unread_only: false, hide_muted: false }),
    };
  }, [
    sidebarPreferences,
    mutedChannelIds,
    setChannelPinned,
    setSectionCollapsed,
    setSidebarFilter,
  ]);
  // Stable for the timeline's load-at-top effect, which lists it as a
  // dependency; the outcome is the hook's `olderError`/`hasOlder` to report.
  const { loadOlder, loadNewer } = channel;
  const loadOlderHistory = useCallback(() => {
    void loadOlder();
  }, [loadOlder]);

  // The viewer's block list, applied on top of the server's mask (#2313). The
  // server masks what it serves, but a row that arrived over the Realtime echo
  // was never evaluated, so every row is classified here from its provenance,
  // this list and this session's clearances (`use-thread-block-list.ts`). The
  // timeline draws only what this lets through; `BlockListNotice` says when
  // rows are held.
  const { blockList, blockState, thread } = useThreadBlockList(
    channel.messages,
    userId,
  );
  // A blocked member's `typing` broadcast still arrives; in a DM the indicator
  // would say they are writing to the viewer (#2496).
  const typingUsers = visibleTypingUsers(
    channel.typingUsers,
    blockState,
    userId,
  );
  // The rows drawn in full: what every surface beside the timeline that prints
  // a message's author or words reads (the Pinned panel and its count). A
  // tombstoned row carries a blocked member's words whenever an echo put them
  // back, and a held row is one the list cannot vouch for yet, so neither may
  // reach a surface that has no tombstone of its own.
  const shownMessages = useMemo(
    () =>
      thread.rows
        .filter((row) => row.visibility === "visible")
        .map((row) => row.message),
    [thread.rows],
  );
  // Every row the timeline draws, tombstones included: what a jump can reach.
  const drawnMessageIds = useMemo(
    () => new Set(thread.rows.map((row) => row.message.id)),
    [thread.rows],
  );
  // Pins the block list keeps off the Pinned panel, counted so the panel says
  // so rather than reading as "nothing pinned": a blocked member's (drawn as a
  // tombstone), and ones it cannot vouch for yet (held, not drawn at all).
  const hiddenPins = useMemo(
    () => ({
      blocked: thread.rows.filter(
        (row) => row.visibility === "tombstone" && row.message.is_pinned,
      ).length,
      held: channel.messages.filter(
        (message) => message.is_pinned && !drawnMessageIds.has(message.id),
      ).length,
    }),
    [thread.rows, channel.messages, drawnMessageIds],
  );
  const unblockFlow = useUnblockFlow();
  const maskedRefresh = useMaskedRefresh();
  const { requestUnblock, reloadMaskedCopies } = unblockFlow;
  const handleUnblock = useCallback(
    (senderId: string) => {
      void requestUnblock(senderId, nameFor(senderId));
    },
    [nameFor, requestUnblock],
  );
  const handleReloadMasked = useCallback(
    (senderId: string) => {
      void reloadMaskedCopies(senderId);
    },
    [reloadMaskedCopies],
  );

  // Report and Block from a row's More menu (#2687), the rules mobile's
  // actions sheet uses, with the same `DepartedMembers` bookkeeping.
  const blockFlow = useBlockFlow();
  const { requestBlock } = blockFlow;
  const [departed, setDeparted] = useState<DepartedMembers>(() =>
    noDepartedMembers(activeChapterId),
  );
  const departedIds = departedIn(departed, activeChapterId);
  const isMember = useMemo(
    () =>
      rosterMembership(
        { byId: memberNames, isPending: rosterPending, isError: rosterError },
        departedIds,
      ),
    [memberNames, rosterPending, rosterError, departedIds],
  );
  const handleBlock = useCallback(
    (message: ChatMessage) => {
      const senderId = message.sender_id;
      if (!senderId) return;
      void requestBlock({
        userId: senderId,
        // The name the menu item showed, which falls back to an imported
        // row's `author_name` where the roster has no entry yet.
        name: resolveAuthorName(message, nameFor),
        inDirectory: isMember(senderId) === true,
      }).then((result) => {
        if (result !== "not-a-member") return;
        setDeparted((previous) =>
          withDeparted(previous, activeChapterId, senderId),
        );
      });
    },
    [activeChapterId, isMember, nameFor, requestBlock],
  );
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  // Whose profile is open (#3726): a sender's name or photo, an `@` chip, or a
  // row of the member list opens the directory's own sheet by `users.id`, as
  // mobile's thread does. The id outlives the close so the sheet keeps its
  // member through its exit animation instead of blanking.
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const openProfile = useCallback((memberUserId: string) => {
    setProfileUserId(memberUserId);
    setProfileOpen(true);
  }, []);
  const handleReport = useCallback(
    (message: ChatMessage) => {
      const canBlock = !!userId && canBlockSender(message, userId, isMember);
      const name = resolveAuthorName(message, nameFor);
      setReportTarget({
        messageId: message.id,
        onBlock: canBlock ? () => handleBlock(message) : undefined,
        blockLabel: canBlock ? blockActionLabel(name) : null,
      });
    },
    [handleBlock, isMember, nameFor, userId],
  );

  // A custom role can hold `channels:manage` without also being a chapter
  // admin — same gate `chat-admin-page.tsx` computes for its own page-level
  // `<Can>`, done inline here since this is a per-row boolean, not a whole
  // surface to hide.
  const permissionsQuery = useMyPermissions();
  const permissionsPayload = permissionsQuery.data;
  const canManageChannel = can(
    "channels:manage",
    permissionsPayload?.permissions,
  );

  // `/event` typed bare, with details the one-liner can't read, or picked
  // from the palette or the composer's + menu, opens the Events page's own
  // form, filled in with what was typed, and the card posts in the channel it
  // came from (#3773, #3865).
  const [eventForm, setEventForm] = useState<{
    open: boolean;
    channelId: string;
    prefill: EventFormPrefill;
  } | null>(null);
  // `/poll` the same way: the New poll dialog (#3773 step 2). Keyed per open,
  // so each visit starts from what was typed and posts where it was opened.
  const [pollForm, setPollForm] = useState<{
    open: boolean;
    key: number;
    channelId: string;
    draft: PollDraft;
  } | null>(null);
  const openCommandForm = useCallback(
    (command: SlashCommand, args: string): CommandFormOutcome => {
      if (!activeChannelId) return null;
      if (command.name === "poll") {
        if (parsePollArgs(args).ok) return null;
        // No role check: `/poll` lets any member post a poll today, and
        // whether it should is #3007's open call. The + menu offers Poll
        // only to `polls:create`, as the phone's + does.
        setPollForm((previous) => ({
          open: true,
          key: (previous?.key ?? 0) + 1,
          channelId: activeChannelId,
          draft: pollDraftFromArgs(args),
        }));
        return "opened";
      }
      if (command.name !== "event") return null;
      if (parseEventArgs(args).ok) return null;
      // Unknown until the read lands, and the server enforces it either way,
      // so only a loaded grant without it refuses before the form opens.
      if (
        permissionsPayload &&
        !canAll(EVENT_CREATE_PERMISSIONS, permissionsPayload.permissions)
      ) {
        toast({
          title: "You can't create events",
          description:
            "Your role doesn't include creating events. An officer can add it in Settings.",
          variant: "destructive",
        });
        return "refused";
      }
      setEventForm({
        open: true,
        channelId: activeChannelId,
        prefill: eventFormPrefill(args),
      });
      return "opened";
    },
    [activeChannelId, permissionsPayload, toast],
  );

  // What the composer's + offers beside Attach a file (#3865), and whether
  // the member's role may use each: `"loading"` until the read lands, so a row
  // isn't blamed on the role before it does, and `"unknown"` if it failed.
  // Task, Service hours and Points join as their forms learn to post into the
  // channel.
  // A read paused offline before it ever landed can't answer either, and
  // stays `pending` rather than erroring, so it counts as failed here.
  const permissionsFailed =
    permissionsQuery.isError ||
    (permissionsQuery.fetchStatus === "paused" && !permissionsPayload);
  const commandForms = useMemo((): PlusMenuForm[] => {
    const granted = permissionsPayload?.permissions;
    const allows = (check: (list: string[]) => boolean) =>
      granted ? check(granted) : permissionsFailed ? "unknown" : "loading";
    return [
      { command: "poll", roleAllows: allows((list) => can("polls:create", list)) },
      {
        command: "event",
        roleAllows: allows((list) => canAll(EVENT_CREATE_PERMISSIONS, list)),
      },
    ];
  }, [permissionsPayload, permissionsFailed]);

  // Memoised because the timeline hands it to the virtualizer's header
  // context, and a new element every render would re-render that row.
  const channelStartNode = useMemo(
    () =>
      activeChannel ? (
        <ChannelStart
          channel={activeChannel}
          displayName={activeChannelName}
          canEdit={canManageChannel}
        />
      ) : undefined,
    [activeChannel, activeChannelName, canManageChannel],
  );

  // Bookmarks (#462). One chapter-wide query backs both the panel and every
  // row's toggle state, so the two can never disagree about what is saved.
  const bookmarksQuery = useBookmarks();
  const bookmarks = useMemo(
    () => asArray<BookmarkEntry>(bookmarksQuery.data),
    [bookmarksQuery.data],
  );
  const bookmarkedMessageIds = useBookmarkedMessageIds();
  const bookmarkMessage = useBookmarkMessage();
  const unbookmarkMessage = useUnbookmarkMessage();
  const handleToggleBookmark = useCallback(
    (messageId: string, next: boolean) => {
      // Both routes are idempotent server-side, so a double-tap or a retry is
      // a no-op rather than an error — no in-flight guard is needed here.
      //
      // A failure is NOT swallowed, though. There is no optimistic write, so a
      // failed save leaves the chip reading "Save" exactly as if nothing had
      // been tapped — the member gets silence and concludes the feature is
      // broken. The sibling control in this same header (notification level)
      // already surfaces its failure as a `role="alert"`; this follows it.
      if (next) bookmarkMessage.mutate(messageId);
      else unbookmarkMessage.mutate(messageId);
    },
    [bookmarkMessage, unbookmarkMessage],
  );
  const bookmarkWriteFailed =
    bookmarkMessage.isError || unbookmarkMessage.isError;
  const resetBookmarkMessage = bookmarkMessage.reset;
  const resetUnbookmarkMessage = unbookmarkMessage.reset;
  // Cleared on a channel switch, mirroring the notification-level control
  // beside it. Both mutations live at the shell level and TanStack keeps
  // `isError` set until the next attempt, so without this one failed save
  // pins "Bookmark not saved" into every channel header for the rest of the
  // session — an alert that outlives its cause is worse than none.
  useEffect(() => {
    resetBookmarkMessage();
    resetUnbookmarkMessage();
  }, [activeChannelId, resetBookmarkMessage, resetUnbookmarkMessage]);

  const { confirm, confirmDialog } = useConfirmDialog();
  // Delete message and Close poll (#3794) are both destructive, so both ask
  // first through one flow: the copy is the action's, and a failure was
  // already toasted by the chat-core action, so it is swallowed here.
  // Mobile's equivalent is `confirmDestructive`.
  const confirmThen = useCallback(
    (
      copy: { title: string; description: string; confirmLabel: string },
      action: () => Promise<void>,
    ) => {
      void (async () => {
        const confirmed = await confirm({ ...copy, tone: "destructive" });
        if (!confirmed) return;
        try {
          await action();
        } catch {
          // The chat-core action already toasted the failure.
        }
      })();
    },
    [confirm],
  );
  const deleteMessage = channel.delete;
  const handleDeleteMessage = useCallback(
    (messageId: string) =>
      confirmThen(
        {
          title: DELETE_MESSAGE_CONFIRM_TITLE,
          description: DELETE_MESSAGE_CONFIRM_BODY,
          confirmLabel: DELETE_MESSAGE_CONFIRM_LABEL,
        },
        () => deleteMessage(messageId),
      ),
    [confirmThen, deleteMessage],
  );
  const closePoll = channel.closePoll;
  const handleClosePoll = useCallback(
    (messageId: string) =>
      confirmThen(
        {
          title: CLOSE_POLL_CONFIRM_TITLE,
          description: CLOSE_POLL_CONFIRM_BODY,
          confirmLabel: CLOSE_POLL_CONFIRM_LABEL,
        },
        () => closePoll(messageId),
      ),
    [confirmThen, closePoll],
  );

  const setNotificationLevel = useSetChannelNotificationLevel();

  // `useSetChannelNotificationLevel` is ONE mutation instance for the whole
  // shell, and TanStack keeps `isError` set until the next `mutate()`. Passing
  // it straight through pinned a "could not save" alert onto every channel for
  // the rest of the session after a single failure — a confident, wrong claim
  // about channels the member never touched. Scope it to the channel the failed
  // write was actually for. Do not `reset()` on channel change: wiring that
  // effect to `isError` cleared the alert on the channel that failed, and an
  // unconditional reset detached in-flight writes. `failedChannelId ===
  // activeChannel.id` is enough — returning to the failed channel still
  // shows the error, which is honest.
  const failedChannelId = setNotificationLevel.isError
    ? setNotificationLevel.variables?.channelId
    : undefined;

  // Hide conversation (#2303).
  //
  // Each hide awaits its own `mutateAsync` promise rather than passing
  // callbacks to `mutate`. The mutation is one instance for the whole shell,
  // and TanStack v5 runs per-call callbacks only for the latest call, so a
  // second hide confirmed while the first was in flight would drop the first
  // one's selection reset and its failure. A failure toasts at once: a hide
  // can start from the rail on a DM that is not open, where no header line
  // would ever be seen.
  const leaveChannelAsync = useLeaveChannel().mutateAsync;
  const hideConversation = useCallback(
    (channelId: string) => {
      leaveChannelAsync(channelId).then(
        // The hidden DM stays in `channels` (flagged), so without this the
        // selection would keep it open and on the rail. Only if the member
        // is still on it: they may have moved on while the write was out.
        () =>
          setSelectedChannelId((current) =>
            current === channelId ? null : current,
          ),
        () =>
          toast({
            title: HIDE_CONVERSATION_FAILED_TITLE,
            description: HIDE_CONVERSATION_FAILED_BODY,
          }),
      );
    },
    [leaveChannelAsync, toast],
  );
  // The rail's Hide asks first, in the shell's own dialog; the header menu's
  // asks in its panel. Both land in `hideConversation`.
  const hideFromRail = useCallback(
    (target: ChatChannel) => {
      void (async () => {
        const confirmed = await confirm({
          title: hideConversationConfirmTitle(
            channelNameFor(target.id) ?? target.name,
          ),
          description: HIDE_CONVERSATION_CONFIRM_BODY,
          confirmLabel: HIDE_CONVERSATION_CONFIRM_ACTION,
          // Not destructive: nothing is deleted, and the body says so.
          tone: "default",
        });
        if (confirmed) hideConversation(target.id);
      })();
    },
    [confirm, channelNameFor, hideConversation],
  );
  // Picking a DM from the rail's Hidden conversations group is opening it
  // again yourself, which is what clears a hide: `POST /v1/channels/dm` with
  // the other member does it server-side, and its refetch moves the row back.
  // The thread opens at once either way, since a hidden DM stays readable.
  const reopenDm = useGetOrCreateDm();

  // Opening a channel stamps the read cursor, and so does hiding a DM (#2303:
  // a hidden row must leave no badge), and so does the rail's right-click
  // Mark as read. So does a message from someone else landing in the open
  // channel while the tab is visible (#3698: `useChatActivityHandler`, which
  // the shell's `useChatRealtimeBinding` wires, re-stamps the channel claimed
  // below). Those are the only things that move it, and the only things that
  // clear the badges above. Without it the rail lights up on first load and never goes out,
  // which is worse than the dead badge this slice replaced: it would show
  // every channel as permanently unread.
  // `spec/behavior/chat/README.md` § Read Receipts: opening stamps to server
  // `now()`; there is no mark-read-to-a-message.
  const markRead = useMarkChannelRead();
  const markReadMutate = markRead.mutate;
  /*
    Only while the thread is on screen. Below `lg` the list and the thread are
    one screen each, and a member back on the list (the arrow, `Esc`, the
    browser's Back, #3824) is not looking at the channel: still claimed, a
    message landing in it was stamped read before they ever saw it, so the
    nav's Chat row never lit and the channel came back read. Leaving the
    thread for the list runs the cleanup, which stamps it read on the way out as leaving
    a channel always has; coming back claims and stamps it again. From `lg`
    up both are on screen and `narrowPane` changes nothing.
  */
  const threadOnScreen = isDesktopShell || narrowPane === "thread";
  useEffect(() => {
    if (!activeChannelId || !threadOnScreen) return;
    markReadMutate(activeChannelId);
    const releaseViewed = claimViewedChannel(activeChannelId);
    // Stamp again on the way out, so messages that arrived while the channel
    // was open do not resurface as unread. Mobile does the same on blur.
    return () => {
      releaseViewed();
      markReadMutate(activeChannelId);
    };
  }, [activeChannelId, threadOnScreen, markReadMutate]);

  // The rail row's right-click menu (owner, 2026-11-06). Which rows a channel
  // offers is `channelRowActions`' call in `@repo/hooks`, scoped to the
  // member's permissions; these are what each one does.
  const router = useRouter();
  const deleteChannelFlow = useDeleteChannelFlow(confirm);
  // Its own mutation instance, not the header's: sharing one moved the
  // header's `isError`/`variables` to whichever channel the rail last changed
  // (clearing the open channel's "not saved" alert) and locked the header
  // while a rail write was pending.
  const setRailNotificationLevelAsync =
    useSetChannelNotificationLevel().mutateAsync;
  const rowActions = useMemo<ChannelRowActions>(
    () => ({
      permissions: permissionsPayload?.permissions,
      onMarkRead: (channelId) => markReadMutate(channelId),
      notificationLevelFor: (channelId) => levelByChannelId.get(channelId),
      // The header's alert only shows on the open channel, and a rail change
      // is usually to one that isn't, so a failure toasts. Per call, because
      // `mutate`'s per-call `onError` runs only for the latest call.
      onSetNotificationLevel: (channelId, level) =>
        void setRailNotificationLevelAsync({ channelId, level }).catch(() =>
          toast({
            variant: "destructive",
            description: "Couldn't change notifications. Try again.",
          }),
        ),
      onCopyLink: (channelId) => {
        const url = `${window.location.origin}${chatDeepLink({ channelId })}`;
        void (async () => {
          try {
            // Inside the try: without a secure context `navigator.clipboard`
            // is undefined and the call throws before any promise exists.
            await navigator.clipboard.writeText(url);
            toast({ description: "Link copied" });
          } catch {
            toast({
              variant: "destructive",
              title: "Copy failed",
              description: "Open the channel and copy the address bar.",
            });
          }
        })();
      },
      onEdit: (channelId) =>
        router.push(`/chat-admin?channel=${encodeURIComponent(channelId)}`),
      onDelete: (channelId) => {
        const name =
          channels.find((c) => c.id === channelId)?.name ?? "this channel";
        void deleteChannelFlow({ id: channelId, name }, () =>
          setSelectedChannelId((current) =>
            current === channelId ? null : current,
          ),
        );
      },
    }),
    [
      permissionsPayload?.permissions,
      markReadMutate,
      levelByChannelId,
      setRailNotificationLevelAsync,
      toast,
      router,
      channels,
      deleteChannelFlow,
    ],
  );

  // Unread and mention counts come from `GET /v1/channels/unread`, never from a
  // local re-derivation: the server excludes the viewer's own and deleted
  // messages and treats a never-opened channel as entirely unread, so a second
  // definition would disagree on exactly those cases
  // (`spec/behavior/chat/README.md` § Read Receipts).
  const unreadQuery = useChannelUnreadCounts();
  // A failed fetch must not read as "everything is read". `ChannelList` maps
  // an absent row to zero, so handing it an empty map on error would render
  // every row calm and unbadged — telling a member they have no @-mentions at
  // the exact moment we cannot know. `sidebarUnreadCounts` gives `undefined`
  // then ("no counts"), which the rail shows as neither read nor unread, and
  // which the sidebar's Unread only filter reads as unknown. Mobile's s04 uses
  // the same helper.
  const unreadByChannelId = useMemo(
    () =>
      sidebarUnreadCounts({
        data: unreadQuery.data,
        isError: unreadQuery.isError,
      }),
    [unreadQuery.data, unreadQuery.isError],
  );

  // The slash gate reads `enabled_modules` from the member view, not the
  // officer-only config, which errors for every member below President and so
  // hid their module commands for good (#2957). It fails closed while that read
  // is loading or errored (#310): the palette shows its loading and error
  // states, and the composer refuses a typed module command until it resolves.
  // The server refuses a disabled module's write either way (#2993); this gate
  // is what lets the member hear it before a round trip.
  const moduleGate = useChapterModuleGateState();
  const isModuleEnabled = moduleGate.isModuleEnabled;
  const slashCommandsStatus = moduleGate.status;
  const onRetrySlashCommands = moduleGate.retry;

  /**
   * The message the composer's next send replies to (#489).
   *
   * An id, not the message: `channel.messages` is the live copy, so deriving
   * the strip from it below means an edit, a delete or a reaction on the parent
   * is reflected in what the member sees they are replying to. A snapshot taken
   * at click time would quote text that no longer exists.
   *
   * Carries its **channel** alongside the message id, so a target can never
   * outlive the channel it was staged in. `chat.service.ts` 400s a
   * `reply_to_id` naming a message in another channel, and clearing on the
   * switch paths alone is not enough to prevent that: the deep-link effect sets
   * `selectedChannelId` directly without going through any switch handler.
   * Scoping makes it structural rather than a cleanup every future switch path
   * has to remember.
   */

  const [replyTarget, setReplyTarget] = useState<{
    channelId: string;
    messageId: string;
  } | null>(null);
  // Channel-scoped: the notice belongs to the channel the jump was attempted
  // in, so it never follows the member into a channel the message was never in.
  // A pending jump whose target is loaded but held by the block list (#2313):
  // not a miss, and nothing to page history for. It shows the
  // same dismissible notice with words that are true, over any earlier miss's.
  const pendingTargetHeld =
    pendingMessageId !== null &&
    (!pendingJumpChannelId || pendingJumpChannelId === activeChannelId) &&
    !drawnMessageIds.has(pendingMessageId) &&
    channel.messages.some((message) => message.id === pendingMessageId);
  const showUnreachableNotice =
    pendingTargetHeld ||
    (unreachableTarget !== null &&
      unreachableTarget.channelId === activeChannelId);
  // A jump paging older history toward its target (#1571). Said out loud
  // because it can take a few seconds, and a silent wait reads as a dead row.
  const showSeekingNotice =
    !showUnreachableNotice &&
    seekingMessageId !== null &&
    seekingMessageId === pendingMessageId &&
    (!pendingJumpChannelId || pendingJumpChannelId === activeChannelId);
  // Pins are a navigation affordance, not a list: the popover's rows were
  // rendered as buttons but `onJump` was never wired, so every one of them was
  // inert. The timeline exposes the scroll, the shell owns the wiring.
  const timeline = useRef<MessageTimelineHandle | null>(null);
  const jumpToMessage = useCallback((messageId: string) => {
    const reached = timeline.current?.scrollToMessage(messageId);
    // Keyboard focus has to go somewhere the scroll can't take away. Every
    // trigger that lands here is inside the virtualized timeline or inside a
    // popover that closes behind the jump, so `react-virtuoso` unmounts the
    // focused element the moment the list scrolls and focus falls to `<body>` —
    // the next Tab starts from the top of the document. The landmark is the
    // destination anyway, and #396 made it focusable for exactly this.
    if (reached) document.getElementById("chat-timeline")?.focus();
  }, []);

  // Every jump — a search hit, a bookmark, a `?message=` deep link — takes the
  // same route: `pendingMessageId` + the jump effect below. Including a target
  // in the channel already open.
  //
  // The same-channel case used to scroll directly, on the reasoning that no
  // channel switch had to be waited for. That was wrong in the way that matters
  // most here: `scrollToMessage` cannot reach a message outside the loaded
  // window, so for any target older than the backfill it did nothing at all,
  // said nothing, and left nothing pending to retry. Search exists to reach old
  // messages, so that was the common case, not the edge — an inert row of
  // exactly the kind `spec/ui/design-system/README.md` §5 rule 2 bans. One path
  // for every case means the unreachable-target handling below covers them all.
  const jumpToChannelMessage = useCallback(
    (channelId: string, messageId: string) => {
      if (channelId !== activeChannelId) {
        setSelectedChannelId(channelId);
        setChannelTargetDismissed(false);
        // Search and bookmarks both read live rows while `useChannels()` serves
        // up to its `staleTime`, so a target can legitimately name a channel
        // the cached list has never seen (a DM opened moments ago). Without
        // this the id fails `channels.some(...)`, `activeChannelId` quietly
        // falls back to #general, and the member lands somewhere they did not
        // ask for with the jump stranded. The deep-link path already forces
        // this refetch for the same reason.
        void refetchChannels();
      }
      setUnreachableTarget(null);
      setPendingMessageId(messageId);
      setPendingJumpChannelId(channelId);
      setJumpAttempt((n) => n + 1);
      // Below `lg` the thread column may be off-screen. Jumping into a
      // `display:none` column consumes the target — `scrollToMessage` finds the
      // index, reports success, and the pending state clears — while nothing
      // visibly happens, so the link reads as broken.
      setNarrowPane("thread");
    },
    [activeChannelId, refetchChannels],
  );

  // The channel's effective notification level, or `null` when it is not known
  // yet. Read once here because two places need it: the mute mark beside the
  // channel name, and the panel behind `⋯`.
  const activeChannelLevel = activeChannelId
    ? (levelByChannelId.get(activeChannelId) ?? null)
    : null;

  /** Search hit (#469) — the panel carries the channel on every row. */
  const jumpToSearchHit = useCallback(
    (hit: ChatSearchHit) => jumpToChannelMessage(hit.channelId, hit.message.id),
    [jumpToChannelMessage],
  );

  /**
   * Bookmark (#462). The Bookmarks panel is chapter-wide, unlike the in-channel
   * pins panel, so its rows routinely target another channel — the same shape
   * as a search hit, and now the same code path.
   */
  const jumpToBookmark = jumpToChannelMessage;

  // A pending target jumps once that message is present in the loaded window.
  //
  // A miss keeps the target pending — a message that arrives later still gets
  // its jump, which is the behaviour deep links have always had — but it no
  // longer keeps *quiet* about it. `scrollToMessage` now reports reachability,
  // so a miss sets the notice rendered in the header below and a later hit
  // clears it. Silence was survivable for pins (a pin you can see is loaded by
  // definition) and is not for search or bookmarks, whose whole job is reaching
  // messages beyond the loaded window: every such row looked inert.
  //
  // A miss with older history still to load pages back for it first (#1571),
  // one page per run of this effect, up to `JUMP_MAX_OLDER_PAGES`. Each page
  // changes `channel.messages` or settles `isLoadingOlder`, and either re-runs
  // this, so the loop needs no timer. The notice is the fallback, not the
  // normal path: the target is further back than the bound, the channel's
  // history ran out without it, or the read failed.
  useEffect(() => {
    if (!pendingMessageId) return;
    // A named channel target must resolve to it first — a message id paired
    // with one channel would be nonsense to look up in another. No channel
    // was named (message-only link): proceed against whatever channel ended
    // up active.
    if (
      pendingJumpChannelId !== null &&
      activeChannelId !== pendingJumpChannelId
    ) {
      return;
    }
    if (channel.isLoading) return;
    /*
      The timeline withholds its rows — and with them `<Virtuoso>` — until the
      viewer resolves (#2243), and `scrollToMessage` reports honestly that it
      could not scroll when there is no virtualizer attached. Without this the
      jump would run into that window and read the `false` as "this message is
      outside the loaded window", paging older history for it and then
      painting the unreachable notice over a message that is in fact loaded.

      A warm cold-start with `?message=` hits it squarely: `seedFirstChunk`
      writes the tail straight into the query cache, so `channel.isLoading` is
      already false above while `GET /v1/users/me` is still in flight. `userId`
      is in the dependency list below so the resolve re-runs the jump, which is
      the half that makes returning here a deferral rather than a silent drop.

      `liveUserId`, deliberately not the cached-or-live `userId` (#2249). What
      this guard needs is the *live window*, not an identity: it pages older
      history and then reports the target unreachable when `scrollToMessage`
      misses, and the cached tail is 30 rows that by
      definition predate the cache being written — so a deep link to a message
      posted while the member was away would miss against it and paint that
      copy over a message the backfill is seconds from delivering. It clears
      itself when the backfill lands, but a screen reader has already been told.
      See the note beside `liveUserId` for why this is a proxy and what
      replaces it.
    */
    if (!liveUserId) return;
    // Loaded but held: the block list cannot vouch for it yet, so the timeline
    // has no row to scroll to (#2313). That is not a miss, so nothing is set
    // here; `pendingTargetHeld` says so in the notice instead, and
    // `drawnMessageIds` below re-runs this once the list lets the row through.
    if (pendingTargetHeld) return;
    const jumped = timeline.current?.scrollToMessage(pendingMessageId) ?? false;
    if (jumped) {
      setPendingMessageId(null);
      setPendingJumpChannelId(null);
      setUnreachableTarget(null);
      setSeekingMessageId(null);
      return;
    }
    // The timeline could not load, so there is nothing to scroll or page:
    // say that, not that the message is gone.
    if (channel.loadError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect reports the outcome of the imperative scroll above, like every setter below it
      setSeekingMessageId(null);
      setUnreachableTarget({
        messageId: pendingMessageId,
        channelId: activeChannelId,
        reason: "unloaded",
      });
      return;
    }
    // Per channel as well as per request: a message-only link runs in
    // whichever channel is active, and a budget spent in one must not starve
    // the next.
    const seek = jumpSeek.current;
    if (
      seek.attempt !== jumpAttempt ||
      seek.messageId !== pendingMessageId ||
      seek.channelId !== activeChannelId
    ) {
      jumpSeek.current = {
        attempt: jumpAttempt,
        messageId: pendingMessageId,
        channelId: activeChannelId,
        pages: 0,
        caughtUp: false,
        forwardFailed: false,
      };
    }
    // The first move is forward, not back. A target can be newer than the
    // cache as easily as older — a notification for a message posted during a
    // Realtime gap — and paging back for it would spend the budget in the
    // wrong direction and then call it gone. One read of what arrived after
    // the newest row settles that; the tick re-runs this when it adds nothing.
    if (!jumpSeek.current.caughtUp) {
      const request = jumpSeek.current;
      request.caughtUp = true;
      setUnreachableTarget(null);
      setSeekingMessageId(pendingMessageId);
      void loadNewer().then((read) => {
        // A failed forward read leaves "newer than the cache" unchecked, so
        // no verdict below may claim the message is gone or further back.
        if (read === null) request.forwardFailed = true;
        setSeekTick((n) => n + 1);
      });
      return;
    }
    const { pages } = jumpSeek.current;
    // A failure from before this request (a scroll-up that failed) does not
    // stop it trying; only a page this request asked for does.
    const failed = channel.olderError && pages > 0;
    if (channel.hasOlder && pages < JUMP_MAX_OLDER_PAGES && !failed) {
      setUnreachableTarget(null);
      setSeekingMessageId(pendingMessageId);
      if (!channel.isLoadingOlder) {
        jumpSeek.current.pages += 1;
        void loadOlder();
      }
      return;
    }
    setSeekingMessageId(null);
    setUnreachableTarget({
      messageId: pendingMessageId,
      channelId: activeChannelId,
      reason:
        failed || jumpSeek.current.forwardFailed
          ? "error"
          : channel.hasOlder
            ? "far"
            : "missing",
    });
  }, [
    pendingMessageId,
    activeChannelId,
    pendingJumpChannelId,
    channel.isLoading,
    channel.loadError,
    channel.messages,
    channel.hasOlder,
    channel.isLoadingOlder,
    channel.olderError,
    loadOlder,
    loadNewer,
    seekTick,
    drawnMessageIds,
    pendingTargetHeld,
    jumpAttempt,
    liveUserId,
  ]);

  /**
   * Stages an inline reply, normalized to the root message (`replyTargetId` in
   * `@repo/chat-core/message-actions` says why it is client-side, and why one
   * hop is enough).
   */
  const startReply = useCallback((message: ChatMessage) => {
    setReplyTarget({
      channelId: message.channel_id,
      messageId: replyTargetId(message),
    });
  }, []);
  const cancelReply = useCallback(() => setReplyTarget(null), []);
  /**
   * Re-stage the reply a refused send carried (#1728). The composer calls this
   * only when it is putting the whole message back into an untouched composer,
   * so nothing else is staged; `current ??` keeps that true if it ever is.
   * Scoped to `activeChannelId` as of the send: the composer calls the copy of
   * this its send closed over, and `<Composer>` is keyed per channel, so a
   * send refused after a switch finds its editor destroyed and restores
   * nothing.
   */
  const restoreReply = useCallback(
    (messageId: string) => {
      if (!activeChannelId) return;
      setReplyTarget(
        (current) => current ?? { channelId: activeChannelId, messageId },
      );
    },
    [activeChannelId],
  );
  /**
   * Whether to offer Reply on rows in this channel at all. Both `can_post` and
   * `is_read_only` are load-bearing; `channelAllowsReplies` says which case
   * each covers.
   *
   * Read off the two fields the rail actually carries rather than mirroring
   * the API's `allowsInThreadReplies` (`apps/api/src/domain/utils/
   * channel-access.ts`). That predicate takes a whole `ChannelAccessRecord`,
   * and the fields the rail has never loaded would have to be invented —
   * `required_permissions: null` and no `archived_at`. That is a projection
   * wearing the full type: the moment the predicate consults a field such a
   * literal fabricates, a copy silently disagrees with the server while
   * *looking* like it cannot. This is a UX pre-filter; the server is the
   * enforcement, and it is the server's copy of the rule that has to be right.
   */
  const canReplyHere = !!activeChannel && channelAllowsReplies(activeChannel);
  /**
   * The staged reply, resolved for the composer's strip.
   *
   * **This, not `replyTarget`, is what a send reads.** The strip the member can
   * see and the `reply_to_id` the send carries come from the *same* derivation,
   * so they cannot disagree — a reply nobody was shown they were sending is
   * ruled out by construction rather than by an effect syncing state back down
   * (which would also be a `setState` in an effect, and is what
   * `react-hooks/set-state-in-effect` is right to refuse).
   *
   * It resolves to `null` only when nothing is staged for *this* channel. A
   * staged target whose parent is not loaded still resolves — to the
   * unavailable variant — so it stays visible and dismissable.
   */
  const replyTo = useMemo(() => {
    if (!replyTarget || replyTarget.channelId !== activeChannelId) return null;
    const parent = channel.messages.find((m) => m.id === replyTarget.messageId);
    // Staged but not in the loaded window — `author: null` renders
    // `QuotedMessage`'s unavailable variant. It must NOT collapse to `null`:
    // the id is still perfectly sendable (the server validates same-channel,
    // which scoping already guarantees), so dropping the strip would leave the
    // member with a reply they can neither see nor dismiss, which then either
    // vanishes from the send or re-attaches when the parent reappears.
    //
    // Reachable, not hypothetical, in two ways: root normalization can target a
    // root older than what `useChatChannel` has loaded so far (#1571), and a
    // refetch can re-window the list under a reply already staged.
    if (!parent) {
      return { id: replyTarget.messageId, author: null, preview: null };
    }
    return {
      id: parent.id,
      author: resolveAuthorLabel(parent, nameFor, userId),
      preview: replyPreviewText(parent),
      hidden: hiddenQuoteText(parent, blockState, userId),
    };
  }, [
    channel.messages,
    replyTarget,
    activeChannelId,
    nameFor,
    userId,
    blockState,
  ]);

  // A screen-reader announcement for a genuinely new incoming message,
  // decoupled from `#chat-timeline`'s DOM — see the comment on that `role="log"`
  // div for why: `MessageTimeline` virtualizes, so a live region wired to its
  // subtree re-announces old messages on ordinary scrolling. This ref tracks
  // the last message this effect has already announced, per channel, so a
  // channel switch or the initial backfill load — the latest message is not
  // "new" in either of those cases — doesn't narrate the whole history.
  const lastAnnouncedRef = useRef<{
    channelId: string | null;
    messageId: string | null;
  }>({ channelId: null, messageId: null });
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  useEffect(() => {
    const latest = channel.messages.at(-1);
    if (!activeChannelId || !latest) return;
    /*
      The attribution below needs a *resolved* viewer, and this effect is not
      behind the timeline's identity gate (#2243) — so it can run while
      `GET /v1/users/me` is still in flight. `latest.sender_id === null` is false
      for every row, so the member's own message would be announced under their
      own display name, or as "Someone": the mis-ID bug reaching the one surface
      that cannot be glanced at and re-read.

      What happens to a message that arrives *inside* that window: it is adopted
      as the baseline and never announced. `userId` is a dependency, so the
      resolve does re-run this effect — but the ref is still `{null, null}`,
      because returning here skips the write, so that run takes the
      channel-switch branch below and sets the baseline without narrating it.
      That is the rule the initial load already follows: a message that landed
      while the app was still booting is part of what the member arrived to, not
      an event to hear about. It is a deliberate outcome, not the announcement
      going missing by accident — do not "fix" it by moving the ref write above
      this line, which would restore the wrong attribution and nothing else.

      `liveUserId`, deliberately not the cached-or-live `userId` (#2249), and for
      a second reason on top of attribution. This effect's first run sets the
      *baseline* every later arrival is measured against. Taken off the seeded
      cached tail, that baseline is however stale the cache is — so the backfill
      replacing those rows reads as a burst of new messages and narrates every
      one of them, which is precisely the "part of what the member arrived to,
      not an event to hear about" rule just above, inverted. Waiting for the live
      id keeps the baseline on a window the network has answered for.
    */
    if (!liveUserId) return;
    const latestKey = latest.client_message_id ?? latest.id;
    if (lastAnnouncedRef.current.channelId !== activeChannelId) {
      lastAnnouncedRef.current = {
        channelId: activeChannelId,
        messageId: latestKey,
      };
      return;
    }
    if (lastAnnouncedRef.current.messageId === latestKey) return;
    lastAnnouncedRef.current = {
      channelId: activeChannelId,
      messageId: latestKey,
    };
    if (latest.is_deleted) return;
    // Only a row the timeline draws in full is announced. Naming the sender of
    // a message the block list tombstones would narrate exactly what the block
    // hides, and a held row is not on screen at all (#2313).
    if (classifyMessage(latest, blockState, liveUserId) !== "visible") return;
    // `liveUserId`, matching the guard above and this effect's dependencies —
    // they are equal here anyway (the live value wins in `useChatViewerId`),
    // but reading the other one would put a value outside the dep list into
    // the closure and make the two disagree the moment either moves.
    const author =
      latest.sender_id === liveUserId
        ? "You"
        : (resolveAuthorName(latest, nameFor) ?? "Someone");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- announcing a real-time arrival by comparing against the previous render's last-seen id, not syncing render state
    setLiveAnnouncement(`New message from ${author}`);
  }, [channel.messages, activeChannelId, liveUserId, nameFor, blockState]);

  /*
    From here the frame renders FIRST and every state renders inside it.

    The board's first-paint contract (`1s`) paints "nav, top bar, chapter name,
    channel column chrome, composer shell" at 0ms, and its delete list names
    exactly what used to stop that here: "the `categoriesQuery.isPending` gate
    on the whole shell; the shell-level LoadingState card". Both are gone.

    - **Categories no longer gate anything.** `asArray` already turned an absent
      payload into `[]`, so a pending fetch renders the flat rail and the groups
      land when they land. `1s` asks for precisely that ("Categories regroup only
      below the fold or on next visit"). The old gate bought a rail that never
      reflowed, and made every cold load wait out the fetch, a failing one
      through the query provider's retry backoff (`api-retry.md` § Reads).
    - **A whole-route loading card is the opposite of the contract**: it makes
      the channel column paint last rather than first. Channel rows shimmer in
      their own geometry instead, and the channel column's chrome is up
      immediately either way.

    No gate survives. "No chapter yet" used to be one — see `channelsPaneState`
    below for why it is now a state the frame renders rather than a return that
    replaces it.
  */
  /*
    Keyed off what we HAVE, not off `isError`. TanStack Query keeps the last
    good `data` when a *background refetch* fails, so branching on `isError`
    first would blank a rail the member is actively using — and unmount the
    timeline with it — because one refetch 502'd during an API restart. The
    error state is for having nothing to show. `levelByChannelId` above records
    the same reasoning for the same reason; this is that rule applied to the
    list itself.
  */
  /*
    `no-chapter` is LAST, and the ordering is the whole correctness of this
    variable.

    The state exists because `/chat` used to server-render a lone 208px "No
    chapter selected" card with no channel column at all — `activeChapterId`
    comes from a persisted zustand store that initializes to `null`, so in the
    server-rendered HTML a member WITH a chapter was indistinguishable from one
    without, and hydration replaced the card with the whole two-column frame.
    That was the largest layout shift on the route and it fired on every cold
    load. `1s` puts "channel column chrome" in the 0ms set and budgets zero CLS
    above the composer; a card that becomes a layout is the opposite of both.

    The first attempt at this put `no-chapter` first, which was wrong in a way
    worth recording. `useChannels()` takes no chapter argument — no `enabled`
    gate, and `["channels"]` as its whole query key (`packages/hooks/src/use-chat.ts`)
    — and `chapter.guard.ts` resolves a sole membership server-side, so the
    channel list arrives perfectly well while this store field is still null.
    Short-circuiting on the field therefore said "no chapter" over the top of
    real data: the rail and timeline stayed hidden while `activeChannel` (derived
    from `channels`, not from the chapter id) resolved anyway, so the member got
    a live composer under a "Pick an active chapter" card with no timeline — able
    to send into #general, never shown the result, and `markChannelRead` stamping
    their cursor for messages that were never on screen.

    So the list decides. Having channels means ready, whatever the store says;
    "no chapter" is only reached once the query has settled with nothing, where
    it is a terminal explanation rather than a guess about a load still in
    flight. That also removes the need to choose a placeholder for it: a cold
    load is `loading` — `isPending` is true on the server and through hydration —
    so the frame and its skeletons are what render at 0ms, which is what the
    contract asked for in the first place.

    Gating any of this on the store's `hasHydrated` was considered and rejected;
    `profile-panel.tsx` records why at length. That flag never becomes true when
    `localStorage` access throws (privacy modes, blocked site data), so it would
    pin a permanent placeholder onto exactly the members for whom "no active
    chapter" is actually true. Nothing here waits on a flag.
  */
  const channelsPaneState =
    channels.length > 0
      ? "ready"
      : channelsQuery.isPending
        ? "loading"
        : channelsQuery.isError
          ? "error"
          : !activeChapterId
            ? "no-chapter"
            : "empty";
  // `Esc`, where nothing else takes it (#3824; the history half is above).
  const navFaceShowing = navFace?.face;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (escapeBelongsElsewhere(event.target)) return;
      if (isDesktopShell) {
        if (navFaceShowing === "modules") showChannelsInNav?.();
        return;
      }
      if (narrowPane === "thread" && channelsPaneState === "ready") {
        backToChannels();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    isDesktopShell,
    navFaceShowing,
    showChannelsInNav,
    narrowPane,
    channelsPaneState,
    backToChannels,
  ]);

  const timelineReady =
    channelsPaneState === "ready" && !requestedChannelMissing;
  const memberColumnMounted =
    !membersHidden &&
    (showMemberList || (!activeChannel && channelsPaneState === "loading"));

  /**
   * Whether focus is in `ComposerShell` right now — the one thing the upgrade
   * to `<Composer>` cannot recover for itself.
   *
   * A ref, and spent by whoever reads it. State would have to be cleared after
   * the handoff (otherwise every later remount — `<Composer>` is keyed on
   * channel id and name, #1014 — would inherit the intent and pull the caret
   * back out of whatever the member was doing), and the only place to clear it
   * is an effect, which is `react-hooks/set-state-in-effect`. Spending it on
   * read makes it one-shot by construction: `claimShellFocus` answers `true`
   * exactly once, to the first editor built after the member was typing in the
   * shell.
   */
  const shellFocus = useRef(false);
  const claimShellFocus = useCallback(() => {
    const had = shellFocus.current;
    shellFocus.current = false;
    return had;
  }, []);

  // The channels pane's contents, rendered in exactly one place: the shell's
  // left column from `lg` up, or inline beside the thread (`nav-face.tsx`).
  const channelsPaneBody = (
    <>
      {/*
            48px, matching the top bar and the channel header beside it, so the
            three headers line up across the whole route (`3a` geometry: "Top bar,
            column headers 48"). The "N channels" count that used to sit under the
            title is deleted (`1t`) - it restated the length of a list already on
            screen.
          */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
        {channelsInNav && navFace ? (
          <NavChannelsTitle onBack={navFace.showModules} />
        ) : (
          <h2 className="text-sm font-semibold text-foreground">Channels</h2>
        )}
        <ChannelFilters
          filters={sidebarPreferences.filters}
          onChange={sidebarControls.onSetFilters}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {/*
              Only `loading` shimmers, and `no-chapter` deliberately does not.

              `loading` is now the state a cold load actually renders — see
              `channelsPaneState` above — so this is the placeholder that carries
              the contract's "channel column chrome" clause, and it resolves the
              moment the list arrives. `no-chapter` is terminal by construction:
              the query has already settled with nothing, so a placeholder there
              would have no exit and would shimmer for as long as the tab stayed
              open. That is the same defect `profile-panel.tsx` rejects
              `hasHydrated` for, reached from the other side.
            */}
        {channelsPaneState === "loading" ? <ChannelListSkeleton /> : null}
        {/*
          The officer setup checklist, above the channels where Discord puts
          its server guide. Renders `null` for anyone with nothing to set up.
        */}
        {channelsPaneState === "ready" ? <SetupChecklistSection /> : null}
        {channelsPaneState === "ready" ? (
          <ChannelList
            viewerId={userId}
            memberNames={memberNames}
            channels={channels}
            categories={categories}
            unreadByChannelId={unreadByChannelId}
            activeChannelId={activeChannelId}
            onHide={hideFromRail}
            rowActions={rowActions}
            sidebar={sidebarControls}
            onPick={(ch) => {
              if (ch.hidden) {
                const memberId = otherMemberId(ch, userId);
                if (memberId) reopenDm.mutate({ member_id: memberId });
              }
              setSelectedChannelId(ch.id);
              // Below `lg` the list and the thread are never both on screen,
              // so picking has to navigate. Inert at `lg` and up.
              openThreadPane();
              // Deliberately leaves any pending jump target alone - it is
              // gated on its own channel and will resolve if the member
              // returns. Only the notice is channel-scoped for display.
              setUnreachableTarget(null);
            }}
          />
        ) : null}
      </div>
    </>
  );

  return (
    /*
      Flush columns, 100vh, independent scroll (`1b` — the board counts the app
      nav as the third; this route owns the other two). The route is
      full-bleed (`layout/full-bleed-routes.ts`), so this sits directly in the
      shell's `<main>` with no inset, and `h-full` here is the shell's fixed
      frame rather than a document that grows. From `lg` up the channels
      column is the shell's left column instead, in place of the module nav
      (owner, 2026-11-05).

      The panes no longer carry `rounded-xl` card chrome, `gap-4` between them,
      or `md:sticky` rail positioning. They are flush columns divided by
      hairlines, and each owns its own scroll because the page has none.
    */
    <div className="flex h-full min-h-0">
      {/*
        `dashboard-shell.tsx`'s "Skip to main content" link lands the keyboard
        user at the top of `/chat`'s `<main>`. Below `lg` that still holds the
        channel list this link exists to skip past; from `lg` up the list is
        the shell's left column, before `<main>`, and the link still lands past
        the channel header and status strip. Every visit to this route needs
        re-skipping, so it earns its own target. Only offered when there is a
        timeline to land on.
      */}
      {timelineReady ? (
        <a href="#chat-timeline" className={SKIP_LINK_CLASSES}>
          Skip to messages
        </a>
      ) : null}
      {/*
        Decoupled from `#chat-timeline` below on purpose - see that div's own
        comment. This is the only thing that announces a genuinely new
        message; it never mounts inside the virtualized timeline.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>
      {/*
        The cold load, announced once.

        The deleted whole-route `LoadingState` carried `role="status"`,
        `aria-busy` and a visible caption, so a screen-reader user was told the
        channels were loading; `ChannelListSkeleton` is `aria-hidden` (eight
        anonymous rectangles are no use to anyone), so the window would
        otherwise be silent.

        Two things this is deliberately NOT. It is not `role="status"` on the
        list's own container: that role implies `aria-atomic`, so every unread
        badge `useChannelUnreadCounts` repaints would re-read the entire channel
        list aloud — the same defect `#chat-timeline`'s `aria-live="off"` exists
        to prevent, one column over. And it is not inside the channels column,
        which `narrowPane` hides below `lg` — the announcement has to survive the
        viewport where the skeleton itself is off-screen.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {channelsPaneState === "loading" ? "Loading channels" : ""}
      </div>
      {/*
        Channels: 240px, full height, its own scroll, no search field (`1b`
        pin 5). From `lg` up inside the dashboard shell it is the left column
        itself: the shell owns the column and its chapter header, and this pane
        is portaled into it, beside a back arrow to the module nav
        (`components/layout/nav-face.tsx`). Below `lg`, and outside the shell,
        it stays inline, on `--surface-1`, the step the left column takes.
      */}
      {channelsInNav && navFace?.channelsSlot
        ? createPortal(
            <section
              aria-label="Channels"
              className="flex min-h-0 flex-1 flex-col"
            >
              {channelsPaneBody}
            </section>,
            navFace.channelsSlot,
          )
        : null}
      {channelsInNav ? null : (
        <section
          aria-label="Channels"
          className={cn(
            "flex min-h-0 flex-col border-r border-border bg-surface-1",
            // Full width below `lg`, where it is the only column on screen.
            "w-full lg:w-60 lg:shrink-0",
            narrowPane === "thread" && "max-lg:hidden",
            // Inside the shell the column is the shell's from `lg` up; until
            // the client knows its width, this copy stays out of the way and
            // the shell's placeholder holds the column.
            navFace && "lg:hidden",
          )}
        >
          {channelsPaneBody}
        </section>
      )}

      {/*
        The thread column is the app floor (s05); the cards posted into it are
        the step above it, and a hovered message row lifts to `--surface-1`.
        No border of its own: the channels column's right hairline is the only
        division, and the composer pins to the bottom of this column, which is
        the bottom of the viewport.
      */}
      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col bg-background",
          narrowPane === "channels" && "max-lg:hidden",
        )}
      >
        {/*
          48px, one row (`1b` pin 11). The name, its description and the one
          overflow control share the row; anything that cannot fit in 48px and
          is not chrome moved below it. Four popover triggers used to live here
          and are now behind `ChannelMenu`'s single `⋯`.
        */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          {/*
            Below `lg` this is the only way back to the list, because the list
            is not on screen. Hidden at `lg`, where both columns are.
          */}
          {/*
            Only when there is a list to go back to. With no channels, or a
            channel list that failed to load, the channels column renders its
            header over an empty scroll area — and since the only control that
            comes back is a channel row, Back would strand the member on a blank
            pane with the Retry button out of reach in the column they left.
          */}
          {channelsPaneState === "ready" ? (
            <Button
              variant="ghost"
              size="icon"
              // 40px, never the 32px compact control (#3824): it is the one
              // way back below `lg`, so it gets a real target.
              className="-ml-2 h-10 w-10 shrink-0 lg:hidden"
              onClick={backToChannels}
              aria-label="Back to channels"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : null}
          <ChannelHeaderTitle
            channel={activeChannel}
            name={activeChannelName}
            description={activeChannelDescription}
          />
          <div className="flex shrink-0 items-center gap-2">
            {showMemberList ? (
              <Button
                variant="ghost"
                size="icon"
                className={compactControlClassName}
                onClick={toggleMembers}
                aria-label={
                  isWideChat && !membersHidden ? "Hide members" : "Show members"
                }
                aria-pressed={isWideChat ? !membersHidden : undefined}
                aria-haspopup={isWideChat ? undefined : "dialog"}
              >
                <MembersGlyph
                  className="h-5 w-5"
                  active={isWideChat && !membersHidden}
                />
              </Button>
            ) : null}
            <ChannelMenu
              activeChannelId={activeChannelId}
              messages={shownMessages}
              hiddenPins={hiddenPins}
              nameFor={nameFor}
              channelNameFor={channelNameFor}
              onJumpToMessage={jumpToMessage}
              onJumpToSearchHit={jumpToSearchHit}
              onJumpToBookmark={jumpToBookmark}
              bookmarks={bookmarks}
              bookmarksLoading={bookmarksQuery.isLoading}
              bookmarksError={bookmarksQuery.isError}
              onRemoveBookmark={(messageId) =>
                unbookmarkMessage.mutate(messageId)
              }
              notificationLevel={activeChannelLevel}
              notificationSaving={setNotificationLevel.isPending}
              onChangeNotificationLevel={(level) => {
                if (!activeChannel) return;
                setNotificationLevel.mutate({
                  channelId: activeChannel.id,
                  level,
                });
              }}
              pinToTop={
                activeChannel && !activeChannel.hidden
                  ? {
                      pinned: sidebarPreferences.pinnedIds.has(
                        activeChannel.id,
                      ),
                      onToggle: () =>
                        sidebarControls.onSetPinned(
                          activeChannel,
                          !sidebarPreferences.pinnedIds.has(activeChannel.id),
                        ),
                    }
                  : undefined
              }
              hideConversation={
                activeChannel && canHideConversation(activeChannel)
                  ? {
                      name: activeChannelName,
                      onHide: () => hideConversation(activeChannel.id),
                    }
                  : undefined
              }
            />
          </div>
        </header>
        {/*
          Status strip, directly under the 48px header rather than inside it.

          Both `role="alert"` lines are here rather than inside the menu for the
          reason they were never inside their own popovers: a popover unmounts
          its content when dismissed, so an alert in there is only seen by a
          member who happens to reopen it. Behind `⋯` that is now strictly
          worse, since the control itself is out of sight too.

          The unreachable-target container is ALWAYS mounted and carries the
          live region; only its contents swap. A live region inserted into the
          DOM at the same instant it gains content is not announced by most
          screen readers - which would have left AT users with exactly the
          silent no-op this notice exists to replace, just relocated.
        */}
        <div className="shrink-0 empty:hidden">
          {activeChannel && failedChannelId === activeChannel.id ? (
            // Scoped to the channel the failed write was actually for: the
            // mutation is shared by the whole shell, so its bare `isError`
            // would assert a failure on channels nobody touched.
            <p
              role="alert"
              className="border-b border-border px-4 py-1.5 text-caption text-destructive"
            >
              Notification level not saved
            </p>
          ) : null}
          {bookmarkWriteFailed ? (
            <p
              role="alert"
              className="border-b border-border px-4 py-1.5 text-caption text-destructive"
            >
              {/* Covers both directions: the same alert fires for a failed
                  save and a failed removal, and "not saved" would be wrong
                  copy for the second. */}
              Bookmark not updated
            </p>
          ) : null}
          <div aria-live="polite" role="status">
            {showUnreachableNotice || showSeekingNotice ? (
              // Dismissible because it reports a past action, not a standing
              // condition of the channel.
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
                <p className="text-caption text-muted-foreground">
                  {pendingTargetHeld
                    ? "That message is waiting on your block list. It opens once the list loads."
                    : showUnreachableNotice && unreachableTarget
                      ? UNREACHABLE_COPY[unreachableTarget.reason]
                      : "Finding that message..."}
                </p>
                <IconButton
                  label="Dismiss"
                  onClick={() => {
                    // Abandons the target, not just the notice. Clearing only
                    // the message would leave it pending, so the effect would
                    // re-raise this the moment any new message arrived - a
                    // dismiss that visibly un-dismisses itself.
                    setUnreachableTarget(null);
                    setSeekingMessageId(null);
                    setPendingMessageId(null);
                    setPendingJumpChannelId(null);
                  }}
                >
                  <X />
                </IconButton>
              </div>
            ) : null}
          </div>
        </div>
        {/*
          Between the channel header and the timeline: "a dismissible inline
          nudge in chat" (`spec/product/modules.md` § Ops-setup nudges) without
          being *inside* the virtualized log, which would make it a row
          `react-virtuoso` can unmount. Renders `null` for everyone but an
          officer of a chapter with a nudge-eligible module switched off, so it
          costs the common case one early return.
        */}
        <OpsSetupNudge />
        {/*
          The four states that used to replace the whole route now render inside
          this column, so the channels column beside them stays usable: a member
          who cannot load #general can still see and pick another channel. FITFO
          copy, per `3b`: the status line is the title and stays under six words,
          with a short second line and one action.

          `no-chapter` joined them in #2145 and is the one that fires on the
          happy path — see `channelsPaneState` above.
        */}
        {channelsPaneState === "no-chapter" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/*
              Phrased as an instruction, not as a claim about the account, and
              `profile-panel.tsx` owns the reasoning: this copy is on screen both
              before the store rehydrates and when the member really has no
              chapter, so "Pick an active chapter" is true in both where "you
              have no chapter" would be a confident falsehood in one.
            */}
            <InlineNote>
              Pick an active chapter to load its channels.
            </InlineNote>
          </div>
        ) : null}
        {channelsPaneState === "error" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/*
              A refusal by role is not a load failure (2026-11-07: testers
              invited as a Discord-imported role with only a channel
              permission). The words are shared with mobile Chat home.
            */}
            <ErrorState
              title={
                isRoleRefusal(channelsQuery.error)
                  ? CHANNELS_ROLE_REFUSAL_TITLE
                  : "Couldn't load channels"
              }
              description={
                isRoleRefusal(channelsQuery.error)
                  ? channelsRoleRefusalBody(null)
                  : describeLoadFailure(channelsQuery.error)
              }
              onRetry={() => void channelsQuery.refetch()}
            />
          </div>
        ) : null}
        {channelsPaneState === "empty" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <InlineNote>No channels yet. Ask an admin to add one.</InlineNote>
          </div>
        ) : null}
        {channelsPaneState === "ready" && requestedChannelMissing ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <InlineNote>
              {"That link points to a channel you can't reach. "}
              <InlineNoteAction
                onClick={() => {
                  setChannelTargetDismissed(true);
                  // Below `lg` the list is a separate pane, so a control named
                  // "Browse channels" has to actually show it. Dismissing alone
                  // resolved the #general fallback and painted a timeline, which
                  // is a different channel rather than a list.
                  setNarrowPane("channels");
                }}
              >
                Browse channels
              </InlineNoteAction>
            </InlineNote>
          </div>
        ) : null}
        {channelsPaneState === "loading" ? (
          /*
            Reserved geometry, not a card: `1s` wants the shell and the composer
            shell up while the tail fills in, and a bordered loading panel here
            would be one more thing to swap out on arrival.

            It draws the same skeleton `MessageTimeline` draws one state later,
            and sharing it is the point rather than a convenience. A cold load
            crosses both branches — channels pending here, then messages pending
            there — and while this was a blank `<div>` the crossing was itself a
            shift: an empty column became ten rows of placeholder became ten rows
            of text. Now only the last of those three is a change.
          */
          <>
            <div className="min-h-0 flex-1">
              {/*
                Bare, unlike `MessageTimeline`'s use of the same skeleton, which
                pairs it with a "Loading messages" region. Here the channel list
                is what is loading, and the announcer above already says so —
                adding a second region would read one event twice.
              */}
              <MessageTimelineSkeleton />
            </div>
            {/*
              The composer, before there is a channel to send to.

              It holds the box open — without it the bottom-aligned skeleton
              above sits flush against the viewport and every row jumps when
              `<Composer>` mounts — and since #2176 it also takes focus and
              takes text, which is the clause `1s` budgets at 400ms and the only
              one #2145 could not close. `ComposerShell` owns both the geometry
              and why.

              Only in this branch. The other terminal states (`error`, `empty`,
              `no-chapter`, and a requested channel that matched nothing) are not
              waiting for anything: a composer there would be a control with
              nowhere to send, which the release gate calls a dead end.
            */}
            <ComposerShell
              // Straight into the channel's draft, with no channel yet. That is
              // not a trick: `useChannelDraft` stores what it is given either
              // way and only *masks* `draft` while `channelId` is `null`, so the
              // text is already there to be read on the render that mounts
              // `<Composer>`. The ordering that makes that safe — and the two
              // texts it has to settle when Dexie answers late — is in
              // `lib/chat/use-channel-draft.ts`.
              onTextChange={channel.setDraft}
              onFocusChange={(focused) => {
                shellFocus.current = focused;
              }}
            />
          </>
        ) : null}
        {timelineReady ? (
          <>
            {/*
          Above the timeline rather than inside it: the timeline virtualizes,
          and this is the one line that says rows are being held off it while
          the block list cannot vouch for them (#2313).
        */}
            <BlockListNotice
              status={blockList.status}
              heldCount={thread.heldCount}
              onRetry={blockList.retry}
              isRetrying={blockList.isRetrying}
              isPaused={blockList.isPaused}
            />
            {/*
          `role="log"` alone still carries an ARIA-spec *implicit* default of
          `aria-live="polite"` / `aria-relevant="additions text"` — so making
          this genuinely non-live takes an explicit `aria-live="off"`, not
          just omitting the attribute. It has to be non-live at all, because
          `MessageTimeline` virtualizes (`react-virtuoso`): scrolling back
          through history unmounts and remounts old rows exactly like a new
          message arriving, so a live region here would re-announce
          already-read messages on ordinary scrolling. `liveAnnouncement`
          below is the decoupled, non-virtualized replacement — it updates
          only when a genuinely new message lands, never on scroll.
        */}
            <div
              id="chat-timeline"
              tabIndex={-1}
              role="log"
              aria-live="off"
              aria-label="Chat timeline"
              // `FOCUS_RING`, not `FOCUS_RING_ALWAYS`: this container is a large
              // panel most of whose area is an ordinary mouse-click target (blank
              // space below the last message), not a control reached only
              // programmatically — `FOCUS_RING_ALWAYS`'s plain `focus:` would
              // leave the ring painted after a routine click into that space.
              // `focus-visible:` still shows it for the skip link's keyboard-
              // driven jump, which is the case this needs to stay visible for.
              className={cn(
                "min-h-0 flex-1 overflow-hidden rounded-md",
                FOCUS_RING,
              )}
            >
              <MentionChipTargetsContext.Provider value={mentionChipTargets}>
                <MessageTimeline
                  ref={timeline}
                  channelId={activeChannel?.id}
                  nameFor={nameFor}
                  roleColorFor={roleColorFor}
                  avatarFor={avatarFor}
                  messages={channel.messages}
                  blockList={{ blockState, thread }}
                  onUnblock={handleUnblock}
                  onReloadMasked={handleReloadMasked}
                  maskedRefresh={maskedRefresh}
                  viewerId={userId}
                  isLoading={channel.isLoading}
                  loadError={channel.loadError}
                  hasOlder={channel.hasOlder}
                  isLoadingOlder={channel.isLoadingOlder}
                  olderError={channel.olderError}
                  onLoadOlder={loadOlderHistory}
                  channelStart={channelStartNode}
                  // Only while the jump is still working. Once it has settled on a
                  // notice the target stays pending (so a late arrival still lands),
                  // but holding follow through that would stop new messages
                  // scrolling into view until the member dismissed it.
                  holdFollow={
                    pendingMessageId !== null &&
                    (pendingJumpChannelId === null ||
                      pendingJumpChannelId === activeChannelId) &&
                    !showUnreachableNotice
                  }
                  onReact={channel.react}
                  onUnreact={channel.unreact}
                  onReply={canReplyHere ? startReply : undefined}
                  // The quote above a reply scrolls to the message it quotes. It used
                  // to open `ThreadPanel` in the Details rail; #2142 deleted both, and
                  // this is the same machinery pins and saved messages already use.
                  onJumpToParent={(message) => jumpToMessage(message.id)}
                  onRetry={channel.retry}
                  onDiscard={channel.discard}
                  // Heavy-command rows bypass the outbox, so `channel.retry` above
                  // cannot reach them. This replays the original request under its
                  // original idempotency key and toasts the outcome through the same
                  // three-way channel a first dispatch uses (#1733).
                  onRetryUnconfirmed={async (replay) => {
                    // Every path here must end in a toast. The first dispatch gets
                    // that guarantee from `runDispatch` in the composer (which also
                    // tags Sentry); this control sits in the timeline and had
                    // neither, so a throw produced a blinking spinner, no message,
                    // and no telemetry — and an officer who concludes Retry is broken
                    // re-types the command, mints a fresh key and double-grants.
                    try {
                      const result = await channel.retryUnconfirmed(replay);
                      notifyDispatchOutcome(toast, replay.command, result);
                    } catch (error) {
                      Sentry.captureException(error, {
                        tags: { slash_command: `${replay.command}_retry` },
                      });
                      // Non-destructive on purpose: the retry failing says nothing
                      // about whether the original attempt committed, and a red
                      // "failed" is what invites the re-type.
                      toast({
                        title: "Couldn't retry that command",
                        description:
                          "The retry didn't go through. Check the points ledger before running the command again. A second run would record the points twice.",
                      });
                    }
                  }}
                  onAct={(messageId, actionType, payload) =>
                    void channel.act(messageId, actionType, payload)
                  }
                  // An edit authorizes as a post (`spec/behavior/chat/README.md`
                  // § Channels → Channel-access enforcement), so a member who can't
                  // post here, such as an alumnus in an ordinary channel, isn't
                  // offered one (#2775).
                  onEdit={
                    activeChannel?.can_post !== false ? channel.edit : undefined
                  }
                  onDelete={handleDeleteMessage}
                  onClosePoll={handleClosePoll}
                  bookmarkedMessageIds={bookmarkedMessageIds}
                  onToggleBookmark={handleToggleBookmark}
                  canManageChannel={canManageChannel}
                  onReport={handleReport}
                  onBlock={handleBlock}
                  onOpenProfile={openProfile}
                  isMember={isMember}
                />
              </MentionChipTargetsContext.Provider>
            </div>
            {/*
          Directly above the composer, which is where Discord and Slack both put
          it and where a 48px header has no room for it. Reserves no space when
          nobody is typing: it is transient status, and a permanently reserved
          strip would push the composer down by a line on every channel.
        */}
            {typingUsers.length > 0 ? (
              <p className="shrink-0 px-4 pb-1 text-caption text-muted-foreground">
                {typingUsers.length === 1
                  ? "Someone is typing…"
                  : `${typingUsers.length} people are typing…`}
              </p>
            ) : null}
          </>
        ) : null}
        {activeChannel ? (
          <Composer
            // Remounts the editor whenever the channel *or its resolved
            // display name* changes, so a baked-in-at-creation extension
            // (the Tiptap `Placeholder`) is rebuilt from the current name
            // rather than freezing a stale one — see #1014. Name alone
            // matters too, not just id: a DM's `activeChannelName` can
            // still read the `directChannelDisplayName` fallback
            // ("Direct message") at mount, before `useChapterRoster()` /
            // `useMemberDisplayNames()` resolve the participant's real
            // name a moment later — same `activeChannel.id` throughout, so
            // an id-only key would never pick up the correction. Costs
            // focus/selection per switch, and can briefly seed the fresh
            // editor from the outgoing channel's still-loading draft until
            // `useChatChannel`'s async Dexie read resolves and the
            // `draft`-sync effect below corrects it — tracked as #1497,
            // pre-existing and not introduced by this `key`.
            key={`${activeChannel.id}:${activeChannelName}`}
            // Carried across the upgrade only, and only if the member was
            // actually typing in the shell. Called from Tiptap's `onCreate`,
            // never during render, and it answers `true` at most once — see
            // `claimShellFocus` above and `Composer`'s own prop doc.
            claimShellFocus={claimShellFocus}
            channelId={activeChannel.id}
            channelName={activeChannelName}
            isDirect={
              activeChannel.type === "DM" || activeChannel.type === "GROUP_DM"
            }
            isReadOnly={!!activeChannel.is_read_only}
            isAuditLog={activeChannel.is_audit_log === true}
            // Undefined (not yet through the server's capability
            // projection) is left to `Composer`'s own default, which
            // resolves to `!isReadOnly` rather than an unconditional
            // `true` — the safe fallback for a read-only channel whose
            // `can_post` hasn't arrived yet.
            canPost={activeChannel.can_post}
            draft={channel.draft}
            onChangeDraft={channel.setDraft}
            // `replyTo?.id`, not `replyToId`: the derived target is the one the
            // member can actually see staged. Reading the raw id would let a
            // send carry a reply whose strip resolved to nothing.
            onSend={(body, attachments) => {
              const target = replyTo?.id ?? null;
              // Cleared before the await, not after: `channel.send` enqueues to
              // the Dexie outbox and resolves on its own schedule, and a strip
              // still standing after the message appears in the timeline reads
              // as "your reply didn't send" — and would silently attach itself
              // to whatever the member typed next. If the outbox refuses the
              // send, the composer hands it back through `onRestoreReply`.
              //
              // Only when the target belongs to THIS channel. Clearing
              // unconditionally reproduced the exact bug the channel-scoping
              // above exists to prevent: a member stages a reply in #general,
              // answers a ping in #random — that send wiped it — and comes back
              // to #general to a per-channel draft still in the composer and no
              // strip above it, so Enter posts the reply as a top-level message.
              if (replyTo) setReplyTarget(null);
              return channel.send(body, { replyToId: target, attachments });
            }}
            onSlashDispatch={(command: SlashCommand, args: string) =>
              channel.dispatchSlash(
                command,
                args,
                announcementsChannelId,
                resolveMember,
              )
            }
            onOpenCommandForm={openCommandForm}
            commandForms={commandForms}
            onTyping={channel.emitTyping}
            isModuleEnabled={isModuleEnabled}
            recruitmentVocab={recruitmentVocab}
            slashCommandsStatus={slashCommandsStatus}
            onRetrySlashCommands={onRetrySlashCommands}
            // Never `disabled` while offline: the send path enqueues to the
            // Dexie outbox before it touches the network, so gating the
            // composer would defeat the queue built to make composing-while-
            // offline work (`spec/ui/resilience/connection-state.md`). The
            // top bar's connection pill says so; this flag only refuses the
            // queueless slash commands.
            isOffline={channel.connection === "offline"}
            replyTo={replyTo}
            onCancelReply={cancelReply}
            onRestoreReply={restoreReply}
          />
        ) : null}
      </section>

      {/*
        Members, 240px on the right from 1280px (#3536), the same step as the
        channels column so the timeline reads as the floor between two rails.
        Hidden by CSS below `xl` rather than by the width hook, so the server's
        markup is already right for the member's width and remembered choice.
        Mounted while the channel list is still loading too (as a skeleton),
        so the timeline does not lose 240px a beat after first paint; it only
        goes away if the channel turns out to be a 1:1 DM.
      */}
      {memberColumnMounted ? (
        <aside
          aria-label="Members"
          className="hidden w-60 shrink-0 flex-col border-l border-border bg-surface-1 xl:flex"
        >
          {/*
            Reads only once the width hook confirms the column is on screen:
            below 1280px CSS hides it, and the sheet has its own copy.
          */}
          <ChannelMemberList
            channelId={activeChannel?.id ?? null}
            enabled={isWideChat}
            onOpenProfile={openProfile}
          />
        </aside>
      ) : null}
      <Sheet open={membersSheetOpen} onOpenChange={setMembersSheetOpen}>
        {/*
          A Panel, §9's surface for a list that grows: the member list is the
          panel's whole body and owns its one scroll.
        */}
        <PanelContent>
          <PanelHeader>Members</PanelHeader>
          {activeChannel ? (
            <ChannelMemberList
              channelId={activeChannel.id}
              onOpenProfile={openProfile}
            />
          ) : null}
        </PanelContent>
      </Sheet>

      {/*
        After the Members sheet, so a profile opened from one of its rows
        stacks over the list and closes back to it, as mobile's does (#3798).
      */}
      <MemberDetailSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        userId={profileUserId}
        identity={
          profileUserId
            ? {
                name: nameFor(profileUserId),
                avatarUrl: avatarFor(profileUserId),
              }
            : null
        }
      />

      {confirmDialog}
      {unblockFlow.confirmDialog}
      {blockFlow.confirmDialog}
      {/* Mounted from the first `/event` on, so it can animate closed. */}
      {eventForm ? (
        <EventEditorDialog
          open={eventForm.open}
          onOpenChange={(open) =>
            setEventForm((previous) =>
              previous ? { ...previous, open } : previous,
            )
          }
          mode="create"
          event={null}
          usingPreviewData={false}
          onSaved={() => undefined}
          initialName={eventForm.prefill.name}
          initialLocation={eventForm.prefill.location}
          initialPointValue={eventForm.prefill.pointValue}
          initialStartAt={prefillLocalInput(
            eventForm.prefill.date,
            eventForm.prefill.startTime,
          )}
          initialEndAt={prefillLocalInput(
            eventForm.prefill.date,
            eventForm.prefill.endTime,
          )}
          postToChannelId={eventForm.channelId}
          trackChatCard={channel.trackEventCard}
        />
      ) : null}
      {pollForm ? (
        <NewPollDialog
          key={pollForm.key}
          open={pollForm.open}
          onOpenChange={(open) =>
            setPollForm((previous) =>
              previous ? { ...previous, open } : previous,
            )
          }
          initialDraft={pollForm.draft}
          onPost={async (poll) => {
            const result = await channel.sendPoll(pollForm.channelId, poll);
            // Posted, but this device couldn't finish saving it: the same
            // non-destructive notice `/poll` gives, so nobody posts it twice.
            if (result.ok && result.warning) {
              toast({ title: "Poll posted", description: result.warning });
            }
            return result;
          }}
        />
      ) : null}
      <ReportMessageDialog
        key={reportTarget?.messageId ?? "closed"}
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </div>
  );
}
