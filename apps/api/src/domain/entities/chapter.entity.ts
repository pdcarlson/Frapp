export type SubscriptionStatus = 'incomplete' | 'active' | 'past_due' | 'canceled';

export interface Chapter {
  id: string;
  name: string;
  university: string;
  stripe_customer_id: string | null;
  subscription_status: SubscriptionStatus;
  subscription_id: string | null;
  accent_color: string | null;
  logo_path: string | null;
  donation_url: string | null;
  created_at: string;
  updated_at: string;
}
