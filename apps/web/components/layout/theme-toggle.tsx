"use client";

import { useEffect, useState } from "react";
import { Moon, Monitor, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const THEME_LABEL = {
  light: "Light",
  dark: "Dark",
  system: "System",
} as const;

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const resolvedTheme = isMounted ? theme : "system";

  const icon =
    resolvedTheme === "dark" ? (
      <Moon className="h-4 w-4" />
    ) : resolvedTheme === "light" ? (
      <Sun className="h-4 w-4" />
    ) : (
      <Monitor className="h-4 w-4" />
    );

  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Theme mode: ${THEME_LABEL[resolvedTheme as keyof typeof THEME_LABEL] ?? "System"}`}
            >
              {icon}
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent>
          <p>Toggle theme</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          System
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
