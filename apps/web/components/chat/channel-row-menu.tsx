"use client";

import type { ReactElement } from "react";
import {
  Bell,
  CheckCheck,
  EyeOff,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  CHANNEL_LEVEL_DETAIL,
  CHANNEL_NOTIFICATIONS_LABEL,
  COPY_CHANNEL_LINK_LABEL,
  DELETE_CHANNEL_LABEL,
  HIDE_CONVERSATION_LABEL,
  MARK_AS_READ_LABEL,
  PIN_TO_TOP_LABEL,
  UNPIN_FROM_TOP_LABEL,
  channelRowActions,
  type ChannelRowActionKey,
  type ChatNotificationLevel,
} from "@repo/hooks";
import { PinGlyph } from "@/components/chat/chat-glyphs";
import { EDIT_CHANNEL_LABEL } from "@repo/hooks/channel-start";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  NOTIFICATION_LEVEL_OPTIONS,
  YOUR_DEFAULT_SUFFIX,
} from "./notification-level-popover";

const DESTRUCTIVE_ITEM_CLASS =
  "text-destructive-text focus:bg-destructive-tint focus:text-destructive-text";

/**
 * What a right-click on a rail row can do, wired by the shell. Which of these
 * a row offers is `channelRowActions`' call (`@repo/hooks`), the rule mobile's
 * long-press menu reads too.
 */
export interface ChannelRowActions {
  /** The member's flattened permissions; `undefined` while unknown. */
  permissions: readonly string[] | undefined;
  /** Stamp the read cursor without opening the channel. */
  onMarkRead: (channelId: string) => void;
  /**
   * The channel's effective level, or `undefined` while the levels are not
   * known, in which case no level is checked.
   */
  notificationLevelFor: (
    channelId: string,
  ) => ChatNotificationLevel | undefined;
  /**
   * The level came from Settings → Chat messages (#3840), so the checked
   * option reads "(your default)" (#4124). Optional: absent reads as false.
   */
  notificationFromChapterLevel?: (channelId: string) => boolean;
  onSetNotificationLevel: (
    channelId: string,
    level: ChatNotificationLevel,
  ) => void;
  onCopyLink: (channelId: string) => void;
  /** Open Chat settings on this channel (name, description, who can see it). */
  onEdit: (channelId: string) => void;
  /** Ask first, then delete. The rail only asks for it. */
  onDelete: (channelId: string) => void;
}

/**
 * The rail row's right-click menu (owner, 2026-11-06): "right click on desktop
 * to get channel actions like delete, edit permissions, mute". It replaced the
 * hover-only Pin and Hide buttons, which the owner asked to take away, so the
 * row itself carries no controls at all.
 *
 * Radix opens it on right-click, on a Mac's Ctrl+click, on a touch long-press,
 * and on the keyboard's menu key or Shift+F10 with the row focused.
 *
 * **Scoped to the member's permissions** (owner, 2026-11-06): a member sees
 * only what the server would let them do, so Edit channel and Delete channel
 * need `channels:manage`.
 *
 * **Never right-click only.** Every row here is also reachable another way:
 * Pin to top, Notifications and Hide conversation sit in the open channel's
 * `⋯` menu, Mark as read is what opening the channel does, Copy link is the
 * address bar, and Edit and Delete live in Chat settings (Edit is also the
 * channel start's own button). So this is a shortcut, not the only door, which
 * is the rule `components/shared/row-menu.tsx` exists to hold.
 */
