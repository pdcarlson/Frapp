import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_ISSUE_TITLE,
  DELEGATED,
  FAIL,
  FAILING_MARKER,
  PASS,
  SKIPPED,
  buildAlertCommentBody,
  buildAlertIssueBody,
  buildRecoveryCommentBody,
  buildRunSummary,
  canResolveAlert,
  checkAuthHook,
  checkAuthRedirects,
  checkAuthSignIn,
  checkAuthSmtp,
  AUTH_SMTP_SENDER_NAME,
  checkAuthMagicLink,
  checkInfisicalSyncs,
  checkProjectStatus,
  checkRenderAutoDeploy,
  checkRenderHealthCheckPath,
  checkSchemaDrift,
  classifyConformance,
  decodeJwtPayload,
  emailsPerHourFromRateLimit,
  parseFailingIds,
  readWorkspaceId,
  redactSecrets,
  runStagingConformance,
} from "../staging-conformance.mjs";

import { readFileSync } from "node:fs";

import { makeFetchMock, quiet } from "./helpers.mjs";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const httpError = (status) => ({ ok: false, status, json: async () => ({}) });

/** Live GET /v1/services/{id} shape for frapp-api-staging (2026-09-09). */
const healthyStagingRender = () =>
  ok({
    autoDeploy: "yes",
    branch: "main",
    serviceDetails: { healthCheckPath: "/health" },
  });

// ── Project status ──────────────────────────────────────────────────────────

test("project status passes only on ACTIVE_HEALTHY", async () => {
  const healthy = await checkProjectStatus({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => ok({ status: "ACTIVE_HEALTHY" }),
  });
  assert.equal(healthy.status, PASS);

  const paused = await checkProjectStatus({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => ok({ status: "INACTIVE" }),
  });
  assert.equal(paused.status, FAIL);
  assert.match(paused.detail, /INACTIVE/);
});

test("project status skips rather than fails when the credential is absent", async () => {
  const result = await checkProjectStatus({ accessToken: "", projectRef: "" });
  assert.equal(result.status, SKIPPED);
});

test("a non-200 from the Management API is a failure, not a skip", async () => {
  const result = await checkProjectStatus({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => httpError(401),
  });
  assert.equal(result.status, FAIL);
});

// ── Auth hook — the #805 regression this workflow exists to catch ───────────

test("auth hook disabled fails and names the trust-model consequence", async () => {
  const result = await checkAuthHook({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => ok({ hook_custom_access_token_enabled: false }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /x-chapter-id/);
});

test("auth hook enabled but pointed at another function is not a pass", async () => {
  const result = await checkAuthHook({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      ok({
        hook_custom_access_token_enabled: true,
        hook_custom_access_token_uri: "pg-functions://postgres/public/some_other_hook",
      }),
  });
  assert.equal(result.status, FAIL);
});

test("auth hook enabled and correctly pointed passes", async () => {
  const result = await checkAuthHook({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      ok({
        hook_custom_access_token_enabled: true,
        hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook",
      }),
  });
  assert.equal(result.status, PASS);
});

// ── Auth redirect allow list — a bare origin matches only itself ────────────

const authConfig = (uriAllowList, siteUrl = "https://app.staging.frapp.live") =>
  ok({ site_url: siteUrl, uri_allow_list: uriAllowList });

test("allow list holding only bare origins fails and names what is missing", async () => {
  const result = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      authConfig("https://app.staging.frapp.live,https://api-staging.frapp.live,frapp://**"),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /https:\/\/app\.staging\.frapp\.live\/\*\*/);
  assert.match(result.detail, /invite/);
});

test("allow list missing the mobile scheme fails even with the web wildcard present", async () => {
  const result = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      authConfig("https://app.staging.frapp.live,https://app.staging.frapp.live/**"),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /frapp:\/\/\*\*/);
});

test("allow list with the site-url wildcard and the mobile scheme passes", async () => {
  const result = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      authConfig(
        "https://app.staging.frapp.live, https://api-staging.frapp.live,exp://localhost:8081,frapp://**,https://app.staging.frapp.live/**",
      ),
  });
  assert.equal(result.status, PASS);
});

test("a trailing slash on site_url does not produce a double-slash requirement", async () => {
  const result = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      authConfig("frapp://**,https://app.staging.frapp.live/**", "https://app.staging.frapp.live/"),
  });
  assert.equal(result.status, PASS);
});

test("auth redirects check skips without credentials and fails on a non-200", async () => {
  const skipped = await checkAuthRedirects({ accessToken: "", projectRef: "", fetchImpl: async () => ok({}) });
  assert.equal(skipped.status, SKIPPED);
  const failed = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => httpError(403),
  });
  assert.equal(failed.status, FAIL);
});

test("expectedSiteUrl fails when site_url is a different origin even with matching wildcards", async () => {
  const result = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    expectedSiteUrl: "https://app.frapp.live",
    fetchImpl: async () =>
      authConfig(
        "https://app.staging.frapp.live,https://app.staging.frapp.live/**,frapp://**",
        "https://app.staging.frapp.live",
      ),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /app\.staging\.frapp\.live/);
  assert.match(result.detail, /app\.frapp\.live/);
});

test("expectedSiteUrl still requires the wildcards when the Site URL matches", async () => {
  const missing = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    expectedSiteUrl: "https://app.frapp.live",
    fetchImpl: async () => authConfig("https://app.frapp.live", "https://app.frapp.live"),
  });
  assert.equal(missing.status, FAIL);
  assert.match(missing.detail, /https:\/\/app\.frapp\.live\/\*\*/);

  const okResult = await checkAuthRedirects({
    accessToken: "t",
    projectRef: "ref",
    expectedSiteUrl: "https://app.frapp.live/",
    fetchImpl: async () =>
      authConfig("frapp://**,https://app.frapp.live/**", "https://app.frapp.live/"),
  });
  assert.equal(okResult.status, PASS);
});

// ── Auth SMTP — hosted 2/hour cap vs proven Resend 300/hour ─────────────────

const smtpConfig = (overrides = {}) =>
  ok({
    smtp_host: "smtp.resend.com",
    smtp_admin_email: "no-reply@mail.staging.frapp.live",
    smtp_sender_name: "Signet",
    rate_limit_email_sent: 300,
    smtp_pass: "must-never-appear-in-detail",
    ...overrides,
  });

test("emailsPerHourFromRateLimit reads legacy numbers and count/duration strings", () => {
  assert.equal(emailsPerHourFromRateLimit(300), 300);
  assert.equal(emailsPerHourFromRateLimit(2), 2);
  assert.equal(emailsPerHourFromRateLimit("300"), 300);
  assert.equal(emailsPerHourFromRateLimit("300/1h"), 300);
  assert.equal(emailsPerHourFromRateLimit("600/2h"), 300);
  assert.equal(emailsPerHourFromRateLimit("10/30m"), 20);
  assert.equal(emailsPerHourFromRateLimit("300/24h"), 12.5);
  assert.equal(emailsPerHourFromRateLimit(""), null);
  assert.equal(emailsPerHourFromRateLimit("nope"), null);
});

