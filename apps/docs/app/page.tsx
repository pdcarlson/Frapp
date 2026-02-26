import Link from "next/link";

const sections = [
  {
    label: "Get started",
    items: [
      {
        title: "Getting Started",
        description:
          "Set up the repo, Supabase, and run the full stack locally.",
        href: "/guides/getting-started",
      },
    ],
  },
  {
    label: "Development",
    items: [
      {
        title: "API Architecture",
        description:
          "NestJS layering, guards, and how to add a new module safely.",
        href: "/guides/api-architecture",
      },
      {
        title: "Database",
        description: "Supabase schema, migrations, and table conventions.",
        href: "/guides/database",
      },
      {
        title: "Docker & Deployment",
        description:
          "Build the API container and deploy to Railway, Render, or AWS.",
        href: "/guides/docker",
      },
      {
        title: "Testing",
        description:
          "Unit tests, guards, interceptors, and E2E patterns with Jest.",
        href: "/guides/testing",
      },
      {
        title: "Env & Config",
        description: "Environment matrix, .env files, and secrets across apps.",
        href: "/guides/env-config",
      },
    ],
  },
  {
    label: "Community",
    items: [
      {
        title: "Contributing",
        description: "Git workflow, commit format, and development rules.",
        href: "/guides/contributing",
      },
    ],
  },
];

export default function Home() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <header className="space-y-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.06] px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="text-xs font-medium text-primary">Frapp Docs</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Documentation
        </h1>
        <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
          Guides and references for building and running Frapp — the operating
          system for Greek life.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <Link
            href="/guides/getting-started"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Get started
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
          <Link
            href="/guides/api-architecture"
            className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-white/[0.15] hover:text-foreground"
          >
            API Architecture
          </Link>
        </div>
      </header>

      {/* Guide sections */}
      {sections.map((section) => (
        <section key={section.label} className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-primary/80">
            {section.label}
          </h2>
          <div
            className={
              section.items.length === 1
                ? "grid gap-3"
                : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            }
          >
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group relative rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all hover:border-primary/30 hover:bg-primary/[0.03]"
              >
                <h3 className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  {item.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Read guide
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
