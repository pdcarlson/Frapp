"use client";

import { ALWAYS_FORMAL_LABEL_WITH_HINT } from "@repo/chat-core/density";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { AUDIT_LOG_SETTINGS_NOTE } from "@repo/chat-core/audit-log-copy";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  PinOff,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import {
  useCategories,
  useChannelAccessOptions,
  useChannels,
  useCreateCategory,
  useCreateChannel,
  useDeleteCategory,
  useMemberDisplayNames,
  usePinnedMessages,
  useUnpinMessage,
  useUpdateCategory,
  useUpdateChannel,
  resolveAuthorLabel,
} from "@repo/hooks";
import { formatClock } from "@repo/formatting";
import {
  builtInChannelDefault,
  sameChannelAccessList,
  type ChatNotificationLevel,
} from "@repo/validation";
import { Can } from "@/components/shared/can";
import { ChatBackgroundDefaultCard } from "./chat-background-default-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { EYEBROW } from "@/components/ui/typography";
import { SectionLabel } from "@/components/shared/section-label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import {
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import {
  anyReadUncached,
  readIsOffline,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import {
  denseListClassName,
  compactControlClassName,
} from "@/components/shared/table-controls";
import { StaleReadNotice } from "@/components/shared/stale-read-notice";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useDeleteChannelFlow } from "@/components/chat/use-delete-channel-flow";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import { ChatReportsCard } from "./chat-reports-card";
import {
  ChannelAccessField,
  describeChannelAccess,
  type ChannelAccessOption,
} from "@/components/chat-admin/channel-access-field";
import {
  ChannelsSkeleton,
  ChatAdminBodySkeleton,
} from "@/components/chat-admin/chat-admin-skeleton";
import { InlineNote } from "@/components/shared/inline-note";

type ChannelType = "PUBLIC" | "PRIVATE" | "ROLE_GATED" | "DM" | "GROUP_DM";

interface AdminChannel {
  id: string;
  name: string;
  description: string | null;
  type: ChannelType;
  category_id: string | null;
  /**
   * Who can see and who can post (#3722): `null` is everyone (who can post:
   * everyone who can see it), a list names tiers and roles. Null on a
   * private channel, whose members decide.
   */
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
  /** Mirrors `who_can_post !== null`; still what the built-in push default reads. */
  is_read_only: boolean;
  /** Officer-set default push level (#2771); `null` = the built-in default. */
  default_notification_level: ChatNotificationLevel | null;
  /** The chapter's default channel, where Chat opens with no last channel. */
  is_default?: boolean;
  /** Leave out of Activity (#3897): its sign-up links reach no one's Activity. */
  activity_excluded?: boolean;
  /**
   * The chapter's audit log, `#chapter-audit` (#3909). Only Frapp posts in
   * it, so the server refuses a rename or switching read-only off, and this
   * form locks both.
   */
  is_audit_log?: boolean;
}

interface AdminCategory {
  id: string;
  name: string;
  display_order: number;
  /** What a new channel in it copies, and what a matching channel follows (#3722). */
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
}

interface PinnedMessageRow {
  id: string;
  content: string;
  sender_id: string | null;
  author_name?: string | null;
  created_at: string;
  pinned_at: string | null;
}

const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  PUBLIC: "Public",
  PRIVATE: "Private",
  ROLE_GATED: "Chosen roles",
  DM: "Direct message",
  GROUP_DM: "Group DM",
};

/**
 * The channel default a member gets until they choose their own level (#2771),
 * in the words the member's own notification menu uses for the same levels.
 */
const DEFAULT_LEVEL_LABELS: Record<ChatNotificationLevel, string> = {
  all: "Every message",
  mentions: "Only @mentions",
  off: "Mute",
};

/** Sentinel for "no officer default": the channel uses its built-in one. */
const BUILT_IN_DEFAULT_LEVEL = "__built_in__";

/** Sentinel for "no category" — Radix `Select` rejects an empty-string item value. */
const NO_CATEGORY = "__none__";

/** A chosen list with nothing on it: the API refuses it, so the form does. */
function isEmptyChoice(list: readonly string[] | null): boolean {
  return list !== null && list.length === 0;
}

/** A category's two answers in one line, for its row in the list. */
function categoryAccessSummary(
  category: AdminCategory,
  options: readonly ChannelAccessOption[],
): string {
  const see = category.who_can_see ?? null;
  const post = category.who_can_post ?? null;
  if (see === null && post === null) return "Everyone can see and post";
  const seen =
    see === null ? "everyone" : describeChannelAccess(see, "see", options);
  const posters =
    post === null
      ? "everyone who can see it"
      : describeChannelAccess(post, "post", options);
  return `Seen by ${seen}. Posts: ${posters}`;
}

/** Whether a channel's two lists equal its category's (it "matches" and follows it). */
function matchesCategory(
  see: readonly string[] | null,
  post: readonly string[] | null,
  category: AdminCategory | null | undefined,
): boolean {
  if (!category) return false;
  return (
    sameChannelAccessList(see, category.who_can_see ?? null) &&
    sameChannelAccessList(post, category.who_can_post ?? null)
  );
}

/**
 * Two pages on one route, the way Discord splits channel settings from server
 * settings (Paul, 2026-11-11: "scope the chat admin panel to whatever channel
 * you're editing"):
 *
 * - **`?channel=<id>`: that channel's settings, and nothing else.** The
 *   channel start's Edit channel shortcut (`components/chat/channel-start.tsx`)
 *   and the chat rail's right-click Edit channel (`chat-shell.tsx`) open it.
 *   Its settings first, then its pins, then the reports filed in it. No list
 *   of every channel: the chat rail beside the page already is one.
 * - **No channel: the chapter's chat settings.** New channel, a picker to open
 *   one channel's settings, categories, the chapter's chat background, and the
 *   whole report queue last (the only place a report about a DM shows).
 */
