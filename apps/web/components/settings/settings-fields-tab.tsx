"use client";

import type { ReactNode } from "react";

import { useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import type {
  ChapterCustomField,
  CustomFieldType,
  CustomFieldVisibility,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  hasNoCachedData,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, parseGuardedInt } from "@/lib/utils";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { useNetwork } from "@/lib/providers/network-provider";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  useCustomFields,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
} from "@repo/hooks";

type Props = {
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
};

const FIELD_TYPES: ReadonlyArray<{ value: CustomFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "decimal", label: "Decimal" },
  { value: "phone", label: "Phone" },
  { value: "select", label: "Select (dropdown)" },
  { value: "boolean", label: "Yes / No" },
];

const VISIBILITIES: ReadonlyArray<{
  value: CustomFieldVisibility;
  label: string;
}> = [
  { value: "self", label: "Self only" },
  { value: "chapter", label: "Whole chapter" },
  { value: "exec", label: "Exec" },
  { value: "president", label: "President" },
];

const TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  decimal: "Decimal",
  phone: "Phone",
  select: "Select (dropdown)",
  boolean: "Yes / No",
};

/**
 * Settings → Fields. An editable table over `chapter_custom_fields` (custom
 * member fields). Each field has a label, type, `required`/`sensitive` flags,
 * and a visibility tier; `select` fields carry an options list. Writes go
 * through the dedicated `/custom-fields` CRUD endpoints (audit-logged
 * server-side). Visibility is *configured* here; it's enforced when the member
 * directory renders the values (a later chunk).
 */
