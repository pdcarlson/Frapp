"use client";

import { useId, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EYEBROW } from "@/components/ui/typography";
import { CHIP } from "@/components/chat/chip";

/**
 * Board `4c`: the per-page settings drawer.
 *
 * `4c` pin 1 is the contract this component exists to hold: "Gear beside the
 * page title · shows only for roles that hold that page's manage permission.
 * Same gear, same drawer, on every page." So the shell is here, in `layout/`,
 * and a route supplies only its sections — the second page to want one must
 * not draw its own 400px panel.
 *
 * **400px, and it is a `Sheet`.** The board draws the drawer as an in-layout
 * right rail beside `<main>`, dimming the page rather than scrimming it, and
 * says it "takes the right slot like Ask and Notifications". Notifications is
 * `dashboard-notification-drawer.tsx`, a right-side `Sheet` — so this is the
 * same primitive at the board's width rather than a second mechanism. Taking
 * the board's literal in-layout rail would mean handing every settings-bearing
 * route the full-bleed contract (`full-bleed-routes.ts`) and rebuilding its
 * padding and scroll, which is a shell change, not a page one.
 *
 * **Autosave, no Save button** (`4c` pin 4). The footer line says so, and it is
 * not decoration: there is no submit here for a section to hang a button on.
 * A section that cannot save on change does not belong in this drawer.
 */
export function PageSettingsDrawer({
  pageTitle,
  children,
  triggerLabel,
}: {
  /** The page's own title. The drawer heading is "<pageTitle> settings". */
  pageTitle: string;
  children: ReactNode;
  /** Overrides the gear's accessible name. Defaults to "<pageTitle> settings". */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const title = `${pageTitle} settings`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={triggerLabel ?? title}
          className="h-[30px] w-[30px] shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-[15px] w-[15px]" />
        </Button>
      </SheetTrigger>
      {/*
        `w-[400px]` is `4c`'s width. It is capped at the viewport below that so
        the drawer never overflows a 375px phone, which the board does not draw
        but `dashboard-shell.spec.tsx` holds every surface to.
      */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[400px] sm:max-w-[400px]"
      >
        <SheetHeader className="h-12 flex-none space-y-0 border-b border-border px-4">
          <SheetTitle className="flex h-12 items-center text-[15px] font-bold">
            {title}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-4 pb-4 pt-3">
          {children}
          {/*
            `margin-top:auto` in the board, and the copy is the board's. It is
            the only thing standing in for a Save button, so it is not optional
            furniture — without it the drawer reads as a form the member forgot
            to submit.
          */}
          <p className="mt-auto pt-2 text-[12.5px] text-muted-foreground">
            Saved as you change. Members see the effect immediately.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * One labelled group inside the drawer. `4c` draws an 11/600 uppercase eyebrow
 * tracked out 0.1em, then the rows.
 */
export function PageSettingsSection({
  label,
  children,
  footer,
}: {
  label: string;
  children: ReactNode;
  /** A trailing line under the rows, such as a pointer to Settings -> Roles. */
  footer?: ReactNode;
}) {
  const labelId = useId();
  return (
    <section aria-labelledby={labelId}>
      {/*
        `EYEBROW`, not the board's literal 11px/0.1em. `typography.ts` holds the
        repo's section-label recipe at `caption` (12.5/0.12em) precisely because
        11px is off the §7 scale, and it exists because this string had already
        been copied twelve times. A thirteenth copy 1.5px off every other
        section label in the app is the drift that module is there to stop.
      */}
      <h3 id={labelId} className={cn("mb-2 text-muted-foreground", EYEBROW)}>
        {label}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
      {footer ? (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{footer}</p>
      ) : null}
    </section>
  );
}

/**
 * A verb row in the Access section: a 90px label against a wrapping chip list
 * (`4c` pin 3, "chips per verb").
 */
export function PageSettingsAccessRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-[34px] grid-cols-[90px_1fr] items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/**
 * A role chip. `4c` gives the granting roles the accent outline and "Everyone"
 * a plain fill, which is the distinction between "these roles" and "no
 * restriction" — not two weights of the same thing.
 *
 * Accent rather than `--gold-ask-*`, for `pro-chip.tsx`'s reason: the board
 * paints this and the Ask pill alike only because the demo tenant's seed is
 * the house gold.
 */
export function PageSettingsRoleChip({
  children,
  tone = "role",
}: {
  children: ReactNode;
  tone?: "role" | "everyone";
}) {
  return (
    // `CHIP` rather than a fresh literal: its own docstring is about the
    // eleventh and twelfth copies of this geometry quietly becoming different
    // chips, and `pro-chip.tsx` already cites that reasoning one lane over.
    <span
      className={cn(
        CHIP.base,
        tone === "role"
          ? CHIP.accent
          : "border-transparent bg-muted text-foreground",
      )}
    >
      {children}
    </span>
  );
}