test("a 300/24h send cap is not 300/hour and fails", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ rate_limit_email_sent: "300/24h" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /12\.5\/hour/);
});

test("empty smtp_host fails and names the hosted 2/hour cap", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_host: "" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /2 messages\/hour/);
  assert.doesNotMatch(result.detail, /must-never-appear-in-detail/);
});

test("a non-Resend smtp_host fails", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_host: "smtp.mailgun.org" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /smtp\.mailgun\.org/);
});

test("wrong From address fails even when the host and cap are right", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_admin_email: "noreply@example.com" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /noreply@example\.com/);
});

test("SMTP on with the hosted send cap still fails", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ rate_limit_email_sent: 2 }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /2\/hour/);
  assert.match(result.detail, /#1824/);
});

test("Resend host, no-reply@mail.staging.frapp.live, Signet sender, and 300/hour pass without leaking smtp_pass", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_host: "SMTP.RESEND.COM", smtp_admin_email: "No-Reply@Mail.Staging.Frapp.live" }),
  });
  assert.equal(result.status, PASS);
  assert.match(result.detail, /300\/hour/);
  assert.match(result.detail, /sender=Signet/);
  assert.doesNotMatch(result.detail, /must-never-appear-in-detail/);
});

test("wrong smtp_sender_name fails even when host, From, and cap are right", async () => {
  assert.equal(AUTH_SMTP_SENDER_NAME, "Signet");
  const leftover = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_sender_name: "Frapp" }),
  });
  assert.equal(leftover.status, FAIL);
  assert.match(leftover.detail, /smtp_sender_name is "Frapp"/);
  assert.match(leftover.detail, /Signet/);
  assert.doesNotMatch(leftover.detail, /must-never-appear-in-detail/);

  const empty = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_sender_name: "" }),
  });
  assert.equal(empty.status, FAIL);
  assert.match(empty.detail, /smtp_sender_name is "\(empty\)"/);

  const wrongCase = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_sender_name: "signet" }),
  });
  assert.equal(wrongCase.status, FAIL);
  assert.match(wrongCase.detail, /smtp_sender_name is "signet"/);

  const padded = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => smtpConfig({ smtp_sender_name: "  Signet  " }),
  });
  assert.equal(padded.status, PASS);
  assert.match(padded.detail, /sender=Signet/);
});

test("auth SMTP check skips without credentials and fails on a non-200", async () => {
  const skipped = await checkAuthSmtp({ accessToken: "", projectRef: "", fetchImpl: async () => ok({}) });
  assert.equal(skipped.status, SKIPPED);
  const failed = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => httpError(401),
  });
  assert.equal(failed.status, FAIL);
});

test("whenUnset skip leaves empty smtp_host as SKIPPED without leaking smtp_pass", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    whenUnset: "skip",
    expectedAdminEmail: "no-reply@mail.frapp.live",
    fetchImpl: async () => smtpConfig({ smtp_host: "", smtp_admin_email: "", rate_limit_email_sent: 2 }),
  });
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /2\/hour cap/);
  assert.match(result.detail, /no-reply@mail\.frapp\.live/);
  assert.doesNotMatch(result.detail, /must-never-appear-in-detail/);
});

test("staging default still FAILs empty smtp_host when whenUnset is omitted", async () => {
  const result = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    expectedAdminEmail: "no-reply@mail.frapp.live",
    fetchImpl: async () => smtpConfig({ smtp_host: "" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /2 messages\/hour/);
});

test("expectedAdminEmail is the From this check compares", async () => {
  const wrong = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    expectedAdminEmail: "no-reply@mail.frapp.live",
    fetchImpl: async () => smtpConfig(),
  });
  assert.equal(wrong.status, FAIL);
  assert.match(wrong.detail, /mail\.staging\.frapp\.live/);
  assert.match(wrong.detail, /no-reply@mail\.frapp\.live/);

  const right = await checkAuthSmtp({
    accessToken: "t",
    projectRef: "ref",
    expectedAdminEmail: "no-reply@mail.frapp.live",
    fetchImpl: async () => smtpConfig({ smtp_admin_email: "no-reply@mail.frapp.live" }),
  });
  assert.equal(right.status, PASS);
  assert.match(right.detail, /no-reply@mail\.frapp\.live/);
  assert.doesNotMatch(right.detail, /must-never-appear-in-detail/);
});

// ── Magic Link template — token_hash on the app host, not ConfirmationURL ──

const magicLinkConfig = (overrides = {}) =>
  ok({
    smtp_host: "smtp.resend.com",
    mailer_subjects_magic_link: "Sign in to Signet",
    mailer_templates_magic_link_content:
      '<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink">Sign in to Signet</a>',
    smtp_pass: "must-never-appear-in-detail",
    ...overrides,
  });

test("Magic Link subject + token_hash href pass without leaking smtp_pass or the body", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => magicLinkConfig(),
  });
  assert.equal(result.status, PASS);
  assert.match(result.detail, /token_hash href/);
  assert.doesNotMatch(result.detail, /must-never-appear-in-detail/);
  assert.doesNotMatch(result.detail, /RedirectTo/);
});

test("hosted Magic Link subject fails", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => magicLinkConfig({ mailer_subjects_magic_link: "Your Magic Link" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /Your Magic Link/);
});

test("empty Magic Link body fails and names ConfirmationURL", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => magicLinkConfig({ mailer_templates_magic_link_content: "   " }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /ConfirmationURL/);
});

test("ConfirmationURL in the Magic Link body fails", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      magicLinkConfig({
        mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Log In</a>',
      }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /ConfirmationURL/);
  assert.match(result.detail, /supabase\.co/);
  assert.doesNotMatch(result.detail, /must-never-appear-in-detail/);
});

test("type=magiclink without TokenHash fails", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      magicLinkConfig({
        mailer_templates_magic_link_content:
          '<a href="{{ .RedirectTo }}&type=magiclink">Sign in</a>',
      }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /TokenHash/);
});

test("token_hash without type=magiclink fails", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      magicLinkConfig({
        mailer_templates_magic_link_content: '<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}">Sign in</a>',
      }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /type=magiclink/);
});

test("Magic Link check skips without credentials and fails on a non-200", async () => {
  const skipped = await checkAuthMagicLink({
    accessToken: "",
    projectRef: "",
    fetchImpl: async () => ok({}),
  });
  assert.equal(skipped.status, SKIPPED);
  const failed = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () => httpError(401),
  });
  assert.equal(failed.status, FAIL);
});

