"use client";

import React, { useState } from "react";
import {
  useCreateDocumentType,
  useDeleteDocumentType,
  useUpdateDocumentType,
  type DocumentTypeRow,
} from "@repo/hooks";
import {
  DOCUMENT_TYPE_NAME_MAX_LENGTH,
  DOCUMENT_TYPES_MAX,
} from "@repo/validation";
import {
  TypeListEditor,
  TypeListForm,
  TypeNameField,
} from "@/components/shared/type-list-editor";
import { cn } from "@/lib/utils";

/**
 * "Edit types" at the end of the upload panel's Type row, for officers with
 * `chapter_docs:manage` (#3642, `spec/behavior/chapter-docs.md` § Document
 * types): the chapter's document types with inline rename, add and delete, so
 * an officer who finds the list wrong fixes it where they noticed. It renders
 * the shared `TypeListEditor` (#4723).
 */
export function DocumentTypesEditor({
  types,
  disabled,
  chipClassName,
}: {
  types: readonly DocumentTypeRow[];
  disabled: boolean;
  /** The row's chip classes, so the trigger sits in the row as a chip. */
  chipClassName: string;
}) {
  return (
    <TypeListEditor
      types={types}
      disabled={disabled}
      triggerClassName={cn(
        chipClassName,
        "gap-1 border-dashed bg-transparent text-muted-foreground hover:text-foreground",
      )}
      widthClassName="w-[20rem]"
      title="Document types"
      blurb="Renaming a type renames it on its documents. Deleting one leaves its documents with no type."
      max={DOCUMENT_TYPES_MAX}
      deleteConsequence="Its documents keep everything but the type."
      editLabel={(name) => `Rename ${name}`}
      useDeleteType={useDeleteDocumentType}
      renderForm={(type, onDone) => (
        <DocumentTypeForm type={type} onDone={onDone} />
      )}
    />
  );
}

/** The inline form for one type: rename when `type` is set, add when `null`. */
function DocumentTypeForm({
  type,
  onDone,
}: {
  type: DocumentTypeRow | null;
  onDone: () => void;
}) {
  const createType = useCreateDocumentType();
  const updateType = useUpdateDocumentType();
  const [name, setName] = useState(type?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = type ? `document-type-${type.id}` : "document-type-new";

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the type a name.");
      return false;
    }
    if (type) await updateType.mutateAsync({ id: type.id, name: trimmed });
    else await createType.mutateAsync({ name: trimmed });
    return true;
  }

  return (
    <TypeListForm
      isNew={!type}
      pending={createType.isPending || updateType.isPending}
      error={error}
      saveFailedTitle="Couldn't rename the type"
      onSave={save}
      onDone={onDone}
    >
      <TypeNameField
        id={`${id}-name`}
        value={name}
        maxLength={DOCUMENT_TYPE_NAME_MAX_LENGTH}
        placeholder="Contract"
        onChange={(next) => {
          setError(null);
          setName(next);
        }}
      />
    </TypeListForm>
  );
}
