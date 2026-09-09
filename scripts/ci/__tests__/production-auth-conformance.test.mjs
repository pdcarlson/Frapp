import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getEnvironment } from "../lib/environments.mjs";
import {
  ALERT_ISSUE_TITLE as STAGING_ALERT_TITLE,
  AUTH_SMTP_SENDER_NAME,
  FAIL,
  PASS,
  SKIPPED,
  STAGING_COPY,
} from "../staging-conformance.mjs";
import {
  ALERT_ISSUE_TITLE,
  DEFAULT_CHECK_IDS,
  PRODUCTION_AUTH_COPY,
  PRODUCTION_AUTH_SMTP_ADMIN_EMAIL,
  PRODUCTION_SITE_URL,
  buildAlertCommentBody,
  buildAlertIssueBody,
  buildRecoveryCommentBody,
  buildRunSummary,
  productionProjectRef,
  runProductionAuthConformance,
} from "../production-auth-conformance.mjs";
import { makeFetchMock, quiet } from "./helpers.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "production-auth-conformance.yml");
const SCRIPT = join(REPO_ROOT, "scripts", "ci", "production-auth-conformance.mjs");
const ALERT_ROUTING = join(REPO_ROOT, "docs", "internal", "ops", "ALERT_ROUTING.md");
const REQUIRED_CHECKS = join(REPO_ROOT, "scripts", "ci", "lib", "required-checks.mjs");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

const PRODUCTION_REF = getEnvironment("production").supabaseProjectRef;
const STAGING_REF = getEnvironment("staging").supabaseProjectRef;

const SIGNET_MAGIC_LINK = {
  mailer_subjects_magic_link: "Sign in to Signet",
  mailer_templates_magic_link_content:
    '<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink">Sign in to Signet</a>',
};

const HEALTHY_AUTH = {
  hook_custom_access_token_enabled: true,
  hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook",
  site_url: PRODUCTION_SITE_URL,
  uri_allow_list: `${PRODUCTION_SITE_URL},${PRODUCTION_SITE_URL}/**,frapp://**`,
  // Hosted-cap SMTP on purpose: the default run must SKIP auth-smtp and
  // auth-magic-link, not FAIL, until #1824 turns production SMTP on.
  smtp_host: "",
  smtp_admin_email: "",
  rate_limit_email_sent: 2,
  smtp_pass: "must-never-appear-in-detail",
  mailer_subjects_magic_link: "Your Magic Link",
  mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Log In</a>',
};

function jsonOk(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function jsonErr(status) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => "{}",
  };
}

function combinedFetch({
  auth = HEALTHY_AUTH,
  status = "ACTIVE_HEALTHY",
  githubRoutes = [],
  projectRef = PRODUCTION_REF,
} = {}) {
  const gh = makeFetchMock(githubRoutes);
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("api.supabase.com")) {
      if (u.includes(`/projects/${projectRef}/config/auth`)) return jsonOk(auth);
      if (u.includes(`/v1/projects/${projectRef}`)) return jsonOk({ status });
      return jsonErr(404);
    }
    return gh.fetchImpl(url, init);
  };
  return { fetchImpl, calls: gh.calls, record: gh };
}

