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

### 7.2 Live Mode (Production)

Same steps but toggle to Live mode in Stripe dashboard. Requires business verification.

**Live mode is a separate object graph.** Its webhook endpoints, products and prices are
distinct from test mode's, and a test-mode endpoint can be registered against the
production URL — one is, today. So "an endpoint exists at `api.frapp.live`" seen in test
mode says nothing about live mode, and the six event types above must be enabled again,
by hand, on the live endpoint. Agent sessions cannot check this: their Stripe access is
test-mode only.

---

## 7A. Discord Application Setup (the archive importer's bot path)

**Optional.** Skip it entirely and the DiscordChatExporter upload flow still
works — the wizard simply does not offer "Connect Discord". What it is not is a
fallback that switches on: the two paths are independent, and the upload one is
what keeps working if Discord ever throttles one shared bot across every chapter.

Everything below is **provider-side configuration that no repo state creates and
no CI check can detect.** Two of the five steps produce Infisical values (step 2
the bot token, step 3 the OAuth pair); the other three produce nothing a repo can
see — step 1 an application, step 4 a text entry, step 5 a toggle — and getting
any of those three wrong fails at runtime with an error that names neither this
page nor the setting.

1. **Create the application.** https://discord.com/developers/applications → New
   Application, owned by **Frapp**, not by a chapter. Name the application and
   its bot **Frapp**: Discord's consent screen shows the application's name, the
   server's member list shows the bot's, and the web import wizard tells an admin
   to add "the Frapp bot". *2026-09-24: the application was named "Signet" when
   it was last observed (the 2026-09-15 note in step 4 below). Renaming it and its bot to Frapp is the
   owner's step on the day ADR-25 step 4
   ([#2579](https://github.com/pdcarlson/Frapp/issues/2579)) merges: General
   Information → Name, and Bot → Username.* A separate application per
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

   It is `API_URL` + `/v1/discord/connect/callback` and Discord matches it
   **character for character**. Get it wrong and every admin who clicks "Add to
   Server" gets Discord's own **`Invalid OAuth2 redirect_uri`** page, and the
   callback is never reached — Discord rejects at the authorize URL, before the
   consent screen, so the admin never even picks a server. The path is pinned in
   code as `DISCORD_CALLBACK_PATH`
   (`apps/api/src/application/services/discord-oauth.service.ts`); this table is
   the third copy, and the one that drifts.

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
consent screen names the application (_Frapp_) — it does not name the chapter the
connection will be bound to, and it cannot. Frapp closes that gap on its own side:
the callback parks the server and links nothing, and an authenticated request
scoped to the chapter is what activates it. So a Frapp officer cannot send their authorize
link to somebody else's Discord admin and end up reading that server. Do not
"simplify" the flow by binding on the callback.

**Verify after setup — and know what the check does not cover.**
`GET /v1/discord/availability` (as an officer with `channels:manage`) must answer
`{"available": true}`. If it answers `false`, one of the three secrets or
`API_URL` / `APP_URL` is unset in that environment — see
[`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md) § API-Only Settings.

**`available: true` is not "Discord is set up".** `DiscordOAuthService.isAvailable()`
reads the five variables named above and nothing else; it makes no call to
Discord, so it cannot observe step 4 or step 5 at all. Neither is detected
*before* an admin tries to use the flow: step 4 is never visible to Frapp, and
step 5 only becomes visible once an import is already running. A fully green
availability check therefore sits happily on top of either one being wrong. The
three failures look nothing alike:

| What is wrong                        | How it presents                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A secret or `API_URL` / `APP_URL` unset | `availability` answers `false`, and the wizard still shows the "Connect Discord" card — greyed out, reading "Not available in this environment", not hidden. Only `POST /v1/discord/connect` and `POST /v1/discord/connect/confirm` 503; `GET`/`DELETE /v1/discord/connection` still answer 200, so a clean 200 there is **not** evidence the secrets are set.                    |
| Redirect URI not registered (step 4) | Wizard offers "Connect Discord" normally and `POST /v1/discord/connect` **succeeds** — it mints a `discord_oauth_states` row and returns the authorize URL. The browser then hits Discord's **`Invalid OAuth2 redirect_uri`** page and the *callback* never fires, so there is no `?discord=` code and nothing on the callback path in logs or Sentry. Server-side evidence does exist: a pile of `discord_oauth_states` rows with `consumed_at IS NULL` and no matching `discord_connections` row is the fingerprint. Live, the `redirect_uri=` parameter in that page's address bar is the fastest check — compare it to the table above character for character. |
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

So the check that actually proves step 4 is clicking **Add to Server** once per
environment and getting Discord's consent screen instead of its error page. It
proves step 4 and nothing else — the consent screen renders happily with the
Message Content Intent off. Confirm step 5 by eye in the portal.

---
