import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const AUTH_ROUTES = ["/sign-in", "/sign-up"];
const DASHBOARD_ROUTE_PREFIX = "/home";
const PROTECTED_ROUTE_PREFIXES = [
  "/home",
  "/dashboard",
  "/members",
  "/alumni",
  "/roles",
  "/events",
  "/tasks",
  "/points",
  "/billing",
  "/profile",
  "/settings",
  "/join",
  "/no-access",
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
 * module can be imported in environments without Supabase env vars — notably
 * the CI Playwright job, which boots `npm run dev` to capture visual
 * regression baselines and does not have production secrets.
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

  const { pathname, search } = request.nextUrl;
  const env = readSupabaseEnv();

  // Environments without Supabase credentials, or with SUPABASE_AUTH_BYPASS
  // set (e.g. the Playwright visual regression job in CI), cannot make auth
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
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl, {
      headers: responseHolder.current.headers,
    });
  }

  if (session && isAuthRoute(pathname)) {
    const redirectTo = request.nextUrl.searchParams.get("redirectTo");
    const destination = request.nextUrl.clone();
    destination.pathname =
      redirectTo && redirectTo.startsWith("/")
        ? redirectTo
        : DASHBOARD_ROUTE_PREFIX;
    destination.search = "";
    return NextResponse.redirect(destination, {
      headers: responseHolder.current.headers,
    });
  }

  return responseHolder.current;
}

export const config = {
  matcher: [
    "/",
    "/sign-in",
    "/sign-up",
    "/join",
    "/home/:path*",
    "/dashboard/:path*",
    "/members/:path*",
    "/alumni/:path*",
    "/roles/:path*",
    "/events/:path*",
    "/tasks/:path*",
    "/points/:path*",
    "/billing/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/no-access",
  ],
};
