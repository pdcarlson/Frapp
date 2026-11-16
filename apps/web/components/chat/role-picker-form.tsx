"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  buildRolePickerMessage,
  ROLE_PICKER_DEFAULT_TITLE,
  ROLE_PICKER_ROLES_MAX,
  ROLE_PICKER_TITLE_MAX_LENGTH,
  type RolePickerPayload,
} from "@repo/chat-core/role-pickers";
import { useRoles } from "@repo/hooks";
import { parseChapterRoles } from "@repo/hooks/chapter-roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FormFooter,
  fieldClass,
  primarySize,
  useReportDraft,
} from "@/components/shared/short-form";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import type { RolePickerDraft } from "./role-picker-draft";


export interface RolePickerFormProps {
  initialDraft: RolePickerDraft;
  onDraftChange?: (draft: RolePickerDraft) => void;
  /** Queues the card in the channel the form was opened in. Never rejects. */
  onPost: (picker: {
    content: string;
    payload: RolePickerPayload;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => void;
  onDiscard: () => void;
}

/**
 * The composer's New role picker form (#4958), inside the + card: an optional
 * title and the chapter's Non-chapter business roles to list, one checkbox
 * each, at least one and at most {@link ROLE_PICKER_ROLES_MAX}. The card it
 * posts gives each member a Join or Leave button per role, as Carl-bot's
 * button roles do on Discord. Posting goes through the outbox like a sign-up
 * sheet (`SignupForm`), so it works offline and a server refusal lands on the
 * card's own failed row; this form reports only an outbox that refused it.
 */
export function RolePickerForm({
  initialDraft,
  onDraftChange,
  onPost,
  onDone,
  onDiscard,
}: RolePickerFormProps) {
  const layout = "card";
  const [draft, setDraft] = useState<RolePickerDraft>(initialDraft);
  useReportDraft(draft, onDraftChange);
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const sending = useRef(false);

  const rolesQuery = useRoles();
  const marked = useMemo(
    () =>
      parseChapterRoles(rolesQuery.data)
        .filter((role) => role.selfAssignable && !role.everyone)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rolesQuery.data],
  );
  // Only roles still marked count: one unmarked since the draft was kept
  // would earn the send route's 400.
  const picked = useMemo(() => {
    const ids = new Set(marked.map((role) => role.id));
    return draft.roleIds.filter((id) => ids.has(id));
  }, [draft.roleIds, marked]);
  const pickedSet = new Set(picked);
  const full = picked.length >= ROLE_PICKER_ROLES_MAX;
  const canPost = picked.length > 0 && !posting;

  const toggle = (id: string, on: boolean) => {
    setFailure(null);
    setDraft((current) => ({
      ...current,
      roleIds: on
        ? [...current.roleIds.filter((other) => other !== id), id]
        : current.roleIds.filter((other) => other !== id),
    }));
  };

  const post = useCallback(() => {
    if (picked.length === 0 || sending.current) return;
    sending.current = true;
    setPosting(true);
    setFailure(null);
    void onPost(buildRolePickerMessage({ title: draft.title, roleIds: picked }))
      .catch((): { ok: false; error: string } => ({
        ok: false,
        error: "Couldn't post that role picker. Try again.",
      }))
      .then((result) => {
        sending.current = false;
        setPosting(false);
        if (result.ok) {
          onDone();
          return;
        }
        setFailure(result.error);
      });
  }, [draft.title, picked, onPost, onDone]);

  let roleList;
  if (rolesQuery.isPending && !rolesQuery.isError) {
    roleList = <p className="text-sm text-muted-foreground">Loading roles…</p>;
  } else if (rolesQuery.isError && marked.length === 0) {
    roleList = (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load your chapter&apos;s roles.{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={() => void rolesQuery.refetch()}
        >
          Try again
        </Button>
      </p>
    );
  } else if (marked.length === 0) {
    roleList = (
      <p className="text-sm text-muted-foreground">
        No roles are open for members to pick yet. Turn on Non-chapter business
        on a role&apos;s page under{" "}
        <Link href="/roles" className="text-foreground underline">
          Roles
        </Link>
        .
      </p>
    );
  } else {
    roleList = (
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm text-muted-foreground">
          Roles to list · {picked.length} of {ROLE_PICKER_ROLES_MAX} at most
        </legend>
        <div className="max-h-56 overflow-y-auto">
          {marked.map((role) => {
            const checked = pickedSet.has(role.id);
            return (
              <label
                key={role.id}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <span className={dashboardCheckboxHitAreaClassName}>
                  <input
                    type="checkbox"
                    className={dashboardTableCheckboxClassName}
                    checked={checked}
                    disabled={posting || (!checked && full)}
                    onChange={(event) => toggle(role.id, event.target.checked)}
                  />
                </span>
                <span className="min-w-0 truncate">{role.name}</span>
              </label>
            );
          })}
        </div>
        {full ? (
          <p className="text-sm text-muted-foreground">
            A role picker can list up to {ROLE_PICKER_ROLES_MAX} roles.
          </p>
        ) : null}
      </fieldset>
    );
  }

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
    >
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground">Title (optional)</span>
        <Input
          value={draft.title}
          onChange={(event) => {
            const title = event.target.value;
            setFailure(null);
            setDraft((current) => ({ ...current, title }));
          }}
          placeholder={ROLE_PICKER_DEFAULT_TITLE}
          maxLength={ROLE_PICKER_TITLE_MAX_LENGTH}
          className={fieldClass(layout)}
          disabled={posting}
          data-plus-autofocus
        />
      </label>

      {roleList}

      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <FormFooter layout={layout} onCancel={onDiscard} cancelDisabled={posting}>
        <Button type="submit" size={primarySize(layout)} disabled={!canPost}>
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {posting ? "Posting…" : "Post role picker"}
        </Button>
      </FormFooter>
    </form>
  );
}
