/**
 * The sign-up hosts Activity gathers, and what each is called (#4215,
 * `spec/behavior/activity.md` § Links).
 *
 * Two copies of the list exist. `activity_action_links` in the database
 * (`20261111030000_activity_links.sql`) decides what is gathered, and this
 * matcher is the TypeScript one: the page's kind label (`activityLinkKind` in
 * `@repo/hooks`) and the API's title read allowlist (`fetchableUrl` in
 * `apps/api`) both call it. SQL can't share code, so
 * `sign-up-link-fixtures.json` holds the URLs both must agree on: this
 * package's spec runs them through the matcher, and the PGlite
 * `activity-links` tier runs them through the database function. That holds
 * the copies together only on the URLs listed, so a widening changes both
 * copies and adds a fixture. One known difference: a caller passes
 * `URL.pathname`, whose dot segments are resolved, where the database reads
 * the path as written (#4928).
 */

export type SignUpLinkKind =
  | "Google Form"
  | "Google Sheet"
  | "Google Doc"
  | "Microsoft Form"
  | "Typeform"
  | "SignUpGenius"
  | "Calendly";

/** The `docs.google.com` file types gathered, after an optional Workspace `/a/<domain>` prefix. */
const GOOGLE_DOCS_PATH = /^(?:\/a\/[^/]+)?\/(forms|spreadsheets|document)\//i;

const GOOGLE_DOCS_KIND: Record<string, SignUpLinkKind> = {
  forms: "Google Form",
  spreadsheets: "Google Sheet",
  document: "Google Doc",
};

/**
 * What a sign-up link is, from its host and path, or `null` when it is not
 * one. The host is compared lowercased with a leading `www.` dropped, as the
 * database does; the path is matched case-insensitively.
 */
export function signUpLinkKind(
  host: string,
  path: string,
): SignUpLinkKind | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h === "docs.google.com") {
    const type = GOOGLE_DOCS_PATH.exec(path)?.[1]?.toLowerCase();
    return type ? (GOOGLE_DOCS_KIND[type] ?? null) : null;
  }
  if (h === "forms.gle") return "Google Form";
  if (
    h === "forms.office.com" ||
    h === "forms.microsoft.com" ||
    h === "forms.cloud.microsoft"
  ) {
    return "Microsoft Form";
  }
  if (h === "typeform.com" || h.endsWith(".typeform.com")) return "Typeform";
  if (h === "signupgenius.com" || h.endsWith(".signupgenius.com")) {
    return "SignUpGenius";
  }
  // `calendly.com` only: the database never gathers a subdomain.
  if (h === "calendly.com") return "Calendly";
  return null;
}