export function ChatAdminPage({
  initialChannelId = null,
}: {
  initialChannelId?: string | null;
} = {}) {
  return (
    <>
      {/*
        The denied line sits under the top bar's title bare, like every other
        denied page: the card it used to sit in framed one sentence.
      */}
      <Can
        permission="channels:manage"
        fallback={<ChatAdminBodySkeleton />}
        deniedFallback={
          <p className="text-sm text-muted-foreground">
            Your role can&apos;t manage channels. Ask your chapter president for
            access.
          </p>
        }
        offlineFallback={(retry) => (
          <PermissionsOfflineSurface
            description="Reconnect to check whether you can manage chat channels."
            onRetry={retry}
          />
        )}
      >
        {/*
          Keyed by channel, so opening another channel's settings starts from
          that channel's row rather than the last one's drafts.
        */}
        <ChatAdminBody
          key={initialChannelId ?? "chapter"}
          initialChannelId={initialChannelId}
        />
      </Can>
      {/*
        Outside the channels:manage gate: the chapter default is set by whoever
        edits the chapter profile (#3973), who may not manage channels. The
        card carries its own CHAPTER_PROFILE_PERMISSIONS gate. Chapter-wide, so
        not on one channel's page.
      */}
      {initialChannelId ? null : (
        <div className="mt-8">
          <ChatBackgroundDefaultCard />
        </div>
      )}
      {/*
        The report queue last, and outside `ChatAdminBody`, so a failed
        channels read (which replaces the body with an error) does not take it
        down. The card carries its own gate (`CHAT_REPORT_QUEUE_PERMISSIONS`,
        which includes channels:manage) and renders nothing for an officer it
        refuses. The new-report notification links to its anchor
        (`/chat-admin#reported-messages`).
      */}
      <div className="mt-10">
        <ChatReportsCard channelId={initialChannelId ?? undefined} />
      </div>
    </>
  );
}

