"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "./navigation";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.06] bg-[hsl(200,6%,7%)] md:flex">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15">
            <span className="block h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Frapp
          </span>
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Docs
          </span>
        </Link>
      </div>

      {/* Divider */}
      <div className="mx-5 border-t border-white/[0.06]" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <div className="space-y-7">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (pathname?.startsWith(item.href) && item.href !== "/");

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={[
                          "group relative flex items-center rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                        ].join(" ")}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
                        )}
                        {item.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/[0.06] px-5 py-4">
        <p className="text-[11px] text-muted-foreground/50">
          The Operating System for Greek Life
        </p>
      </div>
    </aside>
  );
}
