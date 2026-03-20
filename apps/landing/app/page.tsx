import Image from "next/image";
import Link from "next/link";
import { FrappLockup } from "../components/frapp-lockup";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  GraduationCap,
  MessageSquare,
  ShieldCheck,
  Star,
} from "lucide-react";

const chapterStats = [
  { value: "50+", label: "Chapters operating on Frapp" },
  { value: "2,000+", label: "Members engaged weekly" },
  { value: "10,000+", label: "Events managed without spreadsheets" },
];

const features = [
  {
    icon: BookOpen,
    title: "Backwork Library",
    description:
      "Search study resources by department, course, professor, semester, and assignment type in seconds.",
  },
  {
    icon: MessageSquare,
    title: "Real-Time Chat",
    description:
      "Channel-based communication, role-gated rooms, announcements, and DMs in one chapter-native system.",
  },
  {
    icon: CalendarDays,
    title: "Events & Attendance",
    description:
      "Run attendance with self-check-in, role-targeted events, and automatic point awards.",
  },
  {
    icon: Star,
    title: "Points & Leaderboard",
    description:
      "Drive engagement with transparent points, audit-ready ledgers, and semester-aware rankings.",
  },
  {
    icon: GraduationCap,
    title: "Study Hours",
    description:
      "Track verified study sessions inside approved geofences with anti-spoof controls and streak feedback.",
  },
  {
    icon: CircleDollarSign,
    title: "Billing & Dues",
    description:
      "Keep treasurers in control with subscription visibility, member invoices, and payment status tracking.",
  },
];

const testimonials = [
  {
    quote:
      "Frapp replaced three disconnected tools and finally gave our exec board one source of truth.",
    name: "Jordan M.",
    role: "Chapter President",
    chapter: "Alpha Phi • Midwest University",
  },
  {
    quote:
      "Our attendance and points process went from reactive to predictable in under two weeks.",
    name: "Evan R.",
    role: "Treasurer",
    chapter: "Kappa Sigma • State College",
  },
  {
    quote:
      "The app feels built for chapter operations, not retrofitted from a generic workspace product.",
    name: "Dylan P.",
    role: "Standards Chair",
    chapter: "Sigma Tau • Coastal Tech",
  },
];

const faqs = [
  {
    question: "How is Frapp priced?",
    answer:
      "Frapp uses one flat monthly chapter plan. No per-seat pricing and no feature gating.",
  },
  {
    question: "Can we cancel any time?",
    answer:
      "Yes. Chapters can cancel anytime. Data remains preserved in read-only mode for reactivation.",
  },
  {
    question: "Is there a trial period?",
    answer:
      "Yes, every new chapter starts with a 14-day trial so your leadership team can evaluate fit.",
  },
  {
    question: "Can alumni and active members both use Frapp?",
    answer:
      "Yes. Alumni support, role-based permissions, and dedicated channels are built into the product model.",
  },
];

