"use client";

import { Link2, RotateCw, Trash2 } from "lucide-react";
import {
  CHAPTER_LINK_HINT,
  chapterLinkExpiryLabel,
  useChapterLinkPicker,
  useChapterLinks,
  useCreateChapterLink,
  useInviteRoleChoices,
  useRevokeInvite,
  type InviteListItem,
} from "@repo/hooks";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/shared/section-label";
import { RowMenu } from "@/components/shared/row-menu";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { copyWhenReady } from "@/components/members/invite-composer";
import { buildJoinUrl } from "@/lib/invite-link";
import { getErrorMessage } from "@/lib/utils";

/**
 * Chapter links (#3353, Paul 2026-11-19: "One chapter link, 7 days"): links
 * an officer posts where the chapter will see them, the way Discord's server
 * invite and WhatsApp's group link work. Since #5633 ("Officer picks it per
 * link") each link joins at the role the officer picked, one live link per
 * role, so a pledge class link and a brothers link can be out at once.
 *
 * Each link is a row: its role, when it stops (or stopped) working, Copy
 * link while it works, and a menu to make a new one (that role's old link
 * stops working, as WhatsApp's Reset link does) or turn it off. An expired
 * link stays listed, so the officer sees why the link they posted is dead. Under them, **New link** with the role it
 * joins at, starting on the chapter's default. Mobile's Invite members screen
 * has the same section, same words.
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
  const linksQuery = useChapterLinks();
  const roles = useInviteRoleChoices();
  const { links, newRole, pick, label, replaces, canRemake } =
    useChapterLinkPicker(linksQuery.data, roles);
  const create = useCreateChapterLink();
  const revoke = useRevokeInvite();
  const { toast } = useToast();

  async function copy(invite: InviteListItem) {
    const url = buildJoinUrl(window.location.origin, invite.token);
    try {
      await copyWhenReady(Promise.resolve(url));
      toast({ title: `${label(invite.role)} link copied` });
    } catch {
      toast({
        title: "Couldn't copy the link",
        description: `Your browser blocked the clipboard. Copy it from here: ${url}`,
        variant: "destructive",
      });
    }
  }

  async function makeLink(role: string | null) {
    try {
      const made = await create.mutateAsync(role ? { role } : undefined);
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
        title: `${label(invite.role)} link turned off`,
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
  const revokeDisabled = revokeGate.controlProps(
    paused || revoke.isPending,
  ).disabled;

  return (
    <section aria-labelledby="chapter-link-label" className="space-y-2">
      <SectionLabel id="chapter-link-label">Chapter links</SectionLabel>
      <p className="text-sm text-muted-foreground">{CHAPTER_LINK_HINT}</p>
      {links.map((link) => (
        <RowMenu
          key={link.id}
          label={`More for the ${label(link.role)} link`}
          entries={[
            ...(canRemake(link.role)
              ? [
                  {
                    type: "item" as const,
                    key: "new",
                    label: "Make a new link",
                    icon: RotateCw,
                    onSelect: () => void makeLink(link.role),
                    disabled: makeProps.disabled,
                  },
                  { type: "separator" as const, key: "sep" },
                ]
              : []),
            {
              type: "item",
              key: "off",
              label: "Turn off link",
              icon: Trash2,
              destructive: true,
              onSelect: () => void turnOff(link),
              disabled: revokeDisabled,
            },
          ]}
        >
          {(menuButton) => (
            <div className="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card text-muted-foreground">
                <Link2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {label(link.role)}
                </p>
                <p className="truncate text-caption text-muted-foreground">
                  {chapterLinkExpiryLabel(link)}
                </p>
              </div>
              {link.status === "pending" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void copy(link)}
                >
                  Copy link
                </Button>
              ) : null}
              {menuButton}
            </div>
          )}
        </RowMenu>
      ))}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {roles.choices.length > 0 && newRole ? (
          <Select value={newRole} onValueChange={pick}>
            <SelectTrigger
              aria-label="Role the new link joins at"
              className="h-9 w-auto gap-1.5 border-transparent bg-transparent px-2 text-sm hover:bg-card-hover pointer-coarse:h-11"
            >
              <span className="text-muted-foreground">Joins as</span>
              <span className="font-semibold">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {roles.choices.map((choice) => (
                <SelectItem key={choice.id} value={choice.name}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void makeLink(newRole)}
          {...makeProps}
        >
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {replaces ? "Make a new link" : "New link"}
        </Button>
      </div>
    </section>
  );
}
