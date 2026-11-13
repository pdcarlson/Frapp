import type { ReactNode } from "react";
import { AskConversationProvider } from "@repo/hooks";
import { useAuthSession } from "@/lib/auth-session";
import { AskKeptProvider } from "./kept-targets";

/**
 * The one Ask conversation on the phone (`spec/behavior/ai.md` § One
 * conversation), held above every place that shows it: the Ask sheet from
 * the bar, the same sheet on the `frapp://ask` route, and a channel a member
 * asked `@Frapp` from (#4713). A turn asked in one is there in the others,
 * and so is what an officer changed on a waiting card (`kept-targets.tsx`).
 *
 * It is the signed-in member's, in the chapter they are in: either changing
 * starts it over, so nothing asked as one account or in one chapter is shown
 * in another.
 */
export function AskConversationHost({ children }: { children: ReactNode }) {
  const { userId, chapterId } = useAuthSession();
  const scope = `${userId ?? ""}:${chapterId ?? ""}`;
  return (
    <AskConversationProvider scope={scope}>
      <AskKeptProvider scope={scope}>{children}</AskKeptProvider>
    </AskConversationProvider>
  );
}
