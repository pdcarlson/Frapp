import { inviteCardLine, type InviteDetails } from "@repo/hooks";
import { chapterInitials } from "@repo/validation";
import { CrestTile } from "@/components/layout/crest-tile";
import { Skeleton } from "@/components/shared/async-states";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

function markOf(details: Pick<InviteDetails, "mark_text" | "chapter_name">) {
  return {
    logoUrl: null,
    text: details.mark_text ?? chapterInitials(details.chapter_name),
    source: details.mark_text ? ("short_name" as const) : ("initials" as const),
  };
}

/**
 * The top of `/join` with an invite (#5625): the chapter, before anything is
 * asked of the visitor. Discord's and GroupMe's invite pages lead the same
 * way, with whose group it is and who sent it, because that is what decides
 * whether someone taps on.
 *
 * The chapter's name is the screen's `<h1>`. Its mark is the crest tile at
 * card size, in house gold: these routes have no chapter accent
 * (`auth-screen.tsx`), and the raw stored seed is never paint.
 */
export function InviteHero({
  details,
  eyebrow = "You're invited to join",
}: {
  details: InviteDetails;
  eyebrow?: string;
}) {
  const line = inviteCardLine(details);
  return (
    <div>
      <p className={cn(EYEBROW, "text-accent-text")}>{eyebrow}</p>
      <div className="mt-3 flex items-center gap-4">
        <CrestTile size="card" mark={markOf(details)} />
        <div className="min-w-0">
          <h1 className="text-balance text-headline font-bold tracking-tight text-foreground">
            {details.chapter_name}
          </h1>
          {details.university ? (
            <p className="truncate text-sm text-muted-foreground">
              {details.university}
            </p>
          ) : null}
        </div>
      </div>
      {line || details.role ? (
        <dl className="mt-5 divide-y divide-border rounded-md border border-border bg-surface-1">
          {line ? (
            <div className="px-4 py-3">
              <dt className="sr-only">Invite</dt>
              <dd className="text-sm text-foreground">{line}</dd>
            </div>
          ) : null}
          {details.role ? (
            <div className="flex items-baseline justify-between gap-3 px-4 py-3">
              <dt className="text-sm text-muted-foreground">
                You&apos;ll join as
              </dt>
              <dd className="truncate text-sm font-semibold text-foreground">
                {details.role}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * A dead link's top (#5625): what happened is the `<h1>`, and the chapter and
 * its sender stay on the card, so the visitor knows exactly whom to ask.
 */
export function DeadInviteHero({
  details,
  title,
  sent,
}: {
  details: InviteDetails;
  title: string;
  sent: string | null;
}) {
  return (
    <div>
      <h1 className="text-balance text-headline font-bold tracking-tight text-foreground">
        {title}
      </h1>
      <div className="mt-5 flex items-center gap-3 rounded-md border border-border bg-surface-1 p-4">
        <CrestTile size="card" mark={markOf(details)} />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">
            {details.chapter_name}
          </p>
          {details.university ? (
            <p className="truncate text-sm text-muted-foreground">
              {details.university}
            </p>
          ) : null}
          {sent ? (
            <p className="mt-1 text-sm text-muted-foreground">{sent}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The hero's shape while the invite is read, so nothing jumps when it lands. */
export function InviteHeroSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <h1 className="sr-only">Opening your invite…</h1>
      <Skeleton className="h-3 w-40" />
      <div className="mt-3 flex items-center gap-4">
        <Skeleton className="h-14 w-14 shrink-0 rounded-[16px]" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="mt-5 h-12 rounded-md" />
      <div className="mt-8 space-y-3">
        <Skeleton className="h-11 rounded-md" />
        <Skeleton className="h-11 rounded-md" />
      </div>
    </div>
  );
}
