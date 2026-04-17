"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, CircleDollarSign, LayoutDashboard, Star, Users } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type DashboardCommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const commands = [
  { icon: LayoutDashboard, label: "Go to Overview", shortcut: "G O", href: "/" },
  { icon: Users, label: "Go to Members", shortcut: "G M", href: "/members" },
  { icon: Users, label: "Go to Home", shortcut: "G H", href: "/home" },
  { icon: CalendarDays, label: "Go to Events", shortcut: "G E", href: "/events" },
  { icon: Star, label: "Go to Points", shortcut: "G P", href: "/points" },
  { icon: CircleDollarSign, label: "Go to Billing", shortcut: "G B", href: "/billing" },
];

export function DashboardCommandMenu({
  open,
  onOpenChange,
}: DashboardCommandMenuProps) {
  const router = useRouter();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search destinations and actions..." />
      <CommandList>
        <CommandEmpty>No matching commands.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {commands.map((command) => (
            <CommandItem
              key={command.href}
              onSelect={() => {
                router.push(command.href);
                onOpenChange(false);
              }}
            >
              <command.icon className="h-4 w-4" />
              <span>{command.label}</span>
              <CommandShortcut>{command.shortcut}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
