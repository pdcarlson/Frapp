import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const highlights = [
  {
    title: "Real chapter auth",
    description: "Authenticate with Supabase and resume your staging session safely.",
    Icon: LockKeyhole,
  },
  {
    title: "Chapter-scoped operations",
    description: "Every in-scope API request is tied to the active chapter context.",
    Icon: ShieldCheck,
  },
  {
    title: "Live member workflows",
    description: "Create chapters, manage members, and redeem invites against the real database.",
    Icon: Users,
  },
] as const;

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    redirect("/home");
  }

  return (
    <main className="min-h-screen bg-muted/20 px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl justify-end">
        <ThemeToggle />
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-6xl flex-col justify-center gap-10 lg:flex-row lg:items-center">
        <section className="max-w-2xl space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
              Frapp staging
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Run live chapter admin workflows on the web.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Sign in with your real account, bootstrap a chapter, and work through the
              live member-management slice now landing in staging.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/sign-in">
                Sign in
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-up">Create account</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {highlights.map(({ title, description, Icon }) => (
              <Card key={title} className="border-border/70 shadow-sm">
                <CardHeader className="pb-3">
                  <CardDescription className="flex items-center gap-2 text-primary">
                    <Icon className="h-4 w-4" />
                    <span>{title}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Card className="w-full max-w-lg shadow-lg">
          <CardHeader>
            <CardTitle>What this milestone unlocks</CardTitle>
            <CardDescription>
              The current staging slice is optimized for a complete admin walkthrough.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <ol className="space-y-3">
              <li>1. Authenticate with a real Supabase-backed session.</li>
              <li>2. Create or resume your chapter context.</li>
              <li>3. Activate billing when invites need an active subscription.</li>
              <li>4. Open the live members directory and inspect profile detail.</li>
              <li>5. Generate and redeem invites to validate real chapter membership.</li>
            </ol>
            <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
              <p className="font-medium text-foreground">Already have an invite?</p>
              <p className="mt-1">
                Use the shared chapter link or redeem your token after signing in.
              </p>
              <Button asChild className="mt-3" variant="secondary">
                <Link href="/join">Join a chapter</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
