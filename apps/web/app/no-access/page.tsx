import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "No access · Frapp",
  description: "You do not have access to the chapter dashboard right now.",
};

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-lg border-border shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            <LockKeyhole className="h-4 w-4 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">You don&apos;t have access yet</CardTitle>
          <CardDescription>
            Your account is signed in, but no chapter role has been assigned. A
            chapter admin needs to invite you or grant a role before you can
            use the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>Ask your chapter president to assign you a role.</li>
            <li>
              If you have an invite link, open it again to join the chapter
              with the invited role.
            </li>
            <li>
              If you recently lost access, sign out and back in — your
              permission set refreshes on the next request.
            </li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild variant="outline">
              <Link href="/join">Open invite link</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-in">Sign in to a different account</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
