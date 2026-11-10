"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ClipboardCopy,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/lib/hooks/use-toast";
import {
  EXPORT_FORMATS,
  exportRows,
  getErrorMessage,
  readLastExportFormat,
  rememberExportFormat,
  type ExportFormat,
} from "@/lib/utils";

/**
 * The export button every dashboard export uses (Points, Billing, Reports):
 * it opens a menu of file types instead of downloading a `.csv` outright
 * (#3969). A `.csv` opens in whatever spreadsheet app the computer has, so a
 * one-shot CSV download read as "it goes to Excel" with no visible choice.
 *
 * The pattern is the one Stripe's dashboard export, Notion's Export and Google
 * Sheets' own File → Download use: one button, then a short format list. The
 * format last used on this browser is marked, so a repeat export is the same
 * two clicks without re-reading the list.
 *
 * Rows are built by the caller only when a format is picked (`getRows`), and
 * every format goes through `exportRows` in `lib/utils.ts`, so the three
 * exports cannot differ in escaping, filenames or formula handling.
 */
const FORMAT_ITEMS: Record<ExportFormat, { label: string; icon: LucideIcon }> =
  {
    csv: { label: "CSV", icon: FileText },
    xlsx: { label: "Excel (.xlsx)", icon: FileSpreadsheet },
    sheets: { label: "Copy for Google Sheets", icon: ClipboardCopy },
  };

export function ExportMenu({
  label,
  filenamePrefix,
  getRows,
  onExported,
  icon,
  disabled,
  size,
  className,
}: {
  /** The button's words, e.g. "Export selected". */
  label: string;
  /** Names the file: `frapp-<filenamePrefix>-<date>.<ext>`. */
  filenamePrefix: string;
  /** The rows to export, read when a format is picked. */
  getRows: () => Record<string, string>[];
  /** Runs after a successful export, for a caller's own follow-up notice. */
  onExported?: (format: ExportFormat) => void;
  icon?: ReactNode;
  disabled?: boolean;
  size?: ButtonProps["size"];
  className?: string;
}) {
  const { toast } = useToast();
  const [lastFormat, setLastFormat] = useState<ExportFormat | null>(null);
  const [pending, setPending] = useState(false);

  async function runExport(format: ExportFormat) {
    const rows = getRows();
    if (rows.length === 0) return;
    setPending(true);
    try {
      await exportRows(rows, filenamePrefix, format);
    } catch (error) {
      toast({
        title:
          format === "sheets" ? "Couldn't copy the rows" : "Couldn't export",
        variant: "destructive",
        description:
          format === "sheets"
            ? "Your browser blocked the clipboard. Export a CSV and open it in Google Sheets instead."
            : getErrorMessage(error, "Try again, or export a CSV instead."),
      });
      return;
    } finally {
      setPending(false);
    }
    rememberExportFormat(format);
    if (format === "sheets") {
      toast({
        title: `Copied ${rows.length} row${rows.length === 1 ? "" : "s"}`,
        description: "Paste into a Google Sheet.",
      });
    }
    onExported?.(format);
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // Read on open, not on mount: localStorage is not there during the
        // server render, and another tab may have exported since.
        if (open) setLastFormat(readLastExportFormat());
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size={size}
          className={className}
          disabled={disabled || pending}
        >
          {icon}
          {label}
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>File type</DropdownMenuLabel>
        {EXPORT_FORMATS.map((format) => {
          const { label: formatLabel, icon: FormatIcon } = FORMAT_ITEMS[format];
          return (
            <DropdownMenuItem
              key={format}
              onSelect={() => void runExport(format)}
            >
              <FormatIcon aria-hidden="true" />
              {formatLabel}
              {format === lastFormat ? (
                <span className="ml-auto pl-4 text-caption text-muted-foreground">
                  Last used
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
