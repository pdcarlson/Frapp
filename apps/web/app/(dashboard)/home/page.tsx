import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Can } from "@/components/shared/can";
import { ActivityFeed } from "@/components/home/activity-feed";
import { OverviewStatCards } from "@/components/home/overview-stat-cards";

type QuickAction = {
  id: string;
  label: string;
  href: string;
  /**
   * When set, the action is only rendered for callers with the permission.
   * Omit for actions available to every authenticated member.
   */
  permission?: string;
};

const quickActions: QuickAction[] = [
  {
    id: "invite-member",
    label: "Invite a member",
    href: "/members",
    permission: "members:invite",
  },
  {
    id: "new-event",
    label: "Create an event",
    href: "/events",
    permission: "events:create",
  },
  {
    id: "adjust-points",
    label: "Adjust points",
    href: "/points",
    permission: "points:adjust",
  },
  {
    id: "open-billing",
    label: "Open billing",
    href: "/billing",
    permission: "billing:view",
  },
  {
    id: "my-profile",
    label: "Review my profile",
    href: "/profile",
  },
];

function QuickActionButton({ action }: { action: QuickAction }) {
  return (
    <Button
      key={action.id}
      variant="outline"
      className="w-full justify-between"
      asChild
    >
      <Link href={action.href} aria-label={action.label}>
        <span>{action.label}</span>
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

export default function Home() {
  return (
    <>
      <OverviewStatCards />

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <ActivityFeed />

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Quick actions</CardTitle>
            <CardDescription>
              Shortcuts to the workflows your role unlocks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quickActions.map((action) =>
              action.permission ? (
                <Can key={action.id} permission={action.permission}>
                  <QuickActionButton action={action} />
                </Can>
              ) : (
                <QuickActionButton key={action.id} action={action} />
              ),
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
