"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, Search } from "lucide-react";
import {
  compareLatestFirst,
  directChannelDisplayName,
  dmChannelIdOf,
  otherMemberId,
  searchDirectMessages,
  useBlockedUserIds,
  useChannelLatestMessages,
  useChannels,
  useChapterRoster,
  useGetOrCreateDm,
  useMemberDisplayNames,
  useViewerUserId,
  DM_SEARCH_BLOCK_LIST_FAILED,
  DM_SEARCH_CHECKING_BLOCK_LIST,
  DM_SEARCH_CONVERSATIONS_HEADING,
  DM_SEARCH_MEMBERS_HEADING,
  DM_SEARCH_PLACEHOLDER,
  DM_SEARCH_ROSTER_FAILED,
  dmSearchNoMatches,
  type DmSearchMember,
} from "@repo/hooks";
import { isDirectChannel } from "@repo/validation";
import { asArray, cn, getErrorMessage, initials } from "@/lib/utils";
import {
  START_DM_FAILED_FALLBACK,
  START_DM_FAILED_TITLE,
} from "@/lib/chat/start-dm";
import { useToast } from "@/lib/hooks/use-toast";
import { FOCUS_RING, FOCUS_RING_SHELL } from "@/components/ui/focus";
import { DialogOverlay } from "@/components/ui/dialog";
import { EYEBROW } from "@/components/ui/typography";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChatChannel } from "./channel-list";

/**
 * People search in Direct messages (#4668, Shawn, 2026-11-12): type a name,
 * get your conversation with them, or them if you have none, and open either.
 *
 * **Shaped like Find on purpose.** Web already searches channels from the
 * top bar's Find (`find-bar.tsx`), a field-shaped button that opens a centered
 * dialog, and the channel list keeps no search field of its own
 * (`spec/ui/web-dashboard/README.md` § Chat). This is the same pair scoped to
 * people: the field sits at the top of the Direct messages list, where
 * Discord keeps its "Find or start a conversation" and Slack its DM search,
 * and the dialog wears Find's size, rows, group headings and keys, so the two
 * searches read as one. The New message pencil opens it too, as iMessage's
 * and Instagram's new-message button opens a "To:" search.
 *
 * What it finds and who it offers are the shared rules in
 * `@repo/hooks/dm-search`, written to be the phone's too.
 *
 * A pick opens through the shell (`onOpenChannel`), the way a click on a row
 * of the list does, never through the URL: the shell applies a `?channel=`
 * only when it changes, so pushing one could land on the link already there
 * and do nothing, and it would also take chat off a tool page it sits beside.
 */

/** On the page and not under a `display: none` (a pane hidden below `lg`). */
function isShown(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el?.isConnected) return false;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

/** Conversations shown before anything is typed: the newest, as a switcher. */
const RECENT_LIMIT = 6;

type Option =
  | { kind: "conversation"; id: string; channel: ChatChannel; title: string }
  | { kind: "member"; id: string; member: DmSearchMember };