test("whenSmtpUnset skip leaves hosted SMTP as SKIPPED even with ConfirmationURL", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    whenSmtpUnset: "skip",
    fetchImpl: async () =>
      magicLinkConfig({
        smtp_host: "",
        mailer_subjects_magic_link: "Your Magic Link",
        mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Log In</a>',
      }),
  });
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /smtp_host is empty/);
  assert.doesNotMatch(result.detail, /must-never-appear-in-detail/);
  assert.doesNotMatch(result.detail, /ConfirmationURL/);
});

test("whenSmtpUnset skip still FAILs ConfirmationURL once SMTP is on", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    whenSmtpUnset: "skip",
    fetchImpl: async () =>
      magicLinkConfig({
        mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Log In</a>',
      }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /ConfirmationURL/);
});

test("staging default still asserts the template when smtp_host is empty", async () => {
  const result = await checkAuthMagicLink({
    accessToken: "t",
    projectRef: "ref",
    fetchImpl: async () =>
      magicLinkConfig({
        smtp_host: "",
        mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Log In</a>',
      }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /ConfirmationURL/);
});

test("default staging toRun includes auth-magic-link — the function alone is not enough", () => {
  // #1927 shipped checkAuthMagicLink and wired only production. A revert that
  // leaves the function but drops the daily row would sit green.
  const source = readFileSync(
    new URL("../staging-conformance.mjs", import.meta.url),
    "utf8",
  );
  const toRun = source.slice(source.indexOf("const toRun = checks ??"));
  assert.match(toRun, /id: "auth-magic-link"/);
  assert.match(toRun, /checkAuthMagicLink\(/);
});

test("default staging toRun includes health-check-path — the function alone is not enough", () => {
  const source = readFileSync(
    new URL("../staging-conformance.mjs", import.meta.url),
    "utf8",
  );
  const toRun = source.slice(source.indexOf("const toRun = checks ??"));
  assert.match(toRun, /id: "health-check-path"/);
  assert.match(toRun, /checkRenderHealthCheckPath\(/);
});

test("default staging toRun includes render-auto-deploy — the function alone is not enough", () => {
  const source = readFileSync(
    new URL("../staging-conformance.mjs", import.meta.url),
    "utf8",
  );
  const toRun = source.slice(source.indexOf("const toRun = checks ??"));
  assert.match(toRun, /id: "render-auto-deploy"/);
  assert.match(toRun, /checkRenderAutoDeploy\(/);
  // Production's expected value. A copy-paste of assertRenderService here
  // would freeze-assert the wrong host.
  assert.match(source, /autoDeploy !== "yes"/);
  assert.doesNotMatch(source, /autoDeploy !== "no"/);
});

// ── Render healthCheckPath ─────────────────────────────────────────────────

test("healthCheckPath skips rather than fails when the Render credential is absent", async () => {
  const result = await checkRenderHealthCheckPath({});
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /RENDER_API_KEY/);
});

test("healthCheckPath fails on an empty path — TCP-only, not GET /health", async () => {
  const result = await checkRenderHealthCheckPath({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => ok({ serviceDetails: { healthCheckPath: "" } }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /empty/);
  assert.match(result.detail, /TCP-only/);
});

test("healthCheckPath fails on /health/ready — that would cancel a deploy on a degraded dependency", async () => {
  const result = await checkRenderHealthCheckPath({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => ok({ serviceDetails: { healthCheckPath: "/health/ready" } }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /health\/ready/);
});

test("healthCheckPath does not treat a top-level decoy as the live Render field", async () => {
  const result = await checkRenderHealthCheckPath({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () =>
      ok({ healthCheckPath: "/health", serviceDetails: { autoDeployTrigger: "commit" } }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /unreadable/);
});

test("healthCheckPath passes when the nested field is /health", async () => {
  const result = await checkRenderHealthCheckPath({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => ok({ serviceDetails: { healthCheckPath: "/health" } }),
  });
  assert.equal(result.status, PASS);
  assert.match(result.detail, /healthCheckPath=\/health/);
});

test("a non-200 from the Render API is a failure, not a skip", async () => {
  const result = await checkRenderHealthCheckPath({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => httpError(401),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /HTTP 401/);
});

test("healthCheckPath queries the service id it was handed, not a baked-in prod id", async () => {
  const urls = [];
  await checkRenderHealthCheckPath({
    apiKey: "rk",
    serviceId: "srv-d6lqsq75r7bs73c2fdc0",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return ok({ serviceDetails: { healthCheckPath: "/health" } });
    },
  });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith("/services/srv-d6lqsq75r7bs73c2fdc0"));
  assert.ok(!urls[0].includes("srv-d6lqu41aae7s73f62df0"));
});

// ── Render auto-deploy ──────────────────────────────────────────────────────

test("render-auto-deploy skips rather than fails when the Render credential is absent", async () => {
  const result = await checkRenderAutoDeploy({});
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /RENDER_API_KEY/);
});

test("render-auto-deploy fails when auto-deploy is off — that freezes staging", async () => {
  const result = await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => ok({ autoDeploy: "no", branch: "main" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /autoDeploy='no'/);
  assert.match(result.detail, /frozen/);
  assert.doesNotMatch(result.detail, /branch=/);
});

test("render-auto-deploy fails when the service tracks a branch other than main", async () => {
  const result = await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => ok({ autoDeploy: "yes", branch: "staging" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /branch='staging'/);
});

test("render-auto-deploy names both findings when auto-deploy and branch are wrong", async () => {
  const result = await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => ok({ autoDeploy: "no", branch: "production" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /autoDeploy='no'/);
  assert.match(result.detail, /branch='production'/);
});

test("render-auto-deploy does not treat a nested decoy as the live Render field", async () => {
  const result = await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () =>
      ok({
        serviceDetails: { autoDeploy: "yes", branch: "main" },
      }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /unreadable/);
});

test("render-auto-deploy does not unwrap a { service: … } envelope", async () => {
  const result = await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () =>
      ok({ service: { autoDeploy: "yes", branch: "main" } }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /unreadable/);
});

test("render-auto-deploy passes when autoDeploy is yes and branch is main", async () => {
  const result = await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => healthyStagingRender(),
  });
  assert.equal(result.status, PASS);
  assert.match(result.detail, /autoDeploy=yes/);
  assert.match(result.detail, /branch=main/);
});

test("a non-200 from the Render API is a failure for auto-deploy, not a skip", async () => {
  const result = await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-test",
    fetchImpl: async () => httpError(401),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /HTTP 401/);
});

test("render-auto-deploy queries the service id it was handed, not a baked-in prod id", async () => {
  const urls = [];
  await checkRenderAutoDeploy({
    apiKey: "rk",
    serviceId: "srv-d6lqsq75r7bs73c2fdc0",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return healthyStagingRender();
    },
  });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith("/services/srv-d6lqsq75r7bs73c2fdc0"));
  assert.ok(!urls[0].includes("srv-d6lqu41aae7s73f62df0"));
});

test("staging-conformance.yml wires Render creds to the staging service, never prod", () => {
  // The function and toRun row can exist while the job still never asserts:
  // without these env lines the check is permanently SKIPPED.
  const yaml = readFileSync(
    new URL("../../../.github/workflows/staging-conformance.yml", import.meta.url),
    "utf8",
  );
  assert.ok(
    yaml.includes("RENDER_API_KEY: ${{ secrets.RENDER_API_KEY }}"),
    "the job must pass the Render secret or the check is permanently SKIPPED",
  );
  assert.match(yaml, /RENDER_SERVICE_ID: srv-d6lqsq75r7bs73c2fdc0/);
  assert.doesNotMatch(yaml, /srv-d6lqu41aae7s73f62df0/);
  const infra = readFileSync(
    new URL("../../../docs/internal/ci-cd/AGENT_INFRA.md", import.meta.url),
    "utf8",
  );
  assert.ok(
    infra.includes(
      "`verify-deployments.yml` and `staging-conformance.yml` (`RENDER_API_KEY`)",
    ),
    "AGENT_INFRA must list staging-conformance.yml as a RENDER_API_KEY consumer",
  );
  assert.match(
    infra,
    /Render auto-deploy on tracking `main`/,
    "the 07:30 roster must name the auto-deploy assertion or a revert sits green",
  );
});

test("default toRun health-check-path reads RENDER_* from env and skips without them", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).includes("render.com")) {
      return healthyStagingRender();
    }
    return { ok: true, status: 200, json: async () => [] };
  };

  const skipped = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    env: {},
    writeSummary: () => {},
    logger: quiet,
  });
  const skippedRow = skipped.results.find((r) => r.id === "health-check-path");
  assert.equal(skippedRow.status, SKIPPED);
  const skippedAuto = skipped.results.find((r) => r.id === "render-auto-deploy");
  assert.equal(skippedAuto.status, SKIPPED);
  assert.ok(!urls.some((u) => u.includes("render.com")));

  urls.length = 0;
  const passed = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    env: {
      RENDER_API_KEY: "rk",
      RENDER_SERVICE_ID: "srv-d6lqsq75r7bs73c2fdc0",
    },
    writeSummary: () => {},
    logger: quiet,
  });
  const passedRow = passed.results.find((r) => r.id === "health-check-path");
  assert.equal(passedRow.status, PASS);
  const autoDeployRow = passed.results.find((r) => r.id === "render-auto-deploy");
  assert.equal(autoDeployRow.status, PASS);
  assert.ok(urls.some((u) => u.endsWith("/services/srv-d6lqsq75r7bs73c2fdc0")));
  assert.ok(!urls.some((u) => u.includes("srv-d6lqu41aae7s73f62df0")));
});

