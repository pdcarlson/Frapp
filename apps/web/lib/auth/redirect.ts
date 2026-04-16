"use client";

const DEFAULT_DASHBOARD_PATH = "/members";

export function resolveRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) {
    return DEFAULT_DASHBOARD_PATH;
  }
  return value;
}

export function createDashboardRedirectPath(pathname = "/members") {
  return pathname.startsWith("/") ? pathname : DEFAULT_DASHBOARD_PATH;
}
