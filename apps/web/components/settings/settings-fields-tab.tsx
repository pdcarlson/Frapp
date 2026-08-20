"use client";

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
  LoadingState,
} from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
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

  if (fieldsQuery.isPending) {
    return <LoadingState message="Loading custom fields..." />;
  }
  if (fieldsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load custom fields"
        description="Retry to fetch this chapter's custom member fields."
        onRetry={() => void fieldsQuery.refetch()}
      />
    );
  }

  const fields = fieldsQuery.data ?? [];

  return (
    <div className="space-y-6">
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
                <FieldRow key={field.id} field={field} canManage={canManage} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddFieldForm canManage={canManage} />
    </div>
  );
}

function FieldRow({
  field,
  canManage,
}: {
  field: ChapterCustomField;
  canManage: boolean;
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
    const confirmed = window.confirm(`Delete the field "${field.label}"?`);
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
            <SelectTrigger
              className="h-8 w-40"
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
    // Guard-parse: only commit a positive integer (matches Workflows/Dues).
    const trimmed = raw.trim();
    if (trimmed === "") {
      setDraft((prev) => ({ ...prev, maxLength: "" }));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1) return;
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
                      className="rounded-sm hover:bg-muted"
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
                  variant="outline"
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
                <SelectTrigger className="h-9 w-40" aria-label="Visibility">
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
