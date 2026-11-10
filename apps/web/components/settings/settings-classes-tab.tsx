"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { InlineNote } from "@/components/shared/inline-note";
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
  lowerTerm,
  nextOrderNumber,
  parseOrderNumber,
  pluralTerm,
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

  const saved = classesQuery.data ?? [];
  const classes = pendingOrder ?? saved;
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const countByClass = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of members) {
      if (member.pledge_class_id) {
        counts.set(
          member.pledge_class_id,
          (counts.get(member.pledge_class_id) ?? 0) + 1,
        );
      }
    }
    return counts;
  }, [members]);

  const plural = pluralTerm(classTerm);
  const lowerPlural = lowerTerm(plural);
  const lowerClass = lowerTerm(classTerm);
  const editingClass =
    saved.find((entry) => entry.id === editingClassId) ?? null;

  async function handleReorder(next: PledgeClass[]) {
    setPendingOrder(next);
    try {
      await reorder.mutateAsync(next.map((entry) => entry.id));
    } catch (error) {
      toast({
        title: "Couldn't save the order",
        description: getErrorMessage(
          error,
          "The list changed while you were editing. It has been reloaded.",
        ),
        variant: "destructive",
      });
    } finally {
      // The hook re-reads the list either way; wait for it so the saved order
      // replaces the pending one in the same paint.
      await classesQuery.refetch();
      setPendingOrder(null);
    }
  }

  const paused =
    classesQuery.isPending && classesQuery.fetchStatus === "paused";

  let body: ReactNode;
  if (isOffline && anyReadUncached(classesQuery)) {
    body = (
      <OfflineState
        title={`${plural} unavailable offline`}
        description={`Reconnect to load this chapter's ${lowerPlural} and edit them.`}
        onRetry={() => void classesQuery.refetch()}
      />
    );
  } else if (classesQuery.isLoading || paused) {
    body = <SettingsListCardSkeleton label={`Loading ${lowerPlural}`} />;
  } else if (classesQuery.isError && classesQuery.data === undefined) {
    body = (
      <ErrorState
        title={`Couldn't load ${lowerPlural}`}
        description={`Retry to fetch this chapter's ${lowerPlural}.`}
        onRetry={() => void classesQuery.refetch()}
      />
    );
  } else {
    body = (
      <>
        <Card>
          <CardHeader>
            <CardTitle>{plural}</CardTitle>
            <CardDescription>
              Oldest first. The Directory sorts by this order, then by each
              member&apos;s {lowerTerm(orderTerm)}.
              {canManage && classes.length > 1 ? " Drag to reorder." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <InlineNote>
                No {lowerPlural} yet. Add the oldest one first.
              </InlineNote>
            ) : (
              <ReorderList
                aria-label={plural}
                items={classes}
                getId={(entry) => entry.id}
                getLabel={(entry) => entry.name}
                onReorder={(next) => void handleReorder(next)}
                disabled={!canManage || reorder.isPending}
                renderItem={(entry) => (
                  <ClassRow
                    pledgeClass={entry}
                    memberCount={
                      membersQuery.data
                        ? (countByClass.get(entry.id) ?? 0)
                        : null
                    }
                    canManage={canManage}
                    classTerm={lowerClass}
                    confirm={confirm}
                    onEditMembers={() => setEditingClassId(entry.id)}
                  />
                )}
              />
            )}
          </CardContent>
        </Card>

        {canManage ? (
          <AddClassForm
            classTerm={classTerm}
            full={classes.length >= PLEDGE_CLASSES_MAX}
          />
        ) : (
          <InlineNote>
            Only officers who manage roles can change {lowerPlural}.
          </InlineNote>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      {body}
      <Sheet
        open={editingClass !== null}
        onOpenChange={(open) => {
          if (!open) setEditingClassId(null);
        }}
      >
        {editingClass ? (
          <ClassMembersEditor
            // Keyed by class, so a draft never carries over to the next class.
            key={editingClass.id}
            pledgeClass={editingClass}
            classes={saved}
            members={members}
            membersFailed={membersQuery.isError && !membersQuery.data}
            onRetryMembers={() => void membersQuery.refetch()}
            orderTerm={orderTerm}
            classTerm={lowerClass}
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
  classTerm,
  confirm,
  onEditMembers,
}: {
  pledgeClass: PledgeClass;
  /** `null` until the member read answers. */
  memberCount: number | null;
  canManage: boolean;
  classTerm: string;
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
        title: `Couldn't rename the ${classTerm}`,
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
      description:
        memberCount && memberCount > 0
          ? `Its ${memberCountLabel(memberCount)} will have no ${classTerm}. They keep their number.`
          : "No members are in it.",
      confirmLabel: `Delete ${classTerm}`,
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync(pledgeClass.id);
      toast({ title: `${pledgeClass.name} deleted` });
    } catch (error) {
      toast({
        title: `Couldn't delete the ${classTerm}`,
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
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{pledgeClass.name}</p>
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
            disabled={busy}
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
  classTerm,
  full,
}: {
  classTerm: string;
  /** The chapter holds as many classes as it may. */
  full: boolean;
}) {
  const { toast } = useToast();
  const create = useCreatePledgeClass();
  const [name, setName] = useState("");
  const lower = lowerTerm(classTerm);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    try {
      await create.mutateAsync(trimmed);
      setName("");
    } catch (error) {
      toast({
        title: `Couldn't add the ${lower}`,
        description: getErrorMessage(
          error,
          "Check that no other one has this name, then try again.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a {lower}</CardTitle>
        <CardDescription>
          {full
            ? `This chapter has ${PLEDGE_CLASSES_MAX}, the most it can hold.`
            : "It goes at the end of the list, as the newest."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCreate} className="flex items-end gap-3">
          <div className="grid min-w-0 flex-1 gap-1">
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
      </CardContent>
    </Card>
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
  members,
  membersFailed,
  onRetryMembers,
  orderTerm,
  classTerm,
  onDone,
}: {
  pledgeClass: PledgeClass;
  classes: readonly PledgeClass[];
  members: readonly MemberProfile[];
  membersFailed: boolean;
  onRetryMembers: () => void;
  orderTerm: string;
  classTerm: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const assign = useAssignPledgeClasses();
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
        {membersFailed ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/[.28] bg-destructive-tint p-3 text-sm text-destructive-text"
          >
            <span>Couldn&apos;t load the chapter&apos;s members.</span>
            <Button variant="secondary" size="sm" onClick={onRetryMembers}>
              Retry
            </Button>
          </div>
        ) : null}

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
            {memberCountLabel(rows.length)}, by {lowerTerm(orderTerm)}
          </p>
          {rows.length === 0 ? (
            <InlineNote>Nobody is in this {classTerm} yet.</InlineNote>
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
                    <p className="min-w-0 flex-1 truncate text-sm">
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
