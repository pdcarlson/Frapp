"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import {
  fraternalOrderComparator,
  useAssignPledgeClasses,
  useCreatePledgeClass,
  useDeletePledgeClass,
  useMembers,
  usePledgeClasses,
  useRenamePledgeClass,
  useReorderPledgeClasses,
  type MemberProfile,
  type PledgeClass,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  PLEDGE_CLASS_ASSIGNMENTS_MAX,
  PLEDGE_CLASS_NAME_MAX_LENGTH,
  PLEDGE_CLASSES_MAX,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { ProfileSection } from "@/components/profile/profile-section";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import {
  ErrorState,
  OfflineState,
  anyReadUncached,
} from "@/components/shared/async-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  InlineNote,
  InlineNoteAction,
} from "@/components/shared/inline-note";
import {
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import { ReorderList } from "@/components/shared/reorder-list";
import { SettingsListCardSkeleton } from "@/components/settings/settings-skeleton";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import {
  classAssignments,
  nextOrderNumber,
  parseOrderNumber,
  renumberRows,
  type ClassEditorRow,
} from "@/lib/pledge-classes";
import { getErrorMessage } from "@/lib/utils";

type Props = {
  /** Whether the viewer holds `roles:manage`, the gate on every write here. */
  canManage: boolean;
  /** The chapter's word for a class: "Pledge class", "Line", "Cohort". */
  classTerm: string;
  /** The chapter's word for a member's number: "Fraternal order", "Roll number". */
  orderTerm: string;
};

/** How many matches the add-member search lists at once. */
const ADD_MATCH_LIMIT = 8;

function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/**
 * Settings → the chapter's pledge classes (#3939): the place an officer sets
 * them up. The list is the chapter's own order, oldest first, and is put in
 * order by dragging. Each class opens an editor that orders its members in
 * bulk. Behaviour: `spec/behavior/members.md` § Pledge class and order number.
 *
 * Reads need `members:view`; every write needs `roles:manage`, which is also
 * what shows the tab (`settings-access.ts`).
 *
 * **Copy never inflects the chapter's words.** `classTerm` and `orderTerm` are
 * whatever the chapter typed in Settings → vocabulary, so they are drawn as
 * typed, in a heading or a label, and sentences say "it" or "the list". A
 * plural or a lowercased form of a free-text word comes out wrong for "PC" or
 * "Family" (`settings-semester-tab.tsx` words around its term the same way).
 */
export function SettingsClassesTab({ canManage, classTerm, orderTerm }: Props) {
  const classesQuery = usePledgeClasses();
  const membersQuery = useMembers();
  const reorder = useReorderPledgeClasses();
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  // Above the loading and error branches, so a failed background refetch does
  // not unmount an open delete confirmation (see `SettingsFieldsTab`).
  const { confirm, confirmDialog } = useConfirmDialog();
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  // The order as the officer just dropped it, shown until the save and the
  // re-read answer, so a row never jumps back and then forward again.
  const [pendingOrder, setPendingOrder] = useState<PledgeClass[] | null>(null);
  // The newest order not yet sent, and whether a save is running. Moves made
  // while one is in flight collapse into a single follow-up save, so the
  // handles stay usable and two saves never race each other.
  const wantedOrder = useRef<PledgeClass[] | null>(null);
  const savingOrder = useRef(false);

  const saved = classesQuery.data ?? [];
  const classes = pendingOrder ?? saved;
  // `undefined` until the roster read answers: a count, the delete warning
  // and the class editor all need the real roster, never an empty stand-in.
  const members = membersQuery.data;
  const countByClass = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of members ?? []) {
      if (member.pledge_class_id) {
        counts.set(
          member.pledge_class_id,
          (counts.get(member.pledge_class_id) ?? 0) + 1,
        );
      }
    }
    return counts;
  }, [members]);

  const editingClass =
    saved.find((entry) => entry.id === editingClassId) ?? null;

  async function handleReorder(next: PledgeClass[]) {
    setPendingOrder(next);
    wantedOrder.current = next;
    if (savingOrder.current) return;
    savingOrder.current = true;
    try {
      while (wantedOrder.current) {
        const ids = wantedOrder.current.map((entry) => entry.id);
        wantedOrder.current = null;
        // Settles after the list is re-read (`useReorderPledgeClasses`).
        await reorder.mutateAsync(ids);
      }
    } catch (error) {
      wantedOrder.current = null;
      toast({
        title: "Couldn't save the order",
        description: getErrorMessage(
          error,
          "The list changed while you were editing. It has been reloaded.",
        ),
        variant: "destructive",
      });
    } finally {
      savingOrder.current = false;
      // The saved list is in the cache by now, so the row neither jumps back
      // nor keeps an order the API refused.
      setPendingOrder(null);
    }
  }

  const paused =
    classesQuery.isPending && classesQuery.fetchStatus === "paused";

  let body: ReactNode;
  if (isOffline && anyReadUncached(classesQuery)) {
    body = (
      <OfflineState
        title="This list is unavailable offline"
        description="Reconnect to load it and make changes."
        onRetry={() => void classesQuery.refetch()}
      />
    );
  } else if (classesQuery.isLoading || paused) {
    body = <SettingsListCardSkeleton label={`Loading ${classTerm}`} />;
  } else if (classesQuery.isError && classesQuery.data === undefined) {
    body = (
      <ErrorState
        title="Couldn't load the list"
        description="Retry to fetch it again."
        onRetry={() => void classesQuery.refetch()}
      />
    );
  } else {
    body = (
      <>
        <ProfileSection
          id="settings-classes"
          title={classTerm}
          hint={
            <>
              The chapter&apos;s list, oldest first.
              {canManage && classes.length > 1 ? " Drag to reorder." : ""}
            </>
          }
        >
          <div>
            {classes.length === 0 ? (
              <InlineNote>Nothing here yet. Add the oldest one first.</InlineNote>
            ) : (
              <ReorderList
                aria-label={classTerm}
                items={classes}
                getId={(entry) => entry.id}
                getLabel={(entry) => entry.name}
                onReorder={(next) => void handleReorder(next)}
                disabled={!canManage}
                renderItem={(entry) => (
                  <ClassRow
                    pledgeClass={entry}
                    memberCount={
                      members ? (countByClass.get(entry.id) ?? 0) : null
                    }
                    canManage={canManage}
                    confirm={confirm}
                    onEditMembers={() => setEditingClassId(entry.id)}
                  />
                )}
              />
            )}
            {membersQuery.isError && !members ? (
              // Without the roster there are no counts and no class editor,
              // so say why and offer the read again.
              <InlineNote className="mt-3">
                Couldn&apos;t load the chapter&apos;s members, so counts and
                the member editor are unavailable.{" "}
                <InlineNoteAction onClick={() => void membersQuery.refetch()}>
                  Retry
                </InlineNoteAction>
              </InlineNote>
            ) : null}
          </div>
        </ProfileSection>

        {canManage ? (
          <AddClassForm full={classes.length >= PLEDGE_CLASSES_MAX} />
        ) : (
          <InlineNote>
            Only officers who manage roles can change this list.
          </InlineNote>
        )}
      </>
    );
  }

  return (
    <div className="space-y-10">
      {confirmDialog}
      {body}
      <Sheet
        open={editingClass !== null && members !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditingClassId(null);
        }}
      >
        {editingClass && members ? (
          <ClassMembersEditor
            // Keyed by class, so a draft never carries over to the next class.
            key={editingClass.id}
            pledgeClass={editingClass}
            classes={saved}
            members={members}
            orderTerm={orderTerm}
            onDone={() => setEditingClassId(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function ClassRow({
  pledgeClass,
  memberCount,
  canManage,
  confirm,
  onEditMembers,
}: {
  pledgeClass: PledgeClass;
  /** `null` until the member read answers. */
  memberCount: number | null;
  canManage: boolean;
  confirm: ReturnType<typeof useConfirmDialog>["confirm"];
  onEditMembers: () => void;
}) {
  const { toast } = useToast();
  const rename = useRenamePledgeClass();
  const remove = useDeletePledgeClass();
  const [draft, setDraft] = useState<string | null>(null);
  const busy = rename.isPending || remove.isPending;

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = (draft ?? "").trim();
    if (!name) return;
    if (name === pledgeClass.name) {
      setDraft(null);
      return;
    }
    try {
      await rename.mutateAsync({ id: pledgeClass.id, name });
      setDraft(null);
    } catch (error) {
      toast({
        title: `Couldn't rename ${pledgeClass.name}`,
        description: getErrorMessage(
          error,
          "Check that no other one has this name, then try again.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete ${pledgeClass.name}?`,
      // `null` is "not known", never "none": the roster read may be pending
      // or failed, and the class may be full.
      description:
        memberCount === null
          ? "Any members in it are left without one. They keep their number."
          : memberCount > 0
            ? `Its ${memberCountLabel(memberCount)} ${memberCount === 1 ? "is" : "are"} left without one. They keep their number.`
            : "No members are in it.",
      confirmLabel: `Delete ${pledgeClass.name}`,
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(pledgeClass.id);
      toast({ title: `${pledgeClass.name} deleted` });
    } catch (error) {
      toast({
        title: `Couldn't delete ${pledgeClass.name}`,
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  if (draft !== null) {
    return (
      <form onSubmit={saveName} className="flex items-center gap-2">
        <Input
          autoFocus
          value={draft}
          maxLength={PLEDGE_CLASS_NAME_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Only the rename closes, not a surface around it.
              event.stopPropagation();
              setDraft(null);
            }
          }}
          aria-label={`Name of ${pledgeClass.name}`}
          disabled={rename.isPending}
        />
        <IconButton
          type="submit"
          label="Save name"
          disabled={rename.isPending || !draft.trim()}
        >
          {rename.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </IconButton>
        <IconButton
          type="button"
          label="Cancel rename"
          disabled={rename.isPending}
          onClick={() => setDraft(null)}
        >
          <X className="h-4 w-4" />
        </IconButton>
      </form>
    );
  }

  return (
    // Wraps: with chat docked beside Settings the card can be under 300px
    // wide, and three icon buttons on the name's line left it one letter.
    <div className="flex flex-wrap items-center gap-x-2">
      <div className="min-w-[8rem] flex-1">
        <p className="break-words text-sm font-semibold">{pledgeClass.name}</p>
        {memberCount !== null ? (
          <p className="text-caption text-muted-foreground">
            {memberCountLabel(memberCount)}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Edit members of ${pledgeClass.name}`}
            // The editor is built from the roster, so it waits for it.
            disabled={busy || memberCount === null}
            onClick={onEditMembers}
          >
            <Users className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={`Rename ${pledgeClass.name}`}
            disabled={busy}
            onClick={() => setDraft(pledgeClass.name)}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={`Delete ${pledgeClass.name}`}
            disabled={busy}
            onClick={() => void handleDelete()}
          >
            {remove.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

function AddClassForm({
  full,
}: {
  /** The chapter holds as many classes as it may. */
  full: boolean;
}) {
  const { toast } = useToast();
  const create = useCreatePledgeClass();
  const [name, setName] = useState("");

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    try {
      await create.mutateAsync(trimmed);
      setName("");
    } catch (error) {
      toast({
        title: `Couldn't add ${trimmed}`,
        description: getErrorMessage(
          error,
          "Check that no other one has this name, then try again.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <ProfileSection
      id="settings-add-to-the-list"
      title="Add to the list"
      hint={
        <>
          {full
            ? `This chapter has ${PLEDGE_CLASSES_MAX}, the most it can hold.`
            : "It goes at the end, as the newest."}
        </>
      }
    >
      <div>
        <form
          onSubmit={handleCreate}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="grid min-w-[10rem] flex-1 gap-1">
            <Label htmlFor="pledge-class-name">Name</Label>
            <Input
              id="pledge-class-name"
              value={name}
              maxLength={PLEDGE_CLASS_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alpha, or Fall 2026"
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
            Add
          </Button>
        </form>
      </div>
    </ProfileSection>
  );
}

function rowName(member: MemberProfile): string {
  return memberLabel(member.display_name, member.user_id);
}

/**
 * One class's members, in the order the Directory will list them. Dragging a
 * row renumbers the class (`renumberRows` says how), and each number can be
 * typed instead. Nothing is written until Save, which sends every change in
 * one request the API applies whole or not at all.
 */
function ClassMembersEditor({
  pledgeClass,
  classes,
  members: liveMembers,
  orderTerm,
  onDone,
}: {
  pledgeClass: PledgeClass;
  classes: readonly PledgeClass[];
  /** The loaded roster; the editor never mounts without it. */
  members: readonly MemberProfile[];
  orderTerm: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const assign = useAssignPledgeClasses();
  // The roster as it stood when the editor opened. The rows are built from it
  // once, so the save is worked out against the same snapshot: a background
  // re-read that brings in a member another officer just added to this class
  // must not read as "the officer took them out".
  const [members] = useState(liveMembers);
  const [rows, setRows] = useState<ClassEditorRow[]>(() =>
    members
      .filter((member) => member.pledge_class_id === pledgeClass.id)
      .sort(fraternalOrderComparator(classes))
      .map((member) => ({
        memberId: member.id,
        name: rowName(member),
        number:
          member.order_number === null ? "" : String(member.order_number),
      })),
  );
  const [search, setSearch] = useState("");

  const classNameById = useMemo(
    () => new Map(classes.map((entry) => [entry.id, entry.name])),
    [classes],
  );
  const inDraft = useMemo(
    () => new Set(rows.map((row) => row.memberId)),
    [rows],
  );
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return members
      .filter(
        (member) =>
          !inDraft.has(member.id) &&
          rowName(member).toLowerCase().includes(query),
      )
      .slice(0, ADD_MATCH_LIMIT);
  }, [members, inDraft, search]);

  const assignments = classAssignments(pledgeClass.id, rows, members);
  const invalid = assignments === null;
  const tooMany =
    assignments !== null && assignments.length > PLEDGE_CLASS_ASSIGNMENTS_MAX;
  const dirty = assignments === null || assignments.length > 0;

  function addMember(member: MemberProfile) {
    setRows((previous) => [
      ...previous,
      {
        memberId: member.id,
        name: rowName(member),
        number: nextOrderNumber(previous),
      },
    ]);
    setSearch("");
  }

  async function handleSave() {
    if (!assignments || assignments.length === 0 || tooMany) return;
    try {
      await assign.mutateAsync(assignments);
      toast({ title: `${pledgeClass.name} saved` });
      onDone();
    } catch (error) {
      toast({
        title: `Couldn't save ${pledgeClass.name}`,
        description: getErrorMessage(
          error,
          "Nothing was changed. Reload the page and try again.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <PanelContent aria-describedby={undefined}>
      <PanelHeader>{pledgeClass.name}</PanelHeader>
      <PanelBody>
        <div className="grid gap-1">
          <Label htmlFor="class-add-member">Add a member</Label>
          <Input
            id="class-add-member"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name"
            autoComplete="off"
          />
          {search.trim() ? (
            matches.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border border-border">
                {matches.map((member) => {
                  const from = member.pledge_class_id
                    ? classNameById.get(member.pledge_class_id)
                    : undefined;
                  return (
                    <li
                      key={member.id}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{rowName(member)}</p>
                        {from ? (
                          <p className="text-caption text-muted-foreground">
                            Moves from {from}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => addMember(member)}
                        aria-label={`Add ${rowName(member)}`}
                      >
                        Add
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <InlineNote>No other member matches.</InlineNote>
            )
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-label font-semibold text-muted-foreground">
            {memberCountLabel(rows.length)} · {orderTerm}
          </p>
          {rows.length === 0 ? (
            <InlineNote>Nobody is in it yet.</InlineNote>
          ) : (
            <ReorderList
              aria-label={`Members of ${pledgeClass.name}`}
              items={rows}
              getId={(row) => row.memberId}
              getLabel={(row) => row.name}
              onReorder={(next) => setRows(renumberRows(next))}
              disabled={assign.isPending}
              renderItem={(row) => {
                const bad = parseOrderNumber(row.number) === undefined;
                return (
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 break-words text-sm">
                      {row.name}
                    </p>
                    <Input
                      inputMode="numeric"
                      value={row.number}
                      onChange={(event) =>
                        setRows((previous) =>
                          previous.map((entry) =>
                            entry.memberId === row.memberId
                              ? { ...entry, number: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      aria-label={`${orderTerm} for ${row.name}`}
                      aria-invalid={bad || undefined}
                      disabled={assign.isPending}
                      className="h-9 w-24 shrink-0 text-right"
                    />
                    <IconButton
                      label={`Remove ${row.name} from ${pledgeClass.name}`}
                      disabled={assign.isPending}
                      onClick={() =>
                        setRows((previous) =>
                          previous.filter(
                            (entry) => entry.memberId !== row.memberId,
                          ),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </IconButton>
                  </div>
                );
              }}
            />
          )}
          {invalid ? (
            <p role="alert" className="text-caption text-destructive-text">
              A number is a whole number from 1 up, or blank for none.
            </p>
          ) : null}
          {tooMany ? (
            <p role="alert" className="text-caption text-destructive-text">
              That is more than {PLEDGE_CLASS_ASSIGNMENTS_MAX} changes at once.
              Save a smaller set first.
            </p>
          ) : null}
        </div>
      </PanelBody>
      <PanelFooter>
        <Button
          variant="secondary"
          onClick={onDone}
          disabled={assign.isPending}
        >
          Cancel
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={!dirty || invalid || tooMany || assign.isPending}
        >
          {assign.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Save
        </Button>
      </PanelFooter>
    </PanelContent>
  );
}
