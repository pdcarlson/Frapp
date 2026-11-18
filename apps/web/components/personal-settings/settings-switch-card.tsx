"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";

/**
 * One account switch on Settings: its label and caption on the left, the
 * switch on the right, in a bordered card. Frapp AI and Read receipts (#5519)
 * draw it, so a restyle or an accessibility fix reaches both.
 */
export function SettingsSwitchCard({
  label,
  caption,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  caption: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  const switchId = useId();
  const captionId = useId();
  return (
    <div className="flex items-start justify-between gap-8 rounded-[14px] border border-border px-4 py-4">
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor={switchId}
          className="text-sm font-medium text-foreground"
        >
          {label}
        </label>
        <p id={captionId} className="text-caption text-muted-foreground">
          {caption}
        </p>
      </div>
      <Switch
        id={switchId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={captionId}
      />
    </div>
  );
}
