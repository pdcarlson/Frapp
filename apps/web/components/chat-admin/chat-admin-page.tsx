"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Pencil, PinOff, Plus, Trash2 } from "lucide-react";
import {
  useCategories,
  useChannels,
  useCreateCategory,
  useCreateChannel,
  useDeleteCategory,
  useDeleteChannel,
  useMemberDisplayNames,
  usePermissionsCatalog,
  usePinnedMessages,
  useUnpinMessage,
  useUpdateCategory,
  useUpdateChannel,
  resolveAuthorLabel,
} from "@repo/hooks";
import { formatClock } from "@repo/formatting";
import { Can } from "@/components/shared/can";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import { NestedEmpty } from "@/components/shared/nested-states";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";

type ChannelType = "PUBLIC" | "PRIVATE" | "ROLE_GATED" | "DM" | "GROUP_DM";

interface AdminChannel {
  id: string;
  name: string;
  description: string | null;
  type: ChannelType;
  required_permissions: string[] | null;
  category_id: string | null;
  is_read_only: boolean;
}

interface AdminCategory {
  id: string;
  name: string;
  display_order: number;
}

interface PermissionCatalogEntry {
  key: string;
  permission: string;
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
  ROLE_GATED: "Role-gated",
  DM: "Direct message",
  GROUP_DM: "Group DM",
};

/** Only these are ever created or managed here — DMs are member-initiated. */
const CREATABLE_TYPES: Extract<ChannelType, "PUBLIC" | "PRIVATE" | "ROLE_GATED">[] =
  ["PUBLIC", "PRIVATE", "ROLE_GATED"];

/** Sentinel for "no category" — Radix `Select` rejects an empty-string item value. */
const NO_CATEGORY = "__none__";

export function ChatAdminPage() {
  return (
    <Can
      permission="channels:manage"
      deniedFallback={
        <Card>
          <CardHeader>
            <CardTitle>Chat Admin</CardTitle>
            <CardDescription>
              Managing channels and categories needs the{" "}
              <code>channels:manage</code> permission. Ask your chapter
              president to grant access.
            </CardDescription>
          </CardHeader>
        </Card>
      }
      offlineFallback={(retry) => (
        <PermissionsOfflineSurface
          description="Reconnect to check whether you can manage chat channels."
          onRetry={retry}
        />
      )}
    >
      <ChatAdminBody />
    </Can>
  );
}

