"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  readRolePickerPayload,
  rolePickerRows,
  type RolePickerRow,
} from "@repo/chat-core/role-pickers";
import {
  errorCopy,
  usePickableRoles,
  useRoles,
  useSetPickedRole,
} from "@repo/hooks";
import { parseChapterRoles } from "@repo/hooks/chapter-roles";

interface RolePickerCardProps {
  message: ChatMessage;
  /** Confirmed messages can be tapped; a pending optimistic row cannot. */
  isConfirmed: boolean;
}

/** Under a role the viewer neither holds nor can join now. */
export const ROLE_PICKER_CLOSED_CAPTION = "No longer open to join";

/** When every role the card listed has been deleted since it was posted. */
export const ROLE_PICKER_GONE_COPY = "These roles are gone.";

/**
 * A role picker card (`kind: "role_picker"`, #4958): an officer's list of
 * Non-chapter business roles, each with a Join or Leave button for the
 * viewer, as Discord's button-role bots (Carl-bot) and Slack's interactive
 * messages hand out interest roles. A tap is the same join or leave the
 * Profile's "Your roles" picker makes (`useSetPickedRole`), so the card keeps
 * nothing per member: each viewer's buttons read their own roles. Which rows
 * show, and which button each gets, is `rolePickerRows` in
 * `@repo/chat-core/role-pickers`, shared with the phone's card.
 *
 * One tap at a time per card; a refused tap says why under its row.
 */
export function RolePickerCard({ message, isConfirmed }: RolePickerCardProps) {
  const payload = useMemo(() => readRolePickerPayload(message), [message]);
  const pickable = usePickableRoles();
  const rolesQuery = useRoles();
  const setPicked = useSetPickedRole();
  const chapterRoles = useMemo(
    () => parseChapterRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; text: string } | null>(
    null,
  );

  if (!payload) {
    return (
      <div className="mt-1 rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
        Malformed role picker · {message.content}
      </div>
    );
  }

  const rows = rolePickerRows(payload, pickable.roles, chapterRoles);

  async function tap(row: RolePickerRow) {
    if (pendingId !== null || row.action === "closed") return;
    const join = row.action === "join";
    setPendingId(row.id);
    setFailure(null);
    try {
      await setPicked.mutateAsync({ id: row.id, join });
    } catch (error) {
      setFailure({
        id: row.id,
        text: errorCopy(
          error,
          join
            ? `Couldn't join ${row.name}. Try again.`
            : `Couldn't leave ${row.name}. Try again.`,
        ),
      });
    } finally {
      setPendingId(null);
    }
  }

  let body;
  if (pickable.isLoading) {
    body = (
      <p className="mt-3 text-caption text-muted-foreground">Loading roles…</p>
    );
  } else if (pickable.isError && rows.length === 0) {
    body = (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-caption text-muted-foreground">
          Couldn&apos;t load these roles.
        </p>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={pickable.refetch}
        >
          Try again
        </Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="mt-3 text-caption text-muted-foreground">
        {ROLE_PICKER_GONE_COPY}
      </p>
    );
  } else {
    body = (
      <ul className="mt-3 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="py-2 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block break-words text-sm text-foreground">
                  {row.name}
                </span>
                {row.action === "closed" ? (
                  <span className="block text-caption text-muted-foreground">
                    {ROLE_PICKER_CLOSED_CAPTION}
                  </span>
                ) : null}
              </span>
              {row.action === "closed" ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant={row.action === "join" ? "default" : "secondary"}
                  className="shrink-0"
                  aria-label={`${row.action === "join" ? "Join" : "Leave"} ${row.name}`}
                  disabled={!isConfirmed || pendingId !== null}
                  onClick={() => void tap(row)}
                >
                  {pendingId === row.id ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {row.action === "join" ? "Join" : "Leave"}
                </Button>
              )}
            </div>
            {failure?.id === row.id ? (
              <p role="alert" className="mt-1 text-caption text-destructive">
                {failure.text}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card className={MESSAGE_CARD}>
      <p className={cn(EYEBROW, "text-muted-foreground")}>Roles</p>
      <div className="mt-2 break-words text-base font-bold">
        {payload.title}
      </div>
      <p className="mt-1 text-caption text-muted-foreground">
        Each role adds its channels to Chat, and you can leave any time.
      </p>
      {body}
    </Card>
  );
}