// ── Infisical syncs ─────────────────────────────────────────────────────────

const infisicalFetch = (syncPayload, { loginStatus = 200 } = {}) => async (url) => {
  if (url.includes("universal-auth/login")) {
    return loginStatus === 200
      ? ok({ accessToken: "at" })
      : httpError(loginStatus);
  }
  return ok(syncPayload);
};

test("all-succeeded syncs pass", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "render-api-staging", syncStatus: "succeeded" },
        { name: "vercel-web-staging", syncStatus: "succeeded" },
      ],
    }),
  });
  assert.equal(result.status, PASS);
});

test("a failing sync names the sync — the #834 signature", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "render-api-staging", syncStatus: "succeeded" },
        { name: "vercel-landing-staging", syncStatus: "failed" },
      ],
    }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /vercel-landing-staging/);
});

test("a rejected login explains that the credential is present but refused", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({}, { loginStatus: 401 }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /Client ID/);
});

test("an unrecognised response shape fails closed rather than reading as healthy", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({ unexpected: true }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /could not interpret/);
});

test("zero syncs is a failure — an empty sync list is drift, not health", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({ secretSyncs: [] }),
  });
  assert.equal(result.status, FAIL);
});

// ── End-to-end sign-in ──────────────────────────────────────────────────────

test("sign-in skips loudly when the smoke credential is not provisioned", async () => {
  const result = await checkAuthSignIn({ supabaseUrl: "u", anonKey: "k" });
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /exactly ONE chapter membership/);
});

test("sign-in FAILs when URL is present but anon key is missing — #1767", async () => {
  const result = await checkAuthSignIn({ supabaseUrl: "https://staging.example" });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /#1767/);
  assert.match(result.detail, /incomplete/);
});

test("sign-in FAILs when anon key is an empty string — GitHub renders unset secrets as empty", async () => {
  const result = await checkAuthSignIn({
    supabaseUrl: "https://staging.example",
    anonKey: "",
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /#1767/);
});

test("sign-in FAILs when the anon key is present but the URL is not", async () => {
  const result = await checkAuthSignIn({ anonKey: "k" });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /#1767/);
});

test("sign-in FAILs when the smoke user is set but anon key is missing", async () => {
  const result = await checkAuthSignIn({
    email: "smoke@example.com",
    password: "pw",
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /#1767/);
});

test("a fully unconfigured sign-in still skips — local run, not a silent green staging", async () => {
  const result = await checkAuthSignIn({});
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /exactly ONE chapter membership/);
});

test("default toRun auth-signin FAILs when URL is injected without the anon key", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 1767 } },
  ]);
  const { outcome, results } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    env: { SUPABASE_URL: "https://staging.example" },
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "failed");
  const row = results.find((r) => r.id === "auth-signin");
  assert.equal(row.status, FAIL);
  assert.match(row.detail, /#1767/);
});

test("a token carrying active_chapter_id passes", async () => {
  const result = await checkAuthSignIn({
    supabaseUrl: "https://staging.example",
    anonKey: "k",
    email: "smoke@example.com",
    password: "pw",
    fetchImpl: async () => ok({ access_token: "header.payload.sig" }),
    decode: () => ({ active_chapter_id: "chapter-uuid" }),
  });
  assert.equal(result.status, PASS);
});

