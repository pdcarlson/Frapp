import Link from "next/link";
import { ArrowUpRight, CalendarDays, CheckCircle2, CircleDollarSign, Sparkles, Star, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const stats = [
  {
    label: "Active Members",
    value: "47",
    detail: "+4 this semester",
    icon: Users,
  },
  {
    label: "Upcoming Events",
    value: "3",
    detail: "2 mandatory this week",
    icon: CalendarDays,
  },
  {
    label: "Points Awarded",
    value: "1,240",
    detail: "This month",
    icon: Star,
  },
  {
    label: "Outstanding Invoices",
    value: "$1,150",
    detail: "5 members overdue",
    icon: CircleDollarSign,
  },
];

const recentActivity = [
  "Chapter Meeting attendance closed • 42 check-ins",
  "Task completion confirmed for 3 members",
  "Backwork upload: CS 3320 Midterm Study Guide",
  "Invoice reminder sent to 5 members",
];

type QuickAction = {
  label: string;
  href?: string;
  disabledReason?: string;
};

const quickActions: QuickAction[] = [
  {
    label: "Create event",
    href: "/events",
  },
  {
    label: "Invite member",
    href: "/members",
  },
  {
    label: "Adjust points",
    href: "/points",
  },
  {
    label: "Review service entries",
    disabledReason: "Service entry review ships in the next dashboard milestone.",
  },
];

export default function Home() {
  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center justify-between">
                <span>{stat.label}</span>
                <stat.icon className="h-4 w-4 text-primary" />
              </CardDescription>
              <CardTitle className="text-3xl tracking-tight">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{stat.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl">Recent Activity</CardTitle>
              <CardDescription>Operational highlights across your chapter</CardDescription>
            </div>
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Live
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivity.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-md border border-border/70 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                <p className="text-sm">{item}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Quick Actions</CardTitle>
            <CardDescription>Common admin workflows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quickActions.map((action) => {
              const buttonContent = (
                <>
                  <span>{action.label}</span>
                  <ArrowUpRight className="h-4 w-4" />
                </>
              );

              if (action.href) {
                return (
                  <Button
                    key={action.label}
                    variant="outline"
                    className="w-full justify-between"
                    asChild
                  >
                    <Link href={action.href} aria-label={action.label}>
                      {buttonContent}
                    </Link>
                  </Button>
                );
              }

              return (
                <Button
                  key={action.label}
                  variant="outline"
                  className="w-full justify-between"
                  disabled
                  aria-disabled="true"
                  title={action.disabledReason}
                >
                  {buttonContent}
                </Button>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Workflow Coverage</CardTitle>
            <CardDescription>Phase 1 screens shipping now</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {[
              ["Dashboard home", "Ready"],
              ["Members directory", "In progress"],
              ["Events management", "In progress"],
              ["Points ledger", "In progress"],
              ["Billing", "Planned"],
            ].map(([feature, status]) => (
              <div key={feature} className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
                <span>{feature}</span>
                <Badge variant={status === "Ready" ? "default" : "secondary"}>{status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Resilience Standard</CardTitle>
            <CardDescription>UX state completeness baseline</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>• Offline and degraded network banners are globally wired.</p>
            <p>• Route shells now support consistent loading, error, and empty state modules.</p>
            <p>• Component states follow focus-visible and contrast-safe defaults from shared tokens.</p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
