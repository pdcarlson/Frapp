"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ErrorState, LoadingState } from "@/components/shared/async-states";
import { filterSlashCommands, type SlashCommand } from "@repo/chat-integrations";

export interface SlashPaletteProps {
  open: boolean;
  initialQuery?: string;
  isModuleEnabled: (moduleKey: string) => boolean;
  /**
   * Reflects the chapter-config query state so the palette can fail closed
   * while modules are still loading or errored. Defaults to `"ready"` so
   * existing callers and tests don't need to thread the prop.
   */
  status?: "loading" | "error" | "ready";
  /** Retry callback rendered in the error state. */
  onRetry?: () => void;
  onSelect: (command: SlashCommand) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Slash-command palette built on `cmdk`. Filters the catalog by the chapter's
 * enabled modules and lists the typed query results. Foundation chunk: choosing
 * a command surfaces an "Available in Chunk 05" toast via the caller — the
 * palette itself is module-aware and accessible.
 *
 * Fails closed while the chapter config is still loading or errored — see
 * issue #310. The dialog opens to an explicit Loading or Error state instead
 * of a filtered list that defaults to "no modules enabled".
 *
 * The input is controlled and re-syncs with `initialQuery` whenever the palette
 * is opened (e.g. the composer pushed a fresh partial command into it) so the
 * displayed filter never drifts from the composer's slash text.
 */
export function SlashPalette({
  open,
  initialQuery = "",
  isModuleEnabled,
  status = "ready",
  onRetry,
  onSelect,
  onOpenChange,
}: SlashPaletteProps) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    // Re-seed on open and whenever the composer-driven prefix changes.
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const commands = useMemo(
    () => (status === "ready" ? filterSlashCommands(query, isModuleEnabled) : []),
    [query, isModuleEnabled, status],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogTitle className="sr-only">Slash commands</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a slash command. Available commands depend on which modules your
          chapter has enabled.
        </DialogDescription>
        {status === "loading" ? (
          <div className="p-2">
            <LoadingState message="Loading commands…" />
          </div>
        ) : status === "error" ? (
          <div className="p-2">
            <ErrorState
              title="Modules unavailable"
              description="Couldn't load your chapter's enabled commands. Retry to try again."
              onRetry={onRetry}
            />
          </div>
        ) : (
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Type a command…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No matching command.</CommandEmpty>
              <CommandGroup heading="Commands">
                {commands.map((command) => (
                  <CommandItem
                    key={command.name}
                    value={`${command.name} ${command.description}`}
                    onSelect={() => onSelect(command)}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      /{command.name}
                    </span>
                    <span className="ml-2 text-sm">{command.description}</span>
                    {command.usage ? (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {command.usage}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