export function SettingsFieldsTab({ canManage }: Props) {
  const fieldsQuery = useCustomFields();
  const { isOffline } = useNetwork();
  /*
    One confirmation for the list, not one per row.

    It started per-row, which reads fine — until the review pointed out that
    `SettingsFieldsTab` early-returns its loading and error states *above* the
    `<ul>`, so a background refetch failure with a delete confirmation open
    unmounts every row and every dialog with them. `ConfirmDialogHost` settles
    the pending promise `null` on the way out, so the member's click simply
    stops existing: no toast, no error, the page just changes under them.
    `window.confirm` could not fail this way — it blocks the thread, so no
    re-render could land while it was open. `await confirm(...)` blocks
    nothing, which is the cost of the conversion and has to be paid here.

    So the hook lives above the branch and `confirm` is passed down. Same shape
    `tasks-board.tsx` uses for its per-row deletes.
  */
  const { confirm, confirmDialog } = useConfirmDialog();

  const fields = fieldsQuery.data ?? [];
  const paused = fieldsQuery.isPending && fieldsQuery.fetchStatus === "paused";

  let body: ReactNode;
  if (isOffline && hasNoCachedData(fieldsQuery)) {
    body = (
      <OfflineState
        title="Custom fields unavailable offline"
        description="Reconnect to load this chapter's member fields and edit them."
        onRetry={() => void fieldsQuery.refetch()}
      />
    );
  } else if (fieldsQuery.isLoading || paused) {
    body = <LoadingState message="Loading custom fields..." />;
  } else if (fieldsQuery.isError) {
    body = (
      <ErrorState
        title="Couldn't load custom fields"
        description="Retry to fetch this chapter's custom member fields."
        onRetry={() => void fieldsQuery.refetch()}
      />
    );
  } else {
    body = (
      <>
      <Card>
        <CardHeader>
          <CardTitle>Custom member fields</CardTitle>
          <CardDescription>
            Extra fields collected per member, each with a visibility tier.
            Sensitive fields are only returned to authorized viewers. Saving
            writes an entry to the chapter audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <EmptyState
              title="No custom fields yet"
              description="Add one below to start collecting it from members."
            />
          ) : (
            <ul className="space-y-3">
              {fields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  canManage={canManage}
                  confirm={confirm}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddFieldForm canManage={canManage} />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Above the branch: a refetch failure must not cancel an open delete. */}
      {confirmDialog}
      {body}
    </div>
  );
}

function FieldRow({
  field,
  canManage,
  confirm,
}: {
  field: ChapterCustomField;
  canManage: boolean;
  /** The list's confirmation, not the row's — see `SettingsFieldsTab`. */
  confirm: ReturnType<typeof useConfirmDialog>["confirm"];
}) {
  const { toast } = useToast();
  const updateField = useUpdateCustomField();
  const deleteField = useDeleteCustomField();

  async function patch(
    body: Parameters<typeof updateField.mutateAsync>[0]["body"],
  ) {
    try {
      await updateField.mutateAsync({ id: field.id, body });
    } catch (error) {
      toast({
        title: "Couldn't update field",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete the field "${field.label}"?`,
      description:
        "Members lose the values they have entered for it, and the column disappears from the directory. This cannot be undone.",
      confirmLabel: "Delete field",
    });
    if (!confirmed) return;
    try {
      await deleteField.mutateAsync(field.id);
      toast({ title: "Field deleted" });
    } catch (error) {
      toast({
        title: "Couldn't delete field",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  const busy = updateField.isPending || deleteField.isPending;

  return (
    <li className="rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">{field.label}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            {field.key} · {TYPE_LABEL[field.type]}
          </span>
          {field.type === "select" && field.options?.choices?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {field.options.choices.map((choice) => (
                <Badge key={choice} variant="secondary">
                  {choice}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canManage || busy}
          onClick={() => void handleDelete()}
          aria-label={`Delete ${field.label}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={field.required}
            disabled={!canManage || busy}
            onCheckedChange={(required) => void patch({ required })}
            aria-label={`${field.label} required`}
          />
          Required
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={field.sensitive}
            disabled={!canManage || busy}
            onCheckedChange={(sensitive) => void patch({ sensitive })}
            aria-label={`${field.label} sensitive`}
          />
          Sensitive
        </label>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Visible to</span>
          <Select
            value={field.visibility}
            disabled={!canManage || busy}
            onValueChange={(visibility) =>
              void patch({ visibility: visibility as CustomFieldVisibility })
            }
          >
            {/*
              No height override. §4's 44 is a carve-out for *filter chrome* —
              "secondary chrome sitting above the thing it filters" — and
              neither visibility select filters anything: both write. Reading
              that carve-out as "the height for a select" is the defect §4 was
              written about, and here it ran backwards, shrinking below
              `SelectTrigger`'s own 48 rather than up from 44. The primitive's
              default is the field height, and it is what the two unoverridden
              triggers in this same file already render at.
            */}
            <SelectTrigger
              className="w-40"
              aria-label={`${field.label} visibility`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITIES.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </li>
  );
}

const EMPTY_DRAFT = {
  key: "",
  label: "",
  type: "text" as CustomFieldType,
  required: false,
  sensitive: false,
  visibility: "chapter" as CustomFieldVisibility,
  maxLength: "",
  choices: [] as string[],
};

function AddFieldForm({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const createField = useCreateCustomField();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [choiceDraft, setChoiceDraft] = useState("");

  const isSelect = draft.type === "select";
  const isText = draft.type === "text";

  function addChoice() {
    const value = choiceDraft.trim();
    if (!value || draft.choices.includes(value)) {
      setChoiceDraft("");
      return;
    }
    setDraft((prev) => ({ ...prev, choices: [...prev.choices, value] }));
    setChoiceDraft("");
  }

  function removeChoice(choice: string) {
    setDraft((prev) => ({
      ...prev,
      choices: prev.choices.filter((c) => c !== choice),
    }));
  }

  function setMaxLength(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setDraft((prev) => ({ ...prev, maxLength: "" }));
      return;
    }
    // Guard-parse: only commit a positive integer (matches Workflows/Dues).
    // maxLength is stored as the trimmed string (bound directly to the
    // input), not the parsed number, so parseGuardedInt is used only for
    // its validation here.
    if (parseGuardedInt(raw, 1) === undefined) return;
    setDraft((prev) => ({ ...prev, maxLength: trimmed }));
  }

  const selectMissingChoices = isSelect && draft.choices.length === 0;
  const canSubmit =
    canManage &&
    !createField.isPending &&
    !!draft.key.trim() &&
    !!draft.label.trim() &&
    !selectMissingChoices;

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const options: { choices?: string[]; max_length?: number } = {};
    if (isSelect) options.choices = draft.choices;
    if (isText && draft.maxLength) options.max_length = Number(draft.maxLength);

    try {
      await createField.mutateAsync({
        key: draft.key.trim(),
        label: draft.label.trim(),
        type: draft.type,
        required: draft.required,
        sensitive: draft.sensitive,
        visibility: draft.visibility,
        ...(Object.keys(options).length > 0 ? { options } : {}),
      });
      toast({
        title: "Custom field created",
        description: "An entry was written to the chapter audit log.",
      });
      setDraft(EMPTY_DRAFT);
      setChoiceDraft("");
    } catch (error) {
      toast({
        title: "Couldn't create custom field",
        description: getErrorMessage(
          error,
          "The key may already be in use. Retry with a different key.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a field</CardTitle>
        <CardDescription>
          The key is a lowercase slug (letters, numbers, underscores), unique
          per chapter. A select field needs at least one option.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleCreate}>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="custom-field-key">Key</Label>
              <Input
                id="custom-field-key"
                value={draft.key}
                disabled={!canManage}
                placeholder="graduation_year"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, key: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="custom-field-label">Label</Label>
              <Input
                id="custom-field-label"
                value={draft.label}
                disabled={!canManage}
                placeholder="Graduation year"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, label: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="custom-field-type">Type</Label>
              <Select
                value={draft.type}
                disabled={!canManage}
                onValueChange={(type) => {
                  // Drop type-specific config that no longer applies so it
                  // can't linger and reappear if the type is switched back.
                  setDraft((prev) => ({
                    ...prev,
                    type: type as CustomFieldType,
                    choices: [],
                    maxLength: "",
                  }));
                  setChoiceDraft("");
                }}
              >
                <SelectTrigger id="custom-field-type" aria-label="Field type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isSelect ? (
            <div className="grid gap-1.5">
              <Label>Options</Label>
              <div className="flex flex-wrap gap-2">
                {draft.choices.map((choice) => (
                  <Badge
                    key={choice}
                    variant="secondary"
                    className="gap-1 pr-1"
                  >
                    {choice}
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => removeChoice(choice)}
                      aria-label={`Remove option ${choice}`}
                      /*
                        `--accent` aliases `--popover`, so `hover:bg-accent`
                        on a chip inside a card composites to 1.085:1 —
                        `shared/table-contrast.test.ts` pins that exact
                        measurement. The accent tint separates by hue instead
                        of by a ladder step that is not there.
                      */
                      className={`rounded-sm hover:bg-accent-subtle ${FOCUS_RING_OFFSET}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={choiceDraft}
                  disabled={!canManage}
                  placeholder="Add an option"
                  aria-label="New option"
                  className="max-w-xs"
                  onChange={(event) => setChoiceDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addChoice();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!canManage || !choiceDraft.trim()}
                  onClick={addChoice}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          ) : null}

          {isText ? (
            <div className="grid max-w-xs gap-1.5">
              <Label htmlFor="custom-field-maxlength">
                Max length (optional)
              </Label>
              <Input
                id="custom-field-maxlength"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={draft.maxLength}
                disabled={!canManage}
                placeholder="e.g. 120"
                onChange={(event) => setMaxLength(event.target.value)}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.required}
                disabled={!canManage}
                onCheckedChange={(required) =>
                  setDraft((prev) => ({ ...prev, required }))
                }
                aria-label="Required"
              />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.sensitive}
                disabled={!canManage}
                onCheckedChange={(sensitive) =>
                  setDraft((prev) => ({ ...prev, sensitive }))
                }
                aria-label="Sensitive"
              />
              Sensitive
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Visible to</span>
              <Select
                value={draft.visibility}
                disabled={!canManage}
                onValueChange={(visibility) =>
                  setDraft((prev) => ({
                    ...prev,
                    visibility: visibility as CustomFieldVisibility,
                  }))
                }
              >
                <SelectTrigger className="w-40" aria-label="Visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITIES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardContent className="flex justify-end pt-0">
          <Button type="submit" disabled={!canSubmit}>
            {createField.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Add field
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}