test("a claimless token fails and names the no-membership trap, not just the hook", async () => {
  const result = await checkAuthSignIn({
    supabaseUrl: "https://staging.example",
    anonKey: "k",
    email: "smoke@example.com",
    password: "pw",
    fetchImpl: async () => ok({ access_token: "header.payload.sig" }),
    decode: () => ({ sub: "user-uuid" }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /no membership|resolves to no chapter/);
});

test("decodeJwtPayload reads a real base64url payload and survives garbage", () => {
  const payload = Buffer.from(JSON.stringify({ active_chapter_id: "abc" })).toString("base64url");
  assert.deepEqual(decodeJwtPayload(`h.${payload}.s`), { active_chapter_id: "abc" });
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
  assert.equal(decodeJwtPayload(""), null);
});

// ── Schema drift delegation (#833) ──────────────────────────────────────────

test("migration parity is reported as owned elsewhere, and never as a pass", async () => {
  // #833 shipped a complete sibling watchdog (check-migration-drift.yml) with
  // its own schedule and its own alert issue, covering production too. Running
  // its script from here would check the same thing twice a day, let one drift
  // open two P1s, and mutate another watchdog's incident state as a side
  // effect. The row stays visible so the inventory is complete; it asserts
  // nothing, so it can never close this workflow's alert.
  const r = checkSchemaDrift();
  assert.equal(r.status, DELEGATED);
  assert.notEqual(r.status, PASS, "must never count toward this workflow's health");
  assert.notEqual(
    r.status,
    SKIPPED,
    "a permanent delegation must not arm the loud-skip banner every single day",
  );
  assert.match(r.detail, /check-migration-drift\.yml/);
  assert.match(r.detail, /#833/);
});

test("migration parity runs no child process", () => {
  // Guards the collision directly: if this ever shells out again it would be
  // re-running #833's script, which upserts and closes ITS alert.
  const source = readFileSync(
    new URL("../staging-conformance.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /execFileSync|spawnSync|child_process/);
});

// ── Classification and reporting ────────────────────────────────────────────

test("skipped assertions never turn the run red", () => {
  const { outcome, skipped, passed } = classifyConformance([
    { status: PASS },
    { status: SKIPPED },
    { status: SKIPPED },
  ]);
  assert.equal(outcome, "healthy");
  assert.equal(skipped.length, 2);
  assert.equal(passed.length, 1);
});

test("all-skipped is inconclusive, never healthy", () => {
  const { outcome } = classifyConformance([{ status: SKIPPED }, { status: SKIPPED }]);
  assert.equal(outcome, "inconclusive");
});

test("one failure reds the run regardless of how many passed", () => {
  const { outcome, failed } = classifyConformance([
    { status: PASS },
    { status: PASS },
    { status: FAIL },
  ]);
  assert.equal(outcome, "failed");
  assert.equal(failed.length, 1);
});

test("the summary never folds a skipped assertion into the pass count", () => {
  const summary = buildRunSummary({
    outcome: "healthy",
    results: [
      { status: PASS, label: "a", detail: "" },
      { status: SKIPPED, label: "b", detail: "no credential" },
    ],
    runUrl: "",
  });
  assert.match(summary, /1 of 2 assertions passed/);
  assert.match(summary, /SKIPPED/);
  assert.match(summary, /A skipped check is not a passing check/);
});

test("the alert body lists only the failing assertions and warns off claiming it", () => {
  const body = buildAlertIssueBody({
    results: [
      { status: PASS, label: "healthy thing", detail: "" },
      { status: FAIL, label: "auth hook", detail: "disabled" },
    ],
    runUrl: "https://example/run",
  });
  assert.match(body, /auth hook/);
  assert.doesNotMatch(body, /healthy thing/);
  assert.match(body, /routine-state/);
});

// ── Orchestration ───────────────────────────────────────────────────────────

test("a failing run writes the summary, annotates as an error, and raises the alert", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 900 } },
  ]);
  let summary = "";
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "auth hook", status: FAIL, detail: "disabled" })],
    writeSummary: (s) => { summary = s; },
    logger: quiet,
  });

  assert.equal(outcome, "failed");
  assert.equal(alert.action, "created");
  assert.match(summary, /has drifted/);
  const created = calls.find((c) => c.method === "POST" && c.url.includes("/issues"));
  assert.match(created.body, new RegExp(ALERT_ISSUE_TITLE.slice(0, 20)));
});

test("a clean run closes an open alert", async () => {
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "ok", status: PASS, detail: "" })],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "healthy");
  assert.deepEqual(alert.closed, [900]);
});

test("an all-skipped run does NOT close an open alert by counting as healthy", async () => {
  // Guards the subtle version of the bug this workflow exists to prevent: if
  // every credential vanished, the run must not read as a recovery.
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  let summary = "";
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "ok", status: SKIPPED, detail: "no credential" })],
    writeSummary: (s) => { summary = s; },
    logger: quiet,
  });
  assert.equal(outcome, "inconclusive");
  assert.deepEqual(alert.closed, []);
  assert.match(summary, /Inconclusive — nothing was asserted/);
  assert.match(summary, /left open deliberately/);
});

test("an inconclusive run issues no PATCH — the open alert is untouched", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "x", label: "ok", status: SKIPPED, detail: "no credential" })],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});

test("a partially-skipped run with at least one real pass still resolves", async () => {
  // The live shape until the smoke credential is provisioned: some checks
  // assert, one skips. That must still count as evidence of health.
  const { fetchImpl } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE }],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => ({ id: "a", label: "asserted", status: PASS, detail: "" }),
      async () => ({ id: "b", label: "skipped", status: SKIPPED, detail: "no credential" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "healthy");
  assert.deepEqual(alert.closed, [900]);
});

test("one assertion throwing is a failure, and the others still report", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 901 } },
  ]);
  const { outcome, results } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => { throw new Error("DNS blew up"); },
      async () => ({ id: "y", label: "still ran", status: PASS, detail: "" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "failed");
  assert.equal(results.length, 2);
  assert.equal(results[1].status, PASS);
  assert.match(results[0].detail, /DNS blew up/);
});

test("readWorkspaceId reads .infisical.json and returns null on anything malformed", () => {
  assert.equal(
    readWorkspaceId({ path: "x", read: () => JSON.stringify({ workspaceId: "ws-1" }) }),
    "ws-1",
  );
  assert.equal(readWorkspaceId({ path: "x", read: () => "{not json" }), null);
  assert.equal(
    readWorkspaceId({ path: "x", read: () => { throw new Error("ENOENT"); } }),
    null,
  );
});

test("the repo's real .infisical.json exposes a workspaceId", () => {
  // Not a mock: the Infisical assertion depends on this file's shape, so a
  // rename would otherwise only surface as a silent SKIPPED in production.
  assert.ok(readWorkspaceId());
});

// ── Secret redaction ────────────────────────────────────────────────────────
// The job injects the whole staging store, and alert issue bodies are NOT
// covered by GitHub's log masking.

test("redactSecrets removes injected secret values from text bound for an issue body", () => {
  const env = {
    SUPABASE_DB_PASSWORD: "sup3rs3cretpassword",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abcdefghijkl",
    NODE_ENV: "production",
  };
  const leak =
    'failed to connect: key=sb_secret_abcdefghijkl pw=sup3rs3cretpassword env=production';
  const out = redactSecrets(leak, env);
  assert.doesNotMatch(out, /sup3rs3cretpassword/);
  assert.doesNotMatch(out, /sb_secret_abcdefghijkl/);
  // A non-secret-named var of the same value must not be scrubbed away.
  assert.match(out, /env=production/);
});

test("redactSecrets masks a password embedded in a connection URL it has never seen", () => {
  const out = redactSecrets(
    "failed to connect to postgresql://postgres:nEverSeenBefore@db.abc.supabase.co:5432/postgres",
    {},
  );
  assert.doesNotMatch(out, /nEverSeenBefore/);
  assert.match(out, /postgres:\*\*\*@db\.abc\.supabase\.co/);
});

