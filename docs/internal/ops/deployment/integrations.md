## 7. Stripe Setup

### 7.1 Test Mode (Staging)

1. Go to https://dashboard.stripe.com/test → Developers → API keys.
2. Copy `sk_test_...` → use as `STRIPE_SECRET_KEY` for staging API.
3. Create a webhook endpoint pointing at `https://api-staging.frapp.live/v1/webhooks/stripe`,
   and enable **exactly these six event types**:

   ```
   checkout.session.completed
   customer.subscription.updated
   customer.subscription.deleted
   invoice.paid
   payment_intent.succeeded
   payment_intent.payment_failed
   ```

   This list is `HANDLED_WEBHOOK_EVENT_TYPES` in
   [`apps/api/src/infrastructure/billing/stripe-webhook-events.ts`](../../../../apps/api/src/infrastructure/billing/stripe-webhook-events.ts),
   which is the source of truth — re-read it rather than trusting this copy, and
   update this step if it ever changes. Anything not on the list is dropped by the
   allowlist before the database is touched, so enabling extras is noise rather than
   risk; enabling **fewer** is the failure that keeps happening. Every endpoint
   registered so far has been missing at least one type, each a different one
   (#1978, #2285), because this step used to name none of them. `StripeWebhookConsistencyService`
   warns at boot when the registered endpoint is missing one — read the API's startup
   log after creating an endpoint, and do not treat a green deploy as confirmation.

4. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`.
5. Create a Product + Price → copy price ID → `STRIPE_PRICE_ID`.
6. Save the customer portal settings (Settings → Billing → Customer portal), even
   if you keep Stripe's defaults. The API opens a portal session with no
   `configuration` (`createCustomerPortalSession` in
   [`stripe.service.ts`](../../../../apps/api/src/infrastructure/billing/stripe.service.ts)),
   so Stripe uses the mode's saved default and refuses the session when there is
   none, and "Manage billing" 503s. Whether test mode has one saved has not been
   checked: [#2762](https://github.com/pdcarlson/Frapp/issues/2762).

### 7.2 Live Mode (Production)

Same steps but toggle to Live mode in Stripe dashboard. Requires business verification.

**Live mode is a separate object graph.** Its webhook endpoints, products and prices are
distinct from test mode's, and a test-mode endpoint can be registered against the
production URL — one is, today. So "an endpoint exists at `api.frapp.live`" seen in test
mode says nothing about live mode, and the six event types above must be enabled again,
by hand, on the live endpoint. Agent sessions cannot check this: their Stripe access is
test-mode only.

### 7.3 What customers see (live mode)

Checkout, the customer portal, receipts and Stripe's emails show what the dashboard
holds here. No repo state sets it and no check reads it back. The owner set these on
2026-09-24, and this table records them from the owner's dashboard screenshots
([#2669](https://github.com/pdcarlson/Frapp/issues/2669)). Re-read the dashboard to refresh it. Test mode
was not matched to it; of these settings, staging depends only on the portal (§ 7.1 step 6).

| Where | Field | Value |
| --- | --- | --- |
| Settings → Business → Business details → Public details | Public business name | Frapp (the value before was not reported) |
| Business details → Public details | Statement descriptor | `FRAPP.LIVE` (the value before was not reported) |
| Business details → Business information | Business website | `https://www.frapp.live`, because the apex only redirects there ([`vercel.md`](vercel.md)) |
| Business details → Public details | Support email | `team@frapp.live`, the address the landing, Privacy and Support pages publish |
| Business details → Public details | Customer support, privacy and terms URLs | Set. The portal links `https://www.frapp.live/terms` and `https://www.frapp.live/privacy` from them. |
| Business details → Public details | Support phone and address | Set to the owner's own; not copied here |
| Branding | Icon | `packages/brand-assets/assets/signet-emblem-B-1024.png` (the crest on its charcoal tile) |
| Branding | Logo | **Empty on purpose.** `frapp-lockup.svg` still draws the "Signet" wordmark until ADR-25 step 5 ([#2580](https://github.com/pdcarlson/Frapp/issues/2580)) renames it. Upload the lockup once that step lands. |
| Branding | Brand color / accent color | `#1A1A1A` (the mark field) / `#EFB63B` (house gold), per [`brand-identity.md` § 2](../../../../spec/ui/brand-identity.md#2-the-mark) |
| Billing → Customer portal | Features | Stripe's defaults: update payment method, invoice history, update billing info, cancel. Updating the payment method is how a `past_due` chapter recovers ([`billing.md`](../../../../spec/behavior/billing.md)), and Billing promises invoices ([`surfaces.md`](../../../../spec/product/surfaces.md)). The portal header and redirect link are empty, because the API passes `return_url` on every session. |
| Business → Customer emails | Successful payments, refunds | On (were off) |
| Billing → Subscriptions and emails | Trial-ends reminder (7 days), upcoming renewals, expiring cards, card payment failures, bank debit failures | All on (all were off). The trial reminder matters because every new chapter starts on a trial (`TRIAL_PERIOD_DAYS` in `stripe.service.ts`). |
| Billing → Subscriptions and emails | Payment method updates | A link to a Stripe-hosted page (was "mix of both (Legacy)", with every custom link pointing at the `www.frapp.live` homepage) |
| Billing → Subscriptions and emails | Include a link for customers to manage their subscriptions | On (was off) |

---

## 7A. Discord Application Setup (the archive importer's bot path)

**Optional.** Skip it entirely and the DiscordChatExporter upload flow still
works — the wizard simply does not offer "Connect Discord". What it is not is a
fallback that switches on: the two paths are independent, and the upload one is
what keeps working if Discord ever throttles one shared bot across every chapter.

Everything below is **provider-side configuration that no repo state creates and
no CI check can detect.** Two of the five steps produce Infisical values (step 2
the bot token, step 3 the OAuth pair); the other three produce nothing a repo can
see — step 1 an application, step 4 a text entry, step 5 a toggle. The running
API checks steps 2 to 4 against Discord's own record of the application (see
"Verify after setup" below); step 5 it cannot see, and getting it wrong fails at
runtime with an error that names neither this page nor the setting.

1. **Create the application.** https://discord.com/developers/applications → New
   Application, owned by **Frapp**, not by a chapter. Name the application and
   its bot **Frapp**: Discord's consent screen shows the application's name, the
   server's member list shows the bot's, and the web import wizard tells an admin
   to add "the Frapp bot". *2026-09-24: the owner renamed the application
   (General Information → Name) and its bot (Bot → Username) from Signet to
   Frapp, and reported both on [#2669](https://github.com/pdcarlson/Frapp/issues/2669).* A separate application per
   environment is recommended so a staging mistake cannot read production
   chapters' servers. **That recommendation is not currently followed** —
   staging and production were observed sharing one application, so the staging
   bot token is also the production one. (Local was not checked either way.)
   Step 4 spells out what was observed and how, and
   [#2321](https://github.com/pdcarlson/Frapp/issues/2321) is where that gets
   decided rather than left implied.
2. **Bot token.** Bot → Reset Token → copy (shown once) → Infisical
   `DISCORD_BOT_TOKEN`. **One global value per environment, not one per chapter.**

   > ⚠️ **While environments share an application, Reset Token is a
   > cross-environment destructive action.** A Discord application has one bot
   > and one valid token at a time, so resetting it to set up *any* environment
   > invalidates the token every other environment on that application is using.
   > Doing this for local or staging today would break production's importer
   > with Discord 401s, and nothing in the product would name the reset as the
   > cause. Check step 4's observation before clicking it.

3. **OAuth2 credentials.** OAuth2 → copy Client ID → `DISCORD_CLIENT_ID`; Reset
   Secret → copy → `DISCORD_CLIENT_SECRET`. The secret is what signs the
   server-to-server code exchange, which is the step that proves the authorizing
   human holds Manage Server on the guild — without it that fact would have to be
   taken from the browser, which the flow must never do. **Reset Secret carries
   the same cross-environment hazard as Reset Token above**: one secret per
   application, so resetting it for one environment breaks the connect flow in
   every other environment sharing that application until each is updated.
4. **Register the redirect URI** — OAuth2 → Redirects → Add, **exactly**:

   | Environment | Redirect URI                                                 |
   | ----------- | ------------------------------------------------------------ |
   | local       | `http://localhost:3001/v1/discord/connect/callback`          |
   | staging     | `https://api-staging.frapp.live/v1/discord/connect/callback` |
   | production  | `https://api.frapp.live/v1/discord/connect/callback`         |

   It is `API_URL` (less any trailing `/v1`, which the API drops) +
   `/v1/discord/connect/callback`, and Discord matches it **character for
   character**. Get it wrong and every admin who clicks "Add to
   Server" gets Discord's own **`Invalid OAuth2 redirect_uri`** page, and the
   callback is never reached — Discord rejects at the authorize URL, before the
   consent screen, so the admin never even picks a server. The path is pinned in
   code as `DISCORD_CALLBACK_PATH`
   (`apps/api/src/application/services/discord-oauth.service.ts`); this table is
   the third copy, and the one that drifts, which is why the API compares the
   portal's list with the URI it actually sends rather than trusting it.
   *2026-09-28: staging's `API_URL` in Infisical was
   `https://api-staging.frapp.live/v1`, which built
   `/v1/v1/discord/connect/callback` until the API began dropping the suffix.*

   **The Redirects list belongs to an application, not to an environment.**
   Discord validates `redirect_uri` against the list of the application named by
   the `client_id` in the authorize URL, and the API builds that URL from its own
   `DISCORD_CLIENT_ID` — so a row is only ever consulted on the application whose
   client id *that* environment is configured with. A row added to an
   application some other environment uses does nothing for the environment you
   meant to fix. (Which is why the sharing described below matters: when two
   environments are on one application, one row already serves both — and when
   they are not, an identical-looking row on the wrong application is inert.)

   So register, on each application, a row for every environment whose
   `DISCORD_CLIENT_ID` points at it. An extra registered row an environment is
   not using yet is inert, so adding the next environment's row while you are
   already in the portal is free; what is not free is leaving one unregistered.

   Which environment points at which application is in
   [`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md) § API-Only Settings —
   read it before adding a row, because a row added to the wrong application is
   both useless and, if that application serves production, an isolation leak.

   **Staging and production share one application, despite what step 1
   recommends.** Two observations, both 2026-09-15:

   - Opening the Developer Portal OAuth2 page for application
     `1541430523090698250` (then named "Signet") — `https://discord.com/developers/applications/1541430523090698250/oauth2`
     — its Redirects list held exactly the `api-staging` and `api.frapp.live`
     rows, and no `localhost:3001` row.
   - That same client id appeared in the `client_id=` parameter of the authorize
     URL **production** served, read off the address bar of Discord's
     `Invalid OAuth2 redirect_uri` page.

   So production runs on the same application as staging, and therefore the same
   `DISCORD_BOT_TOKEN`: a Discord application has one bot user and one valid
   token at a time, so two environments on one client id cannot hold two working
   tokens. Step 1's isolation rationale ("a staging mistake cannot read
   production chapters' servers") is **not** in force.

   **What those two observations do not cover**, so do not read it here: which
   application local's `DISCORD_CLIENT_ID` names (unchecked — the missing
   `localhost` row is absence on *this* application only), and whether staging's
   and production's Infisical rows currently hold the same secret and token
   strings (a shared application means only one token *can* be valid, not that
   both rows hold it — a half-rotation would leave one environment on a dead
   string). Re-run the two observations above to refresh this, not the date.

   **How far the shared token actually reaches is an inference, not a
   measurement.** The token is bounded by where the bot is installed and what
   `66560` grants, and every read is scoped to `discord_connections.guild_id`
   via `requireGuildId(chapterId)` — a chapter that removed the bot keeps its row
   and grants nothing. Settling it means counting production chapters with a
   connection and checking the bot is still in those guilds. It matters for
   remediation: rotating the token does not cut access to a guild the bot is
   still installed in, which needs removing the install per guild.
   [#2321](https://github.com/pdcarlson/Frapp/issues/2321) tracks the decision to
   either split the applications or record the shared-application posture
   deliberately.

5. **Enable Message Content Intent** — Bot → Privileged Gateway Intents →
   Message Content Intent → on. This is **self-serve below 100 servers** and is
   separate from bot verification, which is not needed yet (revisit before that
   threshold). Without it Discord answers `200` with `content: ""` on every
   message a chapter's members wrote. The importer detects that and fails with a
   message naming this toggle rather than importing a decade of empty bubbles —
   but only turning it on makes an import actually work, and the detection is
   thresholded rather than absolute (see the table below, and #2317).

**Permissions.** The install requests View Channels + Read Message History and
nothing else (bitfield `66560`, pinned as `DISCORD_BOT_PERMISSIONS` in
`apps/api/src/domain/adapters/discord.interface.ts`). Do not widen it in the
portal: the bitfield in the authorize URL is what the consent screen shows a
chapter, and a read-only archiver has no business holding a permission that can
change anything in someone's server.

**One thing the portal cannot express, so it is worth knowing here.** Discord's
consent screen names the Discord application (_Frapp_, step 1) — it does not
name the chapter the connection will be bound to, and it cannot. Frapp closes that gap on its own side:
the callback parks the server and links nothing, and an authenticated request
scoped to the chapter is what activates it. So a Frapp officer cannot send their authorize
link to somebody else's Discord admin and end up reading that server. Do not
"simplify" the flow by binding on the callback.

**Verify after setup — and know what the check does not cover.**
`GET /v1/discord/availability` (as an officer with `channels:manage`) must answer
`{"available": true}`. If it answers `false`, either one of the three secrets or
`API_URL` / `APP_URL` is unset in that environment (see
[`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md) § API-Only Settings), or
Discord's record of the application shows steps 2 to 4 wrong, and the API's log
names which (table below).

**What `available` checks, and what it cannot.** `DiscordOAuthService.isAvailable()`
needs the five variables named above, then reads Discord's own record of the
application: `GET /applications/@me` under the bot token, once at boot, again
whenever a cached answer is more than ten minutes old (one minute when the last
answer was bad or unsettled), and fresh before every "Add to Server"
(`apps/api/src/application/services/discord-application-check.ts`). That record
settles steps 2 to 4, so a mistake in them withdraws the flow instead of sending
an admin to Discord's error page. Two limits:

- **Step 5 is invisible to it.** The Message Content Intent shows up only once
  an import is already running, so `available: true` says nothing about it.
- **Discord's answer may not list the redirects.** `redirect_uris` is optional
  on Discord's application object, and whether it comes back to a bot token has
  not yet been observed from a deployment. When it is absent the flow stays
  offered and the API logs `Discord application setup unchecked`, and step 4 is
  back to being checked by hand, as below. Which of the two a deployment got is
  the first Discord line in its boot log.

When Discord cannot be reached at all (a timeout, a 5xx, a rate limit) the flow
also stays offered, with the same warning: the guard failing is not the setup
failing. The failures look nothing alike:

| What is wrong                        | How it presents                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A secret or `API_URL` / `APP_URL` unset | `availability` answers `false`, and the wizard still shows the "Connect Discord" card — greyed out, reading "Not available in this environment", not hidden. Only `POST /v1/discord/connect` and `POST /v1/discord/connect/confirm` 503; `GET`/`DELETE /v1/discord/connection` still answer 200, so a clean 200 there is **not** evidence the secrets are set.                    |
| Redirect URI not registered (step 4) | `availability` answers `false` and the card greys out as above; `POST /v1/discord/connect` 503s before minting a state. The API logs `Connect Discord withdrawn. Discord application <id> has no OAuth2 redirect registered for <uri> … Registered: <list>` at error level, and Sentry gets one `Discord setup: redirect_unregistered` issue per change, not per request. Add the logged URI verbatim; the flow comes back within a minute, without a redeploy. **If Discord's answer carried no `redirect_uris`** (the limit above), the old presentation applies instead: `POST /v1/discord/connect` succeeds, the browser hits Discord's **`Invalid OAuth2 redirect_uri`** page, and the callback never fires. Its fingerprint is `discord_oauth_states` rows with `consumed_at IS NULL` and no matching `discord_connections` row, and the fastest live check is the `redirect_uri=` parameter in that page's address bar. |
| Bot token reset, or from another application (steps 2–3) | Same withdrawal, logged and reported as `Discord setup: bot_token_rejected` (Discord answered 401: someone clicked Reset Token, which while environments share an application breaks all of them) or `Discord setup: client_id_mismatch` (`DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` name different applications, so the bot an admin installs is not the one that reads). |
| Message Content Intent off (step 5)  | Connecting succeeds and channel and role mapping succeed. The import fails with an error naming this toggle (`MISSING_MESSAGE_CONTENT_INTENT_ERROR`) **only once a slice has seen 25 authored messages with no content, attachment or embed between them** (`MIN_AUTHORED_MESSAGES_FOR_CONTENT_CHECK`, `apps/api/src/domain/utils/discord-api-message.ts`). Under that threshold — a small or quiet archive — the import goes green and writes those messages empty. See the caveat below.                                  |

**Two caveats on that last row, because it is the one that can pass while wrong.**
The tally is cumulative across a slice and checked once per 100-message page
*before* that page is written, so rows written by earlier pages are already
committed when a later page trips it — an import that fails this way can still
have left empty rows behind, despite what the error text says. And the check
needs `withSubstance === 0`: a single message anywhere in the slice carrying an
embed or attachment latches it off for the rest of that slice. So **a green
import on a small test server is not proof the intent is on** — verify the
toggle in the portal directly. ([#2317](https://github.com/pdcarlson/Frapp/issues/2317)
tracks tightening the detector and correcting its error string.)

So the proof of step 4 is the boot log line `Discord application setup verified:
the redirect URI <uri> is registered`. Where the log says the setup is unchecked,
the proof is clicking **Add to Server** once in that environment and reaching
Discord's consent screen instead of its error page. Either proves step 4 and
nothing else — the consent screen renders happily with the
Message Content Intent off. Confirm step 5 by eye in the portal.

---
