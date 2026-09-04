"use client";

const DEFAULT_DASHBOARD_PATH = "/chat";

export function resolveRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) {
    return DEFAULT_DASHBOARD_PATH;
  }
  return value;
}
