import { AlertTriangle, FolderOpen, LoaderCircle } from "lucide-react";
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
}: {
  title: string;
  description: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center">
      <FolderOpen className="h-6 w-6 text-muted-foreground" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
      {actionLabel ? <Button variant="outline">{actionLabel}</Button> : null}
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
