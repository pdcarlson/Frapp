"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/lib/hooks/use-toast";

/** How long a Copy button reads "Copied" before it goes back. */
export const COPIED_RESET_MS = 2000;

/**
 * A Copy button's behaviour: write the text, read "Copied" for two seconds,
 * and say so when the browser refuses the clipboard.
 *
 * Each press restarts the two seconds, and nothing fires after the component
 * is gone. Before this hook the onboarding invite link had its own copy of
 * the logic whose timer did neither, so a second press reverted early.
 *
 * `failureDescription` tells the person how to copy by hand, which depends on
 * what the button copies ("Select the link and copy it manually.").
 */
export function useCopyToClipboard(failureDescription: string) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        if (!mounted.current) return;
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
      } catch {
        toast({
          title: "Copy failed",
          description: failureDescription,
          variant: "destructive",
        });
      }
    },
    [failureDescription, toast],
  );

  return { copied, copy };
}
