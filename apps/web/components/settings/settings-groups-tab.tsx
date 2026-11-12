"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  useCreateGroup,
  useDeleteGroup,
  useGroups,
  useMembers,
  useSetGroupMembers,
  useUpdateGroup,
  type ChapterGroup,
  type MemberProfile,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  GROUP_MEMBERS_MAX,
  GROUP_NAME_MAX_LENGTH,
  GROUPS_MAX,
  roleColorOrNull,
  type RoleColorHex,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ProfileSection } from "@/components/profile/profile-section";
import { RoleColorSwatches } from "@/components/roles/role-color-swatches";
import {
  ErrorState,
  OfflineState,
  anyReadUncached,
} from "@/components/shared/async-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { InlineNote } from "@/components/shared/inline-note";
import {
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import { SettingsListCardSkeleton } from "@/components/settings/settings-skeleton";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import { getErrorMessage } from "@/lib/utils";

/** How many matches the add-member search lists at once. */
const ADD_MATCH_LIMIT = 8;

function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/** What an automatic group follows, said on its row and in its editor. */
function followsLabel(group: ChapterGroup): string | null {
  if (group.kind === "pledge_class") return "Follows pledge class";
  if (group.kind === "class_year") return "Follows graduation year";
  return null;
}

/**
 * Settings → People → Groups (#4076): named sets of members, such as Third
 * floor or Live-ins, that carry no permissions. A group can be `@`-mentioned
 * and picked in a channel's who-can-see and who-can-post lists. Modeled on
 * Slack's user groups (a name, a handle, its members, nothing else) rather
 * than on a Discord role, which is also a grant: here the grant stays with
 * roles and tiers. Behavior: `spec/behavior/members.md` § Groups.
 *
 * Manual groups are the officer's to name and fill. Below them, Frapp keeps
 * one group per pledge class and graduation year from each member's own
 * data; only their color and ping switch can change, so they are listed
 * apart and marked.
 *
 * Every write needs `groups:manage`, which is also what shows the tab
 * (`settings-access.ts`).
 */
export function SettingsGroupsTab({ canManage }: { canManage: boolean }) {
  const groupsQuery = useGroups();
  const membersQuery = useMembers();
  const { isOffline } = useNetwork();
  // Above the loading and error branches, so a failed background refetch does
  // not unmount an open delete confirmation (see `SettingsFieldsTab`).
  const { confirm, confirmDialog } = useConfirmDialog();
  const [editingId, setEditingId] = useState<string | null>(null);

  const groups = groupsQuery.data ?? [];
  const manual = groups.filter((group) => group.kind === "manual");
  const automatic = groups.filter((group) => group.kind !== "manual");
  const members = membersQuery.data;
  const editing = groups.find((group) => group.id === editingId) ?? null;

  const paused = groupsQuery.isPending && groupsQuery.fetchStatus === "paused";

  let body: ReactNode;
  if (isOffline && anyReadUncached(groupsQuery)) {
    body = (
      <OfflineState
        title="Groups are unavailable offline"
        description="Reconnect to load them and make changes."
        onRetry={() => void groupsQuery.refetch()}
      />
    );
  } else if (groupsQuery.isLoading || paused) {
    body = <SettingsListCardSkeleton label="Loading groups" />;
  } else if (groupsQuery.isError && groupsQuery.data === undefined) {
    body = (
      <ErrorState
        title="Couldn't load groups"
        description="Retry to fetch them again."
        onRetry={() => void groupsQuery.refetch()}
      />
    );
  } else {
    body = (
      <>
        <ProfileSection
          id="settings-groups"
          title="Groups"
          hint="Named sets of members, like Third floor or Live-ins. @mention one to ping everyone in it, or pick it in a channel's who can see and post. A group gives no permissions."
        >
          <div className="space-y-1">
            {manual.length === 0 ? (
              <InlineNote>No groups yet.</InlineNote>
            ) : (
              manual.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  canManage={canManage}
                  confirm={confirm}
                  onEdit={() => setEditingId(group.id)}
                />
              ))
            )}
          </div>
        </ProfileSection>

        {canManage ? (
          <AddGroupForm
            full={manual.length >= GROUPS_MAX}
            onCreated={(group) => setEditingId(group.id)}
          />
        ) : null}

        <ProfileSection
          id="settings-groups-automatic"
          title="Pledge classes and class years"
          hint="Frapp keeps these from each member's pledge class and graduation year, so who's in them changes with that. You can set their color and whether anyone can ping them. Class years can't decide who sees a channel, because members set their own graduation year."
        >
          <div className="space-y-1">
            {automatic.length === 0 ? (
              <InlineNote>
                None yet. One appears for each pledge class and graduation year
                someone is in.
              </InlineNote>
            ) : (
              automatic.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  canManage={canManage}
                  confirm={confirm}
                  onEdit={() => setEditingId(group.id)}
                />
              ))
            )}
          </div>
        </ProfileSection>

        {!canManage ? (
          <InlineNote>
            Only officers who manage groups can change these.
          </InlineNote>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-10">
      {confirmDialog}
      {body}
      <Sheet
        open={editing !== null && members !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
      >
        {editing && members ? (
          <GroupEditor
            // Keyed by group, so a draft never carries over to the next one.
            key={editing.id}
            group={editing}
            members={members}
            onDone={() => setEditingId(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function ColorDot({ color }: { color: string | null }) {
  const hex = roleColorOrNull(color);
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
      // Palette literal: chapter data rendered as a raw swatch.
      style={hex ? { backgroundColor: hex, borderColor: hex } : undefined}
    />
  );
}

function GroupRow({
  group,
  canManage,
  confirm,
  onEdit,
}: {
  group: ChapterGroup;
  canManage: boolean;
  confirm: ReturnType<typeof useConfirmDialog>["confirm"];
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const remove = useDeleteGroup();
  const follows = followsLabel(group);
  const details = [
    memberCountLabel(group.member_ids.length),
    follows,
    group.mentionable ? null : "Only officers can ping it",
  ].filter(Boolean);

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete ${group.name}?`,
      description:
        "Its members stay in the chapter. A channel that lists it stops letting them in through it.",
      confirmLabel: `Delete ${group.name}`,
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(group.id);
      toast({ title: `${group.name} deleted` });
    } catch (error) {
      toast({
        title: `Couldn't delete ${group.name}`,
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 rounded-md px-1 py-1.5">
      <ColorDot color={group.color} />
      <div className="min-w-[8rem] flex-1">
        <p className="break-words text-sm font-semibold">{group.name}</p>
        <p className="text-caption text-muted-foreground">
          {details.join(" · ")}
        </p>
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Edit ${group.name}`}
            disabled={remove.isPending}
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          {group.kind === "manual" ? (
            <IconButton
              label={`Delete ${group.name}`}
              disabled={remove.isPending}
              onClick={() => void handleDelete()}
            >
              {remove.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AddGroupForm({
  full,
  onCreated,
}: {
  full: boolean;
  /** Opens the new group's editor, where its members are picked. */
  onCreated: (group: ChapterGroup) => void;
}) {
  const { toast } = useToast();
  const create = useCreateGroup();
  const [name, setName] = useState("");

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    try {
      const group = await create.mutateAsync({ name: trimmed });
      setName("");
      if (group) onCreated(group);
    } catch (error) {
      toast({
        title: `Couldn't add ${trimmed}`,
        description: getErrorMessage(
          error,
          "Pick a name no role, tier or group already has, then try again.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <ProfileSection
      id="settings-add-group"
      title="New group"
      hint={
        full
          ? `This chapter has ${GROUPS_MAX} groups, the most it can hold.`
          : "Name it the way members would @mention it. You pick who's in it next."
      }
    >
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-[10rem] flex-1 gap-1">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            maxLength={GROUP_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="Third floor"
            disabled={full}
          />
        </div>
        <Button
          type="submit"
          disabled={full || create.isPending || !name.trim()}
        >
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Create
        </Button>
      </form>
    </ProfileSection>
  );
}

function rowName(member: MemberProfile): string {
  return memberLabel(member.display_name, member.user_id);
}

/**
 * One group's name, color, ping switch and members. Nothing is written until
 * Save. A manual group's members are replaced whole, all or none, so a
 * member another officer removed from the chapter meanwhile fails the save
 * rather than half of it. An automatic group lists its members read-only.
 */
function GroupEditor({
  group,
  members: liveMembers,
  onDone,
}: {
  group: ChapterGroup;
  /** The loaded roster; the editor never mounts without it. */
  members: readonly MemberProfile[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const update = useUpdateGroup();
  const setMembers = useSetGroupMembers();
  const manual = group.kind === "manual";
  // The roster as it stood when the editor opened, so the rows don't shift
  // under the officer when a background read lands.
  const [members] = useState(liveMembers);
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<RoleColorHex | null>(
    roleColorOrNull(group.color),
  );
  const [mentionable, setMentionable] = useState(group.mentionable);
  const [picked, setPicked] = useState<string[]>(group.member_ids);
  const [search, setSearch] = useState("");
  const busy = update.isPending || setMembers.isPending;

  const byUser = useMemo(
    () => new Map(members.map((member) => [member.user_id, member])),
    [members],
  );
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return members
      .filter(
        (member) =>
          !pickedSet.has(member.user_id) &&
          rowName(member).toLowerCase().includes(query),
      )
      .slice(0, ADD_MATCH_LIMIT);
  }, [members, pickedSet, search]);
  const rows = picked
    .map((userId) => ({
      userId,
      name: byUser.has(userId)
        ? rowName(byUser.get(userId)!)
        : "A former member",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const trimmed = name.trim();
  const nameChanged = manual && trimmed !== group.name;
  const colorChanged = color !== roleColorOrNull(group.color);
  const pingChanged = mentionable !== group.mentionable;
  const membersChanged =
    manual &&
    (picked.length !== group.member_ids.length ||
      picked.some((userId) => !group.member_ids.includes(userId)));
  const tooMany = picked.length > GROUP_MEMBERS_MAX;
  const dirty = nameChanged || colorChanged || pingChanged || membersChanged;

  async function handleSave() {
    if (!dirty || tooMany || (manual && !trimmed)) return;
    try {
      if (nameChanged || colorChanged || pingChanged) {
        await update.mutateAsync({
          id: group.id,
          body: {
            name: nameChanged ? trimmed : undefined,
            color: colorChanged ? color : undefined,
            mentionable: pingChanged ? mentionable : undefined,
          },
        });
      }
      if (membersChanged) {
        await setMembers.mutateAsync({ id: group.id, memberIds: picked });
      }
      toast({ title: `${trimmed || group.name} saved` });
      onDone();
    } catch (error) {
      toast({
        title: `Couldn't save ${group.name}`,
        description: getErrorMessage(
          error,
          "Nothing more was changed. Reload the page and try again.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <PanelContent aria-describedby={undefined}>
      <PanelHeader>{group.name}</PanelHeader>
      <PanelBody>
        <div className="grid gap-1">
          <Label htmlFor="group-edit-name">Name</Label>
          <Input
            id="group-edit-name"
            value={name}
            maxLength={GROUP_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            disabled={!manual || busy}
            aria-describedby={manual ? undefined : "group-edit-name-note"}
          />
          {manual ? null : (
            <p
              id="group-edit-name-note"
              className="text-caption text-muted-foreground"
            >
              {group.kind === "pledge_class"
                ? "It follows the pledge class's name. Rename the class to change it."
                : "It follows the graduation year."}
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <Label id="group-edit-color-label">Color</Label>
          <RoleColorSwatches
            labelId="group-edit-color-label"
            value={color}
            onChange={setColor}
            disabled={busy}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="group-edit-mentionable">
              Anyone can @mention this group
            </Label>
            <p
              id="group-edit-mentionable-description"
              className="text-sm text-muted-foreground"
            >
              When off, only officers who manage channels or roles can ping
              everyone in it.
            </p>
          </div>
          <Switch
            id="group-edit-mentionable"
            aria-describedby="group-edit-mentionable-description"
            checked={mentionable}
            disabled={busy}
            onCheckedChange={setMentionable}
          />
        </div>

        {manual ? (
          <div className="grid gap-1">
            <Label htmlFor="group-add-member">Add a member</Label>
            <Input
              id="group-add-member"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name"
              autoComplete="off"
              disabled={busy}
            />
            {search.trim() ? (
              matches.length > 0 ? (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {matches.map((member) => (
                    <li
                      key={member.user_id}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <p className="min-w-0 truncate text-sm">
                        {rowName(member)}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setPicked((previous) => [
                            ...previous,
                            member.user_id,
                          ]);
                          setSearch("");
                        }}
                        aria-label={`Add ${rowName(member)}`}
                      >
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <InlineNote>No other member matches.</InlineNote>
              )
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-label font-semibold text-muted-foreground">
            {memberCountLabel(rows.length)}
          </p>
          {rows.length === 0 ? (
            <InlineNote>Nobody is in it yet.</InlineNote>
          ) : (
            <ul
              aria-label={`Members of ${group.name}`}
              className="divide-y divide-border rounded-md border border-border"
            >
              {rows.map((row) => (
                <li
                  key={row.userId}
                  className="flex items-center gap-2 px-3 py-1"
                >
                  <p className="min-w-0 flex-1 break-words text-sm">
                    {row.name}
                  </p>
                  {manual ? (
                    <IconButton
                      label={`Remove ${row.name} from ${group.name}`}
                      disabled={busy}
                      onClick={() =>
                        setPicked((previous) =>
                          previous.filter((userId) => userId !== row.userId),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {tooMany ? (
            <p role="alert" className="text-caption text-destructive-text">
              A group can hold at most {GROUP_MEMBERS_MAX} members.
            </p>
          ) : null}
        </div>
      </PanelBody>
      <PanelFooter>
        <Button variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={!dirty || tooMany || (manual && !trimmed) || busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </PanelFooter>
    </PanelContent>
  );
}
