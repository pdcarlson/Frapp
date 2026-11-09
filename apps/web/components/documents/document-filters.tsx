"use client";

import { useId } from "react";
import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SORT_OPTIONS,
  dateFilterLabel,
  isActiveDateFilter,
  type DateFilter,
  type DocumentSort,
} from "@repo/hooks/document-library";
import { cn } from "@/lib/utils";

const CHIP = "gap-1 rounded-full font-semibold";

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
      next: value?.preset === "custom" ? value : { preset: "custom", from: null, to: null },
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
          aria-label={active ? `Date added: ${dateFilterLabel(value)}` : "Date added"}
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
              <Input
                id={`${id}-from`}
                type="date"
                value={custom.from ?? ""}
                max={custom.to ?? undefined}
                onChange={(event) =>
                  onChange({ ...custom, from: event.target.value || null })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-to`} className="text-caption text-muted">
                To
              </Label>
              <Input
                id={`${id}-to`}
                type="date"
                value={custom.to ?? ""}
                min={custom.from ?? undefined}
                onChange={(event) =>
                  onChange({ ...custom, to: event.target.value || null })
                }
              />
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The order chip. Never tinted: an order is always set, so it isn't a filter. */
export function SortChip({
  value,
  onChange,
}: {
  value: DocumentSort;
  onChange: (value: DocumentSort) => void;
}) {
  const selected = SORT_OPTIONS.find((option) => option.value === value)!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="toolbar"
          className={CHIP}
          aria-label={`Sort: ${selected.label}`}
        >
          <ArrowUpDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <span className="truncate">{selected.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            <Check
              className={cn("h-4 w-4", option.value !== value && "invisible")}
              aria-hidden="true"
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