export function ChannelRowMenu({
  channel,
  unread,
  pinned,
  onTogglePin,
  onHide,
  actions,
  children,
}: {
  channel: { id: string; type: string; name: string; hidden?: boolean | null };
  unread: boolean;
  /** Whether the row is pinned, or `null` when the rail offers no pinning. */
  pinned: boolean | null;
  onTogglePin: () => void;
  onHide: (() => void) | undefined;
  /** Absent, the row offers only what the rail itself can do (pin, hide). */
  actions: ChannelRowActions | undefined;
  /** The row: a single element that takes a ref and event props. */
  children: ReactElement;
}) {
  const groups = channelRowActions({
    channel,
    unread: !!actions && unread,
    pinned,
    permissions: actions?.permissions,
    surface: { copyLink: true, edit: true },
  });
  const isOffered = (key: ChannelRowActionKey) =>
    key === "toggle-pin" || (key === "hide" ? !!onHide : !!actions);
  const member = groups.member.filter(isOffered);
  const officer = actions ? groups.officer : [];
  if (member.length === 0 && officer.length === 0) return children;

  const level = actions?.notificationLevelFor(channel.id);
  const fromChapterLevel =
    actions?.notificationFromChapterLevel?.(channel.id) ?? false;

  const item = (key: ChannelRowActionKey) => {
    switch (key) {
      case "mark-read":
        return (
          <ContextMenuItem
            key={key}
            onSelect={() => actions?.onMarkRead(channel.id)}
          >
            <CheckCheck aria-hidden="true" />
            {MARK_AS_READ_LABEL}
          </ContextMenuItem>
        );
      case "toggle-pin":
        return (
          <ContextMenuItem key={key} onSelect={onTogglePin}>
            {/* Chat's pin, solid while pinned, as the channel menu draws it
                (iconography.md §6.2.2, #4292). */}
            <PinGlyph active={pinned === true} />
            {pinned ? UNPIN_FROM_TOP_LABEL : PIN_TO_TOP_LABEL}
          </ContextMenuItem>
        );
      case "notifications":
        return (
          <ContextMenuSub key={key}>
            {/* Locked while the level is unknown, as the header's panel is:
                a pick then would overwrite a level the member can't see. */}
            <ContextMenuSubTrigger
              disabled={!level}
              detail={level ? CHANNEL_LEVEL_DETAIL[level] : undefined}
            >
              <Bell aria-hidden="true" />
              {CHANNEL_NOTIFICATIONS_LABEL}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[180px]">
              <ContextMenuRadioGroup
                value={level ?? ""}
                onValueChange={(next) => {
                  // Radix calls this for the checked item too. Re-picking the
                  // current level must not write it: that would pin an
                  // explicit level over the channel's default.
                  if (next === level) return;
                  actions?.onSetNotificationLevel(
                    channel.id,
                    next as ChatNotificationLevel,
                  );
                }}
              >
                {NOTIFICATION_LEVEL_OPTIONS.map((option) => (
                  <ContextMenuRadioItem key={option.level} value={option.level}>
                    {option.label}
                    {option.level === level && fromChapterLevel
                      ? YOUR_DEFAULT_SUFFIX
                      : null}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        );
      case "copy-link":
        return (
          <ContextMenuItem
            key={key}
            onSelect={() => actions?.onCopyLink(channel.id)}
          >
            <Link2 aria-hidden="true" />
            {COPY_CHANNEL_LINK_LABEL}
          </ContextMenuItem>
        );
      case "hide":
        return (
          <ContextMenuItem key={key} onSelect={onHide}>
            <EyeOff aria-hidden="true" />
            {HIDE_CONVERSATION_LABEL}
          </ContextMenuItem>
        );
      case "edit":
        return (
          <ContextMenuItem
            key={key}
            onSelect={() => actions?.onEdit(channel.id)}
          >
            <Pencil aria-hidden="true" />
            {EDIT_CHANNEL_LABEL}
          </ContextMenuItem>
        );
      case "delete":
        return (
          <ContextMenuItem
            key={key}
            onSelect={() => actions?.onDelete(channel.id)}
            className={DESTRUCTIVE_ITEM_CLASS}
          >
            <Trash2 aria-hidden="true" />
            {DELETE_CHANNEL_LABEL}
          </ContextMenuItem>
        );
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[220px]">
        {member.map(item)}
        {member.length > 0 && officer.length > 0 ? (
          <ContextMenuSeparator />
        ) : null}
        {officer.map(item)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
