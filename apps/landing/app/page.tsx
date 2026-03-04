import Link from "next/link";
import { Button } from "@repo/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/card";

export default function Home() {
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
          <Link href={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}>
            <Button>Get Started</Button>
          </Link>
          <Link href={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}>
            <Button variant="secondary">Log In</Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
