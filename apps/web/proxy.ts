import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { assignResolvedRedirect } from "./lib/auth/redirect";

export const AUTH_ROUTES = ["/sign-in", "/sign-up"];
export const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/activity",
  "/members",
  "/alumni",
  "/roles",
  "/events",
  "/tasks",
  "/service",
  "/documents",
  "/backwork",
  "/discord-import",
  "/geofences",
  "/study",
  "/chat",
  "/chat-admin",
  "/points",
  "/billing",
  "/reports",
  "/profile",
  "/settings",
  "/join",
  "/no-access",
  "/new-account",
];

function needsAuth(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Where an unsigned request for a gated path is sent.
 *
 * `NextURL.clone()` keeps the inbound query string. An invite link
 * `/join?token=…` would otherwise land on
 * `/sign-in?token=…&redirectTo=/join?token=…`, putting the invite token in
 * two places. The sign-in page does not read `token`, but Vercel logs,
 * Referer headers, and any future auth-token parser would. The invite belongs
 * only inside `redirectTo`, which is how the join page itself builds this
 * hop (`app/(auth)/join/page.tsx`).
 */
export function buildSignInRedirectUrl(requestUrl: URL): URL {
  const destination = new URL(requestUrl.href);
  const redirectTo = `${requestUrl.pathname}${requestUrl.search}`;
  destination.pathname = "/sign-in";
  destination.search = "";
  destination.hash = "";
  destination.searchParams.set("redirectTo", redirectTo);
  return destination;
}

type CookieTuple = { name: string; value: string; options: CookieOptions };

type ResponseHolder = { current: NextResponse };

type SupabaseEnv = {
  url: string;
  anonKey: string;
};

function readSupabaseEnv(): SupabaseEnv | null {
  if (
    process.env.SUPABASE_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return null;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Supabase env vars missing in production. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    return null;
  }
  return { url, anonKey };
}

/**
 * Lazy Supabase server-client factory.
 *
 * `createServerClient` is invoked per request (never at module load) so this
 * module can be imported in environments without production Supabase secrets.
 *
 * The CI Playwright job (`web-responsive-floor`) is not an example of the
 * missing-vars path, despite being the usual reason this matters:
 * `playwright.config.ts` injects stand-ins for both vars, so it reaches
 * passthrough via the `SUPABASE_AUTH_BYPASS` branch in `readSupabaseEnv()`
 * instead — see the comment at the `if (!env)` guard below.
 */
function createSupabaseProxyClient(
  env: SupabaseEnv,
  request: NextRequest,
  responseHolder: ResponseHolder,
) {
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieTuple[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        responseHolder.current = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          responseHolder.current.cookies.set(name, value, options),
        );
      },
    },
  });
}

export async function proxy(request: NextRequest) {
  const responseHolder: ResponseHolder = {
    current: NextResponse.next({
      request: {
        headers: request.headers,
      },
    }),
  };

  const { pathname } = request.nextUrl;
  const env = readSupabaseEnv();

  // Environments without Supabase credentials, or with SUPABASE_AUTH_BYPASS
  // set (e.g. the Playwright `web-responsive-floor` job in CI), cannot make auth
  // decisions. All routes proceed without redirects so pages render their
  // actual content. Real deployments always have valid env vars and never
  // set the bypass flag.
  if (!env) {
    return responseHolder.current;
  }

  const supabase = createSupabaseProxyClient(env, request, responseHolder);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (needsAuth(pathname) && !session) {
    const signInUrl = buildSignInRedirectUrl(request.nextUrl);
    return NextResponse.redirect(signInUrl, {
      headers: responseHolder.current.headers,
    });
  }

  if (session && isAuthRoute(pathname)) {
    const destination = request.nextUrl.clone();
    assignResolvedRedirect(
      destination,
      request.nextUrl.searchParams.get("redirectTo"),
    );
    return NextResponse.redirect(destination, {
      headers: responseHolder.current.headers,
    });
  }

  return responseHolder.current;
}

/**
 * Which requests run the proxy at all.
 *
 * On Vercel the proxy is its own function invocation, billed as Fluid Active
 * CPU on top of the page render it guards. The `(dashboard)` layout is dynamic
 * (it reads cookies), so every visible nav `<Link>` prefetches with a server
 * request, and about twenty of them fire on each dashboard page load. Running
 * the session check on those doubled the function count for nothing, so the
 * second entry below skips router prefetches (`next-router-prefetch`) for the
 * `(dashboard)` routes only. That is safe there, and only there, because:
 *
 * - A prefetch of a dynamic route stops at its `loading.tsx` boundary, so the
 *   real navigation is always a separate, non-prefetch request, and the proxy
 *   runs on that one.
 * - The dashboard renders no member data on the server. Data comes from the
 *   API with the member's own token, so an unsigned prefetch gets an empty
 *   shell and no more.
 *
 * Everything else keeps the proxy on every request, prefetch or not:
 *
 * - `/`, the auth routes, `/join`, `/no-access` and `/dashboard` are static.
 *   Next prefetches a static route whole and reuses that for the navigation
 *   with no second request, so a skipped prefetch would skip the redirect.
 * - `/new-account` is dynamic (it reads the session and its query on the
 *   server) but sits in the `(auth)` group, which has no `loading.tsx` for a
 *   prefetch to stop at, so it keeps the proxy on prefetches too.
 * - `/` stays the plain string because Next only adds the root's transport
 *   forms (`/index.rsc` and the like) to a source that is exactly `"/"`.
 * - Only Next's own header is excluded, not the browser's `Purpose: prefetch`.
 *   A browser prerender is activated as the navigation itself.
 *
 * The dashboard skip also assumes nothing does a *full* prefetch of a dashboard
 * route (`prefetch={true}` on a `<Link>`, or `router.prefetch` with the full
 * kind), which is reused the same way. Nothing does one today.
 *
 * Next reads this object statically at build time, so it must stay a literal:
 * a `.map()` over `PROTECTED_ROUTE_PREFIXES` would be silently ignored. That
 * is why the dashboard prefixes are written out again in the regex.
 * `tests/proxy.spec.ts` compiles this with Next's own matcher code and checks
 * it against both arrays above, so the two cannot drift apart unnoticed.
 */
export const config = {
  matcher: [
    "/",
    "/sign-in",
    "/sign-up",
    "/join",
    "/no-access",
    "/new-account",
    "/dashboard/:path*",
    {
      source:
        "/((?:activity|members|alumni|roles|events|tasks|service|documents|backwork|discord-import|geofences|study|chat|chat-admin|points|billing|reports|profile|settings)(?:/.*)?)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
