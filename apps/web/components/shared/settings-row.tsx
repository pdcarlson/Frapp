"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The one settings row on web, and the group that holds it (rulebook § 9,
 * `spec/ui/design-system/components.md` § Settings rows). The phone draws the
 * same shape with `ListSection` and `ListRow` (`apps/mobile/components/list-section.tsx`).
 *
 * A row is a label, at most one short muted line, and one trailing thing:
 *
 * - a switch (`checked` + `onCheckedChange`), saved the moment it flips;
 * - a current value that opens a picker (`value` + `onClick`, or wrap a
 *   `Select`/picker trigger in `control`);
 * - a chevron to another page (`href`).
 *
 * The group is the bordered, divided list (iOS Settings, Slack preferences),
 * so settings never sit in a card each.
 */
export function SettingsGroup({
  label,
  children,
  className,
}: {
  /** Accessible name when the group has no visible heading above it. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "divide-y divide-border rounded-[14px] border border-border bg-card",
        className,
      )}
    >
      {children}
    </ul>
  );
}

type Trailing =
  | {
      checked: boolean;
      onCheckedChange: (next: boolean) => void;
      disabled?: boolean;
      value?: never;
      onClick?: never;
      href?: never;
      control?: never;
    }
  | {
      value: ReactNode;
      onClick: () => void;
      checked?: never;
      onCheckedChange?: never;
      disabled?: boolean;
      href?: never;
      control?: never;
    }
  | {
      href: string;
      value?: ReactNode;
      checked?: never;
      onCheckedChange?: never;
      disabled?: never;
      onClick?: never;
      control?: never;
    }
  | {
      /** A picker trigger (Select, SearchablePicker) drawn at the row's end. */
      control: ReactNode;
      checked?: never;
      onCheckedChange?: never;
      disabled?: never;
      value?: never;
      onClick?: never;
      href?: never;
    };

const ROW =
  "flex min-h-11 items-center gap-4 px-4 py-2.5 group-first:rounded-t-[13px] group-last:rounded-b-[13px]";

export function SettingsRow(
  props: {
    label: ReactNode;
    /** One short line, only when the label alone can't say it. */
    description?: ReactNode;
    /** A setting that only matters under the row above it: drawn indented. */
    nested?: boolean;
    /** Its label greys while the setting it waits on is off. */
    muted?: boolean;
  } & Trailing,
) {
  const { label, description, nested = false, muted = false } = props;
  const row = cn(ROW, nested && "pl-10");
  const labelId = useId();
  const descriptionId = useId();
  const switchId = useId();
  const isSwitch = "onCheckedChange" in props && !!props.onCheckedChange;
  // A switch row's label is a real <label>, so clicking the words flips it.
  const LabelTag = isSwitch ? "label" : "span";

  const text = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <LabelTag
        id={labelId}
        htmlFor={isSwitch ? switchId : undefined}
        className={cn(
          "text-sm font-medium",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {label}
      </LabelTag>
      {description ? (
        <span id={descriptionId} className="text-caption text-muted-foreground">
          {description}
        </span>
      ) : null}
    </span>
  );

  if ("href" in props && props.href) {
    return (
      <li className="group">
        <Link
          href={props.href}
          className={cn(row, "transition hover:bg-card-hover", FOCUS_RING)}
        >
          {text}
          {props.value ? (
            <span className="text-sm text-muted-foreground">{props.value}</span>
          ) : null}
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Link>
      </li>
    );
  }

  if ("onClick" in props && props.onClick) {
    return (
      <li className="group">
        <button
          type="button"
          onClick={props.onClick}
          disabled={props.disabled}
          className={cn(
            row,
            "w-full text-left transition hover:bg-card-hover disabled:opacity-50",
            FOCUS_RING,
          )}
        >
          {text}
          <span className="text-sm text-muted-foreground">{props.value}</span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
      </li>
    );
  }

  if ("onCheckedChange" in props && props.onCheckedChange) {
    return (
      <li className="group">
        <div className={row}>
          {text}
          <Switch
            id={switchId}
            checked={props.checked}
            disabled={props.disabled}
            onCheckedChange={props.onCheckedChange}
            aria-labelledby={labelId}
            aria-describedby={description ? descriptionId : undefined}
          />
        </div>
      </li>
    );
  }

  return (
    <li className="group">
      <div className={row}>
        {text}
        <div className="shrink-0">{props.control}</div>
      </div>
    </li>
  );
}
