import { ReactNode } from "react";

type CalloutType = "info" | "warning" | "tip";

const TYPE_STYLES: Record<
  CalloutType,
  { label: string; border: string; bg: string; text: string }
> = {
  info: {
    label: "Info",
    border: "border-sky-500/60",
    bg: "bg-sky-500/10",
    text: "text-sky-100",
  },
  warning: {
    label: "Warning",
    border: "border-amber-500/70",
    bg: "bg-amber-500/10",
    text: "text-amber-100",
  },
  tip: {
    label: "Tip",
    border: "border-emerald-500/70",
    bg: "bg-emerald-500/10",
    text: "text-emerald-100",
  },
};

type CalloutProps = {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const styles = TYPE_STYLES[type];

  return (
    <div
      className={[
        "my-4 rounded-lg border px-4 py-3 text-sm",
        styles.border,
        styles.bg,
      ].join(" ")}
    >
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span
          className={[
            "inline-flex items-center rounded-full bg-background/40 px-2 py-0.5",
            styles.text,
          ].join(" ")}
        >
          {title ?? styles.label}
        </span>
      </div>
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}
