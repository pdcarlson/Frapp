"use client";

import { AlertTriangle, FolderOpen, LoaderCircle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadingState({ message = "Loading data..." }: { message?: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center">
      <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center">
      <FolderOpen className="h-6 w-6 text-muted-foreground" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <Button variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = "Unable to load data",
  description = "Please retry in a moment.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-card p-6 text-center">
      <AlertTriangle className="h-6 w-6 text-destructive" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function OfflineState({
  title = "You're offline",
  description = "Reconnect to sync chapter data and retry this workflow.",
  actionLabel = "Retry now",
  onRetry,
}: {
  title?: string;
  description?: string;
  actionLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-6 text-center">
      <WifiOff className="h-6 w-6 text-primary" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
