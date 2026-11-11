"use client";

import { useEffect } from "react";
import { useRecordWhatsNewSeen } from "@repo/hooks";
import { markWhatsNewSeen } from "@/lib/whats-new";

/**
 * Records the newest entry as seen once the What's new page is on screen, in
 * this browser and on the account (#4043).
 */
export function WhatsNewSeen() {
  const { mutate: recordOnAccount } = useRecordWhatsNewSeen();
  useEffect(() => {
    const version = markWhatsNewSeen();
    if (version) recordOnAccount(version);
    // Once per visit to the page; `mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
