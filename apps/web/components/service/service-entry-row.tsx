import type { ReactNode } from "react";
import type { components } from "@repo/api-sdk";
import { awardedPointsLabel, statusLabel } from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { serviceStatusKind } from "@/components/service/service-status";

type ServiceEntry = components["schemas"]["ServiceEntryResponseDto"];

/**
 * One reviewed-or-pending entry on `/service`: its title, when and how long,
 * an optional line under that, any reviewer note, then its status and the
 * points its approval recorded. Your log and Chapter history both draw it, so
 * one entry reads the same in both sections; Your log titles it by what was
 * done, Chapter history by who did it. `action` is Withdraw on your own
 * pending row.
 */
export function ServiceEntryRow({
  entry,
  title,
  body,
  meta,
  action,
}: {
  entry: ServiceEntry;
  title: ReactNode;
  body?: ReactNode;
  meta: string;
  action?: ReactNode;
}) {
  const pointsLabel = awardedPointsLabel(entry);
  return (
    <li className="flex min-h-11 flex-col gap-1 py-2 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-caption text-muted-foreground">{meta}</p>
        {body ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        ) : null}
        {entry.review_comment ? (
          <p className="text-caption text-muted-foreground">
            Reviewer note: {entry.review_comment}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={serviceStatusKind(entry.status)}>
          {statusLabel("serviceEntry", entry.status)}
        </Badge>
        {pointsLabel ? <Badge variant="outline">{pointsLabel}</Badge> : null}
        {action}
      </div>
    </li>
  );
}
