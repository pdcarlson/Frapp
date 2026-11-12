"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useClaimPresidency,
  useCurrentChapter,
  useMembers,
  usePresidencyClaimStatus,
  useTransferPresidency,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RolesGlyph } from "@/components/layout/nav-glyphs";
import { ProfileSection } from "@/components/profile/profile-section";
import { useToast } from "@/lib/hooks/use-toast";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/utils";

/**
 * "This chapter needs a new President" recovery prompt
 * (spec/behavior/rbac.md § Presidency Transfer "Edge case").
 *
 * Rendered ABOVE the `roles:manage` gate on the Roles tab (`settings-roles-tab.tsx`),
 * not inside it: the eligible claimant is by definition not the (now-vacant)
 * President, and the default role pack only grants `roles:manage` to
 * President — so a member who needs to see this is exactly the member the
 * gate would otherwise hide it from.
 */
export function PresidencyClaimBanner() {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const chapterQuery = useCurrentChapter();
  const needsPresident = chapterQuery.data?.needs_president ?? false;
  const statusQuery = usePresidencyClaimStatus({ enabled: needsPresident });
  const claimPresidency = useClaimPresidency();

  if (!needsPresident) return null;

  async function handleClaim() {
    const confirmed = await confirm({
      title: "Claim the presidency?",
      description:
        "You will immediately hold every permission the President role carries. Only a future presidency transfer can move it again.",
      confirmLabel: "Claim presidency",
    });
    if (!confirmed) return;
    try {
      await claimPresidency.mutateAsync();
      toast({
        title: "Presidency claimed",
        description: "You are now the President of this chapter.",
      });
    } catch (error) {
      toast({
        title: "Couldn't claim presidency",
        description: getErrorMessage(
          error,
          "You may not be eligible, or someone else already claimed it.",
        ),
        variant: "destructive",
      });
    }
  }

  const eligible = statusQuery.data?.eligible ?? false;
  const nextRoleName = statusQuery.data?.next_role_name ?? null;

  let description: string;
  if (statusQuery.isLoading) {
    description = "Checking who can claim it...";
  } else if (statusQuery.isError) {
    // Distinct from "no eligible role was found" below — an error here means
    // eligibility genuinely could not be determined, not that it was checked
    // and came back empty. Conflating the two told an actually-eligible
    // officer to contact support over a transient network blip.
    description = "Couldn't check who can claim it. Retry in a moment.";
  } else if (eligible) {
    description = nextRoleName
      ? `As the highest-ranked remaining officer (${nextRoleName}), you can claim the presidency now.`
      : "You can claim the presidency now.";
  } else if (nextRoleName) {
    description = `Only a member holding the ${nextRoleName} role can claim it right now.`;
  } else {
    description =
      "No eligible officer role was found. Contact Frapp support to resolve this.";
  }

  return (
    <>
      {confirmDialog}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <RolesGlyph className="h-4 w-4 text-muted-foreground" />
            This chapter needs a new President
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {eligible ? (
          <CardFooter className="flex justify-end">
            <Button
              onClick={() => void handleClaim()}
              disabled={claimPresidency.isPending}
            >
              {claimPresidency.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Claim presidency
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </>
  );
}

/**
 * Hand the President role to another member. Only the current president can
 * do this (the API refuses anyone else), so it is shown only to a caller who
 * holds everything. Its own section rather than part of a role's page: it
 * moves a person, not a permission.
 */
export function TransferPresidencySection() {
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const membersQuery = useMembers();
  const transferPresidency = useTransferPresidency();
  const [target, setTarget] = useState("");
  const members = membersQuery.data ?? [];

  async function handleTransfer() {
    if (!target) return;
    const confirmed = await confirm({
      title: "Transfer presidency?",
      description:
        "The President role moves to the selected member immediately and is removed from you. Only the new president can move it again.",
      confirmLabel: "Transfer presidency",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await transferPresidency.mutateAsync({ target_member_id: target });
      toast({
        title: "Presidency transferred",
        description: "The President role moved successfully.",
      });
      setTarget("");
    } catch (error) {
      toast({
        title: "Couldn't transfer presidency",
        description: getErrorMessage(
          error,
          "Only the current president can transfer it.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <ProfileSection
      id="settings-transfer-presidency"
      title="Transfer presidency"
      hint="Hand the President role to another member. You lose it when they get it."
    >
      {confirmDialog}
      <div className="flex max-w-xl flex-wrap gap-2">
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger
            aria-label="Select the new president"
            className="min-w-0 flex-1"
          >
            <SelectValue placeholder="Select a member" />
          </SelectTrigger>
          <SelectContent>
            {members.map((member) => (
              <SelectItem
                key={member.id ?? member.user_id ?? "unknown"}
                value={String(member.id ?? member.user_id ?? "")}
              >
                {memberLabel(member.display_name, member.user_id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="destructive"
          onClick={() => void handleTransfer()}
          disabled={!target || transferPresidency.isPending}
        >
          {transferPresidency.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Transfer presidency
        </Button>
      </div>
    </ProfileSection>
  );
}
