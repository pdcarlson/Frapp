"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { dmChannelIdOf, useGetOrCreateDm } from "@repo/hooks";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { chatDeepLink } from "@/lib/chat/chat-links";
import {
  START_DM_FAILED_FALLBACK,
  START_DM_FAILED_TITLE,
} from "@/lib/chat/start-dm";

/**
 * A profile's Message button: opens (or creates) the 1:1 DM with
 * `targetUserId` and goes there. Shared by the member sheet and chat's
 * profile popout (#4593), so the two can't drift.
 *
 * `canMessage` is false on the viewer's own profile (`POST /v1/channels/dm`
 * doesn't reject a self-DM) and while `/v1/users/me` is still loading, since
 * a null viewer id would let one through. A request still in flight when the
 * surface has moved on to another member is dropped rather than navigating
 * the viewer to the wrong conversation.
 */
export function useMessageMember(
  targetUserId: string | null,
  onOpened: () => void,
) {
  const dmMutation = useGetOrCreateDm();
  const router = useRouter();
  const { toast } = useToast();
  const { userId: currentUserId, isLoading: isCurrentUserLoading } =
    useFrappUser();
  const targetRef = useRef(targetUserId);
  useEffect(() => {
    targetRef.current = targetUserId;
  }, [targetUserId]);

  const canMessage =
    !!targetUserId && !isCurrentUserLoading && targetUserId !== currentUserId;

  async function startMessage() {
    if (!canMessage || !targetUserId) return;
    const requestedUserId = targetUserId;
    try {
      const dm = await dmMutation.mutateAsync({ member_id: requestedUserId });
      if (targetRef.current !== requestedUserId) return;
      const channelId = dmChannelIdOf(dm);
      if (!channelId) {
        throw new Error("No channel id returned");
      }
      onOpened();
      router.push(chatDeepLink({ channelId }));
    } catch (error) {
      if (targetRef.current !== requestedUserId) return;
      toast({
        title: START_DM_FAILED_TITLE,
        description: getErrorMessage(error, START_DM_FAILED_FALLBACK),
        variant: "destructive",
      });
    }
  }

  return {
    canMessage,
    currentUserId,
    startMessage,
    isPending: dmMutation.isPending,
  };
}
