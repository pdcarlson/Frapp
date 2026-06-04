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
  // High-water mark: the Stripe `event.created` of the most recently applied
  // subscription webhook (null until the first one lands). Enforces
  // timestamp-aware ordering so a stale/retried event can't overwrite a newer
  // subscription status (FRA-242, spec/behavior/billing.md).
  last_stripe_webhook_at: string | null;
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
  // FRA-17: Terms/Privacy acceptance captured at chapter creation
  // (spec/behavior/legal.md), stamped server-side from the session actor at
  // onboard time. Optional because narrower projections (e.g. ChapterGuard)
  // select only specific columns; the main repository read uses select('*'),
  // which does return these.
  legal_accepted_at?: string | null;
  legal_policy_version?: string | null;
  legal_accepted_by?: string | null;
}
