# Onboarding Flow

## Chapter Creation

1. Prospect visits frapp.live, clicks "Get Started."
2. Redirected to app.frapp.live sign-up (Supabase Auth).
3. After authentication, enters chapter details (name, university).
4. **Accepts Terms of Service and Privacy Policy** (required checkbox).
5. API creates chapter with `subscription_status: incomplete`.
6. Default system roles and default channels (#general, #announcements, #alumni) are seeded.

Payment is **not** part of chapter creation. Nothing in the onboarding path touches Stripe — the chapter lands at `incomplete` and stays there until someone starts checkout explicitly:

7. An officer with `billing:manage` opens `/billing` and starts checkout from the subscription card. `POST /v1/billing/checkout` creates the Stripe Customer (storing `stripe_customer_id`) if the chapter has none, then returns a Checkout URL carrying `chapter_id` in metadata.
8. User completes payment on Stripe and is returned to `/billing?checkout=success`.
9. Stripe webhook (`checkout.session.completed`) fires; API activates chapter (`subscription_status: active`). The redirect does **not** activate the chapter — the client polls for the webhook rather than assuming it has landed.

Checkout is offered at `incomplete` and again at `canceled`; `past_due` recovers through the Customer Portal instead, because its subscription is still live and a second checkout would bill the chapter twice. A `canceled` subscription is terminal at Stripe and the Portal cannot resume it, so checkout is that chapter's only way back — safely, because the server reuses the stored `stripe_customer_id`. See [`spec/behavior/billing.md`](../behavior/billing.md) §Duplicate checkout.

## Chapter Lifecycle

| Status       | Meaning                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `incomplete` | Created but not yet paid.                                                                                                                    |
| `active`     | Subscription current. Full access.                                                                                                           |
| `past_due`   | Payment failed. 3-day grace period (soft lock — can still read, cannot invite).                                                              |
| `canceled`   | Subscription ended. Data preserved, read-only (hard lock) across the guarded surface — see #1546 for the un-guarded routes that still write. |

## Invite System

1. Admin generates an invite token (valid for 24 hours, assigned a role).
2. Token is shared as a link (e.g. `app.frapp.live/join?token=abc123`), or the admin enters a list of email addresses and the API emails each one its own token's join link directly.
3. New user signs up (Supabase Auth) and enters the token.
4. API validates the token (not expired, not used), links user to chapter with the token's role.
5. Token is marked as used.
