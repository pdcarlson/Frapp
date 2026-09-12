# Rush / Recruitment / Intake

The recruitment module manages prospective members from first contact through bid/vote to acceptance. Its surfaces follow the shared ops integration pattern — see [`integrations.md`](integrations.md).

## Vocabulary

- The module name and all member-facing copy render through the chapter's **vocabulary helper**, never a hardcoded "rush." The substitutable term is configured per chapter (rush / recruitment / intake) in the settings Chapter tab (`?tab=org`). The same vocabulary term names the slash command, the system channel label, and the dashboard.

## Candidates

- A candidate is a prospective member tracked through the recruitment process. Candidates are added via the `/<vocab> add @candidate` slash command (e.g. `/rush add`, `/recruitment add`, `/intake add`).
- The candidate card (rich renderer) shows the candidate plus their current voting and bid status.

## Voting and Bids

- Members vote on a candidate via `/<vocab> vote <candidate-id>` and extend a bid via `/<vocab> bid @candidate`.
- Vote and bid actor identity comes from the authenticated session (`viewer.id`), never a client-supplied id — see the actor-identity rule in [`chat/integrations.md`](chat/integrations.md#slash-command-dispatch).
- Ballots store `voter_id` so a member can vote once. The card and GET projection publish `vote_count` and `viewer_has_voted` only — voter names are never listed (`wf_rush_anon_vote` is seed-default on). Vote is one-click, not a toggle.
- There is no `rush:*` permission. Slash and REST are gated by the `rush` module plus `members:view` (any chapter member).

## Funnel

- The optional dashboard renders a candidate **funnel by stage**. The funnel's stage keys derive from chapter config / the workflow definition, not a hardcoded stage array, so a chapter's customized stages drive the columns with no code change.
