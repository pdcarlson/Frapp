import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { linkedStatusLabel, type LinkedAppState } from "@repo/hooks";
import { cn } from "@/lib/utils";

/**
 * One row of Settings → Linked apps (#5407): the app's mark, its name, the
 * account it's linked as, and a status mark, then at most one compact control.
 *
 * The state is drawn, not explained, the way Discord's Connections and
 * Slack's and Notion's connected-app lists draw it:
 *
 * - connected: a green check, and the account in the second line;
 * - off: the mark and name greyed, a hollow circle, and Connect;
 * - expired: a red mark and a red second line, and Reconnect.
 *
 * The mark sits right after the app's name, so it lines up with the name on
 * every row whatever control the row ends in, and reads as part of it.
 */
export function LinkedAppRow({
  icon,
  name,
  state,
  showMark = true,
  children,
}: {
  icon: ReactNode;
  name: string;
  state: LinkedAppState;
  /** False for a row that is a tool, not a connection (the calendar link). */
  showMark?: boolean;
  /** The row's one control (Connect, a menu). */
  children?: ReactNode;
}) {
  const off = state.tone === "off";
  return (
    <li className="flex items-center gap-3 py-3" data-linked-state={state.tone}>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-card [&_svg]:size-5",
          off && "opacity-50 grayscale",
        )}
      >
        {icon}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-sm font-semibold",
              off && "text-muted-foreground",
            )}
          >
            {name}
          </span>
          {showMark ? <LinkedStatusMark tone={state.tone} /> : null}
        </p>
        <p
          className={cn(
            "truncate text-caption",
            state.tone === "expired"
              ? "text-destructive-text"
              : "text-muted-foreground",
          )}
        >
          {state.detail}
        </p>
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      ) : null}
    </li>
  );
}

/** The check, hollow circle or alert beside an app's name. */
function LinkedStatusMark({ tone }: { tone: LinkedAppState["tone"] }) {
  const Icon =
    tone === "connected"
      ? CheckCircle2
      : tone === "expired"
        ? AlertCircle
        : Circle;
  return (
    <span
      role="img"
      aria-label={linkedStatusLabel(tone)}
      className={cn(
        "shrink-0 [&_svg]:size-4",
        tone === "connected" && "text-success",
        tone === "expired" && "text-destructive-text",
        tone === "off" && "text-disabled",
      )}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}
