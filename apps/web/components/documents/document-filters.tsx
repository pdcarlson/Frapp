"use client";

import { useId } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FILTER_CHIP_CLASS } from "@/components/shared/filter-chip";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  dateFilterLabel,
  isActiveDateFilter,
  type DateFilter,
} from "@repo/hooks/document-library";
import { cn } from "@/lib/utils";

const CHIP = FILTER_CHIP_CLASS;

/**
 * The Date added chip: a few presets and a custom range. A popover rather
 * than a menu, because the custom range holds two date fields, and a menu's
 * typeahead would take the keys meant for them.
 */
export function DateFilterChip({
  value,
  semesterKnown,
  onChange,
}: {
  value: DateFilter | null;
  /** The chapter's semester archives have loaded; until then "This semester" waits. */
  semesterKnown: boolean;
  onChange: (value: DateFilter | null) => void;
}) {
  const id = useId();
  const active = isActiveDateFilter(value, semesterKnown);
  const presets: { key: string; label: string; next: DateFilter | null }[] = [
    { key: "any", label: "Any time", next: null },
    { key: "semester", label: "This semester", next: { preset: "semester" } },
    { key: "30d", label: "Last 30 days", next: { preset: "30d" } },
    {
      key: "custom",
      label: "Custom range",
      next:
        value?.preset === "custom"
          ? value
          : { preset: "custom", from: null, to: null },
    },
  ];
  const current = value === null ? "any" : value.preset;
  const custom = value?.preset === "custom" ? value : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={active ? "tinted" : "secondary"}
          size="toolbar"
          className={CHIP}
          aria-label={
            active ? `Date added: ${dateFilterLabel(value)}` : "Date added"
          }
        >
          <span className="max-w-[180px] truncate">
            {active ? dateFilterLabel(value) : "Date added"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <div role="radiogroup" aria-label="Date added">
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="radio"
              aria-checked={current === preset.key}
              disabled={preset.key === "semester" && !semesterKnown}
              title={
                preset.key === "semester" && !semesterKnown
                  ? "The chapter's semesters haven't loaded"
                  : undefined
              }
              onClick={() => onChange(preset.next)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-card-hover focus-visible:bg-card-hover focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              <Check
                className={cn("h-4 w-4", current !== preset.key && "invisible")}
                aria-hidden="true"
              />
              {preset.label}
            </button>
          ))}
        </div>
        {custom ? (
          <div className="grid grid-cols-2 gap-2 border-t border-border px-2 pb-2 pt-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-from`} className="text-caption text-muted">
                From
              </Label>
              <DateField
                id={`${id}-from`}
                lean="back"
                value={custom.from ?? ""}
                onChange={(from) => onChange({ ...custom, from: from || null })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-to`} className="text-caption text-muted">
                To
              </Label>
              <DateField
                id={`${id}-to`}
                lean="back"
                value={custom.to ?? ""}
                onChange={(to) => onChange({ ...custom, to: to || null })}
              />
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
