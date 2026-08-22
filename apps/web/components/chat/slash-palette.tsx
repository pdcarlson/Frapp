"use client";

import { useMemo } from "react";
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
  /** Parent-owned query updates (composer prefix or in-palette typing). */
  onQueryChange?: (query: string) => void;
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
 * The input is parent-controlled (`initialQuery` + `onQueryChange`) so the
 * displayed filter stays in lockstep with the composer's slash text without
 * an effect-synced copy.
 */
export function SlashPalette({
  open,
  initialQuery = "",
  onQueryChange,
  isModuleEnabled,
  status = "ready",
  onRetry,
  onSelect,
  onOpenChange,
}: SlashPaletteProps) {
  const query = initialQuery;

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
              onValueChange={(value) => onQueryChange?.(value)}
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
                    <span className="font-mono text-[12.5px] text-muted-foreground">
                      /{command.name}
                    </span>
                    <span className="ml-2 text-base">{command.description}</span>
                    {command.usage ? (
                      <span className="ml-auto text-[12.5px] text-muted-foreground">
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
