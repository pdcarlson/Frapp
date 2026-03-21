import Link from "next/link";

const REPO_FILE_BASE = "https://github.com/pdcarlson/Frapp/blob/main";

type FrozenGuideNoticeProps = {
  title: string;
  /** Repo-relative path, e.g. `docs/guides/getting-started.md`. */
  path: string;
};

export function FrozenGuideNotice({ title, path }: FrozenGuideNoticeProps) {
  const href = `${REPO_FILE_BASE}/${path}`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-5 text-sm leading-relaxed">
        <p className="font-semibold text-amber-100/95">
          Guide content lives in the repo
        </p>
        <p className="mt-2 text-muted-foreground">
          This Next.js site is on content freeze. The canonical copy of{" "}
          <span className="text-foreground/85">{title}</span> is{" "}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[13px] text-foreground/80">
            {path}
          </code>{" "}
          in GitHub. Update that file for PRs; CI accepts changes under{" "}
          <code className="text-foreground/80">docs/</code> or{" "}
          <code className="text-foreground/80">spec/</code>.
        </p>
        <a
          href={href}
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-primary/90"
          target="_blank"
          rel="noopener noreferrer"
        >
          View {title} on GitHub
          <span aria-hidden>↗</span>
        </a>
      </div>
      <p className="text-[13px] text-muted-foreground">
        <Link href="/" className="font-medium text-primary hover:underline">
          ← Back to docs home
        </Link>
      </p>
    </div>
  );
}
