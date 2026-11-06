"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadField, UPLOAD_FIELD_CLASS } from "@/components/shared/upload-sheet";
import { guardIntDraft } from "@/lib/utils";
import { ASSIGNMENT_TYPES, DOCUMENT_VARIANTS, SEMESTERS } from "@repo/validation";
import type { BulkFields } from "@/lib/backwork-bulk/fields";

type Props = {
  value: BulkFields;
  onChange: (next: BulkFields) => void;
  disabled?: boolean;
};

export function BulkFieldsForm({ value, onChange, disabled }: Props) {
  const set = (key: keyof BulkFields) => (next: string) =>
    onChange({ ...value, [key]: next });
  const text = (key: keyof BulkFields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    set(key)(event.target.value);
  const int = (key: keyof BulkFields) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = guardIntDraft(event.target.value);
    if (next !== undefined) set(key)(next);
  };

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <UploadField id="bulk-title" label="Title">
        <Input
          id="bulk-title"
          className={UPLOAD_FIELD_CLASS}
          value={value.title}
          onChange={text("title")}
        />
      </UploadField>
      <div className="grid gap-3 sm:grid-cols-2">
        <UploadField id="bulk-department" label="Department code">
          <Input
            id="bulk-department"
            className={UPLOAD_FIELD_CLASS}
            value={value.department_code}
            onChange={text("department_code")}
            placeholder="CSCI"
          />
        </UploadField>
        <UploadField id="bulk-course" label="Course number">
          <Input
            id="bulk-course"
            className={UPLOAD_FIELD_CLASS}
            value={value.course_number}
            onChange={text("course_number")}
            placeholder="1200"
          />
        </UploadField>
        <UploadField id="bulk-professor" label="Professor">
          <Input
            id="bulk-professor"
            className={UPLOAD_FIELD_CLASS}
            value={value.professor_name}
            onChange={text("professor_name")}
            placeholder="Dr. Lastname"
          />
        </UploadField>
        <UploadField id="bulk-year" label="Year">
          <Input
            id="bulk-year"
            type="number"
            min={1900}
            max={2100}
            className={UPLOAD_FIELD_CLASS}
            value={value.year}
            onChange={int("year")}
          />
        </UploadField>
        <UploadField id="bulk-semester" label="Semester">
          <Select value={value.semester} onValueChange={set("semester")}>
            <SelectTrigger id="bulk-semester" className={UPLOAD_FIELD_CLASS}>
              <SelectValue placeholder="Pick one" />
            </SelectTrigger>
            <SelectContent>
              {SEMESTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </UploadField>
        <UploadField id="bulk-type" label="Assignment type">
          <Select value={value.assignment_type} onValueChange={set("assignment_type")}>
            <SelectTrigger id="bulk-type" className={UPLOAD_FIELD_CLASS}>
              <SelectValue placeholder="Pick one" />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </UploadField>
        <UploadField id="bulk-number" label="Assignment number">
          <Input
            id="bulk-number"
            type="number"
            min={1}
            className={UPLOAD_FIELD_CLASS}
            value={value.assignment_number}
            onChange={int("assignment_number")}
          />
        </UploadField>
        <UploadField id="bulk-variant" label="Document variant">
          <Select value={value.document_variant} onValueChange={set("document_variant")}>
            <SelectTrigger id="bulk-variant" className={UPLOAD_FIELD_CLASS}>
              <SelectValue placeholder="Pick one" />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_VARIANTS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </UploadField>
      </div>
      <UploadField id="bulk-tags" label="Tags (comma-separated)">
        <Input
          id="bulk-tags"
          className={UPLOAD_FIELD_CLASS}
          value={value.tags}
          onChange={text("tags")}
          placeholder="curved, rubric-provided"
        />
      </UploadField>
    </fieldset>
  );
}