test("redactSecrets ignores short values so it cannot blank out ordinary words", () => {
  assert.equal(redactSecrets("all good", { API_KEY: "abc" }), "all good");
});

// ── Failing-assertion marker and gated recovery ─────────────────────────────

test("parseFailingIds round-trips the marker the alert body writes", () => {
  const body = buildAlertIssueBody({
    results: [
      { id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" },
      { id: "project-status", status: FAIL, label: "status", detail: "paused" },
      { id: "infisical-syncs", status: PASS, label: "syncs", detail: "" },
    ],
    runUrl: "",
  });
  assert.match(body, new RegExp(FAILING_MARKER));
  assert.deepEqual(parseFailingIds(body), ["auth-hook", "project-status"]);
});

test("parseFailingIds returns [] for a body with no marker", () => {
  assert.deepEqual(parseFailingIds("a hand-filed issue"), []);
  assert.deepEqual(parseFailingIds(undefined), []);
});

test("canResolveAlert requires the previously-failing assertions to PASS, not merely not-fail", () => {
  const results = [
    { id: "auth-hook", status: SKIPPED },
    { id: "project-status", status: PASS },
  ];
  assert.equal(canResolveAlert({ results, failingIds: ["auth-hook"] }), false);
  assert.equal(canResolveAlert({ results, failingIds: ["project-status"] }), true);
  // No marker (hand-filed or older version) → do not strand the issue.
  assert.equal(canResolveAlert({ results, failingIds: [] }), true);
});

test("a run where the alert's failing check merely SKIPPED does not close it", async () => {
  // The headline regression: deleting a secret must not resolve an alert.
  const openAlert = {
    number: 900,
    state: "open",
    title: ALERT_ISSUE_TITLE,
    body: `\`${FAILING_MARKER} auth-signin\``,
  };
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [openAlert] },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  let summary = "";
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => ({ id: "project-status", label: "status", status: PASS, detail: "" }),
      async () => ({ id: "auth-signin", label: "sign-in", status: SKIPPED, detail: "credential gone" }),
    ],
    writeSummary: (s) => { summary = s; },
    logger: quiet,
  });
  assert.equal(outcome, "unproven-recovery");
  assert.deepEqual(alert.closed, []);
  // A body refresh IS expected here — it records what this run proved so the
  // marker narrows. What must not happen is a close.
  const closes = calls.filter(
    (c) => c.method === "PATCH" && /"state":"closed"/.test(c.body ?? ""),
  );
  assert.equal(closes.length, 0, "must not close the issue");
  assert.match(summary, /not cleared/);
});

test("a run where the alert's failing check now PASSES does close it", async () => {
  const openAlert = {
    number: 900,
    state: "open",
    title: ALERT_ISSUE_TITLE,
    body: `\`${FAILING_MARKER} auth-signin\``,
  };
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [openAlert] },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/900", body: {} },
  ]);
  const { outcome, alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => ({ id: "auth-signin", label: "sign-in", status: PASS, detail: "" }),
      async () => ({ id: "schema-drift", label: "drift", status: SKIPPED, detail: "#833" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(outcome, "healthy");
  assert.deepEqual(alert.closed, [900]);
});

// ── Alert body rendering ────────────────────────────────────────────────────

test("the alert issue body keeps its paragraph breaks", () => {
  const body = buildAlertIssueBody({
    results: [{ id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" }],
    runUrl: "",
  });
  assert.match(body, /\n\n/, "blank lines must survive — they are the markdown paragraph breaks");
  // The load-bearing warning must start its own paragraph, not be swallowed.
  assert.match(body, /\n\nDo not claim this issue as backlog work/);
});

test("the comment builders render the failing assertions and distinguish a reopen", () => {
  const results = [{ id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" }];
  assert.match(buildAlertCommentBody({ results, runUrl: "", reopened: true }), /reopening/);
  assert.match(buildAlertCommentBody({ results, runUrl: "", reopened: false }), /failed again/);
  assert.match(buildAlertCommentBody({ results, runUrl: "", reopened: false }), /hook/);
  assert.match(
    buildRecoveryCommentBody({ results: [{ id: "a", status: PASS }], runUrl: "" }),
    /recovered/i,
  );
});

// ── Infisical status classification ─────────────────────────────────────────

test("pending / running / never-run syncs are neither a failure nor a pass", async () => {
  // Not FAIL: a sync caught mid-window must not open a P1 about a healthy
  // store. Not PASS either: a sync wedged in `pending` because its destination
  // token was revoked is exactly the #834 signature, and calling that green —
  // which also lets it close an open alert — is the silent failure this
  // workflow exists to end.
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "render-api-staging", syncStatus: "succeeded" },
        { name: "vercel-web-staging", syncStatus: "pending" },
        { name: "brand-new-sync", syncStatus: null },
      ],
    }),
  });
  assert.equal(result.status, SKIPPED);
  assert.match(result.detail, /vercel-web-staging=pending/);
  assert.match(result.detail, /brand-new-sync=never-run/);
});

test("an unrecognised sync status skips rather than passing", async () => {
  // The enum was read from Infisical's source, never observed live. If it is
  // wrong, the classifier must fail safe.
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "render-api-staging", syncStatus: "succeeded" },
        { name: "vercel-web-staging", syncStatus: "not_synced" },
      ],
    }),
  });
  assert.equal(result.status, SKIPPED, "an unknown status must never read as green");
});

test("PASS requires every sync to have settled succeeded", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "a", syncStatus: "succeeded" },
        { name: "b", syncStatus: "succeeded" },
      ],
    }),
  });
  assert.equal(result.status, PASS);
});

test("a store where nothing has ever settled is SKIPPED, not PASS", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [{ name: "a", syncStatus: "pending" }, { name: "b", syncStatus: null }],
    }),
  });
  assert.equal(result.status, SKIPPED);
});

test("a failing sync still FAILs even when every other sync is unsettled", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    fetchImpl: infisicalFetch({
      secretSyncs: [
        { name: "vercel-landing-staging", syncStatus: "failed" },
        { name: "b", syncStatus: "pending" },
      ],
    }),
  });
  assert.equal(result.status, FAIL, "a real failure must outrank the cannot-assert case");
});

test("a failing sync surfaces lastSyncMessage, redacted", async () => {
  const result = await checkInfisicalSyncs({
    clientId: "c",
    clientSecret: "s",
    projectId: "p",
    redact: (t) => t.replace("hunter2hunter2", "***"),
    fetchImpl: infisicalFetch({
      secretSyncs: [
        {
          name: "vercel-landing-staging",
          syncStatus: "failed",
          lastSyncMessage: 'Branch "preview" not found; token hunter2hunter2',
        },
      ],
    }),
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /Branch "preview" not found/);
  assert.doesNotMatch(result.detail, /hunter2hunter2/);
});

// ── Thrown assertions and env fallbacks ─────────────────────────────────────────────────

test("a thrown assertion names which check threw and surfaces error.cause", async () => {
  const { fetchImpl } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [] },
    { method: "POST", path: "/issues", body: { number: 901 } },
  ]);
  const { results } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      {
        id: "infisical-syncs",
        label: "Every Infisical secret sync reports succeeded",
        run: async () => {
          throw new TypeError("fetch failed", {
            cause: new Error("getaddrinfo ENOTFOUND app.infisical.com"),
          });
        },
      },
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(results[0].status, FAIL);
  assert.equal(results[0].id, "infisical-syncs", "the failing check must be identifiable");
  assert.match(results[0].label, /Infisical/);
  assert.match(results[0].detail, /ENOTFOUND/, "error.cause carries the real reason");
});

