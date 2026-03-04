import { Button } from "@repo/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Frapp Admin Dashboard</CardTitle>
          <CardDescription>
            The operating system for Greek Life chapter operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Dashboard foundation is active. Authentication and first admin workflows are
            being rolled out incrementally.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled>Sign in (in progress)</Button>
            <Button variant="secondary" disabled>
              Dashboard routes (in progress)
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
