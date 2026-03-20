"use client";

import "./globals.css";
import { Button } from "@repo/ui/button";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="p-8 text-center">
          <h2>Something went wrong</h2>
          <Button onClick={() => reset()} className="mt-4">
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
