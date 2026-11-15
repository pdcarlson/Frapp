"use client";

import * as Sentry from "@sentry/nextjs";
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { createReportOnce } from "@repo/observability";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import { isChunkLoadError } from "@/lib/chunk-load-error";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";

/*
 * The loader behind every chat panel whose code is split out of the first
 * download (#3716): what a failed load shows, and a fresh attempt after one.
 * Why it is not `next/dynamic` is in `deferred-panels.tsx`. Kept apart from
 * the panels so a module a panel itself imports (a message row, for its edit
 * box) can use it without an import cycle back through the panels (#5050).
 */

/** One report per error, however often the member retries it. */
const reportPanelLoadFailure = createReportOnce<{ isChunkError: boolean }>(
  (error, { isChunkError }) => {
    Sentry.captureException(error, {
      tags: { chunk_load_error: isChunkError, surface: "chat-deferred-panel" },
    });
  },
);

type LoadFailure = { error: unknown; retry: () => void };

/** What a panel shows in its own place when its code couldn't load. */
function PanelLoadFailed({ error, retry }: LoadFailure) {
  // `linkOnline`, not `isOffline`, for the reason `SegmentError` gives: an API
  // outage on a working link is not the member being offline.
  const { linkOnline } = useNetwork();
  const isChunkError = isChunkLoadError(error);
  useEffect(() => {
    reportPanelLoadFailure(error, { isChunkError });
  }, [error, isChunkError]);
  if (isChunkError && linkOnline) {
    return (
      <InlineNote className="px-4 py-3">
        Frapp was updated while this tab was open.{" "}
        <InlineNoteAction onClick={() => window.location.reload()}>
          Reload
        </InlineNoteAction>
      </InlineNote>
    );
  }
  return (
    <InlineNote className="px-4 py-3">
      {linkOnline
        ? "Couldn't load this."
        : "You're offline, so this couldn't load."}{" "}
      <InlineNoteAction onClick={retry}>Try again</InlineNoteAction>
    </InlineNote>
  );
}

/**
 * A dialog's failure has no place of its own to draw in, so it closes and
 * says why in a toast. The next open tries again.
 */
function DialogLoadFailed({
  error,
  retry,
  onOpenChange,
}: LoadFailure & { onOpenChange?: (open: boolean) => void }) {
  const { linkOnline } = useNetwork();
  const { toast } = useToast();
  const isChunkError = isChunkLoadError(error);
  useEffect(() => {
    reportPanelLoadFailure(error, { isChunkError });
    toast({
      title: "Couldn't open this",
      description:
        isChunkError && linkOnline
          ? "Frapp was updated while this tab was open. Reload the page to open it."
          : linkOnline
            ? "Try again in a moment."
            : "You're offline. Try again once you're back.",
    });
    onOpenChange?.(false);
    retry();
    // Once per failure: the parent's handlers are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  return null;
}

type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A deferred panel, plus `adopt`, which hands it code a preload already
 * fetched: an instance mounted after that draws it straight away, with no
 * Suspense pass (React holds a revealed fallback for 300 ms).
 */
export type DeferredPanel<P extends object> = ComponentType<P> & {
  adopt: (Component: ComponentType<P>) => void;
};

/**
 * A panel whose code loads on first render, with a fresh attempt after a
 * failure. A `dialog` loads only while open, so a closed dialog whose load
 * failed doesn't keep retrying behind the scenes. `Fallback`, given the same
 * props, draws while the code loads (nothing draws otherwise).
 */
export function deferredPanel<P extends object>(
  load: () => Promise<ComponentType<P>>,
  kind: "slot" | "dialog",
  Fallback?: ComponentType<P>,
): DeferredPanel<P> {
  let loaded: ComponentType<P> | null = null;

  function Attempt({ props, retry }: { props: P; retry: () => void }) {
    // One lazy per attempt, so a rejection is never the last word.
    const [Lazy] = useState(() =>
      lazy(async () => {
        try {
          const Component = await load();
          loaded = Component;
          return { default: Component };
        } catch (error) {
          const Failed = (failedProps: P) =>
            kind === "dialog" ? (
              <DialogLoadFailed
                error={error}
                retry={retry}
                onOpenChange={(failedProps as DialogProps).onOpenChange}
              />
            ) : (
              <PanelLoadFailed error={error} retry={retry} />
            );
          return { default: Failed };
        }
      }),
    );
    return (
      <Suspense fallback={Fallback ? <Fallback {...props} /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  }

  function DeferredPanel(props: P) {
    const [attempt, setAttempt] = useState(0);
    // Which path this instance draws through is fixed at mount. Switching from
    // the lazy to the loaded component once the code arrives would change the
    // element type and remount the panel, losing what the member had typed.
    const [Loaded] = useState(() => loaded);
    // A dialog whose load failed waits for its next open to try again, so a
    // parent that doesn't close it can't loop the attempt and the toast.
    const [failedOpen, setFailedOpen] = useState(false);
    const open = (props as DialogProps).open === true;
    if (failedOpen && !open) setFailedOpen(false);
    if (Loaded) return <Loaded {...props} />;
    if (kind === "dialog") {
      // A dialog stays mounted once loaded, so it can animate closed.
      if (failedOpen || (!loaded && !open)) return null;
    }
    return (
      <Attempt
        key={attempt}
        props={props}
        retry={() => {
          if (kind === "dialog") setFailedOpen(true);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return Object.assign(DeferredPanel, {
    adopt: (Component: ComponentType<P>) => {
      loaded ??= Component;
    },
  });
}
