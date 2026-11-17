# Google Cloud organization

Every Google Cloud project Frapp uses sits in the frapp.live organization (`1033325313086`), administered from `pdcarlson@frapp.live`. This page records how the organization is laid out and who can do what. What runs in each project is in that project's runbook: the API in [`cloud-run.md`](cloud-run.md), Google sign-in in [`supabase.md` § Auth OAuth providers](supabase.md#auth-oauth-providers-google-and-apple), and Calendar and Drive in [`integrations.md` § 7B](integrations.md#7b-google-calendar) and [§ 7C](integrations.md#7c-google-drive-folder).

Moving everything off the owner's personal Google account, and the rest of the clean-up, is tracked in [#5323](https://github.com/frapplive/Frapp/issues/5323).

## Layout

Read with `gcloud` from Cloud Shell on 2026-11-17. The folders, the four admin groups and the audit log export came from Google's guided organization setup, which also named the projects `cs-project-…`.

| Folder (id) | Project | Id | Used for |
| --- | --- | --- | --- |
| Common (`575917033023`) | Frapp sign-in | `signet-frapp` | Google sign-in's OAuth clients and the verified "Frapp" brand, plus Calendar connect's production client, "Frapp Calendar" (made 2026-11-13; staging's is not made yet) ([§ The sign-in project](#the-sign-in-project)) |
| Common | Frapp | `frapp-67722` | Firebase: Android push, and the Play upload service account ([`mobile.md`](mobile.md)) |
| Common | central-logging-monitoring | `cs-project-cob1stf1` | Holds the organization's audit log bucket ([§ Audit logs](#audit-logs)) |
| Production (`1053187101656`) | prod | `cs-project-nyit2x59` | Production API on Cloud Run, production Vertex AI |
| Non-Production (`59613721753`) | nonprod | `cs-project-6vw9f5xp` | Staging API on Cloud Run, staging Vertex AI |
| Development (`501304903226`) | development | `cs-project-un3otdnn` | Nothing yet |

A project ID never changes, so `signet-frapp` keeps its old ID. Members never see it: the consent screen shows the brand, and the client IDs carry only the project number (`661618060468`).

Billing: one account, "My Billing Account" (`0192F1-ED549B-AD9589`), upgraded from the free trial, with a $100 monthly budget alert (both read in the console on 2026-11-16, not re-read on 11-17). `signet-frapp` has no billing account linked, because sign-in and Calendar don't need one.

## Who can do what

Organization roles are granted to these Google Groups. Each role is also granted to `pdcarlson@frapp.live` directly, a copy the guided setup made; #5323 removes the direct copies once the groups are confirmed to hold the right people.

| Group | Main organization roles |
| --- | --- |
| `gcp-organization-admins@frapp.live` | Organization Admin, Folder Admin, Project Creator, Organization Policy Admin, Billing User |
| `gcp-security-admins@frapp.live` | Security Admin, folder IAM admin, Organization Policy Admin, logging and monitoring admin, Security Command Center admin |
| `gcp-billing-admins@frapp.live` | Billing Admin, Billing Account Creator |
| `gcp-logging-monitoring-admins@frapp.live` | Logging Admin, Monitoring Admin |

The whole `frapp.live` domain can also create projects and billing accounts.

Project roles are granted per project. `pdcarlson@frapp.live` owns `signet-frapp` and `frapp-67722`. The service accounts each project's runbook lists (for example [`cloud-run.md` § Identities](cloud-run.md#identities)) hold the rest.

## Organization policies that bite

The organization enforces about twenty constraints. These are the ones Frapp work runs into:

- **Only frapp.live accounts** (`iam.allowedPolicyMemberDomains`, customer `C01tug1x5`). An outside account, such as a personal Gmail, can't be granted a role on any project. The rule checks new grants only, so a grant that existed before a project joined the organization stays until someone removes it. Infisical's sync account needed a project-level exception in `nonprod` and `prod` ([`cloud-run.md` § Setup](cloud-run.md#setup-once-per-project)).
- **No service account key files** (`iam.disableServiceAccountKeyCreation` and `iam.managed.disableServiceAccountKeyCreation`). This applies in `signet-frapp` too since it joined. `nonprod` has a project-level exception to `iam.managed.disableServiceAccountKeyCreation`, made for the staging Vertex key while Render still served staging. Once that key is deleted ([`cloud-run.md` § Secrets](cloud-run.md#secrets)), remove the exception so `nonprod` inherits the rule again: `gcloud org-policies delete iam.managed.disableServiceAccountKeyCreation --project=cs-project-6vw9f5xp --billing-project=cs-project-6vw9f5xp`.
- Keys made before a project joined keep working, but a new one can't be made. That matters for `frapp-67722`: the Play upload account's key in EAS ([`mobile.md`](mobile.md)) can't be re-created there without a project-level exception like `nonprod`'s.
- **No public buckets** (`storage.publicAccessPrevention`, `storage.uniformBucketLevelAccess`).

To list them all: `gcloud org-policies list --organization=1033325313086 --billing-project=cs-project-6vw9f5xp`.

## Audit logs

The sink `org-level-logsink-1033325313086` copies every project's audit logs (admin activity, system events, data access and access transparency) into the bucket `1033325313086-logs` in `central-logging-monitoring`. [Logs Explorer for that project](https://console.cloud.google.com/logs/query?project=cs-project-cob1stf1) shows who changed what anywhere in the organization.

## The sign-in project

`signet-frapp` was created by the owner's personal Google account outside any organization. It was moved into the Common folder on 2026-11-17 (#5323) with `gcloud beta projects move`, after `pdcarlson@frapp.live` was made an Owner. A move like that keeps the project's ID and number, its OAuth clients and secrets, the verified brand, its enabled APIs and its project-level roles, so nothing in Supabase, Infisical or the apps changed. That list comes from Google's migration documentation, read on 2026-11-17. What was checked after the move is one Google sign-in on staging web, which went through (Supabase auth log, 15:46Z); that account had consented before, so it didn't exercise the consent screen, and nobody has re-read the Branding or Audience page since.

The move is one-way: only Google Cloud Customer Care can take a project back out of an organization.

Its consent screen was **External** before the move, and Google's documentation says a move changes only an Internal one. Keep it External. An organization project could switch to Internal, which would admit only frapp.live accounts and lock out every member.

Until #5323 finishes, the personal account is still an Owner of this project and the consent screen's user support email, and Search Console keeps a verification for it ([`vercel.md` § 4.4](vercel.md#44-dns-records-squarespace-domains)).
