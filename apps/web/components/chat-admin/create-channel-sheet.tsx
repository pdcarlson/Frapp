"use client";

import { ALWAYS_FORMAL_LABEL_WITH_HINT } from "@repo/chat-core/density";
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { isEmptyChannelAccessChoice } from "@repo/hooks/channel-access";
import {
  useCategories,
  useChannelAccessOptions,
  useCreateChannel,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slot } from "@radix-ui/react-slot";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelDescription,
  PanelHeader,
} from "@/components/shared/panel";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import {
  ChannelAccessField,
  type ChannelAccessOption,
} from "@/components/chat-admin/channel-access-field";

/** Sentinel for "no category": Radix `Select` rejects an empty-string item value. */
const NO_CATEGORY = "__none__";

interface SheetCategory {
  id: string;
  name: string;
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
}

/**
 * Create a channel: one panel for every place that offers New channel. Chat
 * settings opens it from its New channel button, and the chat rail from the +
 * beside a category heading (#3838, Shawn 2026-11-11: "create a new channel
 * and then drag it where I want it to be directly from the channels list"),
 * which starts it in that category, as Discord's and Slack's + do.
 *
 * Reads the categories and the access options itself, so a caller only says
 * where it opens. The draft is dropped on every close (X, Escape, scrim,
 * Cancel) and on success. `onCreated` gets the new channel's id, for the rail
 * to open it.
 */
