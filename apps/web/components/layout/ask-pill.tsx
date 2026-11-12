"use client";

import {
  forwardRef,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import Link from "next/link";
import {
  aiAvailableFrom,
  useAiChapterSettings,
  useAiConsent,
  useHiddenUnsetFeatures,
  useMyPermissions,
} from "@repo/hooks";
import { ASK_COPY, can } from "@repo/validation";
import { AskPanel } from "@/components/ask/ask-panel";
import { useChapterModuleGate } from "@/lib/hooks/use-chapter-module-gate";
import { useIsRolePreviewActive } from "@/lib/stores/role-preview-store";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";

/**
 * The global ✦ Ask entry in the dashboard top bar.
 *
 * Ask is a *global entry* rather than a navigation destination
 * (`spec/ui/mobile/navigation.md`): it rides the top bar beside find on every
 * screen. What the pill does depends on what the server and the chapter say:
 *
 * - **The server has AI and the chapter's Ask switch is on**, and the member
 *   holds `ai:use`: it opens the Ask panel (`ask-panel.tsx`, #450).
 * - **The server has AI but the president has Ask off**, or the member may
 *   not use AI: no pill. A control that could only say "your president turned
 *   this off" on every screen is noise; Chapter settings says it to officers.
 * - **The server has no AI** (`AI_ENABLED` off, the default): the pill is the
 *   shell it was, a small popover saying Ask cannot answer yet and pointing
 *   at find and Documents, because a control that silently did nothing is the
 *   dead end `spec/ui/design-system/README.md` §5 rule 2 bans. It promises no
 *   date. It is a popover, not a dialog, since 2026-11-05: a screen-dimming
 *   modal to say "not yet" is the heavy chrome `components.md` § Chrome
 *   weight rules out.
 *
 * **House gold, never the chapter accent.** Like mobile's Ask Frapp bar
 * (`apps/mobile/components/quick-actions/quick-actions-panel.tsx`), the entry paints in the fixed
 * `gold-ask-*` family because "the Ask/AI surface speaks in Signet's voice,
 * not the tenant's" (`spec/ui/design-system/components.md` §11). The
 * framework board draws the pill in the same values as the chapter accent
 * tints only because its demo tenant IS the house tenant; merging
 * `--gold-ask-*` into `--accent-*` on the board's authority would repaint Ask
 * in the tenant's colour on every chapter that picks an accent.
 *
 * Geometry is the board's top-bar cluster: 34px tall, radius 10, to sit level
 * with the bell and the avatar beside it.
 */
const PillButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button">
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={ASK_COPY.entry_label}
    title="Ask"
    className={cn(
      "inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-gold-ask-border bg-gold-ask-fill px-3 text-label font-bold text-gold-ask-text transition hover:bg-gold-ask-border/30",
      FOCUS_RING_SHELL,
      className,
    )}
    {...props}
  >
    <span aria-hidden="true">✦</span>
    <span>Ask</span>
  </button>
));
PillButton.displayName = "PillButton";

export function AskPill({ className }: { className?: string }) {
  const consent = useAiConsent();
  const available = aiAvailableFrom(consent);
  const settings = useAiChapterSettings({ enabled: available === true });
  const permissions = useMyPermissions().data?.permissions;
  const [panelOpen, setPanelOpen] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const previewing = useIsRolePreviewActive();

  // No AI on this server, or it could not be asked: the shell it has been.
  if (available === false || consent.isError) {
    return <AskNotReady className={className} />;
  }
  // Not known yet. The pill's box is held, empty, so nothing beside it moves
  // when the answer arrives, and no member reads "not ready" on a server
  // where Ask is a moment from opening.
  if (available !== true || settings.isPending) {
    return (
      <PillButton
        className={cn("invisible", className)}
        aria-hidden="true"
        tabIndex={-1}
        disabled
      />
    );
  }
  if (!settings.data?.ask || !can("ai:use", permissions ?? [])) return null;
  // Viewing as a role (#4072): asking is a POST, which the preview refuses,
  // so the pill (and Do, inside its panel) stays off rather than failing on
  // the first question (#4504).
  if (previewing) return null;
  return (
    <>
      <PillButton
        ref={pill}
        className={className}
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((open) => !open)}
      />
      <AskPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        returnFocus={pill}
      />
    </>
  );
}

/** The pill on a server with no AI: it says so, and where to look instead. */
function AskNotReady({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  // Documents can be switched off per chapter, and the nav hides the row when
  // it is. Offering it from here anyway would send a member to a screen
  // whose reads the API refuses — the dead end this dialog exists to avoid,
  // reintroduced by the dialog itself. Fail-safe while the chapter read loads,
  // like every other module gate on this surface, and read from the same
  // member-readable source the nav uses (#1982).
  const isModuleEnabled = useChapterModuleGate();
  // Nor while nobody has uploaded anything, for a member who can't: the nav
  // hides the row then too (`spec/product/modules.md` § Not-set-up features).
  const permissions = useMyPermissions().data?.permissions;
  const hiddenFeatures = useHiddenUnsetFeatures(permissions, isModuleEnabled);
  const documentsEnabled =
    (!isModuleEnabled || isModuleEnabled("documents")) &&
    !hiddenFeatures.has("documents");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PillButton className={className} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Ask isn't ready yet"
        className="grid w-80 gap-2 text-sm"
      >
        <p className="font-semibold text-foreground">
          Ask isn&apos;t ready yet
        </p>
        <p className="text-muted-foreground">
          It will answer questions about your chapter in plain language. Until
          then, find channels, members, messages and more from the top bar
          {documentsEnabled ? ", and chapter files live in Documents." : "."}
        </p>
        {documentsEnabled ? (
          <Button
            asChild
            variant="link"
            className="h-auto justify-self-start p-0"
          >
            <Link href="/documents" onClick={() => setOpen(false)}>
              Open Documents
            </Link>
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