test("an empty INFISICAL_PROJECT_ID falls back to .infisical.json rather than skipping", async () => {
  // GitHub renders an unset secret as "", which `??` would have kept — silently
  // downgrading the sync assertion to SKIPPED while a valid workspaceId sat in
  // the checked-in .infisical.json.
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (String(url).includes("universal-auth/login")) {
      return { ok: true, status: 200, json: async () => ({ accessToken: "at" }) };
    }
    if (String(url).includes("secret-syncs")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ secretSyncs: [{ name: "s", syncStatus: "succeeded" }] }),
      };
    }
    return { ok: true, status: 200, json: async () => [] };
  };

  const { results } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    env: {
      INFISICAL_PROJECT_ID: "",
      INFISICAL_CLIENT_ID: "c",
      INFISICAL_CLIENT_SECRET: "s",
    },
    writeSummary: () => {},
    logger: quiet,
  });

  const syncRow = results.find((r) => r.id === "infisical-syncs");
  assert.equal(syncRow.status, PASS, "must assert, not skip, on an empty env var");
  const syncCall = seen.find((u) => String(u).includes("secret-syncs"));
  assert.match(syncCall, new RegExp(`projectId=${readWorkspaceId()}`));
});

// ── The recovery gate's second half: keeping the marker current ──────────────
// Verified by mutation during review: with `refreshBodyOnRaise: true` deleted
// from the raise call, the whole suite stayed green while the gate silently
// reverted to the bug it was added to fix. These tests fail if it is removed.

