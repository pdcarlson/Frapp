"use client";

import { useEffect } from "react";
import { markWhatsNewSeen } from "@/lib/whats-new";

/** Records the newest entry as seen once the What's new page is on screen. */
export function WhatsNewSeen() {
  useEffect(() => {
    markWhatsNewSeen();
  }, []);
  return null;
}
