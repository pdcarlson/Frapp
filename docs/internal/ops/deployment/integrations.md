## 7. Stripe Setup

### 7.1 Test Mode (Staging)

1. Go to https://dashboard.stripe.com/test → Developers → API keys.
2. Copy `sk_test_...` → use as `STRIPE_SECRET_KEY` for staging API.
3. Create a webhook endpoint pointing at `https://api-staging.frapp.live/v1/webhooks/stripe`.
4. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`.
5. Create a Product + Price → copy price ID → `STRIPE_PRICE_ID`.

### 7.2 Live Mode (Production)

Same steps but toggle to Live mode in Stripe dashboard. Requires business verification.

---

## 7A. Discord Application Setup (the archive importer's bot path)

**Optional.** Skip it entirely and the DiscordChatExporter upload flow still
works — the wizard simply does not offer "Connect Discord". What it is not is a
fallback that switches on: the two paths are independent, and the upload one is
what keeps working if Discord ever throttles one shared bot across every chapter.

Everything below is **provider-side configuration that no repo state creates and
no CI check can detect.** Three of the five steps produce an Infisical value; two
produce nothing but a toggle, and getting either wrong fails at runtime with an
error that names neither this page nor the setting.

1. **Create the application.** https://discord.com/developers/applications → New
   Application, owned by **Signet**, not by a chapter. A separate application per
   environment is recommended so a staging mistake cannot read production
   chapters' servers.
2. **Bot token.** Bot → Reset Token → copy (shown once) → Infisical
   `DISCORD_BOT_TOKEN`. **One global value per environment, not one per chapter.**
3. **OAuth2 credentials.** OAuth2 → copy Client ID → `DISCORD_CLIENT_ID`; Reset
   Secret → copy → `DISCORD_CLIENT_SECRET`. The secret is what signs the
   server-to-server code exchange, which is the step that proves the authorizing
   human holds Manage Server on the guild — without it that fact would have to be
   taken from the browser, which the flow must never do.
4. **Register the redirect URI** — OAuth2 → Redirects → Add, **exactly**:

   | Environment | Redirect URI                                                 |
   | ----------- | ------------------------------------------------------------ |
   | local       | `http://localhost:3001/v1/discord/connect/callback`          |
   | staging     | `https://api-staging.frapp.live/v1/discord/connect/callback` |
   | production  | `https://api.frapp.live/v1/discord/connect/callback`         |

   It is `API_URL` + `/v1/discord/connect/callback` and Discord matches it
   **character for character**. Get it wrong and every admin who clicks "Add to
   Server" gets Discord's own `invalid_redirect_uri` page with **nothing in the
   API logs** — Discord rejects the request before the callback is ever reached.
   The path is pinned in code as `DISCORD_CALLBACK_PATH`
   (`apps/api/src/application/services/discord-oauth.service.ts`); this table is
   the third copy, and the one that drifts.

5. **Enable Message Content Intent** — Bot → Privileged Gateway Intents →
   Message Content Intent → on. This is **self-serve below 100 servers** and is
   separate from bot verification, which is not needed yet (revisit before that
   threshold). Without it Discord answers `200` with `content: ""` on every
   message a chapter's members wrote. The importer detects that and fails with a
   message naming this toggle rather than importing a decade of empty bubbles —
   but only turning it on makes an import actually work.

**Permissions.** The install requests View Channels + Read Message History and
nothing else (bitfield `66560`, pinned as `DISCORD_BOT_PERMISSIONS` in
`apps/api/src/domain/adapters/discord.interface.ts`). Do not widen it in the
portal: the bitfield in the authorize URL is what the consent screen shows a
chapter, and a read-only archiver has no business holding a permission that can
change anything in someone's server.

**One thing the portal cannot express, so it is worth knowing here.** Discord's
consent screen names _Signet_ — it does not name the chapter the connection will
be bound to, and it cannot. Signet closes that gap on its own side: the callback
parks the server and links nothing, and an authenticated request scoped to the
chapter is what activates it. So a Signet officer cannot send their authorize
link to somebody else's Discord admin and end up reading that server. Do not
"simplify" the flow by binding on the callback.

**Verify after setup**: `GET /v1/discord/availability` (as an officer with
`channels:manage`) must answer `{"available": true}`. If it answers `false`, one
of the three secrets or `API_URL` / `APP_URL` is unset in that environment — see
[`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md) § API-Only Settings.

---
