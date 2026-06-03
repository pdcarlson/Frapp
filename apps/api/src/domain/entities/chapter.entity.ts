export type SubscriptionStatus =
  | 'incomplete'
  | 'active'
  | 'past_due'
  | 'canceled';

export interface Chapter {
  id: string;
  name: string;
  university: string;
  stripe_customer_id: string | null;
  subscription_status: SubscriptionStatus;
  subscription_id: string | null;
  // Timestamp the chapter entered `past_due` (null otherwise). Drives the
  // 3-day grace window in ChapterGuard (FRA-109, spec/behavior/billing.md).
  past_due_since: string | null;
  accent_color: string | null;
  logo_path: string | null;
  donation_url: string | null;
  created_at: string;
  updated_at: string;
  // Chunk 02 customization columns (jsonb / nullable). Optional here because
  // the base list/detail projections don't always select them; the onboarding
  // flow (Chunk 03) writes them at creation time.
  org_archetype?: string;
  enabled_modules?: Record<string, boolean>;
  vocabulary?: Record<string, unknown>;
  branding?: Record<string, unknown>;
  theme_palette?: Record<string, unknown>;
  directory_id?: string | null;
  beta_config?: Record<string, unknown>;
}
