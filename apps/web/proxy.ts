import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const AUTH_ROUTES = ["/sign-in", "/sign-up"];
const DASHBOARD_ROUTE_PREFIX = "/members";
const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/members",
  "/events",
  "/points",
  "/billing",
  "/join",
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

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const { pathname, search } = request.nextUrl;

  if (needsAuth(pathname) && !session) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    return NextResponse.redirect(signInUrl, { headers: response.headers });
  }

  if (session && isAuthRoute(pathname)) {
    const redirectTo = request.nextUrl.searchParams.get("redirectTo");
    const destination = request.nextUrl.clone();
    destination.pathname =
      redirectTo && redirectTo.startsWith("/")
        ? redirectTo
        : DASHBOARD_ROUTE_PREFIX;
    destination.search = "";
    return NextResponse.redirect(destination, { headers: response.headers });
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/sign-in",
    "/sign-up",
    "/join",
    "/dashboard/:path*",
    "/members/:path*",
    "/events/:path*",
    "/points/:path*",
    "/billing/:path*",
  ],
};