function uncommented(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("identity", () => {
  it("uses a distinct alert title from staging conformance", () => {
    assert.notEqual(ALERT_ISSUE_TITLE, STAGING_ALERT_TITLE);
    assert.equal(ALERT_ISSUE_TITLE, "Production Auth settings have drifted");
  });

  it("pins the production Site URL first users actually hit", () => {
    assert.equal(PRODUCTION_SITE_URL, "https://app.frapp.live");
  });

  it("pins the production Auth SMTP From first users must not burn", () => {
    assert.equal(PRODUCTION_AUTH_SMTP_ADMIN_EMAIL, "no-reply@mail.frapp.live");
  });

  it("pins the Auth SMTP sender display name both projects must keep", () => {
    assert.equal(AUTH_SMTP_SENDER_NAME, "Signet");
  });

  it("reads the production ref from environments.json, never from the argument name", () => {
    assert.equal(productionProjectRef(), PRODUCTION_REF);
    assert.notEqual(PRODUCTION_REF, STAGING_REF);
    assert.match(PRODUCTION_REF, /^[a-z0-9]{15,20}$/);
  });

  it("default checks include skip-until-on SMTP and Magic Link, not staging-only probes", () => {
    assert.deepEqual([...DEFAULT_CHECK_IDS], [
      "project-status",
      "auth-hook",
      "auth-redirects",
      "auth-smtp",
      "auth-magic-link",
    ]);
    assert.ok(!DEFAULT_CHECK_IDS.includes("auth-signin"));
    assert.ok(!DEFAULT_CHECK_IDS.includes("infisical-syncs"));
  });
});

describe("default assertions", () => {
  it("hits the committed production ref even when SUPABASE_PROJECT_REF is staging", async () => {
    const seen = [];
    const { fetchImpl } = combinedFetch({
      githubRoutes: [{ method: "GET", path: "/issues?state=all", body: [] }],
    });
    const wrapped = async (url, init) => {
      seen.push(String(url));
      return fetchImpl(url, init);
    };
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl: wrapped,
      env: {
        SUPABASE_ACCESS_TOKEN: "tok",
        SUPABASE_PROJECT_REF: STAGING_REF,
      },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "healthy");
    assert.deepEqual(
      results.map((r) => r.id),
      ["project-status", "auth-hook", "auth-redirects", "auth-smtp", "auth-magic-link"],
    );
    const smtp = results.find((r) => r.id === "auth-smtp");
    assert.equal(smtp.status, SKIPPED);
    assert.match(smtp.detail, /2\/hour cap/);
    assert.match(smtp.detail, /no-reply@mail\.frapp\.live/);
    assert.doesNotMatch(smtp.detail, /must-never-appear-in-detail/);
    const magic = results.find((r) => r.id === "auth-magic-link");
    assert.equal(magic.status, SKIPPED);
    assert.match(magic.detail, /smtp_host is empty/);
    assert.doesNotMatch(magic.detail, /must-never-appear-in-detail/);
    assert.doesNotMatch(magic.detail, /ConfirmationURL/);
    assert.equal(
      results.filter((r) => r.id !== "auth-smtp" && r.id !== "auth-magic-link").every((r) => r.status === PASS),
      true,
    );
    assert.ok(seen.some((u) => u.includes(PRODUCTION_REF)));
    assert.equal(
      seen.filter((u) => u.includes("api.supabase.com") && u.includes(STAGING_REF)).length,
      0,
      "injected staging ref must not retarget the Management API calls",
    );
  });

  it("skips rather than fails when the Management API token is missing — inconclusive, alert stays open", async () => {
    const { fetchImpl, calls } = combinedFetch({
      githubRoutes: [
        {
          method: "GET",
          path: "/issues?state=all",
          body: [
            {
              number: 900,
              state: "open",
              title: ALERT_ISSUE_TITLE,
              body: "`conformance-failing: auth-hook`",
            },
          ],
        },
        { method: "PATCH", path: "/issues/900", body: {} },
      ],
    });
    const { outcome, results, alert } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_REF: PRODUCTION_REF },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "inconclusive");
    assert.ok(results.every((r) => r.status === SKIPPED));
    assert.deepEqual(alert.closed, []);
    assert.equal(
      calls.filter((c) => c.method === "PATCH" && /"state":"closed"/.test(c.body ?? "")).length,
      0,
    );
  });

  it("fails when the hook is disabled", async () => {
    const { fetchImpl, calls } = combinedFetch({
      auth: { ...HEALTHY_AUTH, hook_custom_access_token_enabled: false },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 901 } },
      ],
    });
    const { outcome, results, alert } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const hook = results.find((r) => r.id === "auth-hook");
    assert.equal(hook.status, FAIL);
    assert.match(hook.detail, /x-chapter-id/);
    assert.equal(alert.action, "created");
    const created = calls.find((c) => c.method === "POST" && c.url.includes("/issues"));
    assert.match(created.body, /Production Auth settings have drifted/);
    assert.doesNotMatch(created.body, new RegExp(STAGING_ALERT_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("fails when the mobile scheme is missing from the allow list", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        uri_allow_list: `${PRODUCTION_SITE_URL},${PRODUCTION_SITE_URL}/**`,
      },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 902 } },
      ],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const redirects = results.find((r) => r.id === "auth-redirects");
    assert.equal(redirects.status, FAIL);
    assert.match(redirects.detail, /frapp:\/\/\*\*/);
  });

  it("fails when site_url is the staging origin even if staging wildcards are present", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        site_url: "https://app.staging.frapp.live",
        uri_allow_list:
          "https://app.staging.frapp.live,https://app.staging.frapp.live/**,frapp://**",
      },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 903 } },
      ],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const redirects = results.find((r) => r.id === "auth-redirects");
    assert.equal(redirects.status, FAIL);
    assert.match(redirects.detail, /app\.staging\.frapp\.live/);
    assert.match(redirects.detail, /app\.frapp\.live/);
  });

  it("fails the run when production SMTP is on with the burned apex From", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        smtp_host: "smtp.resend.com",
        smtp_admin_email: "invites@frapp.live",
        smtp_sender_name: "Signet",
        rate_limit_email_sent: 300,
        ...SIGNET_MAGIC_LINK,
      },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 904 } },
      ],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const smtp = results.find((r) => r.id === "auth-smtp");
    assert.equal(smtp.status, FAIL);
    assert.match(smtp.detail, /invites@frapp\.live/);
    assert.match(smtp.detail, /no-reply@mail\.frapp\.live/);
    assert.doesNotMatch(smtp.detail, /must-never-appear-in-detail/);
  });

  it("fails the run when production SMTP uses the staging From", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        smtp_host: "smtp.resend.com",
        smtp_admin_email: "no-reply@mail.staging.frapp.live",
        smtp_sender_name: "Signet",
        rate_limit_email_sent: 300,
        ...SIGNET_MAGIC_LINK,
      },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 905 } },
      ],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const smtp = results.find((r) => r.id === "auth-smtp");
    assert.equal(smtp.status, FAIL);
    assert.match(smtp.detail, /mail\.staging\.frapp\.live/);
    assert.match(smtp.detail, /no-reply@mail\.frapp\.live/);
  });

  it("fails the run when production SMTP is on with a leftover Frapp sender", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        smtp_host: "smtp.resend.com",
        smtp_admin_email: "no-reply@mail.frapp.live",
        smtp_sender_name: "Frapp",
        rate_limit_email_sent: 300,
        ...SIGNET_MAGIC_LINK,
      },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 1946 } },
      ],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const smtp = results.find((r) => r.id === "auth-smtp");
    assert.equal(smtp.status, FAIL);
    assert.match(smtp.detail, /smtp_sender_name is "Frapp"/);
    assert.match(smtp.detail, /Signet/);
    assert.doesNotMatch(smtp.detail, /must-never-appear-in-detail/);
  });

  it("passes auth-smtp when production SMTP is Resend, mail.frapp.live, Signet sender, and 300/hour", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        smtp_host: "smtp.resend.com",
        smtp_admin_email: "no-reply@mail.frapp.live",
        smtp_sender_name: "Signet",
        rate_limit_email_sent: 300,
        ...SIGNET_MAGIC_LINK,
      },
      githubRoutes: [{ method: "GET", path: "/issues?state=all", body: [] }],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "healthy");
    const smtp = results.find((r) => r.id === "auth-smtp");
    assert.equal(smtp.status, PASS);
    assert.match(smtp.detail, /no-reply@mail\.frapp\.live/);
    assert.match(smtp.detail, /300\/hour/);
    assert.doesNotMatch(smtp.detail, /must-never-appear-in-detail/);
    assert.equal(results.every((r) => r.status === PASS), true);
  });

  it("fails when production SMTP is on but still at the hosted 2/hour cap", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        smtp_host: "smtp.resend.com",
        smtp_admin_email: "no-reply@mail.frapp.live",
        smtp_sender_name: "Signet",
        rate_limit_email_sent: 2,
        ...SIGNET_MAGIC_LINK,
      },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 906 } },
      ],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const smtp = results.find((r) => r.id === "auth-smtp");
    assert.equal(smtp.status, FAIL);
    assert.match(smtp.detail, /2\/hour/);
  });

  it("fails the run when production SMTP is on but Magic Link still uses ConfirmationURL", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        smtp_host: "smtp.resend.com",
        smtp_admin_email: "no-reply@mail.frapp.live",
        smtp_sender_name: "Signet",
        rate_limit_email_sent: 300,
        // Signet subject so this FAIL is the leftover ConfirmationURL href,
        // not the hosted "Your Magic Link" subject failing first.
        ...SIGNET_MAGIC_LINK,
        mailer_templates_magic_link_content: '<a href="{{ .ConfirmationURL }}">Log In</a>',
      },
      githubRoutes: [
        { method: "GET", path: "/issues?state=all", body: [] },
        { method: "POST", path: "/issues", body: { number: 907 } },
      ],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "failed");
    const magic = results.find((r) => r.id === "auth-magic-link");
    assert.equal(magic.status, FAIL);
    assert.match(magic.detail, /ConfirmationURL/);
    assert.match(magic.detail, /supabase\.co/);
    assert.doesNotMatch(magic.detail, /must-never-appear-in-detail/);
    const smtp = results.find((r) => r.id === "auth-smtp");
    assert.equal(smtp.status, PASS);
  });

  it("passes auth-magic-link when production SMTP is on and the template has token_hash", async () => {
    const { fetchImpl } = combinedFetch({
      auth: {
        ...HEALTHY_AUTH,
        smtp_host: "smtp.resend.com",
        smtp_admin_email: "no-reply@mail.frapp.live",
        smtp_sender_name: "Signet",
        rate_limit_email_sent: 300,
        ...SIGNET_MAGIC_LINK,
      },
      githubRoutes: [{ method: "GET", path: "/issues?state=all", body: [] }],
    });
    const { outcome, results } = await runProductionAuthConformance({
      token: "t",
      repo: "o/r",
      fetchImpl,
      env: { SUPABASE_ACCESS_TOKEN: "tok" },
      writeSummary: () => {},
      logger: quiet,
    });
    assert.equal(outcome, "healthy");
    const magic = results.find((r) => r.id === "auth-magic-link");
    assert.equal(magic.status, PASS);
    assert.match(magic.detail, /token_hash href/);
    assert.doesNotMatch(magic.detail, /RedirectTo/);
    assert.doesNotMatch(magic.detail, /must-never-appear-in-detail/);
  });
});