export function DmSearch({
  open,
  onOpenChange,
  onOpenChannel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens a conversation as a click on its row in the list does. */
  onOpenChannel: (channelId: string) => void;
}) {
  // Kept here, so closing and reopening keeps what was typed, as Find does.
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // What opened the dialog (this field, the pencil, the empty list's prompt),
  // so closing it puts focus back there.
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={DM_SEARCH_PLACEHOLDER}
        onClick={() => onOpenChange(true)}
        onKeyDown={(event) => {
          // A printable key starts the search, as in the field it looks like.
          if (event.key.length !== 1 || event.key === " ") return;
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          event.preventDefault();
          setQuery(event.key);
          onOpenChange(true);
        }}
        className={cn(
          "flex h-[34px] w-full items-center gap-2.5 rounded-[10px] border border-control-edge bg-surface-1 px-3 text-left text-sm text-muted-foreground transition hover:text-foreground",
          FOCUS_RING_SHELL,
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {query.trim() ? (
            <span className="text-foreground">{query}</span>
          ) : (
            DM_SEARCH_PLACEHOLDER
          )}
        </span>
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogOverlay className="motion-reduce:animate-none" />
          <DialogPrimitive.Content
            aria-modal="true"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const opener = document.activeElement;
              openerRef.current =
                opener instanceof HTMLElement && opener !== document.body
                  ? opener
                  : null;
              const input = inputRef.current;
              input?.focus();
              input?.setSelectionRange(input.value.length, input.value.length);
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // Back to whatever opened it. Below `lg` the field's pane can be
              // hidden (the empty list's prompt sits in the thread column), so
              // a hidden or departed opener falls back to the field, and
              // failing that to nothing rather than a display:none button.
              const opener = openerRef.current;
              openerRef.current = null;
              const target = [opener, triggerRef.current].find(isShown);
              target?.focus();
            }}
            className="fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.98] motion-reduce:animate-none"
          >
            <DialogPrimitive.Title className="sr-only">
              New message
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Find a conversation or a member to message. Use the arrow keys
              to move through results and Enter to open one.
            </DialogPrimitive.Description>
            <DmSearchPanel
              query={query}
              onQueryChange={setQuery}
              inputRef={inputRef}
              onOpen={(channelId) => {
                onOpenChange(false);
                setQuery("");
                onOpenChannel(channelId);
              }}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

function DmSearchPanel({
  query,
  onQueryChange,
  inputRef,
  onOpen,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Close the search and open this conversation. */
  onOpen: (channelId: string) => void;
}) {
  const { toast } = useToast();
  const viewerId = useViewerUserId();
  const channelsQuery = useChannels();
  const latestQuery = useChannelLatestMessages();
  const rosterQuery = useChapterRoster();
  const { byId: names, avatarFor, avatarTintFor } = useMemberDisplayNames();
  const blockList = useBlockedUserIds();
  // The shell already watches `["channels"]`, so the open needn't wait for
  // the refetch: a selection the list doesn't hold yet waits for it
  // (`selectionPending` in the shell).
  const startDm = useGetOrCreateDm({ awaitRefetch: false });
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Bumped on every pick and when the dialog closes (this panel unmounts), so
  // a slow start for one member can't navigate after the member picked
  // something else or closed the search.
  const pickSeq = useRef(0);
  useEffect(() => {
    const seq = pickSeq;
    return () => {
      seq.current += 1;
    };
  }, []);

  const titleOf = useCallback(
    (channel: ChatChannel) =>
      directChannelDisplayName(
        {
          name: channel.name,
          type: channel.type,
          member_ids: channel.member_ids ?? [],
        },
        viewerId,
        names,
      ),
    [viewerId, names],
  );

  // The Direct messages list's rows (#3774), hidden ones left out, newest
  // first. Unlike the list, pins don't lead: Recent is the newest six.
  const conversations = useMemo(() => {
    const latest = new Map(
      asArray<{ channel_id: string; created_at?: string }>(
        latestQuery.data,
      ).map((row) => [row.channel_id, row.created_at]),
    );
    return asArray<ChatChannel>(channelsQuery.data)
      .filter((channel) => isDirectChannel(channel) && !channel.hidden)
      .sort(compareLatestFirst((channel) => latest.get(channel.id), titleOf));
  }, [channelsQuery.data, latestQuery.data, titleOf]);

  const result = useMemo(
    () =>
      searchDirectMessages({
        query,
        conversations,
        titleOf,
        roster: asArray<DmSearchMember>(rosterQuery.data),
        names,
        viewerId,
        blockedIds: blockList.ids,
        blockListReady: blockList.status === "ready",
      }),
    [
      query,
      conversations,
      titleOf,
      rosterQuery.data,
      names,
      viewerId,
      blockList.ids,
      blockList.status,
    ],
  );

  const searching = query.trim().length > 0;
  const options = useMemo<Option[]>(() => {
    const shown = searching
      ? result.conversations
      : result.conversations.slice(0, RECENT_LIMIT);
    return [
      ...shown.map(
        (channel): Option => ({
          kind: "conversation",
          id: `dm-search-conversation-${channel.id}`,
          channel,
          title: titleOf(channel),
        }),
      ),
      ...result.members.map(
        (member): Option => ({
          kind: "member",
          id: `dm-search-member-${member.user_id}`,
          member,
        }),
      ),
    ];
  }, [searching, result, titleOf]);

  // A new query means a new list, so the highlight goes back to the top, in
  // the same paint as the new rows (as Find does).
  const [queryForIndex, setQueryForIndex] = useState(query);
  if (queryForIndex !== query) {
    setQueryForIndex(query);
    setActiveIndex(0);
  }
  const safeIndex = Math.min(activeIndex, Math.max(options.length - 1, 0));

  const openConversation = useCallback(
    (channelId: string) => {
      pickSeq.current += 1;
      onOpen(channelId);
    },
    [onOpen],
  );

  const startConversation = useCallback(
    async (member: DmSearchMember) => {
      if (pendingMemberId) return;
      const seq = ++pickSeq.current;
      setPendingMemberId(member.user_id);
      try {
        const dm = await startDm.mutateAsync({ member_id: member.user_id });
        if (seq !== pickSeq.current) return;
        const channelId = dmChannelIdOf(dm);
        if (!channelId) throw new Error("No channel id returned");
        openConversation(channelId);
      } catch (error) {
        if (seq !== pickSeq.current) return;
        // The member sheet's Message failure (`lib/chat/start-dm.ts`).
        toast({
          title: START_DM_FAILED_TITLE,
          description: getErrorMessage(error, START_DM_FAILED_FALLBACK),
          variant: "destructive",
        });
      } finally {
        if (seq === pickSeq.current) setPendingMemberId(null);
      }
    },
    [pendingMemberId, startDm, openConversation, toast],
  );

  function pick(option: Option | undefined) {
    if (!option) return;
    if (option.kind === "conversation") openConversation(option.channel.id);
    else void startConversation(option.member);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((safeIndex + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((safeIndex - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(options[safeIndex]);
    }
  }

  const loading =
    channelsQuery.isPending || (searching && rosterQuery.isPending);
  // Why no members are listed, so a list with none never reads as "nobody
  // matches": the block list isn't read yet (as the member sheet's Message
  // row says it), or the roster couldn't be read (a role without
  // `members:view`, or the network).
  const rosterFailed = rosterQuery.isError && rosterQuery.data === undefined;
  let heldNote: string | null = null;
  let onRetryHeld: (() => void) | null = null;
  if (searching && result.membersHeld) {
    const failed = blockList.status === "unavailable" && !blockList.isRetrying;
    heldNote = failed
      ? DM_SEARCH_BLOCK_LIST_FAILED
      : DM_SEARCH_CHECKING_BLOCK_LIST;
    if (failed && !blockList.isPaused) onRetryHeld = blockList.retry;
  } else if (searching && rosterFailed) {
    heldNote = DM_SEARCH_ROSTER_FAILED;
    if (!rosterQuery.isFetching) onRetryHeld = () => void rosterQuery.refetch();
  }
  const noMatches = searching && !loading && options.length === 0;
  const activeId = options[safeIndex]?.id;

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Search
          className="h-[18px] w-[18px] shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls="dm-search-results"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={DM_SEARCH_PLACEHOLDER}
          placeholder={DM_SEARCH_PLACEHOLDER}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {searching && !loading
          ? noMatches
            ? (heldNote ?? dmSearchNoMatches(query))
            : `${options.length} result${options.length === 1 ? "" : "s"}.`
          : ""}
      </p>

      <div
        id="dm-search-results"
        role="listbox"
        aria-label={DM_SEARCH_PLACEHOLDER}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {loading ? (
          <p className="px-2.5 py-3 text-sm text-muted-foreground">
            Loading…
          </p>
        ) : null}
        {noMatches && !heldNote ? (
          <p className="px-2.5 py-3 text-sm text-muted-foreground">
            {dmSearchNoMatches(query)}
          </p>
        ) : null}

        {options.map((option, index) => {
          const previous = options[index - 1];
          const isNewGroup = index === 0 || previous!.kind !== option.kind;
          const heading =
            option.kind === "conversation"
              ? searching
                ? DM_SEARCH_CONVERSATIONS_HEADING
                : "Recent"
              : DM_SEARCH_MEMBERS_HEADING;
          const active = index === safeIndex;
          const pending =
            option.kind === "member" &&
            pendingMemberId === option.member.user_id;
          const label =
            option.kind === "conversation"
              ? option.title
              : option.member.display_name;
          const peer =
            option.kind === "member"
              ? option.member.user_id
              : option.channel.type === "DM"
                ? otherMemberId(option.channel, viewerId)
                : null;
          return (
            <div
              key={option.id}
              role="group"
              aria-label={isNewGroup ? heading : undefined}
            >
              {isNewGroup ? (
                <p
                  aria-hidden="true"
                  className={cn("px-2.5 pb-1 pt-3 text-muted", EYEBROW)}
                >
                  {heading}
                </p>
              ) : null}
              <button
                type="button"
                role="option"
                id={option.id}
                aria-selected={active}
                aria-busy={pending || undefined}
                tabIndex={-1}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => pick(option)}
                className={cn(
                  "flex min-h-8 w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left text-sm transition pointer-coarse:min-h-11 pointer-coarse:text-base",
                  active
                    ? "bg-card-hover text-foreground"
                    : "text-foreground hover:bg-card-hover",
                )}
              >
                <Avatar className="h-6 w-6 shrink-0" aria-hidden="true">
                  {peer && avatarFor(peer) ? (
                    <AvatarImage src={avatarFor(peer)!} alt="" />
                  ) : null}
                  <AvatarFallback tint={peer ? avatarTintFor(peer) : null}>
                    {initials(label)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {pending ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                ) : option.kind === "member" ? (
                  // The group heading already says it to a screen reader.
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-caption text-muted-foreground"
                  >
                    Message
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}

        {heldNote ? (
          <p className="px-2.5 pb-1 pt-3 text-caption text-muted-foreground">
            {heldNote}
            {onRetryHeld ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onRetryHeld}
                  className={cn(
                    "font-medium text-foreground underline underline-offset-2",
                    FOCUS_RING,
                  )}
                >
                  Try again
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </>
  );
}