function ChatAdminBody() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();

  const channelsQuery = useChannels();
  const categoriesQuery = useCategories();
  const catalogQuery = usePermissionsCatalog();

  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannel = useDeleteChannel();
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
  const catalog = useMemo(
    () => asArray<PermissionCatalogEntry>(catalogQuery.data),
    [catalogQuery.data],
  );
  const categoryName = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (byId.get(id) ?? "Unknown") : null);
  }, [categories]);

  // ── Category drafts ─────────────────────────────────────────────────────
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [categoryNameDraft, setCategoryNameDraft] = useState("");

  function startEditCategory(category: AdminCategory) {
    setEditingCategoryId(category.id);
    setCategoryNameDraft(category.name);
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await createCategory.mutateAsync({ name, display_order: categories.length });
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
  const [categoryDraft, setCategoryDraft] = useState(NO_CATEGORY);
  const [readOnlyDraft, setReadOnlyDraft] = useState(false);
  const [permissionsDraft, setPermissionsDraft] = useState<Set<string>>(
    new Set(),
  );

  function selectChannel(channel: AdminChannel) {
    setSelectedChannelId(channel.id);
    setNameDraft(channel.name);
    setDescriptionDraft(channel.description ?? "");
    setCategoryDraft(channel.category_id ?? NO_CATEGORY);
    setReadOnlyDraft(channel.is_read_only);
    setPermissionsDraft(new Set(channel.required_permissions ?? []));
  }

  function togglePermission(permission: string) {
    setPermissionsDraft((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function handleSaveChannel() {
    if (!selectedChannel) return;
    try {
      await updateChannel.mutateAsync({
        id: selectedChannel.id,
        body: {
          name: nameDraft.trim() || undefined,
          description: descriptionDraft.trim(),
          category_id: categoryDraft === NO_CATEGORY ? undefined : categoryDraft,
          is_read_only: readOnlyDraft,
          ...(selectedChannel.type === "ROLE_GATED"
            ? { required_permissions: Array.from(permissionsDraft) }
            : {}),
        },
      });
      toast({ description: `#${nameDraft || selectedChannel.name} saved.` });
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't save the channel."),
      });
    }
  }

  async function handleDeleteChannel(channel: AdminChannel) {
    const confirmed = await confirm({
      title: `Delete #${channel.name}?`,
      description:
        "Every message, attachment, and pin in this channel is removed. This cannot be undone.",
      confirmLabel: "Delete channel",
    });
    if (!confirmed) return;
    try {
      await deleteChannel.mutateAsync(channel.id);
      toast({ description: `#${channel.name} deleted.` });
      if (selectedChannelId === channel.id) setSelectedChannelId(null);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't delete the channel."),
      });
    }
  }

  // ── Create-channel dialog ───────────────────────────────────────────────
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createType, setCreateType] =
    useState<(typeof CREATABLE_TYPES)[number]>("PUBLIC");
  const [createCategoryId, setCreateCategoryId] = useState(NO_CATEGORY);
  const [createReadOnly, setCreateReadOnly] = useState(false);
  const [createPermissions, setCreatePermissions] = useState<Set<string>>(
    new Set(),
  );

  function toggleCreatePermission(permission: string) {
    setCreatePermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function resetCreateDraft() {
    setCreateName("");
    setCreateDescription("");
    setCreateType("PUBLIC");
    setCreateCategoryId(NO_CATEGORY);
    setCreateReadOnly(false);
    setCreatePermissions(new Set());
  }

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return;
    try {
      await createChannel.mutateAsync({
        name,
        description: createDescription.trim() || undefined,
        type: createType,
        category_id:
          createCategoryId === NO_CATEGORY ? undefined : createCategoryId,
        is_read_only: createReadOnly,
        ...(createType === "ROLE_GATED"
          ? { required_permissions: Array.from(createPermissions) }
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
    void catalogQuery.refetch();
  }

  const channelsReady = channelsQuery.data !== undefined;
  const categoriesReady = categoriesQuery.data !== undefined;
  const catalogReady = catalogQuery.data !== undefined;
  const paused =
    (channelsQuery.isPending && channelsQuery.fetchStatus === "paused") ||
    (categoriesQuery.isPending && categoriesQuery.fetchStatus === "paused") ||
    (catalogQuery.isPending && catalogQuery.fetchStatus === "paused");

  if (isOffline && !(channelsReady && categoriesReady && catalogReady)) {
    return (
      <OfflineState
        title="Chat Admin unavailable offline"
        description="Reconnect to manage channels, categories, and pins."
        onRetry={retryQueries}
      />
    );
  }
  if (channelsQuery.isLoading || categoriesQuery.isLoading || catalogQuery.isLoading || paused) {
    return <LoadingState message="Loading channels..." />;
  }
  if (channelsQuery.isError || categoriesQuery.isError || catalogQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load Chat Admin"
        description="Retry in a moment. This view requires the channels:manage permission."
        onRetry={retryQueries}
      />
    );
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Chat Admin</h2>
          <p className="text-sm text-muted-foreground">
            Create, edit, and delete channels; organize them into categories;
            and manage pinned messages.
          </p>
        </div>
        <Dialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) resetCreateDraft();
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New channel
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create a channel</DialogTitle>
              <DialogDescription>
                Public and private channels are visible to every member;
                role-gated channels require at least one of the selected
                permissions to read.
              </DialogDescription>
            </DialogHeader>
            <form
              id="channel-create-form"
              className="space-y-4"
              onSubmit={handleCreateChannel}
            >
              <div className="grid gap-1">
                <Label htmlFor="ca-create-name">Name</Label>
                <Input
                  id="ca-create-name"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="announcements"
                  required
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="ca-create-description">Description</Label>
                <Textarea
                  id="ca-create-description"
                  value={createDescription}
                  onChange={(event) => setCreateDescription(event.target.value)}
                  rows={2}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="ca-create-type">Type</Label>
                  <Select
                    value={createType}
                    onValueChange={(value) =>
                      setCreateType(value as (typeof CREATABLE_TYPES)[number])
                    }
                  >
                    <SelectTrigger id="ca-create-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CREATABLE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {CHANNEL_TYPE_LABEL[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="ca-create-category">Category</Label>
                  <Select
                    value={createCategoryId}
                    onValueChange={setCreateCategoryId}
                  >
                    <SelectTrigger id="ca-create-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CATEGORY}>Uncategorized</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-3">
                <Switch
                  checked={createReadOnly}
                  onCheckedChange={setCreateReadOnly}
                />
                <span className="text-sm">
                  Read-only (only officers with permission can post)
                </span>
              </label>
              {createType === "ROLE_GATED" ? (
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Required permissions ({createPermissions.size})
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A member needs at least one of these to read or post.
                  </p>
                  <div className="mt-2 grid gap-2 rounded-md border border-border p-3 max-h-48 overflow-y-auto">
                    {catalog
                      .filter((entry) => entry.permission !== "*")
                      .map((entry) => (
                        <label
                          key={entry.permission}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <span className={dashboardCheckboxHitAreaClassName}>
                            <input
                              type="checkbox"
                              className={dashboardTableCheckboxClassName}
                              checked={createPermissions.has(entry.permission)}
                              onChange={() =>
                                toggleCreatePermission(entry.permission)
                              }
                            />
                          </span>
                          <code className="text-xs">{entry.permission}</code>
                        </label>
                      ))}
                  </div>
                </div>
              ) : null}
            </form>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => setCreateDialogOpen(false)}
                disabled={createChannel.isPending}
              >
                Cancel
              </Button>
              <Button
                form="channel-create-form"
                type="submit"
                disabled={createChannel.isPending}
              >
                {createChannel.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Create channel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Categories</CardTitle>
          <CardDescription>
            {categories.length} categor{categories.length === 1 ? "y" : "ies"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories.length === 0 ? (
            <NestedEmpty
              title="No categories yet"
              description="Channels without a category show up as uncategorized."
            />
          ) : (
            <ul className="divide-y divide-border/70">
              {[...categories]
                .sort((a, b) => a.display_order - b.display_order)
                .map((category) => (
                  <li
                    key={category.id}
                    className="flex items-center justify-between gap-2 py-2"
                  >
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
                            onClick={() => void handleSaveCategory(category)}
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
                        <span className="text-sm font-medium">
                          {category.name}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Rename ${category.name}`}
                            onClick={() => startEditCategory(category)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${category.name}`}
                            onClick={() => void handleDeleteCategory(category)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    )}
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
        </CardContent>
      </Card>

      {channels.length === 0 ? (
        <EmptyState
          title="No channels yet"
          description="Create the first channel to get chapter chat structured."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Channels</CardTitle>
              <CardDescription>
                {channels.length} channel{channels.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <ul className="divide-y divide-border/70">
                {channels.map((channel) => (
                  <li
                    key={channel.id}
                    className="flex items-center justify-between py-2"
                  >
                    <button
                      type="button"
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
                        FOCUS_RING_OFFSET,
                        selectedChannelId === channel.id
                          ? "bg-accent-subtle-hover text-accent-text"
                          : "hover:bg-accent-subtle",
                      )}
                      aria-pressed={selectedChannelId === channel.id}
                      onClick={() => selectChannel(channel)}
                    >
                      <span className="truncate text-sm font-medium">
                        #{channel.name}
                      </span>
                      <Badge variant="outline">
                        {CHANNEL_TYPE_LABEL[channel.type]}
                      </Badge>
                      {channel.is_read_only ? (
                        <Badge variant="secondary">Read-only</Badge>
                      ) : null}
                      {categoryName(channel.category_id) ? (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {categoryName(channel.category_id)}
                        </span>
                      ) : null}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete #${channel.name}`}
                      onClick={() => void handleDeleteChannel(channel)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {selectedChannel
                  ? `Edit #${selectedChannel.name}`
                  : "Select a channel to edit"}
              </CardTitle>
              <CardDescription>
                {selectedChannel
                  ? `Type is set at creation and can't be changed here.`
                  : "Pick a channel on the left to edit its details, permissions, and pins."}
              </CardDescription>
            </CardHeader>
            {selectedChannel ? (
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ca-name">Name</Label>
                    <Input
                      id="ca-name"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="ca-category">Category</Label>
                    <Select value={categoryDraft} onValueChange={setCategoryDraft}>
                      <SelectTrigger id="ca-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>Uncategorized</SelectItem>
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
                    id="ca-description"
                    value={descriptionDraft}
                    onChange={(event) => setDescriptionDraft(event.target.value)}
                    rows={2}
                  />
                </div>
                <label className="flex items-center gap-3">
                  <Switch
                    checked={readOnlyDraft}
                    onCheckedChange={setReadOnlyDraft}
                  />
                  <span className="text-sm">
                    Read-only (only officers with permission can post)
                  </span>
                </label>
                {selectedChannel.type === "ROLE_GATED" ? (
                  <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Required permissions ({permissionsDraft.size})
                    </Label>
                    <div className="mt-2 grid gap-2 rounded-md border border-border p-3 max-h-48 overflow-y-auto">
                      {catalog
                        .filter((entry) => entry.permission !== "*")
                        .map((entry) => (
                          <label
                            key={entry.permission}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <span className={dashboardCheckboxHitAreaClassName}>
                              <input
                                type="checkbox"
                                className={dashboardTableCheckboxClassName}
                                checked={permissionsDraft.has(entry.permission)}
                                onChange={() =>
                                  togglePermission(entry.permission)
                                }
                              />
                            </span>
                            <code className="text-xs">{entry.permission}</code>
                          </label>
                        ))}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2 border-t border-border pt-4">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Pinned messages ({pins.length})
                  </Label>
                  {pinsQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : pins.length === 0 ? (
                    <NestedEmpty
                      title="Nothing pinned"
                      description="Officers can pin key messages from the channel timeline."
                    />
                  ) : (
                    <ul className="max-h-56 space-y-2 overflow-y-auto">
                      {pins.map((message) => (
                        <li
                          key={message.id}
                          className="flex items-start justify-between gap-2 rounded-md border border-border p-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground">
                              {resolveAuthorLabel(message, nameFor, null)}
                              <span className="ml-2 font-normal text-muted-foreground">
                                {formatClock(message.pinned_at ?? message.created_at)}
                              </span>
                            </p>
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {message.content}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
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
                </div>
              </CardContent>
            ) : (
              <CardContent className="text-sm text-muted-foreground">
                Pick a channel on the left to see its details here.
              </CardContent>
            )}
            {selectedChannel ? (
              <CardFooter className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => selectChannel(selectedChannel)}
                  disabled={updateChannel.isPending}
                >
                  Revert changes
                </Button>
                <Button
                  onClick={() => void handleSaveChannel()}
                  disabled={updateChannel.isPending}
                >
                  {updateChannel.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Save channel
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  );
}