export function CreateChannelSheet({
  open,
  onOpenChange,
  initialCategoryId = null,
  onCreated,
  trigger,
  docked = false,
  backLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category the + was beside, or null for none. Read on open. */
  initialCategoryId?: string | null;
  onCreated?: (channelId: string) => void;
  /** The button that opens it, for a caller that has one. */
  trigger?: ReactNode;
  /**
   * Open in place of the page that owns it (Chat admin), beside chat,
   * rather than over the app (`components.md` § Surface size). Chat's own
   * + beside a category has no page, so it stays a sheet.
   */
  docked?: boolean;
  /** The back arrow's name when docked. */
  backLabel?: string;
}) {
  const { toast } = useToast();
  const createChannel = useCreateChannel();
  const categoriesQuery = useCategories();
  const accessOptionsQuery = useChannelAccessOptions();
  const categories = useMemo(
    () => asArray<SheetCategory>(categoriesQuery.data),
    [categoriesQuery.data],
  );
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

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Discord's create dialog asks one question about access, "Private
  // channel", and Frapp keeps it: a private channel's members are added by
  // hand, everyone else's access is the two lists below it.
  const [isPrivate, setIsPrivate] = useState(false);
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const [see, setSee] = useState<string[] | null>(null);
  const [post, setPost] = useState<string[] | null>(null);
  // Until the officer edits a list, the channel takes its category's (the
  // server copies them when the lists are left out), and the form shows them.
  const [accessTouched, setAccessTouched] = useState(false);
  const [alwaysFormal, setAlwaysFormal] = useState(false);

  // The category the + was beside, applied each time the panel opens (during
  // render, so its first paint already shows it). Its lists seed the form,
  // as picking that category would.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? `open:${initialCategoryId ?? ""}` : null;
  if (seededFor !== seedKey) {
    setSeededFor(seedKey);
    if (open) {
      const category = initialCategoryId
        ? categories.find((c) => c.id === initialCategoryId)
        : undefined;
      setCategoryId(category ? category.id : NO_CATEGORY);
      setSee(category?.who_can_see ?? null);
      setPost(category?.who_can_post ?? null);
    }
  }

  function reset() {
    setName("");
    setDescription("");
    setIsPrivate(false);
    setCategoryId(NO_CATEGORY);
    setSee(null);
    setPost(null);
    setAccessTouched(false);
    setAlwaysFormal(false);
  }

  function handleCategoryChange(next: string) {
    setCategoryId(next);
    if (accessTouched) return;
    const category = categories.find((c) => c.id === next);
    setSee(category?.who_can_see ?? null);
    setPost(category?.who_can_post ?? null);
  }

  const accessIncomplete =
    !isPrivate &&
    (isEmptyChannelAccessChoice(see) || isEmptyChannelAccessChoice(post));

  /** Every way the panel closes (X, Escape, scrim, Cancel) drops the draft. */
  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (accessIncomplete) {
      toast({
        variant: "destructive",
        description:
          "Add a tier or role to each chosen list, or pick Everyone.",
      });
      return;
    }
    try {
      const created = await createChannel.mutateAsync({
        name: trimmed,
        description: description.trim() || undefined,
        type: isPrivate ? "PRIVATE" : see === null ? "PUBLIC" : "ROLE_GATED",
        category_id: categoryId === NO_CATEGORY ? undefined : categoryId,
        display_locked: alwaysFormal,
        ...(!isPrivate && accessTouched
          ? { who_can_see: see, who_can_post: post }
          : {}),
      });
      toast({ description: `#${trimmed} created.` });
      handleOpenChange(false);
      const createdId = (created as { id?: unknown } | undefined)?.id;
      if (typeof createdId === "string") onCreated?.(createdId);
    } catch (error) {
      toast({
        variant: "destructive",
        description: getErrorMessage(error, "Couldn't create the channel."),
      });
    }
  }

  return (
    <>
      {trigger ? (
        <Slot onClick={() => handleOpenChange(true)}>{trigger}</Slot>
      ) : null}
      <Panel
        open={open}
        onOpenChange={handleOpenChange}
        docked={docked}
        backLabel={backLabel}
      >
        {/*
        A panel, not a dialog (`components.md` § Surface size): a channel's
        two access lists and their Add menus would scroll inside a 512px
        dialog capped at 80vh.
      */}
        <PanelContent>
          <PanelHeader>Create a channel</PanelHeader>
          <PanelBody as="form" id="channel-create-form" onSubmit={handleSubmit}>
            <PanelDescription>
              Choose who can see the channel and who can post in it. In a
              category, it starts with the category&apos;s answers and follows
              them until you change it.
            </PanelDescription>
            <div className="grid gap-1">
              <Label htmlFor="ca-create-name">Name</Label>
              <Input
                id="ca-create-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="announcements"
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ca-create-description">Description</Label>
              <Textarea
                id="ca-create-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ca-create-category">Category</Label>
              <Select value={categoryId} onValueChange={handleCategoryChange}>
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
            <div className="grid gap-1">
              <label className="flex items-center gap-3">
                <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
                <span className="text-sm">Private channel</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Only people you add can see it, starting with you. Its type
                can&apos;t be changed after it&apos;s created.
              </p>
            </div>
            {isPrivate ? null : (
              <div className="grid gap-4 rounded-md border border-border p-3">
                <ChannelAccessField
                  id="ca-create-see"
                  question="see"
                  value={see}
                  onChange={(next) => {
                    setSee(next);
                    setAccessTouched(true);
                  }}
                  options={accessOptions}
                  optionsState={accessOptionsState}
                />
                <ChannelAccessField
                  id="ca-create-post"
                  question="post"
                  value={post}
                  onChange={(next) => {
                    setPost(next);
                    setAccessTouched(true);
                  }}
                  options={accessOptions}
                  optionsState={accessOptionsState}
                />
              </div>
            )}
            <label className="flex items-center gap-3">
              <Switch
                checked={alwaysFormal}
                onCheckedChange={setAlwaysFormal}
              />
              <span className="text-sm">{ALWAYS_FORMAL_LABEL_WITH_HINT}</span>
            </label>
          </PanelBody>
          <PanelFooter>
            <Button
              variant="secondary"
              // Through the same handler as the X and Escape: Radix fires no
              // `onOpenChange` for a close made by setting state, so a bare
              // `onOpenChange(false)` would keep the draft.
              onClick={() => handleOpenChange(false)}
              disabled={createChannel.isPending}
            >
              Cancel
            </Button>
            <Button
              form="channel-create-form"
              type="submit"
              disabled={
                createChannel.isPending || !name.trim() || accessIncomplete
              }
            >
              {createChannel.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Create channel
            </Button>
          </PanelFooter>
        </PanelContent>
      </Panel>
    </>
  );
}