export default function Home() {
  const appBaseUrlRaw =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.frapp.live";
  const trimmedAppBaseUrl = appBaseUrlRaw.replace(/\/$/, "");
  const appBaseUrl = trimmedAppBaseUrl.endsWith("/signup")
    ? trimmedAppBaseUrl.slice(0, -"/signup".length)
    : trimmedAppBaseUrl;
  const signupUrl = new URL("/signup", `${appBaseUrl}/`).toString();
  const loginUrl = new URL("/login", `${appBaseUrl}/`).toString();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Frapp",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    url: "https://frapp.live",
    description:
      "Frapp is the operating system for Greek Life, unifying chat, events, points, study hours, and chapter billing.",
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: "149",
      description: "Flat monthly chapter plan",
    },
    brand: {
      "@type": "Brand",
      name: "Frapp",
    },
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <FrappLockup />
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <Link
              href="#features"
              className="transition-colors hover:text-foreground"
            >
              Features
            </Link>
            <Link
              href="#how-it-works"
              className="transition-colors hover:text-foreground"
            >
              How it works
            </Link>
            <Link
              href="#pricing"
              className="transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href={loginUrl}
              className="hidden rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted md:inline-flex"
            >
              Log In
            </Link>
            <Link
              href={signupUrl}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="border-b border-border bg-background">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="space-y-6">
            <div className="border-t border-border pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                The operating system for greek life
              </p>
              <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-navy dark:text-white sm:text-5xl lg:text-6xl">
                Replace Discord, OmegaFi, and Life360 with one intentional
                platform.
              </h1>
            </div>
            <p className="max-w-xl text-lg text-muted-foreground">
              Frapp unifies chapter communication, events, study accountability,
              points, and dues workflows so leadership can run operations
              without duct-taped tools.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={signupUrl}
                className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Get Started
              </Link>
              <Link
                href="#showcase"
                className="inline-flex h-11 items-center rounded-md border border-border bg-card px-6 text-sm font-semibold transition-colors hover:bg-muted"
              >
                Explore the product
              </Link>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                14-day trial • No per-seat pricing • Stripe-backed billing
              </span>
            </div>
          </div>
          <div
            id="showcase"
            className="rounded-lg border border-border bg-card p-6 motion-safe:animate-fade-up motion-reduce:animate-none lg:mt-10"
          >
            <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
              <p className="text-sm font-semibold">
                Chapter Operations Snapshot
              </p>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                Subscription active
              </span>
            </div>
            <div className="divide-y divide-border">
              {[
                "42/47 members checked in to Chapter Meeting",
                "3 tasks pending admin confirmation",
                "12 new backwork resources this week",
                "Leaderboard refreshed for Spring semester",
              ].map((line) => (
                <div
                  key={line}
                  className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm text-foreground">{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-muted/30">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
          <div className="grid gap-8 border-t border-border pt-8 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border motion-safe:animate-fade-up motion-reduce:animate-none">
            {chapterStats.map((stat) => (
              <div
                key={stat.label}
                className="sm:px-8 first:sm:pl-0 last:sm:pr-0"
              >
                <p className="text-3xl font-bold tabular-nums text-navy dark:text-white">
                  {stat.value}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-2xl text-xs text-muted-foreground">
            Illustrative projections—not reported customer metrics. Replace with
            verified figures when available (see{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              spec/ui-brand-identity.md
            </code>{" "}
            in the repo).
          </p>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="border-t border-border pt-4 motion-safe:animate-fade-up motion-reduce:animate-none">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Core capabilities
          </p>
          <h2 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-navy dark:text-white sm:text-4xl">
            One ledger for communication, events, points, and dues.
          </h2>
        </div>
        <div className="mt-12 overflow-hidden rounded-lg border border-border bg-card motion-safe:animate-fade-up motion-reduce:animate-none">
          <ul className="divide-y divide-border">
            {features.map((feature) => (
              <li key={feature.title}>
                <article className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:gap-6">
                  <feature.icon
                    className="h-8 w-8 shrink-0 text-primary"
                    aria-hidden
                  />
                  <div>
                    <h3 className="text-lg font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="how-it-works"
        className="border-y border-border bg-muted/30 py-20"
      >
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="border-t border-border pt-4 motion-safe:animate-fade-up motion-reduce:animate-none">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              How it works
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-navy dark:text-white sm:text-4xl">
              Launch your chapter in under five minutes.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Create your chapter workspace",
                body: "Set your chapter identity, configure roles, and connect billing in one guided flow.",
              },
              {
                step: "02",
                title: "Invite members with role defaults",
                body: "Send secure invite links and place each member in the right operational context from day one.",
              },
              {
                step: "03",
                title: "Run events, communication, and accountability",
                body: "From attendance to points and dues, keep everything synced across admin and member experiences.",
              },
            ].map((item) => (
              <article
                key={item.step}
                className="border border-border bg-card p-6 motion-safe:animate-fade-up motion-reduce:animate-none"
              >
                <p className="text-sm font-bold tabular-nums text-primary">
                  {item.step}
                </p>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="border-t border-border pt-4 motion-safe:animate-fade-up motion-reduce:animate-none">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Product in context
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-navy dark:text-white sm:text-4xl">
            Web and mobile surfaces designed as one system.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Leadership workflows stay dense on desktop while members get
            focused, reliable loops on mobile.
          </p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <article className="overflow-hidden rounded-lg border border-border bg-card motion-safe:animate-fade-up motion-reduce:animate-none">
            <div className="border-b border-border">
              <Image
                src="/showcase-dashboard.svg"
                alt="Frapp web dashboard preview showing operations, members, and points modules."
                width={1280}
                height={900}
                className="h-auto w-full"
                priority={false}
              />
            </div>
            <div className="p-4">
              <h3 className="text-base font-semibold">
                Dashboard operations console
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Role-aware navigation, points controls, billing visibility, and
                resilient table workflows.
              </p>
            </div>
          </article>

          <article className="overflow-hidden rounded-lg border border-border bg-card motion-safe:animate-fade-up motion-reduce:animate-none">
            <div className="border-b border-border">
              <Image
                src="/showcase-mobile.svg"
                alt="Frapp mobile app preview showing feed updates and task-loop state cards."
                width={900}
                height={900}
                className="h-auto w-full"
                priority={false}
              />
            </div>
            <div className="p-4">
              <h3 className="text-base font-semibold">Member mobile loop</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Unified chapter feed, explicit sync states, and quick routes for
                events, chat, and points.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] motion-safe:animate-fade-up motion-reduce:animate-none">
          <div className="rounded-lg border-2 border-primary/40 bg-card p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Simple chapter pricing
            </p>
            <p className="mt-4 text-5xl font-bold tabular-nums text-navy dark:text-white">
              $149
            </p>
            <p className="text-sm text-muted-foreground">per chapter / month</p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Unlimited members and officers",
                "Chat, events, points, study tracking, billing",
                "Role-based permissions and audit history",
                "Reports and exports",
                "Priority implementation support",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href={signupUrl}
              className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start free trial
            </Link>
          </div>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <article
                key={faq.question}
                className="rounded-lg border border-border bg-card p-5 motion-safe:animate-fade-up motion-reduce:animate-none"
              >
                <h3 className="font-semibold">{faq.question}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30 py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="border-t border-border pt-4 text-center motion-safe:animate-fade-up motion-reduce:animate-none">
            <h2 className="text-3xl font-bold tracking-tight text-navy dark:text-white sm:text-4xl">
              Built for real chapter operations.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              Composite feedback—illustrative of officer workflows; not
              attributed to verified customers until published as such.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <article
                key={testimonial.name}
                className="border border-border bg-card p-6 motion-safe:animate-fade-up motion-reduce:animate-none"
              >
                <p className="text-sm leading-6 text-foreground">
                  “{testimonial.quote}”
                </p>
                <p className="mt-5 text-sm font-semibold">{testimonial.name}</p>
                <p className="text-xs text-muted-foreground">
                  {testimonial.role}
                </p>
                <p className="text-xs text-muted-foreground">
                  {testimonial.chapter}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-navy py-20 text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 text-center">
          <h2 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to run your chapter with clarity, speed, and accountability?
          </h2>
          <p className="mt-4 max-w-2xl text-slate-300">
            Join the chapters using Frapp to consolidate operations, reduce
            leadership overhead, and improve member engagement.
          </p>
          <Link
            href={signupUrl}
            className="mt-8 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-navy transition-colors hover:bg-slate-200"
          >
            Get Started
          </Link>
        </div>
      </section>

      <footer className="border-t border-border bg-background">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="#features" className="hover:text-foreground">
                  Features
                </Link>
              </li>
              <li>
                <Link href="#pricing" className="hover:text-foreground">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href={signupUrl} className="hover:text-foreground">
                  Get Started
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Resources</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href="https://docs.frapp.live"
                  className="hover:text-foreground"
                >
                  Documentation
                </Link>
              </li>
              <li>
                <Link href={loginUrl} className="hover:text-foreground">
                  Log In
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/terms" className="hover:text-foreground">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-foreground">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/ferpa" className="hover:text-foreground">
                  FERPA Notice
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Contact</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href="mailto:team@frapp.live"
                  className="hover:text-foreground"
                >
                  team@frapp.live
                </Link>
              </li>
              <li>
                <span>Built for chapter leaders</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Frapp. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