test("re-raising onto an open alert refreshes its body, and the marker accumulates", async () => {
  const openAlert = {
    number: 900,
    state: "open",
    title: ALERT_ISSUE_TITLE,
    body: `\`${FAILING_MARKER} auth-hook\``,
  };
  const { fetchImpl, calls } = makeFetchMock([
    { method: "GET", path: "/issues?state=all", body: [openAlert] },
    { method: "PATCH", path: "/issues/900", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      // A different check fails today; auth-hook can no longer be asserted.
      async () => ({ id: "infisical-syncs", label: "syncs", status: FAIL, detail: "broken" }),
      async () => ({ id: "auth-hook", label: "hook", status: SKIPPED, detail: "credential gone" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });

  const patch = calls.find((c) => c.method === "PATCH");
  assert.ok(patch, "an open alert's body must be refreshed so the marker tracks current state");
  const ids = parseFailingIds(JSON.parse(patch.body).body);
  assert.ok(ids.includes("infisical-syncs"), "today's failure joins the marker");
  assert.ok(
    ids.includes("auth-hook"),
    "yesterday's unresolved failure must NOT be dropped — it only leaves the marker by PASSing",
  );
});

test("an id leaves the marker only by passing", () => {
  const previousBody = `\`${FAILING_MARKER} auth-hook,project-status\``;
  const body = buildAlertIssueBody({
    results: [
      { id: "auth-hook", status: PASS, label: "hook", detail: "" },
      { id: "project-status", status: SKIPPED, label: "status", detail: "no credential" },
      { id: "infisical-syncs", status: FAIL, label: "syncs", detail: "broken" },
    ],
    runUrl: "",
    previousBody,
  });
  assert.deepEqual(
    parseFailingIds(body).sort(),
    ["infisical-syncs", "project-status"],
    "auth-hook passed so it drops; project-status only skipped so it stays",
  );
});

test("the three-day regression the marker exists to prevent", async () => {
  // Day 1 auth-hook fails. Day 2 a different check fails while auth-hook is
  // unassertable. Day 3 that other check recovers, auth-hook still unassertable.
  // Day 3 must NOT close the alert.
  const day1 = buildAlertIssueBody({
    results: [{ id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" }],
    runUrl: "",
    previousBody: null,
  });
  const day2 = buildAlertIssueBody({
    results: [
      { id: "auth-hook", status: SKIPPED, label: "hook", detail: "credential gone" },
      { id: "infisical-syncs", status: FAIL, label: "syncs", detail: "broken" },
    ],
    runUrl: "",
    previousBody: day1,
  });
  const day3Results = [
    { id: "auth-hook", status: SKIPPED, label: "hook", detail: "credential gone" },
    { id: "infisical-syncs", status: PASS, label: "syncs", detail: "" },
  ];
  assert.equal(
    canResolveAlert({ results: day3Results, failingIds: parseFailingIds(day2) }),
    false,
    "the hook may still be disabled; nothing has shown otherwise",
  );
});

test("a failed body refresh does not suppress the failure comment", async () => {
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 900, state: "open", title: ALERT_ISSUE_TITLE, body: "" }],
    },
    { method: "PATCH", path: "/issues/900", status: 502, body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const { alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [async () => ({ id: "auth-hook", label: "hook", status: FAIL, detail: "disabled" })],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(alert.action, "commented", "the alert is already open; a cosmetic refresh failing must not abort");
  assert.equal(alert.bodyRefreshFailed, true, "but it must be surfaced");
  assert.ok(calls.some((c) => c.url.includes("/comments")), "today's failure must still be recorded");
});

// ── Round-3: the alert must not become permanently unclosable ────────────────
// Three sequences, each proven by simulation during review to strand the P1
// open forever on a healthy staging. An alert that can never clear is the
// alert-fatigue failure this file's own rationale calls the worst outcome.

test("a reopen starts from a clean marker — a close is proof the old one recovered", async () => {
  // d1 auth-signin fails -> alert opens, marker [auth-signin].
  // d2 all pass -> closed. The CLOSED body still carries the old marker.
  // d3 the smoke credential is removed (its documented default state).
  // d4 auth-hook fails -> reopen. The stale auth-signin must NOT come back,
  //    or it can never be cleared and the alert is stuck forever.
  const closedBody = buildAlertIssueBody({
    results: [{ id: "auth-signin", status: FAIL, label: "sign-in", detail: "broken" }],
    runUrl: "",
    previousBody: null,
  });
  const { fetchImpl, calls } = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 901, state: "closed", title: ALERT_ISSUE_TITLE, body: closedBody }],
    },
    { method: "PATCH", path: "/issues/901", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => ({ id: "auth-hook", label: "hook", status: FAIL, detail: "disabled" }),
      async () => ({ id: "auth-signin", label: "sign-in", status: SKIPPED, detail: "not provisioned" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  const patch = calls.find((c) => c.method === "PATCH");
  const ids = parseFailingIds(JSON.parse(patch.body).body);
  assert.deepEqual(ids, ["auth-hook"], "the settled incident's marker must not be resurrected");
});

test("a marker id the suite no longer emits cannot strand the alert", () => {
  // A check renamed or deleted after the alert was raised can never be marked
  // passing, so requiring it would keep the alert open forever.
  const results = [{ id: "project-status", status: PASS }];
  assert.equal(
    canResolveAlert({ results, failingIds: ["legacy-check"] }),
    true,
    "an id the suite no longer runs is not evidence of an unrecovered failure",
  );
  assert.equal(
    canResolveAlert({ results, failingIds: ["legacy-check", "project-status"] }),
    true,
  );
});

test("unproven-recovery records what it proved, so alternating passes converge", async () => {
  // d1: A and B both fail -> marker [A,B].
  // d2: A passes, B skipped -> unproven-recovery. A's proof must be kept.
  // d3: A skipped, B passes -> the marker should now be empty and it closes.
  // Without recording d2's proof the marker stays [A,B] forever.
  const day1 = buildAlertIssueBody({
    results: [
      { id: "a", status: FAIL, label: "A", detail: "x" },
      { id: "b", status: FAIL, label: "B", detail: "y" },
    ],
    runUrl: "",
    previousBody: null,
  });
  assert.deepEqual(parseFailingIds(day1).sort(), ["a", "b"]);

  // Day 2 through the real orchestrator.
  const d2 = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 902, state: "open", title: ALERT_ISSUE_TITLE, body: day1 }],
    },
    { method: "PATCH", path: "/issues/902", body: {} },
    { method: "POST", path: "/comments", body: {} },
  ]);
  const r2 = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl: d2.fetchImpl,
    checks: [
      async () => ({ id: "a", label: "A", status: PASS, detail: "" }),
      async () => ({ id: "b", label: "B", status: SKIPPED, detail: "cannot assert" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(r2.outcome, "unproven-recovery");
  const day2 = JSON.parse(d2.calls.find((c) => c.method === "PATCH").body).body;
  assert.deepEqual(parseFailingIds(day2), ["b"], "A was proven passing and must drop out");

  // Day 3: B passes, A can no longer be asserted. Marker is [b], b passes -> close.
  const d3 = makeFetchMock([
    {
      method: "GET",
      path: "/issues?state=all",
      body: [{ number: 902, state: "open", title: ALERT_ISSUE_TITLE, body: day2 }],
    },
    { method: "POST", path: "/comments", body: {} },
    { method: "PATCH", path: "/issues/902", body: {} },
  ]);
  const r3 = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl: d3.fetchImpl,
    checks: [
      async () => ({ id: "a", label: "A", status: SKIPPED, detail: "cannot assert" }),
      async () => ({ id: "b", label: "B", status: PASS, detail: "" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });
  assert.equal(r3.outcome, "healthy");
  assert.deepEqual(r3.alert.closed, [902], "each was proven in turn; the alert must converge");
});

test("the alert body names what is actually holding it open", () => {
  const previousBody = `\`${FAILING_MARKER} auth-signin\``;
  const body = buildAlertIssueBody({
    results: [
      { id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" },
      { id: "auth-signin", status: SKIPPED, label: "sign-in", detail: "not provisioned" },
    ],
    runUrl: "",
    previousBody,
  });
  assert.match(body, /Not yet shown to have recovered/);
  assert.match(body, /auth-signin/);
});

test("a failed alert lookup never closes an alert — unreadable is not the same as absent", async () => {
  // Proven during review by faulting exactly this one GET: the gate saw an
  // empty list, fell through, and resolveAlert's own lookup (succeeding
  // moments later) closed an alert whose gated assertion was never proven.
  // Because that assertion is SKIPPED rather than FAIL, no later run reopens
  // it — a permanent silent green.
  let firstLookup = true;
  const patches = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (method === "GET" && String(url).includes("/issues?state=all")) {
      if (firstLookup) {
        firstLookup = false;
        return { ok: false, status: 500, text: async () => "{}" };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              number: 100,
              state: "open",
              title: ALERT_ISSUE_TITLE,
              body: `\`${FAILING_MARKER} auth-hook\``,
            },
          ]),
      };
    }
    if (method === "PATCH") patches.push(init.body);
    return { ok: true, status: 200, text: async () => "{}" };
  };

  const { alert } = await runStagingConformance({
    token: "t",
    repo: "o/r",
    fetchImpl,
    checks: [
      async () => ({ id: "project-status", label: "status", status: PASS, detail: "" }),
      async () => ({ id: "auth-hook", label: "hook", status: SKIPPED, detail: "credential gone" }),
    ],
    writeSummary: () => {},
    logger: quiet,
  });

  assert.deepEqual(alert.closed, [], "an unreadable lookup must not close anything");
  assert.equal(
    patches.filter((b) => /"state":"closed"/.test(b ?? "")).length,
    0,
    "no close may be issued when the alert state could not be read",
  );
});

// ── DELEGATED is a fourth status, not a dressed-up skip ─────────────────────

test("a delegated row does not inflate or deflate the assertion score", () => {
  const summary = buildRunSummary({
    outcome: "healthy",
    results: [
      { id: "a", status: PASS, label: "A", detail: "" },
      { id: "b", status: PASS, label: "B", detail: "" },
      { id: "schema-drift", status: DELEGATED, label: "parity", detail: "owned elsewhere" },
    ],
    runUrl: "",
  });
  assert.match(summary, /2 of 2 assertions passed/, "the delegated row is not part of the denominator");
  assert.doesNotMatch(
    summary,
    /could not run/,
    "a delegation must never fire the skipped-assertion banner",
  );
  assert.match(summary, /owned by another watchdog/);
});

test("a delegated row cannot make a run inconclusive on its own", () => {
  const { outcome, delegated, passed } = classifyConformance([
    { id: "a", status: PASS },
    { id: "schema-drift", status: DELEGATED },
  ]);
  assert.equal(outcome, "healthy");
  assert.equal(delegated.length, 1);
  assert.equal(passed.length, 1);
});

test("an all-delegated run is inconclusive — a pointer is not evidence", () => {
  const { outcome } = classifyConformance([{ id: "schema-drift", status: DELEGATED }]);
  assert.equal(outcome, "inconclusive");
});

test("a delegated id can never strand the alert, even if it reaches the marker", () => {
  // Unreachable today (a delegated row cannot FAIL, so it cannot enter the
  // marker), but the gate must not depend on that staying true: schema-drift
  // can never PASS, so requiring it would keep the alert open forever.
  assert.equal(
    canResolveAlert({
      results: [
        { id: "auth-hook", status: PASS },
        { id: "schema-drift", status: DELEGATED },
      ],
      failingIds: ["auth-hook", "schema-drift"],
    }),
    true,
  );
});
