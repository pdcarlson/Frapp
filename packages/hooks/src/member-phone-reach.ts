"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PhoneReach } from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export interface MemberPhoneReach {
  /**
   * `chapter` for officers who can invite members or manage roles; `self`
   * for anyone else, who is served only their own entry.
   */
  scope: "chapter" | "self";
  /** Each member's reach, keyed by `users.id`. */
  byUserId: ReadonlyMap<string, PhoneReach>;
}

/**
 * Whether Frapp's notifications reach each member's phone, from
 * `GET /v1/members/phone-reach`: the Directory's "Phone app" filter and the
 * member detail row, the same on web and the phone. The server decides who
 * sees whom, so a member only ever receives their own entry.
 */
export function useMemberPhoneReach() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const query = useQuery({
    // Not under `["members", …]`: role, class and invite edits invalidate
    // that prefix, and none of them can change whose phone a push reaches.
    queryKey: ["phone-reach", chapterId],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/members/phone-reach", {
        signal,
      });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    enabled: !!chapterId,
  });
  const reach = useMemo<MemberPhoneReach | null>(() => {
    if (!query.data) return null;
    return {
      scope: query.data.scope,
      byUserId: new Map(
        query.data.members.map((member) => [member.user_id, member]),
      ),
    };
  }, [query.data]);
  return { ...query, reach };
}
