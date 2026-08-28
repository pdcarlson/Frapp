# Rush / Recruitment / Intake

The recruitment module manages prospective members from first contact through bid/vote to acceptance. Its surfaces follow the shared ops integration pattern — see [`integrations.md`](integrations.md).

## Vocabulary

- The module name and all member-facing copy render through the chapter's **vocabulary helper**, never a hardcoded "rush." The substitutable term is configured per chapter (rush / recruitment / intake) in the settings Org tab. The same vocabulary term names the slash command, the system channel label, and the dashboard.

## Candidates

- A candidate is a prospective member tracked through the recruitment process. Candidates are added via the `/<vocab> add @candidate` slash command (e.g. `/rush add`, `/recruitment add`, `/intake add`).
- The candidate card (rich renderer) shows the candidate plus their current voting and bid status.

## Voting and Bids

- Members vote on a candidate via `/<vocab> vote <candidate-id>` and extend a bid via `/<vocab> bid @candidate`.
- Vote and bid actor identity comes from the authenticated session (`viewer.id`), never a client-supplied id — see the actor-identity rule in [`integrations.md`](integrations.md).

## Funnel

- The optional dashboard renders a candidate **funnel by stage**. The funnel's stage keys derive from chapter config / the workflow definition, not a hardcoded stage array, so a chapter's customized stages drive the columns with no code change.