describe("alert contract", () => {
  it("does not close an open alert when the gated check merely skipped", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        method: "GET",
        path: "/issues?state=all",
        body: [
          {
            number: 900,
            state: "open",
            title: ALERT_ISSUE_TITLE,
            body: "`conformance-failing: auth-hook`",
          },
        ],
      },
      { method: "PATCH", path: "/issues/900", body: {} },
    ]);
    const { outcome, alert } = await runProductionAuthConformance({
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
    assert.equal(outcome, "unproven-recovery");
    assert.deepEqual(alert.closed, []);
    assert.equal(
      calls.filter((c) => c.method === "PATCH" && /"state":"closed"/.test(c.body ?? "")).length,
      0,
    );
  });

  it("a failed alert lookup never closes an alert", async () => {
    const patches = [];
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? "GET";
      if (method === "GET" && String(url).includes("/issues?state=all")) {
        return { ok: false, status: 500, text: async () => "{}" };
      }
      if (method === "PATCH") patches.push(init.body);
      return { ok: true, status: 200, text: async () => "{}" };
    };
    const { alert } = await runProductionAuthConformance({
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
    assert.deepEqual(alert.closed, []);
    assert.equal(
      patches.filter((b) => /"state":"closed"/.test(b ?? "")).length,
      0,
    );
  });

  it("alert body names production, not staging, and keeps the failing marker", () => {
    const body = buildAlertIssueBody({
      results: [{ id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" }],
      runUrl: "",
    });
    assert.match(body, /Production Auth settings have drifted/);
    assert.match(body, /production-auth-conformance/);
    assert.match(body, /frapp-prod/);
    assert.doesNotMatch(body, /frapp-staging has drifted/);
    assert.match(body, /conformance-failing:\s*auth-hook/);
    assert.doesNotMatch(body, /smtp_pass/);
    assertNoStagingVoice(body);
  });

  it("summary, comments, and recovery own production voice — they do not rewrite staging strings", () => {
    const results = [{ id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" }];
    const passing = [{ id: "auth-hook", status: PASS, label: "hook", detail: "enabled" }];
    const summary = buildRunSummary({ outcome: "failed", results, runUrl: "" });
    const comment = buildAlertCommentBody({ results, runUrl: "", reopened: true });
    const failedAgain = buildAlertCommentBody({ results, runUrl: "", reopened: false });
    const recovery = buildRecoveryCommentBody({ results: passing, runUrl: "" });
    const inconclusive = buildRunSummary({
      outcome: "inconclusive",
      results: [{ id: "auth-smtp", status: SKIPPED, label: "smtp", detail: "unset" }],
      runUrl: "",
    });

    assert.match(summary, /## Production Auth conformance/);
    assert.match(summary, /frapp-prod Auth settings have drifted/);
    assert.match(comment, /Production Auth settings have drifted again/);
    assert.match(failedAgain, /Production Auth settings failed again/);
    assert.match(recovery, /Production Auth settings recovered/);
    assert.match(inconclusive, /proves nothing about production Auth/);
    for (const text of [summary, comment, failedAgain, recovery, inconclusive]) {
      assertNoStagingVoice(text);
    }
  });

  it("production copy defines every staging copy key so a new phrase cannot leak", () => {
    assert.deepEqual(
      Object.keys(PRODUCTION_AUTH_COPY).sort(),
      Object.keys(STAGING_COPY).sort(),
    );
    for (const [key, value] of Object.entries(PRODUCTION_AUTH_COPY)) {
      const rendered =
        typeof value === "function" ? String(value(1, 2)) : String(value);
      assertNoStagingVoice(rendered);
      assert.ok(rendered.length > 0, `${key} must not be empty`);
    }
  });

  it("ignores a caller-supplied staging copy so production voice cannot be overridden", () => {
    const body = buildAlertIssueBody({
      results: [{ id: "auth-hook", status: FAIL, label: "hook", detail: "disabled" }],
      runUrl: "",
      copy: STAGING_COPY,
    });
    assertNoStagingVoice(body);
    assert.match(body, /frapp-prod/);
  });
});

function assertNoStagingVoice(text) {
  assert.doesNotMatch(text, /frapp-staging/);
  assert.doesNotMatch(text, /Staging conformance/);
  assert.doesNotMatch(text, /staging-conformance\.yml/);
  assert.doesNotMatch(text, /staging-conformance\.mjs/);
  assert.doesNotMatch(text, /proves nothing about staging/);
  assert.doesNotMatch(text, /See #838\./);
}

describe("workflow wiring", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const liveYaml = uncommented(workflow);
  const script = readFileSync(SCRIPT, "utf8");
  const routing = readFileSync(ALERT_ROUTING, "utf8");
  const roster = readFileSync(REQUIRED_CHECKS, "utf8");

  it("does not name environment: production — a schedule job that did would suspend on #1435", () => {
    assert.doesNotMatch(liveYaml, /^\s*environment:\s*production\s*$/m);
    assert.doesNotMatch(liveYaml, /environment:\s*production/);
    assert.doesNotMatch(liveYaml, /environment:\s*["']production["']/);
  });

  it("is schedule + workflow_dispatch only — not a required PR check", () => {
    assert.match(workflow, /cron: "45 7 \* \* \*"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request:/);
    assert.doesNotMatch(roster, /production-auth-conformance/);
  });

  it("injects Infisical prod, not staging, and continues on a revoked identity", () => {
    assert.match(liveYaml, /env-slug:\s*"prod"/);
    assert.doesNotMatch(liveYaml, /env-slug:\s*"staging"/);
    assert.match(liveYaml, /continue-on-error:\s*true/);
    assert.match(liveYaml, /on-missing-credentials:\s*warn/);
    assert.match(workflow, /node scripts\/ci\/production-auth-conformance\.mjs/);
  });

  it("no other daily schedule shares 07:45", () => {
    for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      if (file === "production-auth-conformance.yml") continue;
      const text = uncommented(readFileSync(join(WORKFLOWS_DIR, file), "utf8"));
      assert.doesNotMatch(
        text,
        /cron:\s*"45 7 \* \* \*"/,
        `${file} collides with production-auth-conformance.yml at 07:45 UTC`,
      );
    }
  });

  it("ALERT_ROUTING.md lists this alert title so the roster cannot drop it again", () => {
    assert.ok(
      routing.includes(ALERT_ISSUE_TITLE),
      "ALERT_ROUTING.md must name the new alert; #1674 was this exact miss for guardrails",
    );
  });

  it("the script refuses a GitHub closer in its alert copy", () => {
    assert.doesNotMatch(script, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
  });

  it("owns production voice instead of replaceAll-rewriting staging strings", () => {
    assert.doesNotMatch(script, /rewriteStagingCopy/);
    assert.doesNotMatch(script, /replaceAll\(/);
    assert.match(script, /PRODUCTION_AUTH_COPY/);
  });

  it("requires GitHub credentials before asserting when invoked as main", () => {
    const main = script.slice(script.indexOf("async function main()"));
    const tokenIdx = main.indexOf('requireEnv("GITHUB_TOKEN")');
    const runIdx = main.indexOf("await runProductionAuthConformance");
    assert.ok(tokenIdx !== -1, "main() must require GITHUB_TOKEN");
    assert.ok(runIdx !== -1, "main() must run the suite");
    assert.ok(tokenIdx < runIdx, "a missing token must not look like a successful watch of production");
  });
});
