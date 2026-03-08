import Link from "next/link";
import { BookOpen, CalendarDays, CheckCircle2, CircleDollarSign, GraduationCap, MessageSquare, ShieldCheck, Sparkles, Star } from "lucide-react";

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.frapp.live/signup";
  const normalizedAppUrl = appUrl.replace(/\/$/, "");
  const loginUrl = `${normalizedAppUrl}/login`;
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
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold tracking-tight text-navy dark:text-white">
            frapp
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <Link href="#features" className="hover:text-foreground">Features</Link>
            <Link href="#how-it-works" className="hover:text-foreground">How it works</Link>
            <Link href="#pricing" className="hover:text-foreground">Pricing</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href={loginUrl}
              className="hidden rounded-md border border-border px-4 py-2 text-sm font-medium md:inline-flex"
            >
              Log In
            </Link>
            <Link
              href={appUrl}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="bg-gradient-to-b from-primary-50/70 to-background">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-20 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">
              The operating system for greek life
            </p>
            <h1 className="text-balance text-4xl font-extrabold tracking-tight text-navy sm:text-5xl lg:text-6xl">
              Replace Discord, OmegaFi, and Life360 with one intentional platform.
            </h1>
            <p className="max-w-xl text-lg text-slate-600 dark:text-slate-300">
              Frapp unifies chapter communication, events, study accountability, points, and dues workflows
              so leadership can run operations without duct-taped tools.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={appUrl}
                className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Get Started
              </Link>
              <Link
                href="#showcase"
                className="inline-flex h-11 items-center rounded-md border border-border bg-card px-6 text-sm font-semibold"
              >
                Explore the product
              </Link>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>14-day trial • No per-seat pricing • Stripe-backed billing</span>
            </div>
          </div>
          <div id="showcase" className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
              <p className="text-sm font-semibold">Chapter Operations Snapshot</p>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                Subscription active
              </span>
            </div>
            <div className="space-y-3">
              {[
                "42/47 members checked in to Chapter Meeting",
                "3 tasks pending admin confirmation",
                "12 new backwork resources this week",
                "Leaderboard refreshed for Spring semester",
              ].map((line) => (
                <div key={line} className="flex items-start gap-3 rounded-md border border-border/70 p-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <span className="text-sm text-slate-700 dark:text-slate-200">{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/40">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-12 sm:grid-cols-3">
          {chapterStats.map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-bold text-navy dark:text-white">{stat.value}</p>
              <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Core capabilities</p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Six core systems. One chapter platform.</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <feature.icon className="h-8 w-8 text-primary" />
              <h3 className="mt-5 text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="bg-muted/40 py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">How it works</p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Launch your chapter in under five minutes.</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
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
              <article key={item.step} className="rounded-xl border border-border bg-card p-6">
                <p className="text-sm font-bold text-primary">{item.step}</p>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-2xl border-2 border-primary/30 bg-card p-8 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Simple chapter pricing</p>
            <p className="mt-4 text-5xl font-bold text-navy dark:text-white">$149</p>
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
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href={appUrl}
              className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Start free trial
            </Link>
          </div>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <article key={faq.question} className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold">{faq.question}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-muted/40 py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Built for real chapter operations.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <article key={testimonial.name} className="rounded-xl border border-border bg-card p-6">
                <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">“{testimonial.quote}”</p>
                <p className="mt-5 text-sm font-semibold">{testimonial.name}</p>
                <p className="text-xs text-muted-foreground">{testimonial.role}</p>
                <p className="text-xs text-muted-foreground">{testimonial.chapter}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-navy py-20 text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 text-center">
          <h2 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to run your chapter with clarity, speed, and accountability?
          </h2>
          <p className="mt-4 max-w-2xl text-slate-300">
            Join the chapters using Frapp to consolidate operations, reduce leadership overhead, and improve member engagement.
          </p>
          <Link
            href={appUrl}
            className="mt-8 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-semibold text-navy hover:bg-slate-200"
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
              <li><Link href="#features">Features</Link></li>
              <li><Link href="#pricing">Pricing</Link></li>
              <li><Link href={appUrl}>Get Started</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Resources</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="https://docs.frapp.live">Documentation</Link></li>
              <li><Link href={loginUrl}>Log In</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="/terms">Terms of Service</Link></li>
              <li><Link href="/privacy">Privacy Policy</Link></li>
              <li><Link href="/ferpa">FERPA Notice</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Contact</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link href="mailto:team@frapp.live">team@frapp.live</Link></li>
              <li><span>Built for chapter leaders</span></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/80 py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Frapp. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
