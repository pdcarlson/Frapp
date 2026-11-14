"use client";

import {
  BIRTH_YEAR_MAX,
  BIRTH_YEAR_MIN,
  BIRTHDAY_COPY,
  BIRTHDAY_MONTH_NAMES,
  BIRTHDAY_VISIBILITIES,
  type BirthdayDraftProblem,
  type BirthdayVisibility,
  daysInBirthdayMonth,
} from "@repo/validation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QUIET_LINK } from "@/components/ui/quiet-link";
import { SegmentedChoice } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseGuardedInt } from "@/lib/utils";

export type BirthdayDraft = {
  month: number | null;
  day: number | null;
  year: number | null;
  visibility: BirthdayVisibility;
};

const VISIBILITY_OPTIONS = BIRTHDAY_VISIBILITIES.map((value) => ({
  value,
  label: BIRTHDAY_COPY.visibility[value],
}));

/**
 * The profile's birthday (#4959): month and day pickers, an optional year that
 * is never shown, and who can see it. Laid out as Facebook's birthday field
 * is (month, day, then year), with the audience beside it rather than behind a
 * menu, so a member always sees who will see it. `nobody` is the default.
 */
export function BirthdayFields({
  value,
  onChange,
  problem,
}: {
  value: BirthdayDraft;
  onChange: (next: BirthdayDraft) => void;
  /** The refusal from the last Save, on the field it names; null when none. */
  problem: BirthdayDraftProblem | null;
}) {
  // Without the year, so February always offers the 29th: a year that has
  // none is the year's refusal ("That year has no February 29."), never a
  // day that silently vanishes from the list.
  const days = daysInBirthdayMonth(value.month ?? 1);
  const isSet =
    value.month !== null || value.day !== null || value.year !== null;

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium text-foreground">
        {BIRTHDAY_COPY.label}
      </legend>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_7rem] gap-3">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="birthday-month" className="sr-only">
            {BIRTHDAY_COPY.monthLabel}
          </Label>
          <Select
            value={value.month === null ? "" : String(value.month)}
            onValueChange={(next) => {
              const month = Number(next);
              const max = daysInBirthdayMonth(month);
              onChange({
                ...value,
                month,
                day: value.day !== null && value.day > max ? max : value.day,
              });
            }}
          >
            <SelectTrigger
              id="birthday-month"
              aria-invalid={problem?.field === "month" || undefined}
              aria-describedby="birthday-hint"
            >
              <SelectValue placeholder={BIRTHDAY_COPY.monthLabel} />
            </SelectTrigger>
            <SelectContent>
              {BIRTHDAY_MONTH_NAMES.map((name, index) => (
                <SelectItem key={name} value={String(index + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="birthday-day" className="sr-only">
            {BIRTHDAY_COPY.dayLabel}
          </Label>
          <Select
            value={value.day === null ? "" : String(value.day)}
            onValueChange={(next) => onChange({ ...value, day: Number(next) })}
          >
            <SelectTrigger
              id="birthday-day"
              aria-invalid={problem?.field === "day" || undefined}
              aria-describedby="birthday-hint"
            >
              <SelectValue placeholder={BIRTHDAY_COPY.dayLabel} />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: days }, (_, index) => index + 1).map(
                (day) => (
                  <SelectItem key={day} value={String(day)}>
                    {day}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="birthday-year" className="sr-only">
            {BIRTHDAY_COPY.yearLabel}
          </Label>
          <Input
            id="birthday-year"
            aria-invalid={problem?.field === "year" || undefined}
            aria-describedby="birthday-hint"
            type="number"
            inputMode="numeric"
            min={BIRTH_YEAR_MIN}
            max={BIRTH_YEAR_MAX}
            placeholder="Year"
            title={BIRTHDAY_COPY.yearHint}
            value={value.year ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              const next = raw.trim() === "" ? null : parseGuardedInt(raw);
              if (next === undefined) return;
              onChange({ ...value, year: next });
            }}
          />
        </div>
      </div>
      <p
        id="birthday-hint"
        role={problem ? "alert" : undefined}
        className={
          problem
            ? "text-caption text-destructive-text"
            : "text-caption text-muted-foreground"
        }
      >
        {problem ? problem.message : BIRTHDAY_COPY.yearHint}
      </p>
      <div className="grid gap-2">
        <SegmentedChoice
          label={BIRTHDAY_COPY.visibilityLabel}
          options={VISIBILITY_OPTIONS}
          value={value.visibility}
          onChange={(visibility) => onChange({ ...value, visibility })}
          fill
        />
        <p className="text-caption text-muted-foreground">
          {BIRTHDAY_COPY.visibilityHint[value.visibility]}
        </p>
      </div>
      {isSet ? (
        <div>
          <button
            type="button"
            className={QUIET_LINK}
            onClick={() =>
              onChange({ ...value, month: null, day: null, year: null })
            }
          >
            {BIRTHDAY_COPY.clear}
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
