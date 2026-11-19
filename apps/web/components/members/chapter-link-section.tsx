"use client";

import { Link2, RotateCw, Trash2 } from "lucide-react";
import {
  CHAPTER_LINK_HINT,
  chapterLinkExpiryLabel,
  useChapterLink,
  useCreateChapterLink,
  useRevokeInvite,
  type InviteListItem,
} from "@repo/hooks";
import { EVERYONE_ROLE_NAME } from "@repo/validation";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/shared/section-label";
import { RowMenu } from "@/components/shared/row-menu";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { copyWhenReady } from "@/components/members/invite-composer";
import { buildJoinUrl } from "@/lib/invite-link";
import { getErrorMessage } from "@/lib/utils";

/**
 * The chapter link (#3353, Paul 2026-11-19: "One chapter link, 7 days"):
 * the one link an officer posts where the whole chapter will see it, the way
 * Discord's server invite and WhatsApp's group link work. Copy it, make a new
 * one (the old one stops working, as WhatsApp's Reset link does), or turn it
 * off. Mobile's Invite members screen has the same section, same words.
 */
export function ChapterLinkSection({
  gate,
  revokeGate,
  paused,
}: {
  /** Making a link: `@GraceBlocked`, like every invite mint. */
  gate: SubscriptionGate;
  /** Turning it off: `DELETE /invites/:id`, plain `@FreeTier`. */
  revokeGate: SubscriptionGate;
  /** Invite data didn't load; the panel already says so. */
  paused: boolean;
}) {
  const linkQuery = useChapterLink();
  const create = useCreateChapterLink();
  const revoke = useRevokeInvite();
  const { toast } = useToast();
  const link = linkQuery.data ?? null;
  const live = link?.status === "pending" ? link : null;

  async function copy(invite: InviteListItem) {
    const url = buildJoinUrl(window.location.origin, invite.token);
    try {
      await copyWhenReady(Promise.resolve(url));
      toast({ title: "Chapter link copied" });
    } catch {
      toast({
        title: "Couldn't copy the link",
        description: `Your browser blocked the clipboard. Copy it from here: ${url}`,
        variant: "destructive",
      });
    }
  }

  async function makeLink() {
    try {
      const made = await create.mutateAsync();
      await copy(made);
    } catch (error) {
      toast({
        title: "Couldn't make a chapter link",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function turnOff(invite: InviteListItem) {
    try {
      await revoke.mutateAsync(invite.id);
      toast({
        title: "Chapter link turned off",
        description: "Nobody can join with it now.",
      });
    } catch (error) {
      toast({
        title: "Couldn't turn off the link",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  const makeProps = gate.controlProps(paused || create.isPending);

  return (
    <section aria-labelledby="chapter-link-label" className="space-y-2">
      <SectionLabel id="chapter-link-label">Chapter link</SectionLabel>
      <p className="text-sm text-muted-foreground">{CHAPTER_LINK_HINT}</p>
      {live ? (
        <RowMenu
          label="More for the chapter link"
          entries={[
            {
              type: "item",
              key: "new",
              label: "Make a new link",
              icon: RotateCw,
              onSelect: () => void makeLink(),
              disabled: makeProps.disabled,
            },
            { type: "separator", key: "sep" },
            {
              type: "item",
              key: "off",
              label: "Turn off link",
              icon: Trash2,
              destructive: true,
              onSelect: () => void turnOff(live),
              disabled: revokeGate.controlProps(paused || revoke.isPending)
                .disabled,
            },
          ]}
        >
          {(menuButton) => (
            <div className="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card text-muted-foreground">
                <Link2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">Chapter link</p>
                <p className="truncate text-caption text-muted-foreground">
                  {[
                    chapterLinkExpiryLabel(live),
                    live.role === EVERYONE_ROLE_NAME
                      ? null
                      : `Joins as ${live.role}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void copy(live)}
              >
                Copy link
              </Button>
              {menuButton}
            </div>
          )}
        </RowMenu>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void makeLink()}
            {...makeProps}
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Make a chapter link
          </Button>
          {link?.status === "expired" ? (
            <p className="text-caption text-muted-foreground">
              {chapterLinkExpiryLabel(link)}.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
