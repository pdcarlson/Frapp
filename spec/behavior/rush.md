# Rush / Recruitment / Intake

The recruitment module manages prospective members from first contact through bid/vote to acceptance. Its surfaces follow the shared ops integration pattern — see [`integrations.md`](integrations.md).

A proposed upgrade (a pipeline, interest forms, eligibility and a council master list) is in [`ifc-recruitment.md`](ifc-recruitment.md). It is pending Paul, and this file still owns what recruitment does today.

## Vocabulary

- The module name and all member-facing copy render through the chapter's **vocabulary helper**, never a hardcoded "rush." The substitutable term is configured per chapter (rush / recruitment / intake / induction) in the settings Chapter tab (`?tab=org`), and defaults to the archetype's. The same vocabulary term names the slash command, the dashboard and the chat candidate card's eyebrow. Web and mobile resolve it with the one helper, `vocab()` and `memberViewVocabulary()` in `@repo/org-archetypes`.

## Candidates

- A candidate is a prospective member tracked through the recruitment process. Candidates are added via the `/<vocab> add @candidate` slash command (e.g. `/rush add`, `/recruitment add`, `/intake add`).
- The candidate card (a chat card on web and mobile) shows the candidate and who added them, plus their live vote count and bid status, and offers Vote and Extend bid inline. Its rules: [`chat/integrations.md` § Rich-message renderer registry](chat/integrations.md#rich-message-renderer-registry).

## Voting and Bids

- Members vote on a candidate via `/<vocab> vote <candidate>` and extend a bid via `/<vocab> bid <candidate>`, where each takes a candidate's id or name, or with the candidate card's Vote and Extend bid.
- Vote and bid actor identity comes from the authenticated session (`viewer.id`), never a client-supplied id — see the actor-identity rule in [`chat/integrations.md`](chat/integrations.md#slash-command-dispatch).
- Ballots store `voter_id` so a member can vote once. The card and GET projection publish `vote_count` and `viewer_has_voted` only — voter names are never listed. That holds whatever `wf_rush_anon_vote` says: the seed shows it as a Settings → Workflows switch, but nothing reads it ([#3439](https://github.com/pdcarlson/Frapp/issues/3439)). Vote is one-click, not a toggle.

## Permissions

Recruitment has its own permissions (#4070, 2026-11-10). Every REST route needs the `rush` module on, `members:view`, and the key for what it does. The slash commands and the card's buttons call those routes, so they carry the same gates.

| Permission | Lets a role | Gates today |
| --- | --- | --- |
| `rush:view` | Look up a prospect and see their bid status | `GET /v1/rush/candidates`, `GET /v1/rush/candidates/:id`; `/<vocab> vote` and `bid` by name, which look the prospect up first |
| `rush:add` | Add a prospect | `POST /v1/rush/candidates`, `/<vocab> add` |
| `rush:vote` | Vote on a prospect | `POST /v1/rush/candidates/:id/vote`, `/<vocab> vote`, the card's Vote |
| `rush:bid` | Record a bid | `POST /v1/rush/candidates/:id/bid`, `/<vocab> bid`, the card's Extend bid |
| `rush:view_results` | See how many votes a prospect has | Nothing yet: the count travels with every prospect read ([#4084](https://github.com/pdcarlson/Frapp/issues/4084)) |
| `rush:notes` | Write notes on a prospect | Nothing yet: notes are not built |
| `rush:manage` | Delete prospects and export the list | Nothing yet: neither is built |

**Default: today's behaviour** (Paul, 2026-11-10, [#4068](https://github.com/pdcarlson/Frapp/issues/4068) decision 12). Before these keys, any member with `members:view` could look up, add, vote and record a bid. So the seeded Member role holds every key but `rush:manage` (`RUSH_MEMBER_PERMISSIONS` in `@repo/validation`), and migration `20261111010000_rush_permissions_backfill.sql` gave the same six to every existing role and custom role that held `members:view` in a chapter with the module on. A chapter tightens it by taking a key off a role. `rush:manage` is held only through `*`.

Two things follow from where the keys were given:

- In a new chapter only Member is seeded with them, so someone whose only role is New Member or Alumni can't use recruitment until an officer grants it. In chapters that existed before the migration, those roles kept what they could do.
- A chapter that had the module off at the migration got no backfill. Turning it on later leaves recruitment to the President until the keys are granted.

Web and mobile do not read the keys yet: a role without `rush:vote` still sees the Vote button, and the API refuses it (#4084).

## Funnel

- The optional dashboard renders a candidate **funnel by stage**. The funnel's stage keys derive from chapter config / the workflow definition, not a hardcoded stage array, so a chapter's customized stages drive the columns with no code change.
