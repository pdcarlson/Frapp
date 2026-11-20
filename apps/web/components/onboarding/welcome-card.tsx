"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import {
  useCurrentChapter,
  useCurrentUser,
  useEvents,
  usePickableRoles,
} from "@repo/hooks";
import {
  WELCOME_CARD_COPY,
  welcomeCardEventWhen,
  welcomeCardEvents,
  welcomeCardTitle,
} from "@repo/validation";
import { ChatDensityControl } from "@/components/profile/chat-density-control";
import { ProfilePhotoControl } from "@/components/profile/profile-photo-control";
import { PickRolesList } from "@/components/roles/pick-roles-section";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FOCUS_RING } from "@/components/ui/focus";
import { clearWelcomeDue, isWelcomeDue } from "@/lib/onboarding/welcome-due";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { cn, initials } from "@/lib/utils";

type Me = {
  id?: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

type EventRow = {
  id: string;
  name: string;
  start_time: string;
  end_time?: string | null;
};

/**
 * The welcome card (#5627; Paul's pick 2026-11-19, "welcome card, no tour"):
 * once, at the top of the first channel a new member opens after `/welcome`,
 * which is the chapter's default channel (`landingChannelId`). It replaced
 * the first-run tour. The phone draws the same card
 * (`apps/mobile/components/onboarding/welcome-card.tsx`).
 *
 * "Welcome to <chapter>, <first name>", the chapter's next two events with
 * their days written out, and **Finish your profile**, which opens the photo,
 * the roles they can join and the chat display: what onboarding stopped
 * asking up front. Closing it is for good, in this browser
 * (`lib/onboarding/welcome-due.ts`).
 *
 * Between the channel header and the timeline, as the ops-setup nudge sits,
 * so it is never a row the virtualized log can unmount.
 */
export function WelcomeCard({ channelOpen }: { channelOpen: boolean }) {
  const chapterId = useChapterStore((s) => s.activeChapterId);
  const userQuery = useCurrentUser();
  const me = userQuery.data as Me | undefined;
  // Read once per mount: the mark only changes when this card clears it.
  const [due, setDue] = useState<boolean | null>(null);
  if (due === null && me?.id && chapterId) {
    setDue(isWelcomeDue(me.id, chapterId));
  }
  const show = !!due && channelOpen;
  const chapter = useCurrentChapter({ chapterId, enabled: show });
  const events = useEvents({ enabled: show });
  const [finishOpen, setFinishOpen] = useState(false);
  const upcoming = useMemo(
    () =>
      welcomeCardEvents(
        (Array.isArray(events.data) ? events.data : []) as EventRow[],
        new Date(),
      ),
    [events.data],
  );

  // Drawn once the events have answered, so the rows never push it taller.
  if (!show || !me || events.isPending) return null;

  const chapterName = (chapter.data as { name?: string } | undefined)?.name;
  const title = welcomeCardTitle(chapterName, me.display_name);

  function close() {
    clearWelcomeDue();
    setDue(false);
  }

  return (
    <section
      aria-labelledby="welcome-card-title"
      className="mx-4 mt-3 rounded-[14px] border border-border bg-card"
    >
      <div className="flex items-start gap-3 px-4 pt-3">
        <h2
          id="welcome-card-title"
          className="min-w-0 flex-1 text-base font-semibold text-foreground"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label={WELCOME_CARD_COPY.close}
          className={cn(
            "-mr-2 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11",
            FOCUS_RING,
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-1 divide-y divide-border px-4 pb-1">
        {upcoming.map((event) => (
          <li key={event.id}>
            <Link
              href={`/events?event=${event.id}`}
              className={cn(
                "-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-accent",
                FOCUS_RING,
              )}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">
                {event.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {welcomeCardEventWhen(event.start_time, new Date())}
              </span>
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setFinishOpen(true)}
            className={cn(
              "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent",
              FOCUS_RING,
            )}
          >
            <span className="min-w-0 flex-1 font-semibold text-foreground">
              {WELCOME_CARD_COPY.finishProfile}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {WELCOME_CARD_COPY.finishProfileHint}
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
      <FinishProfileDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        me={me}
      />
    </section>
  );
}

/**
 * Finish your profile: the three things onboarding no longer asks, each the
 * control its own page uses (Profile's photo and Your roles, Settings' chat
 * display), so a change here is the same change there.
 */
function FinishProfileDialog({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: Me;
}) {
  const { roles } = usePickableRoles();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{WELCOME_CARD_COPY.sheetTitle}</DialogTitle>
          <DialogDescription>{WELCOME_CARD_COPY.sheetLede}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6">
          <section aria-label={WELCOME_CARD_COPY.photo} className="grid gap-2">
            <h3 className="text-sm font-semibold">{WELCOME_CARD_COPY.photo}</h3>
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14 border border-border bg-popover">
                {me.avatar_url ? (
                  <AvatarImage src={me.avatar_url} alt="" />
                ) : null}
                <AvatarFallback className="bg-popover text-sm font-bold text-foreground">
                  {initials(me.display_name ?? null)}
                </AvatarFallback>
              </Avatar>
              <ProfilePhotoControl hasPhoto={!!me.avatar_url} />
            </div>
          </section>
          {roles.length > 0 ? (
            <section
              aria-label={WELCOME_CARD_COPY.roles}
              className="grid gap-2"
            >
              <h3 className="text-sm font-semibold">
                {WELCOME_CARD_COPY.roles}
              </h3>
              <PickRolesList roles={roles} />
            </section>
          ) : null}
          <section
            aria-label={WELCOME_CARD_COPY.display}
            className="grid gap-2"
          >
            <h3 className="text-sm font-semibold">
              {WELCOME_CARD_COPY.display}
            </h3>
            <ChatDensityControl />
          </section>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {WELCOME_CARD_COPY.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
