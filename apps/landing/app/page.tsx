import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";
import { joinClassNames } from "@repo/ui/utils";

export default function Home() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "/";
  const loginUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/login`
    : "/login";

  const baseCtaClassName =
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring h-10 px-4 py-2";

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader className="space-y-4">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
            Frapp
          </p>
          <CardTitle className="text-4xl sm:text-5xl">
            The Operating System for Greek Life
          </CardTitle>
          <CardDescription className="max-w-xl text-base">
            Replace Discord, OmegaFi, and Life360 with one integrated platform
            for chapter operations, communication, events, and accountability.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link
            href={appUrl}
            className={joinClassNames(
              baseCtaClassName,
              "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            Get Started
          </Link>
          <Link
            href={loginUrl}
            className={joinClassNames(
              baseCtaClassName,
              "border border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            Log In
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