function ChatAdminBody({
  initialChannelId,
}: {
  initialChannelId: string | null;
}) {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();

  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();
  const accessOptionsQuery = useChannelAccessOptions();

  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannelFlow = useDeleteChannelFlow(confirm);
  const router = useRouter();
  /** `?channel=` was given: this page is that channel's settings alone. */
  const channelMode = initialChannelId !== null;
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const allChannels = useMemo(
    () => asArray<AdminChannel>(channelsQuery.data),
    [channelsQuery.data],
  );
  // DMs and group DMs are member-initiated, not admin-managed — this surface
  // is channel/category structure, per the issue's own scope.
  const channels = useMemo(
    () => allChannels.filter((c) => c.type !== "DM" && c.type !== "GROUP_DM"),
    [allChannels],
  );
  const categories = useMemo(
    () => asArray<AdminCategory>(categoriesQuery.data),
    [categoriesQuery.data],
  );
  // What the who-can-see and who-can-post lists can name (#3722). Its own
  // read, so a failure degrades only the Add menus: the lists still show
  // what they hold, and every other setting saves.
  const accessOptions = useMemo(
    () => asArray<ChannelAccessOption>(accessOptionsQuery.data),
    [accessOptionsQuery.data],
  );
  const accessOptionsState: "ready" | "loading" | "error" =
    accessOptionsQuery.data !== undefined
      ? "ready"
      : accessOptionsQuery.isError ||
          (accessOptionsQuery.isPending &&
            accessOptionsQuery.fetchStatus === "paused")
        ? "error"
        : "loading";

  // ── Category drafts ─────────────────────────────────────────────────────
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [categoryNameDraft, setCategoryNameDraft] = useState("");
  // One category's access open at a time, edited in place under its row.
  const [accessCategoryId, setAccessCategoryId] = useState<string | null>(null);
  const [categorySeeDraft, setCategorySeeDraft] = useState<string[] | null>(
    null,
  );
  const [categoryPostDraft, setCategoryPostDraft] = useState<string[] | null>(
    null,
  );

  function startEditCategoryAccess(category: AdminCategory) {
    setAccessCategoryId(category.id);
    setCategorySeeDraft(category.who_can_see ?? null);
    setCategoryPostDraft(category.who_can_post ?? null);
  }

  async function handleSaveCategoryAccess(category: AdminCategory) {
    if (isEmptyChoice(categorySeeDraft) || isEmptyChoice(categoryPostDraft)) {
      return;
    }
    try {
      await updateCategory.mutateAsync({
        id: category.id,
        body: {
          who_can_see: categorySeeDraft,
          who_can_post: categoryPostDraft,
        },
      });
      toast({ description: `${category.name} access saved.` });
      setAccessCategoryId(null);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't save the access."),
      });
    }
  }

  function startEditCategory(category: AdminCategory) {
    setEditingCategoryId(category.id);
    setCategoryNameDraft(category.name);
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      // Max + 1, not `categories.length`: after any deletion the length no
      // longer equals "one past the highest order," and two categories can
      // end up tied on `display_order`.
      const nextOrder =
        categories.reduce((max, c) => Math.max(max, c.display_order), -1) + 1;
      await createCategory.mutateAsync({ name, display_order: nextOrder });
      toast({ description: `Category "${name}" created.` });
      setNewCategoryName("");
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't create the category."),
      });
    }
  }

  async function handleSaveCategory(category: AdminCategory) {
    const name = categoryNameDraft.trim();
    if (!name) return;
    try {
      await updateCategory.mutateAsync({ id: category.id, body: { name } });
      toast({ description: "Category renamed." });
      setEditingCategoryId(null);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't rename the category."),
      });
    }
  }

  async function handleDeleteCategory(category: AdminCategory) {
    const confirmed = await confirm({
      title: `Delete "${category.name}"?`,
      description:
        "Channels in this category become uncategorized. This cannot be undone.",
      confirmLabel: "Delete category",
    });
    if (!confirmed) return;
    try {
      await deleteCategory.mutateAsync(category.id);
      toast({ description: `Category "${category.name}" deleted.` });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't delete the category."),
      });
    }
  }

  // ── Channel selection + edit draft ──────────────────────────────────────
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  // What the draft was seeded with, so a save can tell an officer's edit from
  // the server row moving underneath an untouched draft.
  const [descriptionSeed, setDescriptionSeed] = useState("");
  const [categoryDraft, setCategoryDraft] = useState(NO_CATEGORY);
  const [isDefaultDraft, setIsDefaultDraft] = useState(false);
  const [activityExcludedDraft, setActivityExcludedDraft] = useState(false);
  // Seeded like `isDefaultSeed`: the switch is sent only when the officer
  // flipped it, so a save of another field can't undo another officer's.
  const [activityExcludedSeed, setActivityExcludedSeed] = useState(false);
  // What the switch was seeded with, for the reason `descriptionSeed` exists:
  // another officer moving the default refetches the live row under an
  // untouched switch, and comparing with that row would send it back.
  const [isDefaultSeed, setIsDefaultSeed] = useState(false);
  const [defaultLevelDraft, setDefaultLevelDraft] = useState<string>(
    BUILT_IN_DEFAULT_LEVEL,
  );
  // Who can see and post (#3722). `matchDraft` is set by "Match the
  // category" and cleared by any later edit of either list: a save then asks
  // the server to copy the category's lists, rather than sending the copy
  // this page last read.
  const [seeDraft, setSeeDraft] = useState<string[] | null>(null);
  const [postDraft, setPostDraft] = useState<string[] | null>(null);
  const [matchDraft, setMatchDraft] = useState(false);

  // `?channel=` from the channel start. Applied once, during render rather
  // than in an effect, so the editor's first paint already shows the channel.
  // The description field takes focus as the editor mounts (`autoFocus`), so
  // the officer lands where the channel start sent them. Any later pick
  // clears it (`selectChannel`), so the field doesn't take focus again when
  // the editor remounts.
  const [initialApplied, setInitialApplied] = useState(false);
  const [focusDescription, setFocusDescription] = useState(false);
  if (!initialApplied && initialChannelId) {
    const initial = channels.find((c) => c.id === initialChannelId);
    if (initial) {
      setInitialApplied(true);
      selectChannel(initial);
      setFocusDescription(true);
    } else if (channelsQuery.isSuccess) {
      setInitialApplied(true);
    }
  }

  function selectChannel(channel: AdminChannel) {
    setFocusDescription(false);
    setSelectedChannelId(channel.id);
    setNameDraft(channel.name);
    setDescriptionDraft(channel.description ?? "");
    setDescriptionSeed((channel.description ?? "").trim());
    setCategoryDraft(channel.category_id ?? NO_CATEGORY);
    setIsDefaultDraft(channel.is_default === true);
    setIsDefaultSeed(channel.is_default === true);
    setActivityExcludedDraft(channel.activity_excluded === true);
    setActivityExcludedSeed(channel.activity_excluded === true);
    setDefaultLevelDraft(
      channel.default_notification_level ?? BUILT_IN_DEFAULT_LEVEL,
    );
    setSeeDraft(channel.who_can_see ?? null);
    setPostDraft(channel.who_can_post ?? null);
    setMatchDraft(false);
  }

  /** The channel takes lists: not private, not a DM, not the audit log. */
  const selectedTakesLists =
    selectedChannel !== null &&
    (selectedChannel.type === "PUBLIC" ||
      selectedChannel.type === "ROLE_GATED") &&
    selectedChannel.is_audit_log !== true;
  const draftCategory =
    categoryDraft === NO_CATEGORY
      ? null
      : (categories.find((c) => c.id === categoryDraft) ?? null);
  const accessChanged =
    selectedChannel !== null &&
    (!sameChannelAccessList(seeDraft, selectedChannel.who_can_see ?? null) ||
      !sameChannelAccessList(postDraft, selectedChannel.who_can_post ?? null));
  const accessIncomplete =
    selectedTakesLists && (isEmptyChoice(seeDraft) || isEmptyChoice(postDraft));

  async function handleSaveChannel() {
    if (!selectedChannel) return;
    const name = nameDraft.trim();
    if (!name) {
      toast({ variant: "destructive", description: "Name can't be empty." });
      return;
    }
    if (accessIncomplete) {
      toast({
        variant: "destructive",
        description:
          "Add a tier or role to each chosen list, or pick Everyone.",
      });
      return;
    }
    // The description goes out only when the officer changed it. Sending the
    // blank draft on every save turned a never-set description (null) into
    // `''`, which reads the same on screen but is what a deliberate clear
    // looks like to the default-description backfill (20261105210000). The
    // draft is compared with what it was seeded from, not the live row: a
    // refetch that brings in the backfill or another officer's text while
    // this draft sits untouched must not send the stale draft over it.
    const description = descriptionDraft.trim();
    const descriptionChanged = description !== descriptionSeed;
    try {
      await updateChannel.mutateAsync({
        id: selectedChannel.id,
        body: {
          name,
          ...(descriptionChanged ? { description } : {}),
          // `null` clears the category; `NO_CATEGORY` selected means "make this
          // uncategorized," which is a real write, not "leave it alone."
          category_id: categoryDraft === NO_CATEGORY ? null : categoryDraft,
          // The lists go out only when they changed (a save of the name must
          // not write back lists another officer, or the category, just
          // moved), or as "match the category" when the officer asked for it.
          ...(selectedTakesLists && matchDraft && draftCategory
            ? { match_category_access: true }
            : selectedTakesLists && accessChanged
              ? { who_can_see: seeDraft, who_can_post: postDraft }
              : {}),
          ...(activityExcludedDraft !== activityExcludedSeed
            ? { activity_excluded: activityExcludedDraft }
            : {}),
          // Sent only when the officer flipped it: setting it moves the
          // chapter default off another channel, which a save of an unrelated
          // field must not.
          ...(isDefaultDraft !== isDefaultSeed
            ? { is_default: isDefaultDraft }
            : {}),
          // `null` clears an officer's choice; the built-in default applies.
          default_notification_level:
            defaultLevelDraft === BUILT_IN_DEFAULT_LEVEL
              ? null
              : (defaultLevelDraft as ChatNotificationLevel),
        },
      });
      setMatchDraft(false);
      if (descriptionChanged) setDescriptionSeed(description);
      setIsDefaultSeed(isDefaultDraft);
      setActivityExcludedSeed(activityExcludedDraft);
      toast({ description: `#${name} saved.` });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't save the channel."),
      });
    }
  }

  async function handleDeleteChannel(channel: AdminChannel) {
    await deleteChannelFlow(channel, () => {
      if (selectedChannelId === channel.id) setSelectedChannelId(null);
      // The page was this channel's; back to the chapter's chat settings.
      if (channelMode) router.replace("/chat-admin");
    });
  }

  // ── Create-channel panel ────────────────────────────────────────────────
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  // Discord's create dialog asks one question about access, "Private
  // channel", and Frapp keeps it: a private channel's members are added by
  // hand, everyone else's access is the two lists below it.
  const [createPrivate, setCreatePrivate] = useState(false);
  const [createCategoryId, setCreateCategoryId] = useState(NO_CATEGORY);
  const [createSee, setCreateSee] = useState<string[] | null>(null);
  const [createPost, setCreatePost] = useState<string[] | null>(null);
  // Until the officer edits a list, the channel takes its category's (the
  // server copies them when the lists are left out), and the form shows them.
  const [createAccessTouched, setCreateAccessTouched] = useState(false);
  const [createAlwaysFormal, setCreateAlwaysFormal] = useState(false);

  function resetCreateDraft() {
    setCreateName("");
    setCreateDescription("");
    setCreatePrivate(false);
    setCreateCategoryId(NO_CATEGORY);
    setCreateSee(null);
    setCreatePost(null);
    setCreateAccessTouched(false);
    setCreateAlwaysFormal(false);
  }

  function handleCreateCategoryChange(categoryId: string) {
    setCreateCategoryId(categoryId);
    if (createAccessTouched) return;
    const category = categories.find((c) => c.id === categoryId);
    setCreateSee(category?.who_can_see ?? null);
    setCreatePost(category?.who_can_post ?? null);
  }

  const createAccessIncomplete =
    !createPrivate && (isEmptyChoice(createSee) || isEmptyChoice(createPost));

  /** Every way the create panel closes (X, Escape, scrim, Cancel) drops the draft. */
  function handleCreateOpenChange(open: boolean) {
    setCreateDialogOpen(open);
    if (!open) resetCreateDraft();
  }

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return;
    if (createAccessIncomplete) {
      toast({
        variant: "destructive",
        description:
          "Add a tier or role to each chosen list, or pick Everyone.",
      });
      return;
    }
    try {
      await createChannel.mutateAsync({
        name,
        description: createDescription.trim() || undefined,
        type: createPrivate
          ? "PRIVATE"
          : createSee === null
            ? "PUBLIC"
            : "ROLE_GATED",
        category_id:
          createCategoryId === NO_CATEGORY ? undefined : createCategoryId,
        display_locked: createAlwaysFormal,
        ...(!createPrivate && createAccessTouched
          ? { who_can_see: createSee, who_can_post: createPost }
          : {}),
      });
      toast({ description: `#${name} created.` });
      resetCreateDraft();
      setCreateDialogOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't create the channel."),
      });
    }
  }

  // ── Pinned messages for the selected channel ────────────────────────────
  const pinsQuery = usePinnedMessages(selectedChannelId ?? "");
  const pins = useMemo(
    () => asArray<PinnedMessageRow>(pinsQuery.data),
    [pinsQuery.data],
  );
  const unpinMessage = useUnpinMessage();
  const { nameFor } = useMemberDisplayNames();

  async function handleUnpin(messageId: string) {
    try {
      await unpinMessage.mutateAsync(messageId);
      toast({ description: "Message unpinned." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't unpin the message."),
      });
    }
  }

  function retryQueries() {
    void channelsQuery.refetch();
    void categoriesQuery.refetch();
    void accessOptionsQuery.refetch();
  }

  const paused =
    (channelsQuery.isPending && channelsQuery.fetchStatus === "paused") ||
    (categoriesQuery.isPending && categoriesQuery.fetchStatus === "paused");

  // The nested family, not `async-states.tsx`'s: those paint `--card`, so on
  // this flush route they would redraw the card the route deleted. `sole`
  // because each is the only state the channel structure has, and it stands
  // where both of its sections would be: its title is that region's heading
  // and its loading line is that region's announcement. The report queue below
  // keeps its own, separately.
  if (isOffline && anyReadUncached(channelsQuery, categoriesQuery)) {
    return (
      <NestedOffline
        sole
        title="Channels unavailable offline"
        description="Reconnect to manage channels, categories and pins."
        onRetry={retryQueries}
      />
    );
  }
  if (channelsQuery.isLoading || categoriesQuery.isLoading || paused) {
    return <ChannelsSkeleton />;
  }
  // `data === undefined`, not `isError` alone: a failed background refetch
  // keeps the rows TanStack already holds, and an officer part-way through an
  // edit should not lose the form behind an error that blames their access
  // over a read that will likely succeed next time. Same line as the report
  // queue below draws.
  if (
    (channelsQuery.isError && channelsQuery.data === undefined) ||
    (categoriesQuery.isError && categoriesQuery.data === undefined)
  ) {
    return (
      <NestedError
        sole
        title="Couldn't load channels"
        description={describeLoadFailure(
          channelsQuery.error ?? categoriesQuery.error,
        )}
        onRetry={retryQueries}
      />
    );
  }

  return (
    <div className="space-y-8">
      {confirmDialog}
      {/*
        The channels and categories below are the last good read when a
        refetch failed, so say so rather than present them as current.
      */}
      <StaleReadNotice
        stale={channelsQuery.isError || categoriesQuery.isError}
        message="Couldn't refresh the channels. These are the last ones that loaded."
        onRetry={retryQueries}
      />
      {channelMode ? (
        <>
          {selectedChannel ? (
            // Its own container: the form's fields count the page's width.
            <div className="@container">
              <section aria-labelledby="ca-edit-label" className="space-y-4">
                <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-2">
                  <h2
                    id="ca-edit-label"
                    className="min-w-0 truncate text-lg font-bold"
                  >
                    #{selectedChannel.name}
                  </h2>
                  <Badge variant="outline">
                    {CHANNEL_TYPE_LABEL[selectedChannel.type]}
                  </Badge>
                  {selectedChannel.is_default ? (
                    <Badge variant="secondary">Default</Badge>
                  ) : null}
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="ml-auto gap-1.5 text-muted-foreground"
                  >
                    <Link href="/chat-admin">
                      <ArrowLeft className="h-4 w-4" />
                      All chat settings
                    </Link>
                  </Button>
                </div>
                <div className="grid gap-3 @md:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ca-name">Name</Label>
                    <Input
                      id="ca-name"
                      value={nameDraft}
                      disabled={selectedChannel.is_audit_log === true}
                      onChange={(event) => setNameDraft(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ca-category">Category</Label>
                    <Select
                      value={categoryDraft}
                      onValueChange={setCategoryDraft}
                    >
                      <SelectTrigger id="ca-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>
                          Uncategorized
                        </SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="ca-description">Description</Label>
                  <Textarea
                    autoFocus={focusDescription}
                    id="ca-description"
                    value={descriptionDraft}
                    onChange={(event) =>
                      setDescriptionDraft(event.target.value)
                    }
                    rows={2}
                  />
                </div>
                <ChannelAccessSection
                  channel={selectedChannel}
                  takesLists={selectedTakesLists}
                  category={draftCategory}
                  see={seeDraft}
                  post={postDraft}
                  matching={matchDraft}
                  options={accessOptions}
                  optionsState={accessOptionsState}
                  onSeeChange={(next) => {
                    setSeeDraft(next);
                    setMatchDraft(false);
                  }}
                  onPostChange={(next) => {
                    setPostDraft(next);
                    setMatchDraft(false);
                  }}
                  onMatch={() => {
                    if (!draftCategory) return;
                    setSeeDraft(draftCategory.who_can_see ?? null);
                    setPostDraft(draftCategory.who_can_post ?? null);
                    setMatchDraft(true);
                  }}
                />
                <div className="grid gap-1">
                  <label className="flex items-center gap-3">
                    <Switch
                      checked={isDefaultDraft}
                      onCheckedChange={setIsDefaultDraft}
                    />
                    <span className="text-sm">Chapter default channel</span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Chat opens here when a member&apos;s device has no last
                    channel. Turning this on moves it off any other channel.
                    Members who can&apos;t see this channel open #general.
                  </p>
                </div>
                <div className="grid gap-1">
                  <label className="flex items-center gap-3">
                    <Switch
                      checked={activityExcludedDraft}
                      onCheckedChange={setActivityExcludedDraft}
                    />
                    <span className="text-sm">Leave out of Activity</span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Sign-up links posted here (forms, sheets, booking pages)
                    won&apos;t show on anyone&apos;s Activity page. For channels
                    like #advertising whose links aren&apos;t chapter business.
                  </p>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="ca-default-level">
                    Default notifications
                  </Label>
                  <Select
                    value={defaultLevelDraft}
                    onValueChange={setDefaultLevelDraft}
                  >
                    <SelectTrigger id="ca-default-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BUILT_IN_DEFAULT_LEVEL}>
                        {/* Read from the drafts, so renaming a channel to or
                              from #general shows the default it would get. */}
                        Standard (
                        {
                          DEFAULT_LEVEL_LABELS[
                            builtInChannelDefault({
                              name: nameDraft.trim(),
                              type: selectedChannel.type,
                              is_read_only: selectedTakesLists
                                ? postDraft !== null
                                : selectedChannel.is_read_only,
                            })
                          ]
                        }
                        )
                      </SelectItem>
                      {(
                        Object.keys(
                          DEFAULT_LEVEL_LABELS,
                        ) as ChatNotificationLevel[]
                      ).map((level) => (
                        <SelectItem key={level} value={level}>
                          {DEFAULT_LEVEL_LABELS[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    What members get until they pick their own level for this
                    channel. Their own choice always wins, and an @mention still
                    reaches a member who muted it.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* The server refuses deleting the audit log (#3909). */}
                  {selectedChannel.is_audit_log ? null : (
                    <Button
                      variant="ghost"
                      className="mr-auto gap-2 text-destructive hover:text-destructive"
                      onClick={() => void handleDeleteChannel(selectedChannel)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete channel
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => selectChannel(selectedChannel)}
                    disabled={updateChannel.isPending}
                  >
                    Revert changes
                  </Button>
                  <Button
                    onClick={() => void handleSaveChannel()}
                    disabled={
                      updateChannel.isPending ||
                      !nameDraft.trim() ||
                      accessIncomplete
                    }
                  >
                    {updateChannel.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save channel
                  </Button>
                </div>

                <section
                  aria-labelledby="ca-pins-label"
                  className="space-y-2 border-t border-border pt-6"
                >
                  <h3
                    id="ca-pins-label"
                    className={`${EYEBROW} text-muted-foreground`}
                  >
                    Pinned messages
                    {/* A count only once there is a list to count. */}
                    {pinsQuery.data !== undefined ? ` (${pins.length})` : ""}
                  </h3>
                  <StaleReadNotice
                    stale={pinsQuery.isError && pinsQuery.data !== undefined}
                    message="Couldn't refresh the pins. These are the last ones that loaded."
                    onRetry={() => void pinsQuery.refetch()}
                  />
                  {/*
                      A failed or paused read is not an empty list. Both used
                      to fall through to "Nothing pinned", because `pins` is
                      `[]` whenever there is no data, so an officer offline or
                      behind a failed read was told the channel had no pins.
                      The nested family, so the three states in this slot
                      read as one, and Retry is the family's 44px control.
                      Offline first, and both ways a read goes offline
                      (`readIsOffline` in async-states.tsx): it pauses, or,
                      with the API unreachable or a page restored offline, it
                      fails, which would otherwise read as a load error.
                    */}
                  {readIsOffline(isOffline, pinsQuery) ? (
                    <NestedOffline
                      title="Pins unavailable offline"
                      description="Reconnect to load this channel's pins."
                      onRetry={() => void pinsQuery.refetch()}
                    />
                  ) : pinsQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">
                      Loading pins...
                    </p>
                  ) : pinsQuery.isError && pinsQuery.data === undefined ? (
                    <NestedError
                      title="Couldn't load pins"
                      description={describeLoadFailure(pinsQuery.error)}
                      onRetry={() => void pinsQuery.refetch()}
                    />
                  ) : pins.length === 0 ? (
                    <InlineNote>
                      Nothing pinned. Pin a message from the channel.
                    </InlineNote>
                  ) : (
                    <ul
                      className={cn(
                        denseListClassName,
                        "max-h-56 overflow-y-auto",
                      )}
                    >
                      {pins.map((message) => (
                        <li
                          key={message.id}
                          className="flex items-start justify-between gap-2 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground">
                              {resolveAuthorLabel(message, nameFor, null)}
                              <span className="ml-2 font-normal text-muted-foreground">
                                {formatClock(
                                  message.pinned_at ?? message.created_at,
                                )}
                              </span>
                            </p>
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {message.content}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={compactControlClassName}
                            aria-label="Unpin message"
                            onClick={() => void handleUnpin(message.id)}
                            disabled={unpinMessage.isPending}
                          >
                            <PinOff className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </section>
            </div>
          ) : (
            <div className="space-y-3">
              <InlineNote>
                This channel isn&apos;t here anymore. It may have been deleted.
              </InlineNote>
              <Button asChild variant="secondary" size="sm" className="gap-1.5">
                <Link href="/chat-admin">
                  <ArrowLeft className="h-4 w-4" />
                  All chat settings
                </Link>
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {/*
        Flush, not carded (`1f` pin 2: "one toolbar row, no wrapper card, no
        description paragraph"). The chapter's page lists no channels: the
        chat rail beside it already does, and right-click > Edit channel there
        opens one channel's own page. The picker is the way in from Settings,
        where the rail is not beside it.
      */}
          <section aria-labelledby="ca-channels-label" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <SectionLabel
                id="ca-channels-label"
                count={
                  channels.length > 0
                    ? `${channels.length} channel${channels.length === 1 ? "" : "s"}`
                    : null
                }
              >
                Channels
              </SectionLabel>
              <div className="flex flex-wrap items-center gap-2">
                {channels.length > 0 ? (
                  <Select
                    value=""
                    onValueChange={(id) =>
                      router.push(
                        `/chat-admin?channel=${encodeURIComponent(id)}`,
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label="Edit a channel"
                      className="w-56 max-w-full"
                    >
                      <SelectValue placeholder="Edit a channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          #{channel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Sheet
                  open={createDialogOpen}
                  onOpenChange={handleCreateOpenChange}
                >
                  <SheetTrigger asChild>
                    <Button className="gap-2">
                      <Plus className="h-4 w-4" />
                      New channel
                    </Button>
                  </SheetTrigger>
                  {/*
              A panel, not a dialog (`components.md` § Surface size): a
              channel's two access lists and their Add menus would scroll
              inside a 512px dialog capped at 80vh.
            */}
                  <PanelContent>
                    <PanelHeader>Create a channel</PanelHeader>
                    <PanelBody
                      as="form"
                      id="channel-create-form"
                      onSubmit={handleCreateChannel}
                    >
                      <SheetDescription>
                        Choose who can see the channel and who can post in it.
                        In a category, it starts with the category&apos;s
                        answers and follows them until you change it.
                      </SheetDescription>
                      <div className="grid gap-1">
                        <Label htmlFor="ca-create-name">Name</Label>
                        <Input
                          id="ca-create-name"
                          value={createName}
                          onChange={(event) =>
                            setCreateName(event.target.value)
                          }
                          placeholder="announcements"
                          required
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="ca-create-description">
                          Description
                        </Label>
                        <Textarea
                          id="ca-create-description"
                          value={createDescription}
                          onChange={(event) =>
                            setCreateDescription(event.target.value)
                          }
                          rows={2}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="ca-create-category">Category</Label>
                        <Select
                          value={createCategoryId}
                          onValueChange={handleCreateCategoryChange}
                        >
                          <SelectTrigger id="ca-create-category">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CATEGORY}>
                              Uncategorized
                            </SelectItem>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1">
                        <label className="flex items-center gap-3">
                          <Switch
                            checked={createPrivate}
                            onCheckedChange={setCreatePrivate}
                          />
                          <span className="text-sm">Private channel</span>
                        </label>
                        <p className="text-xs text-muted-foreground">
                          Only people you add can see it, starting with you. Its
                          type can&apos;t be changed after it&apos;s created.
                        </p>
                      </div>
                      {createPrivate ? null : (
                        <div className="grid gap-4 rounded-md border border-border p-3">
                          <ChannelAccessField
                            id="ca-create-see"
                            question="see"
                            value={createSee}
                            onChange={(next) => {
                              setCreateSee(next);
                              setCreateAccessTouched(true);
                            }}
                            options={accessOptions}
                            optionsState={accessOptionsState}
                          />
                          <ChannelAccessField
                            id="ca-create-post"
                            question="post"
                            value={createPost}
                            onChange={(next) => {
                              setCreatePost(next);
                              setCreateAccessTouched(true);
                            }}
                            options={accessOptions}
                            optionsState={accessOptionsState}
                          />
                        </div>
                      )}
                      <label className="flex items-center gap-3">
                        <Switch
                          checked={createAlwaysFormal}
                          onCheckedChange={setCreateAlwaysFormal}
                        />
                        <span className="text-sm">
                          {ALWAYS_FORMAL_LABEL_WITH_HINT}
                        </span>
                      </label>
                    </PanelBody>
                    <PanelFooter>
                      <Button
                        variant="secondary"
                        // Through the same handler as the X and Escape: Radix fires no
                        // `onOpenChange` for a close made by setting state, so a bare
                        // `setCreateDialogOpen(false)` would keep the draft.
                        onClick={() => handleCreateOpenChange(false)}
                        disabled={createChannel.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        form="channel-create-form"
                        type="submit"
                        disabled={
                          createChannel.isPending ||
                          !createName.trim() ||
                          createAccessIncomplete
                        }
                      >
                        {createChannel.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Create channel
                      </Button>
                    </PanelFooter>
                  </PanelContent>
                </Sheet>
              </div>
            </div>
            {channels.length === 0 ? (
              <InlineNote>
                No channels yet. Create the first one above.
              </InlineNote>
            ) : null}
          </section>

          <section aria-labelledby="ca-categories-label" className="space-y-3">
            <SectionLabel
              id="ca-categories-label"
              count={
                categories.length > 0
                  ? `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`
                  : null
              }
            >
              Categories
            </SectionLabel>
            {categories.length === 0 ? (
              <InlineNote>
                No categories yet. Channels without one show as uncategorized.
              </InlineNote>
            ) : (
              <ul className={denseListClassName}>
                {[...categories]
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((category) => (
                    <li key={category.id}>
                      <div className="flex min-h-11 items-center justify-between gap-2">
                        {editingCategoryId === category.id ? (
                          <>
                            <Input
                              value={categoryNameDraft}
                              onChange={(event) =>
                                setCategoryNameDraft(event.target.value)
                              }
                              className="h-8"
                              autoFocus
                            />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                onClick={() =>
                                  void handleSaveCategory(category)
                                }
                                disabled={updateCategory.isPending}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setEditingCategoryId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {category.name}
                              </p>
                              {/*
                              Both answers in one line, so an officer scanning
                              the list sees which categories are private
                              without opening each.
                            */}
                              <p className="truncate text-caption text-muted-foreground">
                                {categoryAccessSummary(category, accessOptions)}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className={compactControlClassName}
                                aria-label={`Who can see and post in ${category.name}`}
                                aria-expanded={accessCategoryId === category.id}
                                onClick={() =>
                                  accessCategoryId === category.id
                                    ? setAccessCategoryId(null)
                                    : startEditCategoryAccess(category)
                                }
                              >
                                <Users className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={compactControlClassName}
                                aria-label={`Rename ${category.name}`}
                                onClick={() => startEditCategory(category)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={compactControlClassName}
                                aria-label={`Delete ${category.name}`}
                                onClick={() =>
                                  void handleDeleteCategory(category)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                      {accessCategoryId === category.id ? (
                        <CategoryAccessEditor
                          category={category}
                          channels={channels}
                          see={categorySeeDraft}
                          post={categoryPostDraft}
                          onSeeChange={setCategorySeeDraft}
                          onPostChange={setCategoryPostDraft}
                          options={accessOptions}
                          optionsState={accessOptionsState}
                          saving={updateCategory.isPending}
                          onCancel={() => setAccessCategoryId(null)}
                          onSave={() => void handleSaveCategoryAccess(category)}
                        />
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
            <form
              onSubmit={handleCreateCategory}
              className="flex items-end gap-2 pt-2"
            >
              <div className="grid flex-1 gap-1">
                <Label htmlFor="ca-new-category" className="text-xs">
                  New category
                </Label>
                <Input
                  id="ca-new-category"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="Officers"
                  className="h-8"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={createCategory.isPending || !newCategoryName.trim()}
              >
                Add
              </Button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * A channel's "Who can see and post" (#3722). Paul, 2026-11-10: two lists,
 * not Discord's permission matrix, and a channel copies its category's
 * answers until changed, showing whether it still matches with a way back.
 * Private channels and the audit log say why they have no lists instead.
 */
function ChannelAccessSection({
  channel,
  takesLists,
  category,
  see,
  post,
  matching,
  options,
  optionsState,
  onSeeChange,
  onPostChange,
  onMatch,
}: {
  channel: AdminChannel;
  takesLists: boolean;
  category: AdminCategory | null;
  see: string[] | null;
  post: string[] | null;
  matching: boolean;
  options: readonly ChannelAccessOption[];
  optionsState: "ready" | "loading" | "error";
  onSeeChange: (next: string[] | null) => void;
  onPostChange: (next: string[] | null) => void;
  onMatch: () => void;
}) {
  if (channel.is_audit_log) {
    return (
      <p className="text-xs text-muted-foreground">{AUDIT_LOG_SETTINGS_NOTE}</p>
    );
  }
  if (!takesLists) {
    return (
      <InlineNote>
        Private. Only the people added to this channel can see it and post.
      </InlineNote>
    );
  }
  const matches = matching || matchesCategory(see, post, category);
  return (
    <section
      aria-labelledby="ca-access-label"
      className="grid gap-4 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 id="ca-access-label" className="text-sm font-semibold">
          Who can see and post
        </h3>
        {category ? (
          matches ? (
            <span className="text-caption text-muted-foreground">
              Matches {category.name}
            </span>
          ) : (
            <span className="flex items-center gap-2 text-caption text-muted-foreground">
              Custom
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={onMatch}
              >
                Match {category.name}
              </Button>
            </span>
          )
        ) : null}
      </div>
      <ChannelAccessField
        id="ca-see"
        question="see"
        value={see}
        onChange={onSeeChange}
        options={options}
        optionsState={optionsState}
      />
      <ChannelAccessField
        id="ca-post"
        question="post"
        value={post}
        onChange={onPostChange}
        options={options}
        optionsState={optionsState}
      />
      {category && matches ? (
        <p className="text-caption text-muted-foreground">
          Changes to {category.name}&apos;s access reach this channel too.
        </p>
      ) : null}
    </section>
  );
}

/**
 * A category's two answers, edited under its row. Saving moves every channel
 * in it that matched (the server does it in one transaction), so the editor
 * names them first: an officer locking down Exec sees which channels follow.
 */
function CategoryAccessEditor({
  category,
  channels,
  see,
  post,
  onSeeChange,
  onPostChange,
  options,
  optionsState,
  saving,
  onCancel,
  onSave,
}: {
  category: AdminCategory;
  channels: readonly AdminChannel[];
  see: string[] | null;
  post: string[] | null;
  onSeeChange: (next: string[] | null) => void;
  onPostChange: (next: string[] | null) => void;
  options: readonly ChannelAccessOption[];
  optionsState: "ready" | "loading" | "error";
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const inCategory = channels.filter(
    (channel) =>
      channel.category_id === category.id &&
      (channel.type === "PUBLIC" || channel.type === "ROLE_GATED") &&
      channel.is_audit_log !== true,
  );
  const following = inCategory.filter((channel) =>
    matchesCategory(
      channel.who_can_see ?? null,
      channel.who_can_post ?? null,
      category,
    ),
  );
  const custom = inCategory.length - following.length;
  const incomplete = isEmptyChoice(see) || isEmptyChoice(post);
  return (
    <div className="mb-2 mt-1 grid gap-4 rounded-md border border-border p-3">
      <ChannelAccessField
        id={`ca-cat-${category.id}-see`}
        question="see"
        value={see}
        onChange={onSeeChange}
        options={options}
        optionsState={optionsState}
      />
      <ChannelAccessField
        id={`ca-cat-${category.id}-post`}
        question="post"
        value={post}
        onChange={onPostChange}
        options={options}
        optionsState={optionsState}
      />
      <p className="text-caption text-muted-foreground">
        {following.length === 0
          ? "No channel here matches it now, so saving changes only what new channels start with."
          : `Saving also changes ${following
              .map((channel) => `#${channel.name}`)
              .join(
                ", ",
              )}, which ${following.length === 1 ? "matches" : "match"} it now.`}
        {custom > 0
          ? ` ${custom === 1 ? "One channel has" : `${custom} channels have`} custom access and keep${custom === 1 ? "s" : ""} it.`
          : ""}
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || incomplete}>
          Save access
        </Button>
      </div>
    </div>
  );
}
